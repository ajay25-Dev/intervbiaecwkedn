import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdminAssessmentService } from './admin-assessment.service';
import { AdminGuard } from './auth/admin.guard';
import { extractUserIdSafely } from './utils/user-id.util';

export interface CreateQuestionDto {
  question_text: string;
  question_type:
    | 'mcq'
    | 'text'
    | 'image_mcq'
    | 'image_text'
    | 'short_text'
    | 'fill_blank';
  category_id?: string;
  module_id?: string;
  difficulty_level: 'easy' | 'medium' | 'hard';
  points_value: number;
  time_limit_seconds: number;
  explanation?: string;
  question_image_url?: string;
  tags?: string[];
  options?: Array<{
    option_text: string;
    is_correct: boolean;
    explanation?: string;
  }>;
  text_answer?: {
    correct_answer: string;
    case_sensitive: boolean;
    exact_match: boolean;
    alternate_answers?: string[];
    keywords?: string[];
  };
}

export interface UpdateQuestionDto extends Partial<CreateQuestionDto> {
  is_active?: boolean;
}

export interface CreateCategoryDto {
  name: string;
  display_name: string;
  description?: string;
  icon?: string;
  color?: string;
  order_index?: number;
}

export interface CreateTemplateDto {
  title: string;
  description?: string;
  instructions?: string;
  category_id?: string;
  module_id?: string;
  time_limit_minutes: number;
  passing_percentage: number;
  randomize_questions: boolean;
  randomize_options: boolean;
  show_results_immediately: boolean;
  allow_retakes: boolean;
  max_attempts?: number;
  difficulty_distribution?: {
    easy: number;
    medium: number;
    hard: number;
  };
  is_public: boolean;
  question_ids: string[];
}

@Controller('v1/admin/assessments')
@UseGuards(SupabaseGuard, AdminGuard)
export class AdminAssessmentController {
  constructor(
    private readonly adminAssessmentService: AdminAssessmentService,
  ) {}

  // ========== Categories Management ==========

  @Get('categories')
  async getCategories(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getCategories(token);
  }

