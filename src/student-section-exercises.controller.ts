import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { SectionExercisesService } from './section-exercises.service';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Student Section Exercises')
@ApiBearerAuth()
@Controller('v1/sections')
@UseGuards(SupabaseGuard)
export class StudentSectionExercisesController {
  constructor(
    private readonly sectionExercisesService: SectionExercisesService,
  ) {}

  @ApiOperation({ summary: 'Get exercises for a section (student view)' })
  @Get(':sectionId/exercises')
  async getExercisesBySection(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    const userId = req.user?.sub; // From SupabaseGuard
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.sectionExercisesService.getExercisesBySection(
      sectionId,
      userId,
    );
  }

  @ApiOperation({ summary: 'Get dataset for a specific question' })
  @Get('questions/:questionId/dataset')
  async getQuestionDataset(
    @Req() req: any,
    @Param('questionId') questionId: string,
  ) {
    const userId = req.user?.sub; // From SupabaseGuard
    if (!userId) {
      throw new Error('User not authenticated');
    }
    return this.sectionExercisesService.getQuestionDataset(questionId, userId);
  }
}
