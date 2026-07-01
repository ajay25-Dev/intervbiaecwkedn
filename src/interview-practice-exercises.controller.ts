import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  HttpException,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { InterviewPracticeExercisesService } from './interview-practice-exercises.service';
import { PracticeCodingService } from './practice-coding.service';
import { PracticeExercisesGenerationService } from './practice-exercises-generation.service';
import { InterviewSqlSandboxService } from './interview-sql-sandbox.service';
import { SupabaseGuard } from './auth/supabase.guard';

@Controller('interview-prep')
@UseGuards(SupabaseGuard)
export class InterviewPracticeExercisesController {
  private readonly nonExecutableLanguages = new Set([
    'google_sheets',
    'google sheets',
    'google sheet',
    'excel',
    'power_bi',
    'power bi',
    'reasoning',
    'problem_solving',
    'problem solving',
    'math',
    'geometry',
    'behavioral',
    'communication',
  ]);

  constructor(
    private readonly exercisesService: InterviewPracticeExercisesService,
    private readonly codingService: PracticeCodingService,
    private readonly practiceService: PracticeExercisesGenerationService,
    private readonly sqlSandbox: InterviewSqlSandboxService,
  ) {}

  private getUserId(req: any): string {
    const userId = req?.user?.sub || req?.user?.id;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return userId;
  }

  private isNonExecutableLanguage(language?: string): boolean {
    return this.nonExecutableLanguages.has(String(language || '').trim().toLowerCase());
  }