  @Post('categories')
  async createCategory(
    @Body() createCategoryDto: CreateCategoryDto,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.createCategory',
    );
    return this.adminAssessmentService.createCategory(
      createCategoryDto,
      userId,
      token,
    );
  }

  @Put('categories/:id')
  async updateCategory(
    @Param('id') id: string,
    @Body() updateCategoryDto: Partial<CreateCategoryDto>,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.updateCategory(
      id,
      updateCategoryDto,
      token,
    );
  }

  @Delete('categories/:id')
  async deleteCategory(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.deleteCategory(id, token);
  }

  @Get('modules')
  async getModules(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getCourseModules(token);
  }

  // ========== Questions Management ==========

  @Get('questions')
  async getQuestions(
    @Req() req: any,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
    @Query('category_id') category_id?: string,
    @Query('question_type') question_type?: string,
    @Query('module_id') module_id?: string,
    @Query('difficulty_level') difficulty_level?: string,
    @Query('search') search?: string,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getQuestions(
      {
        page,
        limit,
        category_id,
        question_type,
        module_id,
        difficulty_level,
        search,
      },
      token,
    );
  }

  @Get('questions/:id')
  async getQuestionById(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getQuestionById(id, token);
  }

  @Post('questions')
  async createQuestion(
    @Body() createQuestionDto: CreateQuestionDto,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );

    // Validate question data
    this.validateQuestionData(createQuestionDto);

    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.createQuestion',
    );
    return this.adminAssessmentService.createQuestion(
      createQuestionDto,
      userId,
      token,
    );
  }

  @Put('questions/:id')
  async updateQuestion(
    @Param('id') id: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.updateQuestion(
      id,
      updateQuestionDto,
      token,
    );
  }

  @Delete('questions/:id')
  async deleteQuestion(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.deleteQuestion(id, token);
  }

  // ========== Bulk Operations ==========

  @Post('questions/bulk')
  async bulkCreateQuestions(
    @Body() questions: CreateQuestionDto[],
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );

    // Validate all questions
    questions.forEach((q) => this.validateQuestionData(q));

    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.bulkCreateQuestions',
    );
    return this.adminAssessmentService.bulkCreateQuestions(
      questions,
      userId,
      token,
    );
  }

  @Put('questions/:id/toggle-status')
  async toggleQuestionStatus(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.toggleQuestionStatus(id, token);
  }

  // ========== Media Upload ==========

  @Post('upload-image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
      fileFilter: (req, file, callback) => {
        if (!file.mimetype.match(/^image\/(jpeg|png|gif|webp)$/)) {
          return callback(
            new BadRequestException(
              'Only image files (JPEG, PNG, GIF, WebP) are allowed',
            ),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ) {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.uploadImage',
    );
    return this.adminAssessmentService.uploadImage(file, userId, token);
  }

  // ========== Assessment Templates Management ==========

  @Get('templates')
  async getTemplates(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getTemplates(token);
  }

  @Get('templates/:id')
  async getTemplateById(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getTemplateById(id, token);
  }

  @Post('templates')
  async createTemplate(
    @Body() createTemplateDto: CreateTemplateDto,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );

    // Validate template data
    this.validateTemplateData(createTemplateDto);

    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.createTemplate',
    );
    return this.adminAssessmentService.createTemplate(
      createTemplateDto,
      userId,
      token,
    );
  }

  @Put('templates/:id')
  async updateTemplate(
    @Param('id') id: string,
    @Body() updateTemplateDto: Partial<CreateTemplateDto>,
    @Req() req: any,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.updateTemplate(
      id,
      updateTemplateDto,
      token,
    );
  }

  @Delete('templates/:id')
  async deleteTemplate(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.deleteTemplate(id, token);
  }

  // ========== Analytics and Reports ==========

  @Get('analytics/overview')
  async getAnalyticsOverview(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getAnalyticsOverview(token);
  }

  @Get('analytics/questions/:id')
  async getQuestionAnalytics(@Param('id') id: string, @Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getQuestionAnalytics(id, token);
  }

  @Get('reports/student-performance')
  async getStudentPerformanceReport(
    @Req() req: any,
    @Query('template_id') template_id?: string,
    @Query('start_date') start_date?: string,
    @Query('end_date') end_date?: string,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.adminAssessmentService.getStudentPerformanceReport(
      {
        template_id,
        start_date,
        end_date,
      },
      token,
    );
  }

  // ========== Data Seeding ==========

  @Post('seed')
  async seedAssessmentData(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = extractUserIdSafely(
      req,
      'AdminAssessmentController.seedInitialData',
    );
    return this.adminAssessmentService.seedInitialData(userId, token);
  }

  // ========== Validation Methods ==========

  private validateQuestionData(questionDto: CreateQuestionDto): void {
    if (!questionDto.question_text?.trim()) {
      throw new BadRequestException('Question text is required');
    }

    if (!questionDto.question_type) {
      throw new BadRequestException('Question type is required');
    }

    if (!questionDto.module_id) {
      throw new BadRequestException(
        'Module is required for assessment questions',
      );
    }

    if (
      questionDto.question_type === 'mcq' ||
      questionDto.question_type === 'image_mcq'
    ) {
      if (!questionDto.options || questionDto.options.length < 2) {
        throw new BadRequestException(
          'MCQ questions must have at least 2 options',
        );
      }

      const correctOptions = questionDto.options.filter((o) => o.is_correct);
      if (correctOptions.length !== 1) {
        throw new BadRequestException(
          'MCQ questions must have exactly 1 correct option',
        );
      }
    }

    if (
      ['text', 'image_text', 'short_text', 'fill_blank'].includes(
        questionDto.question_type,
      )
    ) {
      if (!questionDto.text_answer?.correct_answer?.trim()) {
        throw new BadRequestException(
          'Text questions must have a correct answer',
        );
      }
    }

    if (questionDto.points_value && questionDto.points_value < 1) {
      throw new BadRequestException('Points value must be at least 1');
    }

    if (questionDto.time_limit_seconds && questionDto.time_limit_seconds < 10) {
      throw new BadRequestException('Time limit must be at least 10 seconds');
    }
  }

  private validateTemplateData(templateDto: CreateTemplateDto): void {
    if (!templateDto.title?.trim()) {
      throw new BadRequestException('Template title is required');
    }

    if (!templateDto.question_ids || templateDto.question_ids.length === 0) {
      throw new BadRequestException('Template must have at least one question');
    }

    if (templateDto.time_limit_minutes && templateDto.time_limit_minutes < 1) {
      throw new BadRequestException('Time limit must be at least 1 minute');
    }

    if (
      templateDto.passing_percentage < 0 ||
      templateDto.passing_percentage > 100
    ) {
      throw new BadRequestException(
        'Passing percentage must be between 0 and 100',
      );
    }

    if (templateDto.max_attempts && templateDto.max_attempts < 1) {
      throw new BadRequestException('Max attempts must be at least 1');
    }

    if (templateDto.difficulty_distribution) {
      const { easy, medium, hard } = templateDto.difficulty_distribution;
      if (easy + medium + hard !== 100) {
        throw new BadRequestException(
          'Difficulty distribution percentages must sum to 100',
        );
      }
    }
  }
}
