import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Pool } from 'pg';
import { InterviewSqlSafetyService } from './interview-sql-safety.service';

export type SqlRunInput = {
  exercise_id: string;
  question_id: string;
  query: string;
  mode?: 'run' | 'submit';
  datasets?: DatasetInfo[];
};

export type SqlRunResult = {
  question_id: string;
  mode: 'run' | 'submit';
  columns: string[];
  rows: Record<string, any>[];
  row_count: number;
  execution_ms: number;
  error?: string;
};

type DatasetInfo = {
  name?: string;
  table_name?: string;
  creation_sql?: string;
  csv_data?: string;
  dataset_csv_raw?: string;
  columns?: string[];
  data?: any[];
  schema_info?: {
    creation_sql?: string;
    dataset_csv_raw?: string;
    dataset_columns?: string[];
  };
};

@Injectable()
export class InterviewSqlSandboxService {
  private pool?: Pool;
  private supabase: SupabaseClient;

  constructor(private readonly safety: InterviewSqlSafetyService) {
    this.supabase = createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE || process.env.SUPABASE_KEY || '',
    );
  }

  async run(input: SqlRunInput): Promise<SqlRunResult> {
    if (!input.question_id) {
      throw new BadRequestException('question_id is required');
    }
    if (!input.query) {
      throw new BadRequestException('query is required');
    }

    const submit = input.mode === 'submit';
    const query = this.safety.assertSafeQuery(input.query);
    const schemaName = this.buildSchemaName(
      input.exercise_id,
      input.question_id,
      submit,
    );

    // Load datasets: use provided datasets, or fetch from Supabase
    const datasets = input.datasets?.length
      ? input.datasets
      : await this.fetchDatasets(input.exercise_id, input.question_id);

    const pool = this.getPool();
    const startedAt = Date.now();
    const client = await pool.connect();

    try {
      await client.query('BEGIN');
      await client.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      await client.query(`CREATE SCHEMA "${schemaName}"`);
      await client.query(`SET LOCAL search_path TO "${schemaName}"`);
      await client.query('SET LOCAL statement_timeout = 10000');

      // Load each dataset into the sandbox schema
      const datasetLoadErrors: string[] = [];
      for (const dataset of datasets) {
        const setupSql = this.buildSetupSql(dataset);
        if (!setupSql) continue;
        try {
          await client.query(setupSql);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[SQL Sandbox] Failed to load dataset "${dataset.name || dataset.table_name}": ${msg}`);
          datasetLoadErrors.push(`Table "${dataset.table_name || dataset.name}": ${msg}`);
        }
      }
      // If datasets were expected but all failed, surface the error instead of silently running
      if (datasets.length > 0 && datasetLoadErrors.length === datasets.length) {
        await client.query('ROLLBACK');
        return {
          question_id: input.question_id,
          mode: submit ? 'submit' : 'run',
          columns: [],
          rows: [],
          row_count: 0,
          execution_ms: Date.now() - startedAt,
          error: `Dataset setup failed — tables could not be created: ${datasetLoadErrors[0]}`,
        };
      }

      const executableQuery = this.safety.shouldApplyRowLimit(query)
        ? `SELECT * FROM (${query}) AS sandbox_result LIMIT 500`
        : query;

      const result = await client.query(executableQuery);
      await client.query('ROLLBACK');

      return {
        question_id: input.question_id,
        mode: submit ? 'submit' : 'run',
        columns: result.fields.map((f) => f.name),
        rows: result.rows,
        row_count: result.rowCount ?? result.rows.length,
        execution_ms: Date.now() - startedAt,
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      const message =
        error instanceof Error ? error.message : 'SQL execution failed';
      return {
        question_id: input.question_id,
        mode: submit ? 'submit' : 'run',
        columns: [],
        rows: [],
        row_count: 0,
        execution_ms: Date.now() - startedAt,
        error: message,
      };
    } finally {
      client.release();
    }
  }

  /** Convert common MySQL-dialect DDL to PostgreSQL-compatible SQL */
  private normalizeSql(sql: string): string {
    return sql
      .replace(/`/g, '"')                                          // backticks → double quotes
      .replace(/\bAUTO_INCREMENT\s*=?\s*\d*/gi, '')               // AUTO_INCREMENT
      .replace(/\bENGINE\s*=\s*\w+/gi, '')                        // ENGINE=InnoDB
      .replace(/\bDEFAULT\s+CHARSET\s*=\s*\w+/gi, '')            // DEFAULT CHARSET=utf8
      .replace(/\bCOLLATE\s*=?\s*\w+/gi, '')                     // COLLATE
      .replace(/\bUNSIGNED\b/gi, '')                              // UNSIGNED
      .replace(/\bTINYINT\b/gi, 'SMALLINT')                       // TINYINT → SMALLINT
      .replace(/\bMEDIUMINT\b/gi, 'INTEGER')
      .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
      .replace(/\bLONGTEXT\b|\bMEDIUMTEXT\b|\bTINYTEXT\b/gi, 'TEXT')
      .replace(/\bDOUBLE\s*\([^)]+\)/gi, 'DOUBLE PRECISION')
      .replace(/\bFLOAT\s*\([^)]+\)/gi, 'REAL')
      .replace(/\bINT\s*\(\s*\d+\s*\)/gi, 'INTEGER')             // INT(11) → INTEGER
      .replace(/\bVARCHAR\s*\(\s*(\d+)\s*\)/gi, 'VARCHAR($1)')   // keep VARCHAR(n) as-is
      .replace(/\bIF NOT EXISTS\b/gi, 'IF NOT EXISTS');           // keep as-is (PostgreSQL supports this)
  }

  private buildSetupSql(dataset: DatasetInfo): string | null {
    // Prefer explicit creation_sql at top level or inside schema_info
    const creationSql =
      dataset.creation_sql || dataset.schema_info?.creation_sql;
    if (creationSql && creationSql.trim()) {
      return this.normalizeSql(creationSql.trim());
    }

    // Fall back to generating CREATE TABLE + INSERT from CSV or row data
    const csvRaw =
      dataset.csv_data ||
      dataset.dataset_csv_raw ||
      dataset.schema_info?.dataset_csv_raw;

    const rows = csvRaw ? this.parseCsv(csvRaw) : (dataset.data ?? []);

    if (!rows.length) return null;

    const tableName = this.sanitizeIdentifier(
      dataset.table_name || dataset.name || 'dataset',
    );
    const columns =
      dataset.columns ||
      dataset.schema_info?.dataset_columns ||
      Object.keys(rows[0]);

    const colDefs = columns
      .map((c) => `"${this.sanitizeIdentifier(c)}" TEXT`)
      .join(', ');

    let sql = `CREATE TABLE IF NOT EXISTS "${tableName}" (${colDefs});\n`;

    for (const row of rows) {
      const values = columns.map((col) => {
        const val = row[col];
        if (val === null || val === undefined) return 'NULL';
        return `'${String(val).replace(/'/g, "''")}'`;
      });
      sql += `INSERT INTO "${tableName}" VALUES (${values.join(', ')});\n`;
    }

    return sql;
  }

  private async fetchDatasets(
    exerciseId: string,
    questionId: string,
  ): Promise<DatasetInfo[]> {
    try {
      const { data, error } = await this.supabase
        .from('interview_practice_datasets')
        .select('*')
        .or(`question_id.eq.${questionId},exercise_id.eq.${exerciseId}`)
        .order('created_at', { ascending: true });

      if (error) {
        console.error('Error fetching SQL datasets:', error);
        return [];
      }

      return (data || []).map((d) => ({
        name: d.name,
        table_name: d.table_name,
        creation_sql: d.creation_sql ?? d.schema_info?.creation_sql,
        csv_data: d.csv_data,
        dataset_csv_raw: d.schema_info?.dataset_csv_raw,
        columns: d.columns,
        data: d.data,
        schema_info: d.schema_info,
      }));
    } catch (err) {
      console.error('Failed to fetch datasets for SQL sandbox:', err);
      return [];
    }
  }

  private parseCsv(csv: string): Record<string, string>[] {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const parseLine = (line: string): string[] => {
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      values.push(current.trim());
      return values.map((v) => v.replace(/^"(.*)"$/, '$1'));
    };

    const headers = parseLine(lines[0]);
    return lines.slice(1).map((line) => {
      const vals = parseLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = vals[i] ?? '';
      });
      return row;
    });
  }

  private buildSchemaName(
    exerciseId: string,
    questionId: string,
    submit: boolean,
  ): string {
    const raw = `sandbox_${exerciseId}_${questionId}_${submit ? 'submit' : 'run'}`;
    return raw
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 60);
  }

  private sanitizeIdentifier(name: string): string {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^[0-9]/, '_$&');
  }

  private getPool(): Pool {
    if (this.pool) return this.pool;
    const connectionString = process.env.SQL_SANDBOX_DATABASE_URL;
    if (!connectionString) {
      throw new InternalServerErrorException(
        'SQL_SANDBOX_DATABASE_URL is not configured',
      );
    }
    this.pool = new Pool({ connectionString, max: 5 });
    return this.pool;
  }
}
