import {
  Controller,
  Get,
  Post,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { SubjectSelectionService } from './subject-selection.service';
import { SupabaseGuard } from './auth/supabase.guard';

export interface SelectSubjectsDto {
  selected_subjects: string[];
}

export interface SkipSubjectSelectionDto {
  reason?: string;
}

@Controller('v1/subject-selection')
@UseGuards(SupabaseGuard)
export class SubjectSelectionController {
  constructor(
    private readonly subjectSelectionService: SubjectSelectionService,
  ) {}

  /**
   * Get all subjects from assigned courses for a student
   */
  @Get('available')
  async getAvailableSubjects(@Request() req) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = req.user.sub;
    return this.subjectSelectionService.getAvailableSubjects(userId, token);
  }

  /**
   * Save selected subjects for a student
   */
  @Post('select')
  async selectSubjects(@Request() req, @Body() dto: SelectSubjectsDto) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = req.user.sub;
    return this.subjectSelectionService.saveSelectedSubjects(
      userId,
      dto.selected_subjects,
      token,
    );
  }

  /**
   * Get student's selected subjects
   */
  @Get('selected')
  async getSelectedSubjects(@Request() req) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = req.user.sub;
    return this.subjectSelectionService.getSelectedSubjects(userId, token);
  }

  /**
   * Skip subject selection + assessment and fast-track to the learning path.
   */
  @Post('skip')
  async skipSelection(@Request() req, @Body() dto: SkipSubjectSelectionDto) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = req.user.sub;
    return this.subjectSelectionService.skipSubjectSelectionAndGeneratePath(
      userId,
      token,
      dto?.reason,
    );
  }
}
