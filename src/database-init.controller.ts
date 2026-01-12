import { Controller, Post, Get } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { createClient } from '@supabase/supabase-js';

@Controller('admin/database')
export class DatabaseInitController {
  @Get('schema')
  async getSchema() {
    try {
      const sqlPath = path.join(
        __dirname,
        '..',
        '..',
        'supabase',
        'migrations',
        '001_create_interview_tables.sql',
      );
      const sql = fs.readFileSync(sqlPath, 'utf-8');
      return { schema: sql };
    } catch (error) {
      return { error: error.message };
    }
  }

  @Post('init')
  async initDatabase() {
    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE;

      if (!supabaseUrl || !supabaseServiceKey) {
        return { error: 'Supabase credentials not configured' };
      }

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Check if tables exist
      try {
        const { data: profilesTable } = await supabase
          .from('interview_profiles')
          .select('id')
          .limit(1);

        if (profilesTable !== null && profilesTable.length >= 0) {
          return { message: 'Tables already exist' };
        }
      } catch (err) {
        // Tables don't exist, continue with creation
      }

      // Tables don't exist, return SQL to be executed manually
      const sqlPath = path.join(
        __dirname,
        '..',
        '..',
        'supabase',
        'migrations',
        '001_create_interview_tables.sql',
      );
      const sql = fs.readFileSync(sqlPath, 'utf-8');

      return {
        message:
          'Tables not found. Please execute the following SQL in your Supabase dashboard SQL Editor:',
        instructions:
          'Go to your Supabase project > SQL Editor > New Query > paste the SQL below > Execute',
        sql: sql,
      };
    } catch (error) {
      return { error: error.message };
    }
  }
}
