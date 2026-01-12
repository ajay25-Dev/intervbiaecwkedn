import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { SupabaseGuard } from './auth/supabase.guard';
import { SectionExercisesService } from './section-exercises.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

export interface CreateExerciseDto {
  title: string;
  description?: string;
  content?: string;
  type?:
    | 'practice'
    | 'quiz'
    | 'assignment'
    | 'coding'
    | 'sql'
    | 'python'
    | 'excel';
  difficulty?: 'easy' | 'medium' | 'hard';
  time_limit?: number;
  passing_score?: number;
  max_attempts?: number;
  order_index?: number;
  questions?: CreateQuestionDto[];
}

export interface UpdateExerciseDto {
  title?: string;
  description?: string;
  content?: string;
  type?:
    | 'practice'
    | 'quiz'
    | 'assignment'
    | 'coding'
    | 'sql'
    | 'python'
    | 'excel';
  difficulty?: 'easy' | 'medium' | 'hard';
  time_limit?: number;
  passing_score?: number;
  max_attempts?: number;
  order_index?: number;
  status?: 'draft' | 'published' | 'archived';
}

export type QuestionType =
  | 'mcq'
  | 'text'
  | 'fill-in-the-blanks'
  | 'coding'
  | 'interactive'
  | 'dataset';

export type PracticeSubjectType =
  | 'python'
  | 'sql'
  | 'excel'
  | 'statistics'
  | 'r'
  | 'javascript'
  | 'power_bi'
  | 'sheets'
  | 'problem_solving';

export type ExerciseContentType =
  | 'coding'
  | 'interactive_quiz'
  | 'reasoning_problem'
  | 'data_manipulation'
  | 'statistical_analysis'
  | 'power_bi'
  | 'sheets';

export interface QuestionOptionDto {
  id?: string;
  text: string;
  correct: boolean;
  order_index?: number;
}

export interface QuestionAnswerDto {
  id?: string;
  answer_text?: string;
  text?: string;
  correct?: boolean;
  is_case_sensitive?: boolean;
  isCaseSensitive?: boolean;
}

export interface BaseQuestionDto {
  hint?: string;
  explanation?: string;
  points?: number;
  order_index?: number;
  content?: string;
  language?: string;
  subject_type?: PracticeSubjectType;
  execution_enabled?: boolean;
  starter_code?: string;
  test_cases?: any[];
  sample_data?: any;
  expected_runtime?: number;
  difficulty_override?: 'easy' | 'medium' | 'hard';
  exercise_type?: ExerciseContentType;
  subject_focus?: PracticeSubjectType;
  interactive_config?: Record<string, any>;
  validation_logic?: Record<string, any>;
  hints_and_tips?: Record<string, any>;
  options?: QuestionOptionDto[];
  answers?: QuestionAnswerDto[];
}

export interface CreateQuestionDto extends BaseQuestionDto {
  type: QuestionType;
  text: string;
}

export interface UpdateQuestionDto extends Partial<BaseQuestionDto> {
  type?: QuestionType;
  text?: string;
}

export interface UpsertQuestionDatasetDto {
  name?: string;
  subject_type?: PracticeSubjectType;
  creation_sql: string;
  dataset_csv_raw?: string;
  dataset_rows?: any[];
  dataset_columns?: string[];
  dataset_description?: string;
}

@ApiTags('Section Exercises')
@Controller('v1/admin/section-exercises')
@UseGuards(SupabaseGuard)
export class SectionExercisesController {
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  constructor(
    private readonly sectionExercisesService: SectionExercisesService,
  ) {}

  @ApiOperation({ summary: 'Get all exercises for a section' })
  @Get('section/:sectionId')
  async getExercisesBySection(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    await this.ensureAdmin(req);
    const userId = req.user?.sub;
    return this.sectionExercisesService.getExercisesBySection(
      sectionId,
      userId,
    );
  }

