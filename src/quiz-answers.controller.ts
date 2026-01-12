import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { QuizService } from './quiz.service';

@Controller('v1/quiz-answers')
@UseGuards(SupabaseGuard)
export class QuizAnswersController {
  constructor(private readonly quizService: QuizService) {}

  @Post()
  async lookupAnswers(
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
