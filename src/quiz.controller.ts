import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { QuizService } from './quiz.service';

@Controller('v1/admin/quizzes')
@UseGuards(SupabaseGuard)
export class QuizController {
  constructor(private readonly quizService: QuizService) {}

  @Post()
  async createQuiz(@Body() quiz: { title: string; section_id: string }) {
    return this.quizService.createQuiz(quiz.title, quiz.section_id);
  }

  @Put(':id')
  async updateQuiz(
    @Param('id') id: string,
    @Body() quiz: { title: string; section_id: string },
  ) {
    return this.quizService.updateQuiz(id, quiz.title, quiz.section_id);
  }

  @Delete(':id')
  async deleteQuiz(@Param('id') id: string) {
    return this.quizService.deleteQuiz(id);
  }

  @Get(':id')
  async getQuiz(@Param('id') id: string) {
    return this.quizService.getQuiz(id);
  }

  @Get('by-section/:sectionId')
  async getQuizzesBySection(@Param('sectionId') sectionId: string) {
    return this.quizService.getQuizzesBySection(sectionId);
  }

  @Post(':quizId/questions')
  async createQuestion(
    @Param('quizId') quizId: string,
    @Body()
    question: {
      type: string;
      text: string;
      order_index: number;
      content: string;
    },
  ) {
    return this.quizService.createQuestion(
      quizId,
      question.type,
      question.text,
      question.order_index,
      question.content,
    );
  }

  @Put('questions/:id')
  async updateQuestion(
    @Param('id') id: string,
    @Body()
    question: {
      type: string;
      text: string;
      order_index: number;
      content: string;
    },
  ) {
    return this.quizService.updateQuestion(
      id,
      question.type,
      question.text,
      question.order_index,
      question.content,
    );
  }

  @Delete('questions/:id')
  async deleteQuestion(@Param('id') id: string) {
    return this.quizService.deleteQuestion(id);
  }

  @Get('questions/by-quiz/:quizId')
  async getQuestionsByQuiz(@Param('quizId') quizId: string) {
    return this.quizService.getQuestionsByQuiz(quizId);
  }

  @Post('questions/:questionId/options')
  async createOption(
    @Param('questionId') questionId: string,
    @Body() option: { text: string; correct: boolean },
  ) {
    return this.quizService.createOption(
      questionId,
      option.text,
      option.correct,
    );
  }

  @Put('options/:id')
  async updateOption(
    @Param('id') id: string,
    @Body() option: { text: string; correct: boolean },
  ) {
    return this.quizService.updateOption(id, option.text, option.correct);
  }

  @Delete('options/:id')
  async deleteOption(@Param('id') id: string) {
    return this.quizService.deleteOption(id);
  }

  @Get('options/by-question/:questionId')
  async getOptionsByQuestion(@Param('questionId') questionId: string) {
    return this.quizService.getOptionsByQuestion(questionId);
  }
}
