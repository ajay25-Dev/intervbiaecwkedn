import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { PracticeExerciseService } from './practice-exercise.service';
import { SupabaseGuard } from './auth/supabase.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { PracticeExerciseAttempt } from './practice-exercise.dto';
import { extractUserIdSafely } from './utils/user-id.util';

@ApiTags('Practice Exercises')
@Controller('v1/practice-exercises')
@UseGuards(SupabaseGuard)
export class PracticeExerciseController {
  constructor(private readonly exerciseService: PracticeExerciseService) {}

  @ApiOperation({ summary: 'Get all practice exercises' })
  @ApiResponse({ status: 200, description: 'List of all practice exercises' })
  @Get()
  async getAllExercises(@Req() req: any) {
    const userId = extractUserIdSafely(req, 'PracticeExerciseController');
    return this.exerciseService.getAllExercises(userId);
  }

  @ApiOperation({ summary: 'Get a single practice exercise by ID' })
  @ApiResponse({ status: 200, description: 'The requested practice exercise' })
  @Get(':exerciseId')
  async getExerciseById(@Param('exerciseId') exerciseId: string) {
    return this.exerciseService.getExerciseById(exerciseId);
  }

  @ApiOperation({ summary: 'Get all questions for a specific exercise' })
  @ApiResponse({
    status: 200,
    description: 'List of questions for the exercise',
  })
  @Get(':exerciseId/questions')
  async getExerciseQuestions(@Param('exerciseId') exerciseId: string) {
    return this.exerciseService.getExerciseQuestions(exerciseId);
  }

  @ApiOperation({
    summary: 'Submit an attempt for a practice exercise question',
  })
  @ApiResponse({ status: 201, description: 'The result of the attempt' })
  @Post('attempt')
  async submitAttempt(
    @Req() req: any,
    @Body() attempt: Partial<PracticeExerciseAttempt>,
  ): Promise<PracticeExerciseAttempt> {
    const userId = extractUserIdSafely(req, 'PracticeExerciseController');
    return this.exerciseService.submitAttempt({ ...attempt, user_id: userId });
  }

  @ApiOperation({ summary: 'Get user attempts for a specific question' })
  @ApiResponse({
    status: 200,
    description: 'List of user attempts for the question',
  })
  @Get('attempts/:questionId')
  async getUserAttemptsForQuestion(
    @Req() req: any,
    @Param('questionId') questionId: string,
  ) {
    const userId = extractUserIdSafely(req, 'PracticeExerciseController');
    return this.exerciseService.getUserAttemptsForQuestion(userId, questionId);
  }

  @ApiOperation({ summary: 'Get all datasets for a specific exercise' })
  @ApiResponse({
    status: 200,
    description: 'List of datasets for the exercise',
  })
  @Get(':exerciseId/datasets')
  async getExerciseDatasets(@Param('exerciseId') exerciseId: string) {
    return this.exerciseService.getExerciseDatasets(exerciseId);
  }
}
