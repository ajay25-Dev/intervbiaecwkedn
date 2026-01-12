import {
  Controller,
  Post,
  Get,
  Body,
  Req,
  UseGuards,
  Param,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import {
  PracticeCodingService,
  TestCase,
  ExecutionResult,
} from './practice-coding.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';
import { extractUserIdSafely } from './utils/user-id.util';

interface ExecuteCodeRequest {
  exercise_id: string;
  question_id: string;
  code: string;
  language: string;
  practice_type: string;
  test_cases?: TestCase[];
  run_type?: 'sample' | 'full' | 'submit';
}

@ApiTags('Practice Coding')
@Controller('v1/practice-coding')
@UseGuards(SupabaseGuard)
export class PracticeCodingController {
  constructor(private readonly codingService: PracticeCodingService) {}

  @ApiOperation({ summary: 'Execute code with test cases' })
  @ApiResponse({ status: 200, description: 'Code execution results' })
  @Post('execute')
  async executeCode(
    @Req() req: any,
    @Body() body: ExecuteCodeRequest,
  ): Promise<ExecutionResult> {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Validate input
    if (
      !body.code ||
      !body.language ||
      !body.exercise_id ||
      !body.question_id
    ) {
      throw new Error(
        'Missing required fields: code, language, exercise_id, question_id',
      );
    }

    // Execute the code with test cases
    const result = await this.codingService.execute(
      userId,
      body.exercise_id,
      body.question_id,
      body.code,
      body.language,
      body.practice_type,
      body.test_cases || [],
      body.run_type || 'sample',
      token,
    );

    return result;
  }

  @ApiOperation({ summary: 'Get programming languages' })
  @ApiResponse({
    status: 200,
    description: 'List of supported programming languages',
  })
  @Get('languages')
  async getLanguages() {
    return this.codingService.getSupportedLanguages();
  }

  @ApiOperation({ summary: 'Get user attempts for a question' })
  @ApiResponse({ status: 200, description: 'User coding attempts' })
  @Get('attempts/:questionId')
  async getUserAttempts(
    @Req() req: any,
    @Param('questionId') questionId: string,
    @Query('limit') limit: number = 10,
  ) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.codingService.getUserAttempts(userId, questionId, limit, token);
  }

  @ApiOperation({ summary: 'Get coding progress for user' })
  @ApiResponse({ status: 200, description: 'User coding progress statistics' })
  @Get('progress/:questionId')
  async getProgress(@Req() req: any, @Param('questionId') questionId: string) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.codingService.getUserProgress(userId, questionId, token);
  }

  @ApiOperation({ summary: 'Get practice datasets for a question' })
  @ApiResponse({ status: 200, description: 'Practice datasets' })
  @Get('datasets/:questionId')
  async getDatasets(@Req() req: any, @Param('questionId') questionId: string) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.codingService.getQuestionDatasets(questionId, token);
  }

  @ApiOperation({ summary: 'Get test cases for a coding question' })
  @ApiResponse({
    status: 200,
    description: 'Test cases (non-hidden for students)',
  })
  @Get('test-cases/:questionId')
  async getTestCases(
    @Req() req: any,
    @Param('questionId') questionId: string,
    @Query('include_hidden') includeHidden: boolean = false,
  ) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Check if user is admin to see hidden test cases
    const isAdmin = req.user.role === 'admin';
    const showHidden = includeHidden && isAdmin;

    return this.codingService.getQuestionTestCases(questionId, showHidden);
  }

  @ApiOperation({ summary: 'Submit final solution' })
  @ApiResponse({ status: 200, description: 'Final submission result' })
  @Post('submit')
  async submitSolution(
    @Req() req: any,
    @Body() body: ExecuteCodeRequest,
  ): Promise<ExecutionResult> {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Force run_type to submit for final submissions
    const result = await this.codingService.execute(
      userId,
      body.exercise_id,
      body.question_id,
      body.code,
      body.language,
      body.practice_type,
      body.test_cases || [],
      'submit',
      token,
    );

    return result;
  }

  @ApiOperation({ summary: 'Upload dataset for practice question' })
  @ApiResponse({ status: 201, description: 'Dataset upload result' })
  @Post('datasets/:questionId')
  @UseInterceptors(FileInterceptor('file'))
  async uploadDataset(
    @Req() req: any,
    @Param('questionId') questionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('subject_type') subjectType: string,
  ) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    const result = await this.codingService.processDatasetUpload(
      questionId,
      file,
      subjectType,
      token,
    );
    return result;
  }

  @ApiOperation({ summary: 'Get subject-specific code templates' })
  @ApiResponse({ status: 200, description: 'Code templates for subject type' })
  @Get('templates/:subjectType')
  async getSubjectTemplates(@Param('subjectType') subjectType: string) {
    return this.codingService.getSubjectSpecificTemplates(subjectType);
  }

  @ApiOperation({
    summary: 'Enhanced code execution with subject-specific setup',
  })
  @ApiResponse({ status: 200, description: 'Enhanced execution result' })
  @Post('execute-enhanced')
  async executeEnhanced(
    @Req() req: any,
    @Body()
    body: {
      exercise_id: string;
      question_id: string;
      code: string;
      language: string;
      subject_type: string;
      test_cases?: TestCase[];
      run_type?: 'sample' | 'full' | 'submit';
    },
  ) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');
    const token = req.headers.authorization?.replace('Bearer ', '');

    // Enhance the code for subject-specific execution
    const enhancement =
      await this.codingService.enhanceSubjectSpecificExecution(
        body.code,
        body.language,
        body.subject_type,
        body.question_id,
      );

    // Execute the enhanced code
    const result = await this.codingService.execute(
      userId,
      body.exercise_id,
      body.question_id,
      enhancement.enhancedCode,
      body.language,
      body.subject_type,
      body.test_cases || [],
      body.run_type || 'sample',
      token,
    );

    return result;
  }

  @ApiOperation({
    summary: 'Save practice attempt (for client-side execution)',
  })
  @ApiResponse({ status: 201, description: 'Attempt saved successfully' })
  @Post('save-attempt')
  async saveAttempt(
    @Req() req: any,
    @Body()
    body: {
      exercise_id: string;
      question_id: string;
      code: string;
      language: string;
      test_results: TestCase[];
      score: number;
      passed: boolean;
      execution_time: number;
    },
  ) {
    const userId = extractUserIdSafely(req, 'PracticeCodingController');

    const attemptId = await this.codingService.savePracticeAttempt(
      userId,
      body.exercise_id,
      body.question_id,
      body.code,
      body.language,
      body.test_results,
      body.score,
      body.passed,
      body.execution_time,
    );

    return { attempt_id: attemptId, success: true };
  }
}
