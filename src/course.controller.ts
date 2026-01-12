import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { ProfilesService } from './profiles.service';
import { CourseService } from './course.service';
import { SectionExercisesService } from './section-exercises.service';
import {
  CreateQuestionDto,
  QuestionAnswerDto,
  QuestionOptionDto,
  UpdateQuestionDto,
} from './section-exercises.controller';
import { normalizeSectionStatus } from './section-status.util';

function assertString(v: any, name: string) {
  if (typeof v !== 'string' || v.trim() === '')
    throw new Error(`${name} is required`);
  return v.trim();
}

@Controller('v1')
export class CourseController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly courses: CourseService,
    private readonly sectionExercisesService: SectionExercisesService,
  ) {}

  private async ensureAdmin(req: any): Promise<string> {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const profile = await this.profiles.ensureProfile(req.user.sub, token);
    if ((profile.role || '').toLowerCase() !== 'admin')
      throw new ForbiddenException('Admin access required');
    return token || '';
  }

  // List courses
  @UseGuards(SupabaseGuard)
  @Get('courses')
  async list(@Req() req: any) {
    await this.ensureAdmin(req);
    return await this.courses.listCourses(
      (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      ),
    );
  }

  // Create course
  @UseGuards(SupabaseGuard)
  @Post('courses')
  async createCourse(@Req() req: any, @Body() body: any) {
    const token = await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const description =
      typeof body?.description === 'string' ? body.description : null;
    return await this.courses.createCourse(
      req.user.sub,
      { title, description },
      token,
    );
  }

  // Update course
  @UseGuards(SupabaseGuard)
  @Put('courses/:id')
  async updateCourse(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const description =
      typeof body?.description === 'string'
        ? body.description
        : body?.description === null
          ? null
          : undefined;
    const status = typeof body?.status === 'string' ? body.status : undefined;
    const difficulty =
      typeof body?.difficulty === 'string' ? body.difficulty : undefined;
    const category =
      typeof body?.category === 'string'
        ? body.category
        : body?.category === null
          ? null
          : undefined;
    const duration =
      typeof body?.duration === 'number'
        ? body.duration
        : body?.duration === null
          ? null
          : undefined;
    const enrolled_count =
      typeof body?.enrolled_count === 'number'
        ? body.enrolled_count
        : body?.enrolled_count === null
          ? null
          : undefined;
    return await this.courses.updateCourse(
      id,
      {
        title,
        description,
        status,
        difficulty,
        category,
        duration,
        enrolled_count,
      },
      token,
    );
  }

  // Delete course
  @UseGuards(SupabaseGuard)
  @Delete('courses/:id')
  async deleteCourse(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteCourse(id, token);
    return { ok: true };
  }

  // Add subject
  @UseGuards(SupabaseGuard)
  @Post('courses/:courseId/subjects')
  async addSubject(
    @Req() req: any,
    @Param('courseId') courseId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addSubject(courseId, { title, order }, token);
  }

  // Add module
  @UseGuards(SupabaseGuard)
  @Post('subjects/:subjectId/modules')
  async addModule(
    @Req() req: any,
    @Param('subjectId') subjectId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addModule(subjectId, { title, order }, token);
  }

  // Update subject
  @UseGuards(SupabaseGuard)
  @Put('subjects/:id')
  async updateSubject(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updateSubject(id, { title, order }, token);
  }

  // Delete subject
  @UseGuards(SupabaseGuard)
  @Delete('subjects/:id')
  async deleteSubject(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteSubject(id, token);
    return { ok: true };
  }

  // Add section
  @UseGuards(SupabaseGuard)
  @Post('modules/:moduleId/sections')
  async addSection(
    @Req() req: any,
    @Param('moduleId') moduleId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const status = normalizeSectionStatus(body?.status);
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addSection(
      moduleId,
      { title, order, status },
      token,
    );
  }

  // Update module
  @UseGuards(SupabaseGuard)
  @Put('modules/:id')
  async updateModule(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updateModule(id, { title, order }, token);
  }

  // Delete module
  @UseGuards(SupabaseGuard)
  @Delete('modules/:id')
  async deleteModule(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteModule(id, token);
    return { ok: true };
  }

  // Update section
  @UseGuards(SupabaseGuard)
  @Put('sections/:id')
  async updateSection(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    const status =
      body?.status !== undefined
        ? normalizeSectionStatus(body.status)
        : undefined;
    return await this.courses.updateSection(
      id,
      { title, order, status },
      token,
    );
  }

  // Delete section
  @UseGuards(SupabaseGuard)
  @Delete('sections/:id')
  async deleteSection(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteSection(id, token);
    return { ok: true };
  }

  // Upsert lecture
  @UseGuards(SupabaseGuard)
  @Post('sections/:sectionId/lecture')
  async upsertLecture(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const content = assertString(body?.content ?? '', 'content');
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.upsertLecture(
      sectionId,
      { title, content },
      token,
    );
  }

  @UseGuards(SupabaseGuard)
  @Put('lectures/:id')
  async updateLecture(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const content =
      typeof body?.content === 'string'
        ? body.content
        : body?.content === null
          ? null
          : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updateLecture(
      id,
      { title, content, order },
      token,
    );
  }

  @UseGuards(SupabaseGuard)
  @Delete('lectures/:id')
  async deleteLecture(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteLecture(id, token);
    return { ok: true };
  }

  // Add practice exercise
  @UseGuards(SupabaseGuard)
  @Post('sections/:sectionId/practice-exercises')
  async addPractice(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    try {
      const title = assertString(body?.title, 'title');
      const order = typeof body?.order === 'number' ? body.order : null;
      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );
      // const content = this.buildPracticeContent(body);
      const content = body?.content;

      return await this.courses.addPractice(
        sectionId,
        {
          title,
          content,
          order,
          description: body?.instructions || '',
          programming_language: body?.language || '',
        },
        token,
      );
    } catch (e) {
      console.error('�?O addPractice failed', { sectionId, body, error: e });
      throw e; // Nest will log stack trace
    }
  }

  private buildPracticeContent(body: any): string {
    const structured = this.maybeBuildStructuredPracticeContent(body);
    if (structured !== undefined) return structured;
    return assertString(body?.content ?? '', 'content');
  }

  private maybeBuildStructuredPracticeContent(body: any): string | undefined {
    if (!body || typeof body !== 'object') return undefined;

    const structuredKeys = [
      'exerciseType',
      'instructions',
      'exerciseInstructions',
      'starterCode',
      'codeTemplate',
      'expectedOutput',
      'solutionOutline',
      'solution',
      'datasetUrl',
      'evaluationCriteria',
      'resources',
      'hints',
      'difficulty',
    ];

    const hasStructured = structuredKeys.some(
      (key) => body?.[key] !== undefined,
    );

    if (!hasStructured) return undefined;

    const instructionsSource =
      typeof body?.instructions === 'string'
        ? body.instructions
        : typeof body?.exerciseInstructions === 'string'
          ? body.exerciseInstructions
          : typeof body?.content === 'string'
            ? body.content
            : '';

    const instructions = assertString(instructionsSource, 'instructions');

    const exerciseTypeRaw =
      typeof body?.exerciseType === 'string'
        ? body.exerciseType
        : typeof body?.type === 'string'
          ? body.type
          : 'coding';

    const exerciseType =
      (exerciseTypeRaw || 'coding').toString().trim().toLowerCase() || 'coding';

    const payload: Record<string, any> = {
      version: 1,
      exerciseType,
      instructions,
    };

    const starterCode =
      typeof body?.starterCode === 'string'
        ? body.starterCode
        : typeof body?.codeTemplate === 'string'
          ? body.codeTemplate
          : undefined;
    if (typeof starterCode === 'string' && starterCode.trim() !== '') {
      payload.starterCode = starterCode;
    }

    const expectedOutput =
      typeof body?.expectedOutput === 'string'
        ? body.expectedOutput
        : undefined;
    if (typeof expectedOutput === 'string' && expectedOutput.trim() !== '') {
      payload.expectedOutput = expectedOutput;
    }

    const solutionOutline =
      typeof body?.solutionOutline === 'string'
        ? body.solutionOutline
        : typeof body?.solution === 'string'
          ? body.solution
          : undefined;
    if (typeof solutionOutline === 'string' && solutionOutline.trim() !== '') {
      payload.solutionOutline = solutionOutline;
    }

    const datasetUrl =
      typeof body?.datasetUrl === 'string' ? body.datasetUrl : undefined;
    if (typeof datasetUrl === 'string' && datasetUrl.trim() !== '') {
      payload.datasetUrl = datasetUrl;
    }

    const evaluationCriteria =
      typeof body?.evaluationCriteria === 'string'
        ? body.evaluationCriteria
        : undefined;
    if (
      typeof evaluationCriteria === 'string' &&
      evaluationCriteria.trim() !== ''
    ) {
      payload.evaluationCriteria = evaluationCriteria;
    }

    const hints =
      typeof body?.hints === 'string'
        ? body.hints
        : Array.isArray(body?.hints)
          ? body.hints.filter(
              (hint) => typeof hint === 'string' && hint.trim().length > 0,
            )
          : undefined;

    if (Array.isArray(hints) && hints.length > 0) {
      payload.hints = hints;
    } else if (typeof hints === 'string' && hints.trim() !== '') {
      payload.hints = hints;
    }

    const resources = Array.isArray(body?.resources)
      ? body.resources.filter(
          (item: any) => typeof item === 'string' && item.trim().length > 0,
        )
      : undefined;
    if (resources && resources.length > 0) {
      payload.resources = resources;
    }

    const difficulty =
      typeof body?.difficulty === 'string' ? body.difficulty : undefined;
    if (typeof difficulty === 'string' && difficulty.trim() !== '') {
      payload.difficulty = difficulty.toLowerCase();
    }

    const pointsRaw = body?.points;
    const pointsValue =
      typeof pointsRaw === 'number'
        ? pointsRaw
        : typeof pointsRaw === 'string' && pointsRaw.trim() !== ''
          ? Number(pointsRaw)
          : undefined;
    if (typeof pointsValue === 'number' && Number.isFinite(pointsValue)) {
      payload.points = pointsValue;
    }

    const timeLimitRaw = body?.timeLimit;
    const timeLimitValue =
      typeof timeLimitRaw === 'number'
        ? timeLimitRaw
        : typeof timeLimitRaw === 'string' && timeLimitRaw.trim() !== ''
          ? Number(timeLimitRaw)
          : undefined;
    if (typeof timeLimitValue === 'number' && Number.isFinite(timeLimitValue)) {
      payload.timeLimit = timeLimitValue;
    }

    const maxAttemptsRaw = body?.maxAttempts;
    const maxAttemptsValue =
      typeof maxAttemptsRaw === 'number'
        ? maxAttemptsRaw
        : typeof maxAttemptsRaw === 'string' && maxAttemptsRaw.trim() !== ''
          ? Number(maxAttemptsRaw)
          : undefined;
    if (
      typeof maxAttemptsValue === 'number' &&
      Number.isFinite(maxAttemptsValue)
    ) {
      payload.maxAttempts = maxAttemptsValue;
    }

    const passingScoreRaw = body?.passingScore;
    const passingScoreValue =
      typeof passingScoreRaw === 'number'
        ? passingScoreRaw
        : typeof passingScoreRaw === 'string' && passingScoreRaw.trim() !== ''
          ? Number(passingScoreRaw)
          : undefined;
    if (
      typeof passingScoreValue === 'number' &&
      Number.isFinite(passingScoreValue)
    ) {
      payload.passingScore = passingScoreValue;
    }

    const language =
      typeof body?.language === 'string'
        ? body.language
        : typeof body?.programmingLanguage === 'string'
          ? body.programmingLanguage
          : undefined;
    if (typeof language === 'string' && language.trim() !== '') {
      payload.language = language;
    }

    return JSON.stringify(payload);
  }

  private normalizeQuestionOptions(
    input: any,
  ): QuestionOptionDto[] | undefined {
    if (!Array.isArray(input)) return undefined;

    const options = input
      .map((option: any, index: number) => {
        const textSource =
          typeof option?.text === 'string'
            ? option.text
            : typeof option?.answer_text === 'string'
              ? option.answer_text
              : '';
        const text = textSource.trim();
        if (!text) return null;
        const isCorrectRaw =
          typeof option?.correct === 'boolean'
            ? option.correct
            : typeof option?.is_correct === 'boolean'
              ? option.is_correct
              : typeof option?.isCorrect === 'boolean'
                ? option.isCorrect
                : false;
        const orderIndex =
          typeof option?.order_index === 'number'
            ? option.order_index
            : typeof option?.order === 'number'
              ? option.order
              : index;
        return {
          text,
          correct: isCorrectRaw,
          order_index: orderIndex,
        } as QuestionOptionDto;
      })
      .filter(
        (option): option is QuestionOptionDto =>
          option !== null && typeof option.text === 'string',
      );

    return options.length > 0 ? options : undefined;
  }

  private normalizeQuestionAnswers(body: any): QuestionAnswerDto[] | undefined {
    const answers: QuestionAnswerDto[] = [];

    if (Array.isArray(body?.answers)) {
      for (const answer of body.answers) {
        const textSource =
          typeof answer?.answer_text === 'string'
            ? answer.answer_text
            : typeof answer?.text === 'string'
              ? answer.text
              : '';
        const text = textSource.trim();
        if (!text) continue;
        const isCaseSensitive =
          typeof answer?.is_case_sensitive === 'boolean'
            ? answer.is_case_sensitive
            : typeof answer?.isCaseSensitive === 'boolean'
              ? answer.isCaseSensitive
              : false;
        answers.push({ answer_text: text, is_case_sensitive: isCaseSensitive });
      }
    } else if (Array.isArray(body?.correctAnswers)) {
      for (const value of body.correctAnswers) {
        if (typeof value !== 'string') continue;
        const text = value.trim();
        if (!text) continue;
        answers.push({ answer_text: text, is_case_sensitive: false });
      }
    } else if (Array.isArray(body?.options)) {
      for (const option of body.options) {
        const text =
          typeof option?.text === 'string'
            ? option.text.trim()
            : typeof option?.answer_text === 'string'
              ? option.answer_text.trim()
              : '';
        if (!text) continue;
        const isCorrect =
          typeof option?.correct === 'boolean'
            ? option.correct
            : typeof option?.is_correct === 'boolean'
              ? option.is_correct
              : typeof option?.isCorrect === 'boolean'
                ? option.isCorrect
                : false;
        if (!isCorrect) continue;
        answers.push({ answer_text: text, is_case_sensitive: false });
      }
    }

    return answers.length > 0 ? answers : undefined;
  }

  // Update practice
  @UseGuards(SupabaseGuard)
  @Put('practice-exercises/:id')
  async updatePractice(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const content = body?.content ? this.buildPracticeContent(body) : undefined;
    const contentPatch = typeof content === 'string' ? content : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updatePractice(
      id,
      { title, content: contentPatch, order },
      token,
    );
  }

  // Delete practice
  @UseGuards(SupabaseGuard)
  @Delete('practice-exercises/:id')
  async deletePractice(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deletePractice(id, token);
    return { ok: true };
  }

  // Add quiz
  @UseGuards(SupabaseGuard)
  @Post('sections/:sectionId/quiz')
  async addQuiz(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const questions = Array.isArray(body?.questions) ? body.questions : [];
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addQuiz(
      sectionId,
      { title, order, questions },
      token,
    );
  }

  // Add generated quiz
  @UseGuards(SupabaseGuard)
  @Post('sections/:sectionId/generate-and-add-quiz')
  async addGeneratedQuiz(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const generationInput = body?.generationInput;
    if (!generationInput || typeof generationInput !== 'object') {
      throw new Error('generationInput is required');
    }
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addGeneratedQuiz(
      sectionId,
      { title, order, generationInput },
      token,
    );
  }

  // Add bulk generated practice exercises
  @UseGuards(SupabaseGuard)
  @Post('sections/:sectionId/generate-and-add-practice-exercises')
  async addBulkGeneratedPracticeExercises(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const title = assertString(body?.title, 'title');
    const order = typeof body?.order === 'number' ? body.order : null;
    const generationInput = body?.generationInput;
    if (!generationInput || typeof generationInput !== 'object') {
      throw new Error('generationInput is required');
    }
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addBulkGeneratedPracticeExercises(
      sectionId,
      { title, order, generationInput },
      token,
    );
  }

  // Update quiz (metadata only)
  @UseGuards(SupabaseGuard)
  @Put('quizzes/:id')
  async updateQuiz(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const title = typeof body?.title === 'string' ? body.title : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updateQuiz(id, { title, order }, token);
  }

  // Delete quiz
  @UseGuards(SupabaseGuard)
  @Delete('quizzes/:id')
  async deleteQuiz(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteQuiz(id, token);
    return { ok: true };
  }

  // ==== Quiz Questions CRUD ====
  @UseGuards(SupabaseGuard)
  @Post('quizzes/:quizId/questions')
  async addQuestion(
    @Req() req: any,
    @Param('quizId') quizId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const text = assertString(body?.text, 'text');
    const type = typeof body?.type === 'string' ? body.type : 'mcq';
    const order = typeof body?.order === 'number' ? body.order : null;
    const options = Array.isArray(body?.options) ? body.options : [];
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addQuestion(
      quizId,
      { text, type, order, options },
      token,
    );
  }

  @UseGuards(SupabaseGuard)
  @Put('questions/:id')
  async updateQuestion(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const type = typeof body?.type === 'string' ? body.type : undefined;
    const text = typeof body?.text === 'string' ? body.text : undefined;
    const order = typeof body?.order === 'number' ? body.order : undefined;
    return await this.courses.updateQuestion(id, { type, text, order }, token);
  }

  @UseGuards(SupabaseGuard)
  @Delete('questions/:id')
  async deleteQuestion(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteQuestion(id, token);
    return { ok: true };
  }

  // ==== Quiz Options CRUD ====
  @UseGuards(SupabaseGuard)
  @Post('questions/:questionId/options')
  async addOption(
    @Req() req: any,
    @Param('questionId') questionId: string,
    @Body() body: any,
  ) {
    await this.ensureAdmin(req);
    const text = assertString(body?.text, 'text');
    const correct = !!body?.correct;
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.addOption(questionId, { text, correct }, token);
  }

  @UseGuards(SupabaseGuard)
  @Put('options/:id')
  async updateOption(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const text = typeof body?.text === 'string' ? body.text : undefined;
    const correct =
      typeof body?.correct === 'boolean' ? body.correct : undefined;
    return await this.courses.updateOption(id, { text, correct }, token);
  }

  @UseGuards(SupabaseGuard)
  @Delete('options/:id')
  async deleteOption(@Req() req: any, @Param('id') id: string) {
    const token = await this.ensureAdmin(req);
    await this.courses.deleteOption(id, token);
    return { ok: true };
  }

  // Full hierarchy
  @UseGuards(SupabaseGuard)
  @Get('courses/:id/full')
  async full(@Req() req: any, @Param('id') id: string) {
    await this.ensureAdmin(req);
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const data = await this.courses.courseFull(id, token);
    return data ?? {};
  }

  // List all modules (for learning path) - accessible to all authenticated users
  @UseGuards(SupabaseGuard)
  @Get('modules')
  async listModules(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return await this.courses.listModules(token);
  }

  // Create a question for a practice exercise
  @UseGuards(SupabaseGuard)
  @Post('admin/practice-exercises/:exerciseId/questions')
  async createPracticeExerciseQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const text = assertString(body?.text, 'text');
    const type = typeof body?.type === 'string' ? body.type : 'mcq';
    const hintValue =
      typeof body?.hint === 'string'
        ? body.hint
        : body?.hint === null
          ? null
          : undefined;
    const explanationValue =
      typeof body?.explanation === 'string'
        ? body.explanation
        : body?.explanation === null
          ? null
          : undefined;
    const points = typeof body?.points === 'number' ? body.points : undefined;
    const order_index =
      typeof body?.order_index === 'number' ? body.order_index : undefined;
    const content =
      typeof body?.content === 'string' ? body.content : undefined;
    const language =
      typeof body?.language === 'string' ? body.language : undefined;
    const options = this.normalizeQuestionOptions(
      Array.isArray(body?.options)
        ? body.options
        : Array.isArray(body?.answers)
          ? body.answers
          : undefined,
    );
    const answers = this.normalizeQuestionAnswers(body);

    const payload = {
      text,
      type,
    } as CreateQuestionDto;

    if (hintValue !== undefined) (payload as any).hint = hintValue;
    if (explanationValue !== undefined)
      (payload as any).explanation = explanationValue;
    if (points !== undefined) payload.points = points;
    if (order_index !== undefined) payload.order_index = order_index;
    if (content !== undefined) payload.content = content;
    if (language !== undefined) payload.language = language;
    if (options) payload.options = options;
    if (answers) payload.answers = answers;

    return await this.sectionExercisesService.addQuestion(
      exerciseId,
      payload,
      token,
    );
  }

  // Update a question for a practice exercise
  @UseGuards(SupabaseGuard)
  @Put('admin/practice-exercises/:exerciseId/questions/:questionId')
  async updatePracticeExerciseQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
    @Body() body: any,
  ) {
    const token = await this.ensureAdmin(req);
    const text = typeof body?.text === 'string' ? body.text : undefined;
    const type = typeof body?.type === 'string' ? body.type : undefined;
    const hintValue =
      typeof body?.hint === 'string'
        ? body.hint
        : body?.hint === null
          ? null
          : undefined;
    const explanationValue =
      typeof body?.explanation === 'string'
        ? body.explanation
        : body?.explanation === null
          ? null
          : undefined;
    const points = typeof body?.points === 'number' ? body.points : undefined;
    const order_index =
      typeof body?.order_index === 'number' ? body.order_index : undefined;
    const content =
      typeof body?.content === 'string' ? body.content : undefined;
    const language =
      typeof body?.language === 'string' ? body.language : undefined;
    const options = this.normalizeQuestionOptions(
      Array.isArray(body?.options)
        ? body.options
        : Array.isArray(body?.answers)
          ? body.answers
          : undefined,
    );
    const answers = this.normalizeQuestionAnswers(body);

    const payload: UpdateQuestionDto = {};
    if (text !== undefined) payload.text = text;
    if (type !== undefined) payload.type = type;
    if (hintValue !== undefined) (payload as any).hint = hintValue;
    if (explanationValue !== undefined)
      (payload as any).explanation = explanationValue;
    if (points !== undefined) payload.points = points;
    if (order_index !== undefined) payload.order_index = order_index;
    if (content !== undefined) payload.content = content;
    if (language !== undefined) payload.language = language;
    if (options) payload.options = options;
    if (answers) payload.answers = answers;

    return await this.sectionExercisesService.updateQuestion(
      questionId,
      payload,
      token,
    );
  }

  // Delete a question for a practice exercise
  @UseGuards(SupabaseGuard)
  @Delete('admin/practice-exercises/:exerciseId/questions/:questionId')
  async deletePracticeExerciseQuestion(
    @Req() req: any,
    @Param('exerciseId') exerciseId: string,
    @Param('questionId') questionId: string,
  ) {
    const token = await this.ensureAdmin(req);
    await this.sectionExercisesService.deleteQuestion(questionId, token);
    return { ok: true };
  }
}
