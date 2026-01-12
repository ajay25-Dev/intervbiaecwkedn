import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import {
  QuizGenerationService,
  SectionBasedQuizGenerationInput,
} from './quiz-generation.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Section Quizzes')
@Controller('v1/sections')
@UseGuards(SupabaseGuard)
export class SectionQuizController {
  constructor(private readonly quizService: QuizGenerationService) {}

  @ApiOperation({ summary: 'Generate quiz for a section' })
  @ApiResponse({ status: 200, description: 'Generated quiz for the section' })
  @Post(':sectionId/generate-quiz')
  async generateSectionQuiz(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body()
    generateRequest: {
      courseId: string;
      subjectId: string;
      sectionTitle: string;
      difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
      questionCount?: number;
      questionTypes?: string[];
      prevQuizResult?: {
        score: number;
        answers: Record<string, any>;
        feedback?: string;
      };
    },
  ) {
    const input: SectionBasedQuizGenerationInput & {
      prevQuizResult?: {
        score: number;
        answers: Record<string, any>;
        feedback?: string;
      };
    } = {
      ...generateRequest,
      sectionId,
    };

    return this.quizService.generateSectionQuiz(input);
  }

  @ApiOperation({ summary: 'Get existing quizzes for a section' })
  @ApiResponse({ status: 200, description: 'List of quizzes for the section' })
  @Get(':sectionId/quizzes')
  async getSectionQuizzes(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    return this.quizService.getSectionQuizzes(sectionId);
  }
}
