import {
  Controller,
  Get,
  UseGuards,
  Param,
  Post,
  Body,
  Req,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { QuizService } from './quiz.service';

@Controller('v1/quizzes')
@UseGuards(SupabaseGuard)
export class StudentQuizController {
  constructor(private readonly quizService: QuizService) {}

  @Get(':id')
  async getQuizForStudent(@Param('id') id: string) {
    return this.quizService.getQuiz(id);
  }

  @Post(':id/submit')
  async submitQuiz(
    @Param('id') quizId: string,
    @Body()
    body: {
      responses: Array<{
        questionId: string;
        selectedOptionId: string | null;
        isCorrect: boolean;
      }>;
      score: number;
      timeTaken: number;
    },
    @Req() req: any,
  ) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new Error('User not authenticated');
    }

    return this.quizService.submitQuiz(
      quizId,
      userId,
      body.responses,
      body.score,
      body.timeTaken,
    );
  }

  @Post('answers')
  async getQuizAnswers(
    @Body()
    body: {
      questionIds?: Array<string | number | null | undefined>;
    },
  ) {
    const ids = Array.isArray(body?.questionIds)
      ? body.questionIds
          .map((value) =>
            value === null || value === undefined ? null : String(value),
          )
          .filter((value): value is string => Boolean(value?.trim()))
      : [];

    if (!ids.length) {
      return [];
    }

    return this.quizService.getQuizAnswers(ids);
  }
}
