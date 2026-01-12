import {
  Controller,
  Post,
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
import { SectionExercisesService } from './section-exercises.service';
import { ExercisesUploadService } from './exercises-upload.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';

export interface BulkExerciseUploadDto {
  exercises: Array<{
    title: string;
    description?: string;
    content?: string;
    type?:
      | 'practice'
      | 'quiz'
      | 'assignment'
      | 'coding'
      | 'sql'
      | 'statistics'
      | 'python'
      | 'excel';
    difficulty?: 'easy' | 'medium' | 'hard';
    time_limit?: number;
    passing_score?: number;
    max_attempts?: number;
    order_index?: number;
    questions?: Array<{
      type: 'mcq' | 'text' | 'fill-in-the-blanks' | 'coding';
      text?: string;
      title?: string;
      description?: string;
      instruction?: string;
      hint?: string;
      explanation?: string;
      points?: number;
      order_index?: number;
      content?: string;
      language?: string;
      programming_language?: string;
      subjects?:
        | { title?: string | null; name?: string | null }
        | Array<{ title?: string | null; name?: string | null } | string>
        | string
        | null;
      options?: Array<{
        text: string;
        correct: boolean;
        order_index?: number;
      }>;
      answers?: Array<{
        answer_text: string;
        is_case_sensitive?: boolean;
      }>;
    }>;
  }>;
}

export interface ExerciseFromTemplateDto {
  template_id: string;
  title: string;
  description?: string;
  customizations?: {
    difficulty?: 'easy' | 'medium' | 'hard';
    time_limit?: number;
    passing_score?: number;
    max_attempts?: number;
  };
}

@ApiTags('Exercise Upload & Bulk Operations')
@Controller('v1/admin/exercises-upload')
@UseGuards(SupabaseGuard)
export class ExercisesUploadController {
  constructor(
    private readonly sectionExercisesService: SectionExercisesService,
    private readonly exercisesUploadService: ExercisesUploadService,
  ) {}

  @ApiOperation({
    summary: 'Upload exercise content file (JSON, CSV, or Excel)',
  })
  @ApiConsumes('multipart/form-data')
  @Post('section/:sectionId/upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads/exercises/imports',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            `exercise-import-${uniqueSuffix}${extname(file.originalname)}`,
          );
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
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
  )
  async uploadExerciseFile(
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
      };
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.exercisesUploadService.processUploadedFile(
      sectionId,
      file.path,
      body.format,
      body.options,
      token,
    );
  }

  @ApiOperation({ summary: 'Bulk create exercises from JSON data' })
  @ApiResponse({ status: 201, description: 'Exercises created successfully' })
  @Post('section/:sectionId/bulk-create')
  async bulkCreateExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() bulkData: BulkExerciseUploadDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.exercisesUploadService.bulkCreateExercises(
      sectionId,
      bulkData.exercises,
      token,
    );
  }

  @ApiOperation({ summary: 'Create exercise from template' })
  @ApiResponse({
    status: 201,
    description: 'Exercise created from template successfully',
  })
  @Post('section/:sectionId/from-template')
  async createFromTemplate(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() templateData: ExerciseFromTemplateDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.exercisesUploadService.createFromTemplate(
      sectionId,
      templateData,
      token,
    );
  }

  @ApiOperation({ summary: 'Upload exercise assets (images, documents, etc.)' })
  @ApiConsumes('multipart/form-data')
  @Post(':exerciseId/upload-assets')
  @UseInterceptors(
    FilesInterceptor('assets', 10, {
      storage: diskStorage({
        destination: './uploads/exercises/assets',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            `exercise-asset-${uniqueSuffix}${extname(file.originalname)}`,
          );
        },
      }),
      limits: {
        fileSize: 25 * 1024 * 1024, // 25MB per file
      },
    }),
  )
  async uploadExerciseAssets(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @UploadedFiles() files: Express.Multer.File[],
    @Body()
    body: {
      asset_type:
        | 'question_image'
        | 'reference_document'
        | 'solution_file'
        | 'template_file';
      descriptions?: string[];
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    const assets = files.map((file, index) => ({
      name: file.originalname,
      url: `/uploads/exercises/assets/${file.filename}`,
      type: body.asset_type,
      size: file.size,
      description: body.descriptions?.[index] || '',
      mime_type: file.mimetype,
    }));

    return this.exercisesUploadService.addAssets(exerciseId, assets, token);
  }

  @ApiOperation({ summary: 'Import exercises from external platform' })
  @Post('section/:sectionId/import-external')
  async importFromExternal(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body()
    importData: {
      platform: 'moodle' | 'blackboard' | 'canvas' | 'google_forms';
      data: any;
      mapping_config?: Record<string, string>;
    },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    return this.exercisesUploadService.importFromExternal(
      sectionId,
      importData.platform,
      importData.data,
      importData.mapping_config,
      token,
    );
  }

  @ApiOperation({ summary: 'Validate exercise data before upload' })
  @Post('validate')
  async validateExerciseData(
    @Req() req: any,
    @Body() data: BulkExerciseUploadDto,
  ) {
    await this.ensureAdmin(req);

    return this.exercisesUploadService.validateExerciseData(data.exercises);
  }

  @ApiOperation({ summary: 'Get upload templates and examples' })
  @Post('templates')
  async getUploadTemplates(
    @Req() req: any,
    @Body() body: { format: 'json' | 'csv' | 'excel' },
  ) {
    await this.ensureAdmin(req);

    return this.exercisesUploadService.getUploadTemplates(body.format);
  }

  private async ensureAdmin(req: any): Promise<void> {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      throw new Error('Admin access required');
    }
  }
}
