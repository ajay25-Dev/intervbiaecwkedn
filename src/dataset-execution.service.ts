import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

export interface DatasetExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  columns?: string[];
  rows?: any[];
  datasetInfo?: {
    name: string;
    description: string;
    tableName?: string;
    columns?: string[];
  };
}

@Injectable()
export class DatasetExecutionService {
  private supabase;

  constructor() {
    this.supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE!,
    );
  }

  /**
   * Get dataset for a question based on subject type
   * All subjects now use SQL-based datasets stored in creation_sql
   */
  async getQuestionDataset(
    questionId: string,
    userId: string,
  ): Promise<DatasetExecutionResult> {
    try {
      // Get the dataset information for this question
      const { data: datasetData, error: datasetError } = await this.supabase
        .from('practice_datasets')
        .select('*')
        .eq('question_id', questionId)
        .single();

      if (datasetError) {
        console.error('Error fetching question dataset:', datasetError);
        return {
          success: false,
          error: 'Dataset not found for this question',
        };
      }

      if (!datasetData) {
        return {
          success: false,
          error: 'No dataset available for this question',
        };
      }

      // All subjects use the same SQL-based dataset approach
      return this.getSQLDataset(datasetData);
    } catch (error) {
      console.error('Dataset execution error:', error);
      return {
        success: false,
        error: error.message || 'Failed to load dataset',
      };
    }
  }

  /**
   * Get SQL dataset - works for all subject types now
   * All datasets are stored as SQL creation scripts
   */
  private getSQLDataset(datasetData: any): DatasetExecutionResult {
    return {
      success: true,
      datasetInfo: {
        name: datasetData.name,
        description: datasetData.description,
        tableName: datasetData.table_name,
        columns: datasetData.columns || [],
      },
      data: {
        subject_type: datasetData.subject_type,
        creation_sql: datasetData.creation_sql,
        schema_info: datasetData.schema_info,
        table_name: datasetData.table_name,
        columns: datasetData.columns,
      },
    };
  }

  /**
   * Execute SQL query (for SQL subject type)
   */
  async executeSQL(
    sql: string,
    userId: string,
    questionId?: string,
  ): Promise<any> {
    try {
      let datasetSql = '';

      if (questionId) {
        const datasetResult = await this.getQuestionDataset(questionId, userId);
        if (datasetResult.success && datasetResult.data?.creation_sql) {
          datasetSql = datasetResult.data.creation_sql;
        }
      }

      // Sanitize the SQL to prevent dangerous operations
      const sanitizedSql = this.sanitizeSQL(sql);

      // For now, return a mock result since we need to implement proper SQL sandboxing
      return this.getMockSQLResult(sanitizedSql, datasetSql);
    } catch (error) {
      console.error('SQL execution error:', error);
      throw new Error(`SQL execution failed: ${error.message}`);
    }
  }

  private sanitizeSQL(sql: string): string {
    // Basic SQL sanitization - remove dangerous keywords
    const dangerousKeywords = [
      'DROP',
      'DELETE',
      'UPDATE',
      'INSERT',
      'ALTER',
      'CREATE',
      'TRUNCATE',
      'GRANT',
      'REVOKE',
      'EXEC',
      'EXECUTE',
      'CALL',
    ];

    const sanitized = sql.trim();

    // Check for dangerous keywords at the beginning of statements
    const statements = sanitized.split(';').filter((s) => s.trim());

    for (const statement of statements) {
      const firstWord = statement.trim().split(/\s+/)[0]?.toUpperCase();
      if (dangerousKeywords.includes(firstWord)) {
        throw new Error(`Dangerous SQL operation not allowed: ${firstWord}`);
      }
    }

    return sanitized;
  }

  private getMockSQLResult(sql: string, datasetSql?: string): any[] {
    // Mock result based on common SQL patterns
    const upperSQL = sql.toUpperCase();

    // If we have dataset SQL, try to provide more realistic mock data
    if (datasetSql) {
      const upperDatasetSQL = datasetSql.toUpperCase();

      // Check if dataset creates specific tables
      if (upperDatasetSQL.includes('CREATE TABLE EMPLOYEES')) {
        if (upperSQL.includes('SELECT') && upperSQL.includes('EMPLOYEES')) {
          return [
            {
              id: 1,
              name: 'John Doe',
              department: 'Engineering',
              salary: 75000,
            },
            {
              id: 2,
              name: 'Jane Smith',
              department: 'Marketing',
              salary: 65000,
            },
            { id: 3, name: 'Bob Johnson', department: 'Sales', salary: 55000 },
          ];
        }
      } else if (upperDatasetSQL.includes('CREATE TABLE PRODUCTS')) {
        if (upperSQL.includes('SELECT') && upperSQL.includes('PRODUCTS')) {
          return [
            { id: 1, name: 'Laptop', category: 'Electronics', price: 999.99 },
            { id: 2, name: 'Phone', category: 'Electronics', price: 699.99 },
            { id: 3, name: 'Desk', category: 'Furniture', price: 299.99 },
          ];
        }
      } else if (upperDatasetSQL.includes('CREATE TABLE SALES')) {
        if (upperSQL.includes('SELECT') && upperSQL.includes('SALES')) {
          return [
            {
              id: 1,
              product_id: 1,
              quantity: 2,
              sale_date: '2024-01-15',
              amount: 1999.98,
            },
            {
              id: 2,
              product_id: 2,
              quantity: 1,
              sale_date: '2024-01-16',
              amount: 699.99,
            },
            {
              id: 3,
              product_id: 3,
              quantity: 3,
              sale_date: '2024-01-17',
              amount: 899.97,
            },
          ];
        }
      }
    }

    // Default mock results based on SQL patterns
    if (upperSQL.includes('SELECT') && upperSQL.includes('COUNT')) {
      return [{ count: 42 }];
    } else if (upperSQL.includes('SELECT') && upperSQL.includes('AVG')) {
      return [{ avg: 75.5 }];
    } else if (upperSQL.includes('SELECT') && upperSQL.includes('SUM')) {
      return [{ sum: 1250 }];
    } else if (upperSQL.includes('SELECT')) {
      // Return generic sample data
      return [
        { id: 1, name: 'Sample Record 1', value: 100 },
        { id: 2, name: 'Sample Record 2', value: 200 },
        { id: 3, name: 'Sample Record 3', value: 150 },
      ];
    }

    return [];
  }
}
