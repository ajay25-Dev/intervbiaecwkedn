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
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { CourseService } from './course.service';
import { ProfilesService } from './profiles.service';
import { SectionExercisesService } from './section-exercises.service';
import { extractUserIdSafely } from './utils/user-id.util';
import { normalizeSectionStatus, SectionStatus } from './section-status.util';
import type {
  CreateQuestionDto,
  UpdateQuestionDto,
  CreateExerciseDto,
} from './section-exercises.controller';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

export interface CreateSectionDto {
  title: string;
  order?: number;
  status?: SectionStatus;
  exercises?: CreateExerciseDto[];
}

export interface UpdateSectionDto {
  title?: string;
  order?: number;
  status?: SectionStatus;
  exercises?: CreateExerciseDto[];
}

export interface CreateLectureDto {
  title: string;
  content: string;
  order?: number;
}

export interface CreateLecturesDto {
  lectures: CreateLectureDto[];
}

@ApiTags('Admin Modules')
@Controller('v1/admin/modules')
@UseGuards(SupabaseGuard)
export class AdminModulesController {
  constructor(
    private readonly courseService: CourseService,
    private readonly profilesService: ProfilesService,
    private readonly sectionExercisesService: SectionExercisesService,
  ) {}

  private async ensureAdmin(req: any): Promise<string> {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = extractUserIdSafely(
      req,
      'AdminModulesController.ensureAdmin',
    );
    const profile = await this.profilesService.ensureProfile(userId, token);
    if ((profile.role || '').toLowerCase() !== 'admin')
      throw new Error('Admin access required');
    return token || '';
  }

  @ApiOperation({ summary: 'Get all sections for a module' })
  @Get(':moduleId/sections')
  async getSectionsByModule(
    @Req() req: any,
    @Param('moduleId') moduleId: string,
  ) {
    const token = await this.ensureAdmin(req);
    return this.courseService.getSectionsByModule(moduleId, token);
  }

  @ApiOperation({ summary: 'Create a new section for a module' })
  @Post(':moduleId/sections')
  async createSection(
    @Req() req: any,
    @Param('moduleId') moduleId: string,
    @Body() createSectionDto: CreateSectionDto,
  ) {
    const token = await this.ensureAdmin(req);
    const status = normalizeSectionStatus(createSectionDto?.status);

    // Create the section
    const sectionResult = await this.courseService.addSection(
      moduleId,
      {
        title: createSectionDto.title,
        order: createSectionDto.order,
        status,
      },
      token,
    );

    // If exercises are provided, create them with their questions
    if (
      Array.isArray(createSectionDto.exercises) &&
      createSectionDto.exercises.length > 0
    ) {
      const createdExercises: any[] = [];
      for (const exerciseDto of createSectionDto.exercises) {
        try {
          const createdExercise =
            await this.sectionExercisesService.createExercise(
              sectionResult.id,
              exerciseDto,
              token,
            );
          createdExercises.push(createdExercise);
        } catch (error) {
          console.error('Error creating exercise:', error);
          // Continue with other exercises even if one fails
        }
      }
      return { ...sectionResult, exercises: createdExercises };
    }

    return sectionResult;
  }

  @ApiOperation({ summary: 'Update a section' })
  @Put('sections/:sectionId')
  async updateSection(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() updateSectionDto: UpdateSectionDto,
  ) {
    const token = await this.ensureAdmin(req);
    const status =
      updateSectionDto.status !== undefined
        ? normalizeSectionStatus(updateSectionDto.status)
        : undefined;

    // Update section metadata
    const sectionResult = await this.courseService.updateSection(
      sectionId,
      {
        title: updateSectionDto.title,
        order: updateSectionDto.order,
        status,
      },
      token,
    );

    // If exercises are provided, create them with their questions
    if (
      Array.isArray(updateSectionDto.exercises) &&
      updateSectionDto.exercises.length > 0
    ) {
      const createdExercises: any[] = [];
      for (const exerciseDto of updateSectionDto.exercises) {
        try {
          const createdExercise =
            await this.sectionExercisesService.createExercise(
              sectionId,
              exerciseDto,
              token,
            );
          createdExercises.push(createdExercise);
        } catch (error) {
          console.error('Error creating exercise:', error);
          // Continue with other exercises even if one fails
        }
      }
      return { ...sectionResult, exercises: createdExercises };
    }

    return sectionResult;
  }

  @ApiOperation({ summary: 'Delete a section' })
  @Delete('sections/:sectionId')
  async deleteSection(@Req() req: any, @Param('sectionId') sectionId: string) {
    const token = await this.ensureAdmin(req);
    await this.courseService.deleteSection(sectionId, token);
    return { ok: true };
  }

  @ApiOperation({ summary: 'Get a specific module with its sections' })
  @Get(':moduleId')
  async getModule(@Req() req: any, @Param('moduleId') moduleId: string) {
    const token = await this.ensureAdmin(req);
    return this.courseService.getModuleWithSections(moduleId, token);
  }

  @ApiOperation({ summary: 'Create multiple lectures for a section' })
  @Post('sections/:sectionId/lectures')
  async createLectures(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() createLecturesDto: CreateLecturesDto,
  ) {
    const token = await this.ensureAdmin(req);
    const results: any[] = [];
    for (const lectureData of createLecturesDto.lectures) {
      const result = await this.courseService.addLecture(
        sectionId,
        {
          title: lectureData.title,
          content: lectureData.content,
          order: lectureData.order,
        },
        token,
      );
      results.push(result);
    }
    return results;
  }

  // ========== Question CRUD Endpoints ==========

  @ApiOperation({ summary: 'Get all questions for an exercise' })
  @Get('sections/:sectionId/exercises/:exerciseId/questions')
  async getQuestions(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Param('exerciseId') exerciseId: string,
  ) {
    await this.ensureAdmin(req);
    return this.sectionExercisesService.getQuestions(exerciseId);
  }

  @ApiOperation({ summary: 'Create a question for an exercise' })
  @Post('sections/:sectionId/exercises/:exerciseId/questions')
  async createQuestion(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Param('exerciseId') exerciseId: string,
    @Body() createQuestionDto: CreateQuestionDto,
  ) {
    const token = await this.ensureAdmin(req);
    return this.sectionExercisesService.addQuestion(
      exerciseId,
      createQuestionDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Update a question' })
  @Put('sections/:sectionId/exercises/:exerciseId/questions/:questionId')
  async updateQuestion(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() updateQuestionDto: UpdateQuestionDto,
  ) {
    const token = await this.ensureAdmin(req);
    return this.sectionExercisesService.updateQuestion(
      questionId,
      updateQuestionDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Delete a question' })
  @Delete('sections/:sectionId/exercises/:exerciseId/questions/:questionId')
  async deleteQuestion(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    const token = await this.ensureAdmin(req);
    return this.sectionExercisesService.deleteQuestion(questionId, token);
  }
}
