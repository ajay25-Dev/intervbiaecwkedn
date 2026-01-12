import { Injectable } from '@nestjs/common';
import { DatasetExecutionService } from './dataset-execution.service';

@Injectable()
export class SqlExecutionService {
  constructor(
    private readonly datasetExecutionService: DatasetExecutionService,
  ) {}

  async executeSQL(
    sql: string,
    userId: string,
    questionId?: string,
  ): Promise<any[]> {
    return this.datasetExecutionService.executeSQL(sql, userId, questionId);
  }
}
