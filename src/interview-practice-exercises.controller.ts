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
} from '@nestjs/common';
import { InterviewPracticeExercisesService } from './interview-practice-exercises.service';
import { PracticeCodingService } from './practice-coding.service';
import { PracticeExercisesGenerationService } from './practice-exercises-generation.service';

@Controller('interview-prep')
export class InterviewPracticeExercisesController {
  constructor(
    private readonly exercisesService: InterviewPracticeExercisesService,
    private readonly codingService: PracticeCodingService,
    private readonly practiceService: PracticeExercisesGenerationService,
  ) {}

  private getUserId(req: any): string {
    if (req?.user?.id) return req.user.id;
    if (req?.user?.sub) return req.user.sub;
    if (req?.headers?.['x-user-id']) return String(req.headers['x-user-id']);
    if (process.env.DEV_INTERVIEW_PREP_USER_ID)
      return process.env.DEV_INTERVIEW_PREP_USER_ID;
    return '00000000-0000-0000-0000-000000000000';
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

      const result = await this.codingService.execute(
        userId,
        exerciseId,
        questionId,
        body.code,
        body.language,
        'coding',
        body.test_cases || [],
        'sample',
        token,
        body.datasets || [],
      );

      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new InternalServerErrorException(error.message);
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

      const executionResult = await this.codingService.execute(
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
