import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { SqlExecutionService } from './sql-execution.service';
import { SupabaseGuard } from './auth/supabase.guard';

@Controller('v1/sql')
@UseGuards(SupabaseGuard)
export class SqlExecutionController {
  constructor(private readonly sqlExecutionService: SqlExecutionService) {}

  @Post('execute')
  async executeSQL(
    @Body() body: { sql: string; questionId?: string },
    @Request() req: any,
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new Error('User not authenticated');
      }

      const result = await this.sqlExecutionService.executeSQL(
        body.sql,
        userId,
        body.questionId,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error) {
      console.error('SQL execution error:', error);
      return {
        success: false,
        error: error.message || 'SQL execution failed',
      };
    }
  }
}