  @ApiOperation({ summary: 'Create a new exercise for a section' })
  @Post('section/:sectionId')
  async createExercise(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() createExerciseDto: CreateExerciseDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.createExercise(
      sectionId,
      createExerciseDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Get exercise by ID' })
  @Get(':exerciseId')
  async getExercise(@Req() req: any, @Param('exerciseId') exerciseId: string) {
    await this.ensureAdmin(req);
    return this.sectionExercisesService.getExercise(exerciseId);
  }

  @ApiOperation({ summary: 'Update exercise' })
  @Put(':exerciseId')
  async updateExercise(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Body() updateExerciseDto: UpdateExerciseDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.updateExercise(
      exerciseId,
      updateExerciseDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Delete exercise' })
  @Delete(':exerciseId')
  async deleteExercise(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.deleteExercise(exerciseId, token);
  }

  @ApiOperation({ summary: 'Add question to exercise' })
  @Post(':exerciseId/questions')
  async addQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Body() createQuestionDto: CreateQuestionDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.addQuestion(
      exerciseId,
      createQuestionDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Get questions for exercise' })
  @Get(':exerciseId/questions')
  async getQuestions(@Req() req: any, @Param('exerciseId') exerciseId: string) {
    try {
      await this.ensureAdmin(req);
      return this.sectionExercisesService.getQuestions(exerciseId);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get questions';
      console.error(`Controller error in getQuestions: ${errorMessage}`);
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: errorMessage,
          exerciseId,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({ summary: 'Update question' })
  @Put(':exerciseId/questions/:questionId')
  async updateQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.updateQuestion(
      questionId,
      updateQuestionDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Delete question' })
  @Delete(':exerciseId/questions/:questionId')
  async deleteQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.deleteQuestion(questionId, token);
  }

  @ApiOperation({ summary: 'Upsert dataset for a question' })
  @Put(':exerciseId/questions/:questionId/dataset')
  async upsertQuestionDataset(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() body: UpsertQuestionDatasetDto,
  ) {
    await this.ensureAdmin(req);
    return this.sectionExercisesService.upsertQuestionDataset(questionId, body);
  }

  @ApiOperation({ summary: 'Delete dataset for a question' })
  @Delete(':exerciseId/questions/:questionId/dataset')
  async deleteQuestionDataset(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    await this.ensureAdmin(req);
    return this.sectionExercisesService.deleteQuestionDataset(questionId);
  }

  @ApiOperation({ summary: 'Reorder exercises in section' })
  @Put('section/:sectionId/reorder')
  async reorderExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: { exerciseIds: string[] },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.reorderExercises(
      sectionId,
      body.exerciseIds,
      token,
    );
  }

  @ApiOperation({ summary: 'Publish exercise' })
  @Post(':exerciseId/publish')
  async publishExercise(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.updateExercise(
      exerciseId,
      { status: 'published' },
      token,
    );
  }

  @ApiOperation({ summary: 'Archive exercise' })
  @Post(':exerciseId/archive')
  async archiveExercise(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.sectionExercisesService.updateExercise(
      exerciseId,
      { status: 'archived' },
      token,
    );
  }

  private async ensureAdmin(req: any): Promise<void> {
    const user = req.user;

    if (!user) {
      console.error('ensureAdmin: No user object found in request');
      throw new HttpException(
        {
          statusCode: HttpStatus.UNAUTHORIZED,
          message: 'User not authenticated',
        },
        HttpStatus.UNAUTHORIZED,
      );
    }

    const userId = user.sub || user.id;

    // First, check JWT token for admin role (fast path)
    if (user.role === 'admin') {
      console.log(
        `ensureAdmin: User ${userId} authenticated as admin via JWT token`,
      );
      return;
    }

    // If JWT doesn't have admin role, check profiles table (source of truth)
    try {
      const { data, error } = await this.supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (error) {
        console.error(
          `ensureAdmin: Database error checking profile for user ${userId}`,
          {
            error: error.message,
            userId,
          },
        );
        throw new HttpException(
          {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Failed to verify admin status',
          },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const profileRole = data?.role;
      if (profileRole === 'admin') {
        console.log(
          `ensureAdmin: User ${userId} authenticated as admin via profiles table`,
        );
        return;
      }

      // User is not admin
      console.error(
        `ensureAdmin: User ${userId} denied - role is "${profileRole || 'undefined'}"`,
        {
          userId,
          jwtRole: user.role,
          profileRole: profileRole || 'undefined',
          userEmail: user.email,
        },
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.FORBIDDEN,
          message: `Admin access required. User role is "${profileRole || 'undefined'}", expected "admin"`,
          userRole: profileRole || 'undefined',
        },
        HttpStatus.FORBIDDEN,
      );
    } catch (error) {
      // If it's already an HttpException, rethrow it
      if (error instanceof HttpException) {
        throw error;
      }

      console.error(`ensureAdmin: Unexpected error for user ${userId}`, {
        error: error.message,
        userId,
      });
      throw new HttpException(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Failed to verify admin status',
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
