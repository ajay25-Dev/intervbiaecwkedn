import {
  Controller,
  Post,
  Put,
  Param,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { SupabaseGuard } from './auth/supabase.guard';
import { QuizService } from './quiz.service';
import { QuizUploadService } from './quiz-upload.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';

export interface BulkQuizUploadDto {
  quizzes: Array<{
    title: string;
    description?: string;
    instructions?: string;
    time_limit?: number;
    passing_score?: number;
    max_attempts?: number;
    randomize_questions?: boolean;
    show_results?: boolean;
    order_index?: number;
    questions: Array<{
      type:
        | 'mcq'
        | 'text'
        | 'true_false'
        | 'fill_blank'
        | 'matching'
        | 'ordering';
      text: string;
      content?: string;
      points?: number;
      time_limit?: number;
      order_index?: number;
      explanation?: string;
      hint?: string;
      media?: {
        type: 'image' | 'video' | 'audio';
        url: string;
        alt_text?: string;
      };
      options?: Array<{
        text: string;
        correct: boolean;
        order_index?: number;
        explanation?: string;
      }>;
      correct_answer?: string;
      matching_pairs?: Array<{
        left: string;
        right: string;
      }>;
      ordering_items?: Array<{
        text: string;
        correct_order: number;
      }>;
    }>;
  }>;
}

export interface QuizFromTemplateDto {
  template_id: string;
  title: string;
  description?: string;
  customizations?: {
    time_limit?: number;
    passing_score?: number;
    max_attempts?: number;
    randomize_questions?: boolean;
    question_count?: number;
    difficulty_filter?: 'easy' | 'medium' | 'hard' | 'mixed';
  };
}

export interface QuizSettingsDto {
  time_limit?: number;
  passing_score?: number;
  max_attempts?: number;
  randomize_questions?: boolean;
  randomize_options?: boolean;
  show_results_immediately?: boolean;
  allow_review?: boolean;
  show_correct_answers?: boolean;
  availability_start?: string;
  availability_end?: string;
  late_submission_penalty?: number;
  proctoring_enabled?: boolean;
  browser_lockdown?: boolean;
}

@ApiTags('Quiz Upload & Management')
@Controller('v1/admin/quiz-upload')
@UseGuards(SupabaseGuard)
export class QuizUploadController {
  constructor(
    private readonly quizService: QuizService,
    private readonly quizUploadService: QuizUploadService,
  ) {}

  @ApiOperation({ summary: 'Upload quiz content file (JSON, CSV, or Excel)' })
  @ApiConsumes('multipart/form-data')
  @Post('section/:sectionId/upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/quizzes/imports',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `quiz-import-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'application/json',
          'text/csv',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Only JSON, CSV, and Excel files are allowed'), false);
        }
      },
      limits: {
        fileSize: 15 * 1024 * 1024, // 15MB limit
      },
    }),
  )
  async uploadQuizFile(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body()
    body: {
      format: 'json' | 'csv' | 'excel';
      options?: {
        sheet_name?: string;
        start_row?: number;
        column_mapping?: Record<string, string>;
        include_media?: boolean;
      };
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.processUploadedFile(
      sectionId,
      file.path,
      body.format,
      body.options,
      token,
    );
  }

  @ApiOperation({ summary: 'Bulk create quizzes from JSON data' })
  @ApiResponse({ status: 201, description: 'Quizzes created successfully' })
  @Post('section/:sectionId/bulk-create')
  async bulkCreateQuizzes(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() bulkData: BulkQuizUploadDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.bulkCreateQuizzes(
      sectionId,
      bulkData.quizzes,
      token,
    );
  }

  @ApiOperation({ summary: 'Create quiz from template' })
  @ApiResponse({
    status: 201,
    description: 'Quiz created from template successfully',
  })
  @Post('section/:sectionId/from-template')
  async createFromTemplate(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() templateData: QuizFromTemplateDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.createFromTemplate(
      sectionId,
      templateData,
      token,
    );
  }

  @ApiOperation({ summary: 'Upload quiz media files (images, videos, audio)' })
  @ApiConsumes('multipart/form-data')
  @Post(':quizId/upload-media')
  @UseInterceptors(
    FilesInterceptor('media', 20, {
      storage: diskStorage({
        destination: './uploads/quizzes/media',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `quiz-media-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedTypes = [
          'image/jpeg',
          'image/png',
          'image/gif',
          'image/webp',
          'video/mp4',
          'video/webm',
          'video/ogg',
          'audio/mp3',
          'audio/wav',
          'audio/ogg',
        ];
        if (allowedTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new Error('Only image, video, and audio files are allowed'),
            false,
          );
        }
      },
      limits: {
        fileSize: 100 * 1024 * 1024, // 100MB per file
      },
    }),
  )
  async uploadQuizMedia(
    @Req() req: any,
    @Param('quizId') quizId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      question_ids?: string[];
      alt_texts?: string[];
      descriptions?: string[];
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    const mediaFiles = files.map((file, index) => ({
      name: file.originalname,
      url: `/uploads/quizzes/media/${file.filename}`,
      type: this.getMediaType(file.mimetype),
      size: file.size,
      mime_type: file.mimetype,
      alt_text: body.alt_texts?.[index] || '',
      description: body.descriptions?.[index] || '',
      question_id: body.question_ids?.[index] || null,
    }));

    return this.quizUploadService.addMediaFiles(quizId, mediaFiles, token);
  }

  @ApiOperation({ summary: 'Configure quiz settings' })
  @Put(':quizId/settings')
  async configureQuizSettings(
    @Req() req: any,
    @Param('quizId') quizId: string,
    @Body() settings: QuizSettingsDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.updateQuizSettings(quizId, settings, token);
  }

  @ApiOperation({ summary: 'Import quiz from external platform' })
  @Post('section/:sectionId/import-external')
  async importFromExternal(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body()
    importData: {
      platform:
        | 'moodle'
        | 'blackboard'
        | 'canvas'
        | 'google_forms'
        | 'kahoot'
        | 'quizizz';
      data: any;
      mapping_config?: Record<string, string>;
      import_settings?: {
        preserve_formatting?: boolean;
        import_media?: boolean;
        convert_question_types?: boolean;
      };
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.importFromExternal(
      sectionId,
      importData.platform,
      importData.data,
      importData.mapping_config,
      importData.import_settings,
      token,
    );
  }

  @ApiOperation({ summary: 'Generate quiz from question bank' })
  @Post('section/:sectionId/generate-from-bank')
  async generateFromQuestionBank(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body()
    generationData: {
      title: string;
      description?: string;
      question_count: number;
      difficulty_distribution?: {
        easy?: number;
        medium?: number;
        hard?: number;
      };
      topic_filters?: string[];
      question_types?: string[];
      exclude_used_questions?: boolean;
      settings?: QuizSettingsDto;
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.generateFromQuestionBank(
      sectionId,
      generationData,
      token,
    );
  }

  @ApiOperation({ summary: 'Validate quiz data before upload' })
  @Post('validate')
  async validateQuizData(@Req() req: any, @Body() data: BulkQuizUploadDto) {
    await this.ensureAdmin(req);

    return this.quizUploadService.validateQuizData(data.quizzes);
  }

  @ApiOperation({ summary: 'Get quiz upload templates and examples' })
  @Post('templates')
  async getUploadTemplates(
    @Req() req: any,
    @Body()
    body: {
      format: 'json' | 'csv' | 'excel';
      question_types?: string[];
      include_advanced?: boolean;
    },
  ) {
    await this.ensureAdmin(req);

    return this.quizUploadService.getUploadTemplates(
      body.format,
      body.question_types,
      body.include_advanced,
    );
  }

  @ApiOperation({ summary: 'Preview quiz before publishing' })
  @Post(':quizId/preview')
  async previewQuiz(
    @Req() req: any,
    @Param('quizId') quizId: string,
    @Body()
    options: {
      randomize?: boolean;
      question_limit?: number;
      show_answers?: boolean;
    },
  ) {
    await this.ensureAdmin(req);

    return this.quizUploadService.generateQuizPreview(quizId, options);
  }

  @ApiOperation({ summary: 'Duplicate quiz to another section' })
  @Post(':quizId/duplicate')
  async duplicateQuiz(
    @Req() req: any,
    @Param('quizId') quizId: string,
    @Body()
    duplicateData: {
      target_section_id: string;
      new_title?: string;
      include_media?: boolean;
      include_settings?: boolean;
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.quizUploadService.duplicateQuiz(
      quizId,
      duplicateData.target_section_id,
      duplicateData,
      token,
    );
  }

  private async ensureAdmin(req: any): Promise<void> {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      throw new Error('Admin access required');
    }
  }

  private getMediaType(mimetype: string): 'image' | 'video' | 'audio' {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    return 'image'; // default
  }
}
