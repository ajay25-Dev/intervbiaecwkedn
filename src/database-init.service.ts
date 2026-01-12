import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class DatabaseInitService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn(
        'SUPABASE_URL or SUPABASE_SERVICE_ROLE not set, skipping database init',
      );
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseServiceKey);
  }

  async initializeDatabase() {
    try {
      console.log('[DatabaseInit] Checking if interview tables exist...');

      try {
        const { data, error } = await this.supabase
          .from('interview_profiles')
          .select('id')
          .limit(1);

        if (data !== null) {
          console.log('[DatabaseInit] Tables already exist');
          return;
        }
      } catch (err) {
        // Table doesn't exist, proceed with creation
      }

      console.log('[DatabaseInit] Tables not found, creating schema...');
      await this.createTablesViaSql();
    } catch (error) {
      console.error('[DatabaseInit] Error during initialization:', error);
    }
  }

  private async createTablesViaSql() {
    try {
      const sqlPath = path.join(
        __dirname,
        '..',
        '..',
        'supabase',
        'migrations',
        '001_create_interview_tables.sql',
      );

      if (!fs.existsSync(sqlPath)) {
        console.warn('[DatabaseInit] Migration file not found at', sqlPath);
        return;
      }

      const sql = fs.readFileSync(sqlPath, 'utf-8');
      const statements = sql.split(';').filter((s) => s.trim().length > 0);

      console.log(
        `[DatabaseInit] Executing ${statements.length} SQL statements...`,
      );

      for (const statement of statements) {
        try {
          // Try using rpc if available, otherwise log and skip
          const { error } = await this.supabase.rpc('exec_sql', {
            sql: statement + ';',
          });

          if (error && !error.message?.includes('already exists')) {
            console.warn(
              '[DatabaseInit] Warning executing statement:',
              error.message,
            );
          }
        } catch (err) {
          console.warn('[DatabaseInit] Could not execute via RPC:', err);
        }
      }

      console.log('[DatabaseInit] Schema creation completed');
    } catch (error) {
      console.error('[DatabaseInit] Error in createTablesViaSql:', error);
    }
  }
}
