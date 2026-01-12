import { Controller, Post, Body, UseGuards, Req } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdaptiveQuizService } from './adaptive-quiz.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Adaptive Quiz')
@Controller('v1/adaptive-quiz')
@UseGuards(SupabaseGuard)
export class AdaptiveQuizController {
  constructor(private readonly adaptiveQuizService: AdaptiveQuizService) {}

  @ApiOperation({ summary: 'Start a new adaptive quiz session' })
  @ApiResponse({ status: 200, description: 'Adaptive quiz session started' })
  @Post('start')
  async startAdaptiveQuiz(
    @Req() req: any,
    @Body()
    startRequest: {
      courseId: string;
      subjectId: string;
      sectionId: string;
      sectionTitle: string;
      userId?: string;
      difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
      targetLength?: number;
      userToken?: string;
    },
  ) {
    const userId = req.user?.sub || startRequest.userId;
    const userToken =
      req.headers.authorization?.substring(7) || startRequest.userToken; // Remove 'Bearer ' prefix if present
    return this.adaptiveQuizService.startAdaptiveQuizSession({
      courseId: startRequest.courseId,
      subjectId: startRequest.subjectId,
      sectionId: startRequest.sectionId,
      sectionTitle: startRequest.sectionTitle,
      userId,
      userToken,
      difficulty: startRequest.difficulty,
      targetLength: startRequest.targetLength,
    });
  }

  @ApiOperation({ summary: 'Resume an active adaptive quiz session' })
  @ApiResponse({
    status: 200,
    description: 'Adaptive quiz session resumed if one exists',
  })
  @Post('resume')
  async resumeAdaptiveQuiz(
    @Req() req: any,
    @Body()
    resumeRequest: {
      sectionId?: string;
      userId?: string;
      userToken?: string;
    },
  ) {
    const userId = req.user?.sub || resumeRequest.userId;
    const userToken =
      req.headers.authorization?.substring(7) || resumeRequest.userToken;

    return this.adaptiveQuizService.resumeAdaptiveQuizSession({
      sectionId: resumeRequest.sectionId,
      userId,
      userToken,
    });
  }

  @ApiOperation({ summary: 'Generate next question in adaptive quiz' })
  @ApiResponse({
    status: 200,
    description: 'Next question generated or quiz completed',
  })
  @Post('next-question')
  async getNextQuestion(
    @Req() req: any,
    @Body()
    nextRequest: {
      sessionId: string;
      userId?: string;
      previousAnswer?: {
        questionId: string;
        selectedOption: string;
        isCorrect: boolean;
      };
    },
  ) {
    const userId = req.user?.sub || nextRequest.userId;
    const userToken = req.headers.authorization?.substring(7); // Remove 'Bearer ' prefix
    return this.adaptiveQuizService.generateNextQuestion({
      ...nextRequest,
      userId,
      userToken,
    });
  }

  @ApiOperation({ summary: 'Get adaptive quiz session summary' })
  @ApiResponse({ status: 200, description: 'Quiz session summary' })
  @Post('summary')
  async getSessionSummary(
    @Req() req: any,
    @Body()
    summaryRequest: {
      sessionId: string;
    },
  ) {
    const userId = req.user?.sub;
    const userToken = req.headers.authorization?.substring(7); // Remove 'Bearer ' prefix
    return this.adaptiveQuizService.getSessionSummary(
      summaryRequest.sessionId,
      userId,
      userToken,
    );
  }

  @ApiOperation({
    summary: 'Check if a section has an active quiz for the user',
  })
  @ApiResponse({ status: 200, description: 'Quiz status for the section' })
  @Post('check-status')
  async checkQuizStatus(
    @Req() req: any,
    @Body()
    statusRequest: {
      sectionId: string;
    },
  ) {
    const userId = req.user?.sub;
    return this.adaptiveQuizService.checkActiveQuizStatus({
      userId,
      sectionId: statusRequest.sectionId,
    });
  }
}