  @Get('practice-exercises')
  async getExercises(
    @Query('subject') subject?: string,
    @Query('difficulty') difficulty?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.exercisesService.getExercises({
      subject,
      difficulty,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('practice-exercises/:exerciseId')
  async getExerciseDetail(@Param('exerciseId') exerciseId: string) {
    try {
      return await this.exercisesService.getExerciseDetail(exerciseId);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error.message);
    }
  }

  @Get('exercises/:exerciseId/questions/:questionId')
  async getQuestionData(
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    try {
      return await this.exercisesService.getQuestionData(
        exerciseId,
        questionId,
      );
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error.message);
    }
  }

  @Get('exercises/:exerciseId/datasets/:datasetId')
  async getDatasetPreview(
    @Param('exerciseId') exerciseId: string,
    @Param('datasetId') datasetId: string,
    @Query('limit') limit?: string,
  ) {
    try {
      return await this.exercisesService.getDatasetPreview(
        exerciseId,
        datasetId,
        limit ? parseInt(limit, 10) : 50,
      );
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new InternalServerErrorException(error.message);
    }
  }

  @Post('exercises/:exerciseId/questions/:questionId/execute')
  async executeCode(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body()
    body: {
      code?: string;
      query?: string;
      language: string;
      mode?: 'run' | 'submit';
      test_cases?: any[];
      datasets?: any[];
    },
  ) {
    try {
      const normalizedLanguage = (body.language || '').trim().toLowerCase();

      // SQL questions: use PostgreSQL sandbox
      if (normalizedLanguage === 'sql') {
        const query = body.query || body.code || '';
        if (!query) {
          throw new BadRequestException('query is required for SQL execution');
        }
        return await this.sqlSandbox.run({
          exercise_id: exerciseId,
          question_id: questionId,
          query,
          mode: body.mode || 'run',
          datasets: body.datasets,
        });
      }

      // Python/other: use Judge0 via PracticeCodingService
      if (!body.code) {
        throw new BadRequestException('code is required');
      }
      if (!body.language) {
        throw new BadRequestException('language is required');
      }

      const userId = this.getUserId(req);
      const token = req?.headers?.authorization || '';

      return await this.codingService.execute(
        userId,
        exerciseId,
        questionId,
        body.code,
        body.language,
        'coding',
        body.test_cases || [],
        body.mode === 'submit' ? 'submit' : 'sample',
        token,
        body.datasets || [],
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(
        error instanceof Error ? error.message : 'Execution failed',
      );
    }
  }

  @Post('exercises/:exerciseId/questions/:questionId/submit')
  async submitAnswer(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body()
    body: {
      code: string;
      language: string;
      test_cases?: any[];
      datasets?: any[];
    },
  ) {
    try {
      if (!body.code || !body.language) {
        throw new BadRequestException('Code and language are required');
      }

      const userId = this.getUserId(req);
      const token = req?.headers?.authorization || '';
      const skipExecution = this.isNonExecutableLanguage(body.language);

      const executionResult = skipExecution
        ? {
            success: true,
            passed: false,
            score: 0,
            total_points: 0,
            test_results: [],
            overall_result: {
              stdout: '',
              stderr: '',
              execution_time: 0,
              memory_used: 0,
              exit_code: 0,
            },
          }
        : await this.codingService.execute(
            userId,
            exerciseId,
            questionId,
            body.code,
            body.language,
            'coding',
            body.test_cases || [],
            'submit',
            token,
            body.datasets || [],
            true,
          );

      // Only attempt to save to permanent storage if it's a real exercise
      let attemptId = executionResult.attempt_id;
      if (!exerciseId.startsWith('plan-')) {
        try {
          attemptId = await this.exercisesService.saveAttempt(
            userId,
            exerciseId,
            questionId,
            body.code,
            body.language,
            executionResult,
          );
        } catch (e) {
          console.error('Failed to save attempt metadata:', e);
          // Don't fail the request if just saving metadata fails, as we have the execution result
        }
      }

      let aiEvaluationResult: Awaited<
        ReturnType<
          PracticeExercisesGenerationService['submitInterviewQuestionAnswer']
        >
      > | null = null;
      if (!exerciseId.startsWith('plan-')) {
        try {
          aiEvaluationResult =
            await this.practiceService.submitInterviewQuestionAnswer(
              exerciseId,
              questionId,
              userId,
              body.code,
              executionResult.overall_result?.execution_time ?? undefined,
            );
        } catch (error) {
          console.error(
            'Failed to capture AI evaluation for interview submission:',
            error,
          );
        }
      }

      return {
        ...executionResult,
        attempt_id: attemptId,
        aiEvaluation: aiEvaluationResult,
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(error.message);
    }
  }

  @Get('exercises/:exerciseId/questions/:questionId/submissions')
  async getInterviewQuestionSubmissions(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    try {
      const userId = this.getUserId(req);
      const submissionsResult =
        await this.exercisesService.getInterviewQuestionSubmissions(
          userId,
          exerciseId,
          questionId,
        );

      const submissions =
        Array.isArray(submissionsResult?.submissions) &&
        submissionsResult.submissions.length > 0
          ? submissionsResult.submissions
          : [];

      return {
        submissions,
        total: submissionsResult?.total ?? submissions.length,
        success:
          typeof submissionsResult?.success === 'boolean'
            ? submissionsResult.success
            : submissions.length > 0,
      };
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  @Post('exercises/:exerciseId/questions/:questionId/hint')
  async requestHint(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() body: { current_code?: string },
  ) {
    try {
      const userId = this.getUserId(req);
      const userAnswer =
        typeof body?.current_code === 'string' ? body.current_code : '';

      const hintResult = await this.practiceService.generateHintForQuestion(
        exerciseId,
        questionId,
        userId,
        userAnswer,
      );

      if (!hintResult) {
        return {
          success: false,
          message: 'Hint unavailable',
        };
      }

      return {
        success: true,
        message: hintResult.message,
        hint: hintResult.message,
        verdict: hintResult.verdict,
        rawResponse: hintResult.raw_response ?? null,
      };
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  @Post('exercises/:exerciseId/questions/:questionId/chat')
  async sendChatMessage(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() body: { message: string; conversation_history?: any[] },
  ) {
    try {
      if (!body.message) {
        throw new BadRequestException('Message is required');
      }

      return {
        role: 'mentor',
        content: 'Mentor support coming soon',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  @Post('exercises/:exerciseId/progress')
  async saveProgress(
    @Request() req,
    @Param('exerciseId') exerciseId: string,
    @Body()
    body: {
      question_id: string;
      code: string;
      language: string;
      execution_results?: any;
      submitted: boolean;
      timestamp: string;
    },
  ) {
    try {
      const userId = this.getUserId(req);

      if (!body.question_id) {
        throw new BadRequestException('question_id is required');
      }

      await this.exercisesService.saveAttempt(
        userId,
        exerciseId,
        body.question_id,
        body.code,
        body.language,
        body.execution_results,
      );

      return {
        success: true,
        message: 'Progress saved',
      };
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }
}
