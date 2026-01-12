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
  PracticeExercisesGenerationService,
  SectionBasedExerciseGenerationInput,
} from './practice-exercises-generation.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Section Practice Exercises')
@Controller('v1/sections')
@UseGuards(SupabaseGuard)
export class SectionPracticeController {
  constructor(
    private readonly practiceService: PracticeExercisesGenerationService,
  ) {}

  @ApiOperation({ summary: 'Generate practice exercises for a section' })
  @ApiResponse({
    status: 200,
    description: 'Generated practice exercises for the section',
  })
  @Post(':sectionId/generate-exercises')
  async generateSectionExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body()
    generateRequest: {
      courseId: string;
      subjectId: string;
      sectionTitle: string;
      difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
      exerciseType?:
        | 'sql'
        | 'python'
        | 'google_sheets'
        | 'statistics'
        | 'reasoning'
        | 'math'
        | 'problem_solving'
        | 'geometry';
      questionCount?: number;
      futureTopics?: string[];
      datasetCreationCodingLanguage?: string;
      solutionCodingLanguage?: string;
    },
  ) {
    const userId = req.user?.sub;
    const input: SectionBasedExerciseGenerationInput = {
      ...generateRequest,
      sectionId,
      userId,
      futureTopics: generateRequest.futureTopics,
      datasetCreationCodingLanguage:
        generateRequest.datasetCreationCodingLanguage,
      solutionCodingLanguage: generateRequest.solutionCodingLanguage,
    };

    return this.practiceService.generateSectionExercises(input);
  }

  @ApiOperation({ summary: 'Get existing practice exercises for a section' })
  @ApiResponse({
    status: 200,
    description: 'List of practice exercises for the section',
  })
  @Get(':sectionId/exercises')
  async getSectionExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getSectionExercises(
      sectionId,
      'coding',
      userId,
    );
  }

  @ApiOperation({ summary: 'Get practice exercises for a section by type' })
  @ApiResponse({
    status: 200,
    description: 'List of practice exercises for the section filtered by type',
  })
  @Get(':sectionId/exercises/:exerciseType')
  async getSectionExercisesByType(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Param('exerciseType') exerciseType: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getSectionExercises(
      sectionId,
      exerciseType,
      userId,
    );
  }

  @ApiOperation({ summary: 'Get user exercises for a section' })
  @ApiResponse({
    status: 200,
    description: 'List of user-specific practice exercises for the section',
  })
  @Get(':sectionId/user-exercises')
  async getUserSectionExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getUserSectionExercises(sectionId, userId);
  }

  @ApiOperation({ summary: 'Get exercise with progress' })
  @ApiResponse({
    status: 200,
    description: 'Exercise details with user progress',
  })
  @Get('exercises/:exerciseId/progress')
  async getExerciseProgress(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getExerciseProgress(exerciseId, userId);
  }

  @ApiOperation({ summary: 'Submit answer for a question' })
  @ApiResponse({
    status: 200,
    description: 'Submission result with validation',
  })
  @Post('exercises/:exerciseId/questions/:questionId/submit')
  async submitQuestionAnswer(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body()
    submission: {
      userAnswer: string;
      timeSpent?: number;
    },
  ) {
    const userId = req.user?.sub;
    return this.practiceService.submitQuestionAnswer(
      exerciseId,
      questionId,
      userId,
      submission.userAnswer,
      submission.timeSpent,
    );
  }

  @ApiOperation({ summary: 'Get an AI-generated hint for a question' })
  @ApiResponse({
    status: 200,
    description: 'Encouraging hint or reinforcement message',
  })
  @Post('exercises/:exerciseId/questions/:questionId/hint')
  async generateHint(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body()
    body: {
      userAnswer: string;
    },
  ) {
    const userId = req.user?.sub;
    return this.practiceService.generateHintForQuestion(
      exerciseId,
      questionId,
      userId,
      body.userAnswer,
    );
  }

  @ApiOperation({ summary: 'Get mentor chat session for a question' })
  @ApiResponse({
    status: 200,
    description: 'Mentor chat configuration and existing messages',
  })
  @Get('exercises/:exerciseId/questions/:questionId/chat')
  async getMentorChatSession(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getMentorChatSession(
      exerciseId,
      questionId,
      userId,
    );
  }

  @ApiOperation({ summary: 'Send a new mentor chat message' })
  @ApiResponse({
    status: 200,
    description: 'Updated mentor chat session with the AI response',
  })
  @Post('exercises/:exerciseId/questions/:questionId/chat')
  async sendMentorChatMessage(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body()
    body: {
      message: string;
    },
  ) {
    const userId = req.user?.sub;
    return this.practiceService.sendMentorChatMessage(
      exerciseId,
      questionId,
      userId,
      body.message,
    );
  }

  @ApiOperation({ summary: 'Get dataset creation SQL for a question' })
  @ApiResponse({
    status: 200,
    description: 'Dataset creation SQL',
  })
  @Get('questions/:questionId/dataset')
  async getQuestionDataset(
    @Req() req: any,
    @Param('questionId') questionId: string,
  ) {
    return this.practiceService.getQuestionDataset(questionId);
  }

  @ApiOperation({ summary: 'Get submission history for a question' })
  @ApiResponse({
    status: 200,
    description: 'List of submissions for the question',
  })
  @Get('exercises/:exerciseId/questions/:questionId/submissions')
  async getQuestionSubmissions(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    const userId = req.user?.sub;
    return this.practiceService.getQuestionSubmissions(questionId, userId);
  }
}
