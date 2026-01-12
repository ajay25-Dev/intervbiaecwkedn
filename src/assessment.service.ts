import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { LearningPath, LearningPathService } from './learning-path.service';

type AssessmentRow = {
  id: string;
  user_id: string;
  started_at: string;
  completed_at: string | null;
  score: number | null;
  passed: boolean | null;
};

type ResponseRow = {
  id: string;
  assessment_id: string;
  q_index: number;
  question_id: string;
  user_id: string;
  module_id: string | null;
  answer_text: string | null;
  correct: boolean;
  skipped: boolean;
};

type AssessmentSessionRow = {
  id: string;
  user_id: string;
  assessment_id: string;
  current_position: number;
  started_at: string;
  last_updated: string;
  status: string;
};

type SessionResponseRow = {
  id: string;
  session_id: string;
  q_index: number;
  question_id: string;
  answer_text: string | null;
  skipped: boolean;
  created_at: string;
};

type QuestionType = 'mcq' | 'text';

interface DbQuestionRow {
  id: string;
  question_type: string;
  question_text: string;
  question_image_url?: string | null;
  points_value?: number | null;
  time_limit_seconds?: number | null;
  is_active?: boolean | null;
  module_id?: string | null;
}

interface DbOptionRow {
  question_id: string;
  option_text: string;
  is_correct: boolean;
  order_index?: number | null;
}

interface DbTextAnswerRow {
  question_id: string;
  correct_answer: string;
  case_sensitive: boolean;
  exact_match: boolean;
  alternate_answers?: string[] | null;
  keywords?: string[] | null;
}

interface ModuleRow {
  id: string;
  subject_id: string | null;
}

type RunnerQuestionBase = {
  id: string;
  prompt: string;
  imageUrl: string | null;
  rawType: string;
  timeLimit: number | null;
  moduleId: string | null;
  subjectId: string | null;
};
type RunnerQuestion =
  | (RunnerQuestionBase & { type: 'mcq'; options: string[] })
  | (RunnerQuestionBase & { type: 'text' });

type FullQuestion = {
  id: string;
  type: QuestionType;
  prompt: string;
  imageUrl: string | null;
  points: number;
  timeLimit: number | null;
  options: DbOptionRow[];
  textAnswer: DbTextAnswerRow | null;
  rawType: string;
  module_id?: string | null;
  subjectId?: string | null;
};

@Injectable()
export class AssessmentService {
  constructor(private learningPathService: LearningPathService) {}

  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();
  private anonKey = process.env.SUPABASE_ANON_KEY?.trim();

  private readonly SUPPORTED_TYPES: string[] = [
    'mcq',
    'image_mcq',
    'text',
    'image_text',
    'short_text',
    'fill_blank',
  ];
  private readonly DEFAULT_LIMIT = 25;
  private readonly PASSING_SCORE = 72;
  private readonly MEDIA_SIGN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
  private readonly MEDIA_BUCKET =
    (process.env.SUPABASE_ASSESSMENT_BUCKET ?? 'plc').trim() || 'plc';

  private headers(userToken?: string) {
    const sk = this.serviceKey;
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    }
    if (this.anonKey && userToken) {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      };
    }
    throw new InternalServerErrorException(
      'Supabase keys missing for assessments',
    );
  }

  private sanitizeQuestionType(
    rawType: string | null | undefined,
  ): QuestionType | null {
    const value = (rawType ?? '').trim().toLowerCase();
    if (!value) return null;

    if (['mcq', 'image_mcq', 'multiple_choice'].includes(value)) {
      return 'mcq';
    }

    if (
      [
        'text',
        'image_text',
        'short_text',
        'fill_blank',
        'fill-in-the-blank',
        'fill-in-the-blanks',
        'fill_in_blank',
        'fill_in_the_blanks',
      ].includes(value)
    ) {
      return 'text';
    }

    console.warn(`Unsupported assessment question type: ${value}`);
    return null;
  }

  private formatInFilter(values: string[]): string {
    return values
      .filter((value) => typeof value === 'string' && value.length > 0)
      .map((value) => `"${value.replace(/"/g, '""')}"`)
      .join(',');
  }

  private async fetchModuleSubjectMap(
    moduleIds: (string | null | undefined)[],
    userToken?: string,
  ) {
    const unique = Array.from(
      new Set(
        moduleIds.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        ),
      ),
    );
    const map = new Map<string, string | null>();
    if (!unique.length) return map;

    try {
      const url = `${this.restUrl}/modules?id=in.(${this.formatInFilter(unique)})&select=id,subject_id`;
      const res = await fetch(url, { headers: this.headers(userToken) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `Failed to fetch module subject map: ${res.status} ${body}`,
        );
        return map;
      }
      const rows = (await res.json()) as ModuleRow[];
      for (const row of rows) {
        map.set(row.id, row.subject_id ?? null);
      }
    } catch (error: any) {
      console.warn(
        `Failed to fetch module subject map: ${error?.message ?? error}`,
      );
    }

    return map;
  }

  private async getSelectedSubjectIds(
    userId: string,
    userToken?: string,
  ): Promise<string[]> {
    if (!userId) return [];

    try {
      const url = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}&select=selected_subjects`;
      const res = await fetch(url, { headers: this.headers(userToken) });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.warn(
          `Failed to fetch subject selection for user ${userId}: ${res.status} ${body}`,
        );
        return [];
      }
      const rows = await res.json();
      const [selection] = Array.isArray(rows) ? rows : [];
      const subjects = Array.isArray(selection?.selected_subjects)
        ? selection.selected_subjects
        : [];
      return subjects.filter(
        (value: unknown): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      );
    } catch (error: any) {
      console.warn(
        `Failed to fetch subject selection for user ${userId}: ${error?.message ?? error}`,
      );
      return [];
    }
  }

  private async resolveQuestionImageUrl(
    raw: string | null | undefined,
    userToken?: string,
  ): Promise<string | null> {
    const value = (raw ?? '').trim();
    if (!value) return null;

    if (/^https?:\/\//i.test(value)) {
      return value;
    }

    const supabaseUrlRaw = process.env.SUPABASE_URL?.trim();
    if (!supabaseUrlRaw) {
      console.warn(
        'Supabase URL missing for assessment question image resolution',
      );
      return null;
    }
    const supabaseUrl = supabaseUrlRaw.replace(/\/$/, '');

    if (value.startsWith('/')) {
      return `${supabaseUrl}${value}`;
    }

    if (value.startsWith('storage/v1/object/')) {
      return `${supabaseUrl}/${value}`;
    }

    const cleanedPath = value.replace(/^\/+/, '');
    const bucket = this.MEDIA_BUCKET;

    // First, try public URL (for public buckets)
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/${bucket}/${cleanedPath}`;

    try {
      // Check if the public URL works
      const publicRes = await fetch(publicUrl, { method: 'HEAD' });
      if (publicRes.ok) {
        // console.log(`Using public URL for image: ${publicUrl}`);
        return publicUrl;
      }
    } catch (publicError) {
      // console.log(`Public URL not available, falling back to signed URL`);
    }

    try {
      const headers = this.headers(userToken);
      const signUrl = `${supabaseUrl}/storage/v1/object/sign/${bucket}/${cleanedPath}`;
      const res = await fetch(signUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ expiresIn: this.MEDIA_SIGN_TTL_SECONDS }),
      });

      if (!res.ok) {
        const body = await res.text();
        console.warn(
          `Failed to sign assessment question image ${cleanedPath}: ${res.status} ${body}`,
        );
        return null;
      }

      const data: any = await res.json();
      const signedPath =
        data?.signedURL ?? data?.signedUrl ?? data?.url ?? null;
      if (!signedPath) {
        console.warn(
          `Signed URL missing for assessment question image ${cleanedPath}`,
        );
        return null;
      }

      if (signedPath.startsWith('http')) {
        return signedPath;
      }

      // Handle both full and relative paths correctly
      if (signedPath.startsWith('/storage/v1/object/')) {
        return `${supabaseUrl}${signedPath}`;
      } else if (signedPath.startsWith('/object/')) {
        // Fix missing storage/v1 prefix
        return `${supabaseUrl}/storage/v1${signedPath}`;
      } else {
        // Assume it's a relative path without leading slash
        return `${supabaseUrl}/storage/v1/object/${signedPath}`;
      }
    } catch (error) {
      console.warn('Failed to resolve assessment question image URL:', error);
      return null;
    }
  }

  private async fetchQuestions(
    userToken?: string,
    ids?: string[],
  ): Promise<FullQuestion[]> {
    let query =
      'assessment_questions?select=id,question_type,question_text,question_image_url,points_value,time_limit_seconds,is_active,module_id';
    if (ids && ids.length > 0) {
      query += `&id=in.(${this.formatInFilter(ids)})`;
    } else {
      const typeFilter = this.formatInFilter(this.SUPPORTED_TYPES);
      query += `&or=(is_active.is.null,is_active.eq.true)&question_type=in.(${typeFilter})&order=created_at.asc`;
    }

    const res = await fetch(`${this.restUrl}/${query}`, {
      headers: this.headers(userToken),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to fetch assessment questions: ${res.status} ${body}`,
      );
    }
    const rows = (await res.json()) as DbQuestionRow[];

    const mapped = rows
      .map((row) => {
        const type = this.sanitizeQuestionType(row.question_type);
        if (!type) return null;
        if (!ids && row.is_active === false) return null;
        return { row, type };
      })
      .filter((entry): entry is { row: DbQuestionRow; type: QuestionType } =>
        Boolean(entry),
      );

    if (mapped.length === 0) return [];

    const mcqIds = mapped
      .filter(({ type }) => type === 'mcq')
      .map(({ row }) => row.id);
    const textIds = mapped
      .filter(({ type }) => type === 'text')
      .map(({ row }) => row.id);
    const moduleIds = Array.from(
      new Set(
        mapped
          .map(({ row }) => row.module_id)
          .filter(
            (value): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          ),
      ),
    );

    const [optionsMap, textAnswerMap, moduleSubjectMap] = await Promise.all([
      this.fetchOptions(mcqIds, userToken),
      this.fetchTextAnswers(textIds, userToken),
      this.fetchModuleSubjectMap(moduleIds, userToken),
    ]);

    const imageUrlCache = new Map<string, Promise<string | null>>();
    const resolveImageUrl = (value: string | null | undefined) => {
      const key = (value ?? '').trim();
      if (!key) return Promise.resolve<string | null>(null);
      const cached = imageUrlCache.get(key);
      if (cached) return cached;
      const promise = this.resolveQuestionImageUrl(key, userToken);
      imageUrlCache.set(key, promise);
      return promise;
    };

    return Promise.all(
      mapped.map(async ({ row, type }) => {
        const imageUrl = await resolveImageUrl(row.question_image_url);
        const moduleId =
          typeof row.module_id === 'string' && row.module_id.trim().length > 0
            ? row.module_id
            : null;
        const subjectId = moduleId
          ? (moduleSubjectMap.get(moduleId) ?? null)
          : null;
        return {
          id: row.id,
          type,
          prompt: row.question_text,
          imageUrl,
          points:
            typeof row.points_value === 'number' &&
            !Number.isNaN(row.points_value)
              ? row.points_value
              : 1,
          timeLimit:
            typeof row.time_limit_seconds === 'number' &&
            !Number.isNaN(row.time_limit_seconds)
              ? row.time_limit_seconds
              : null,
          options: optionsMap.get(row.id) ?? [],
          textAnswer: textAnswerMap.get(row.id) ?? null,
          rawType: row.question_type,
          module_id: moduleId,
          subjectId,
        };
      }),
    );
  }

  private async fetchOptions(questionIds: string[], userToken?: string) {
    const map = new Map<string, DbOptionRow[]>();
    if (!questionIds.length) return map;

    const url = `${this.restUrl}/assessment_question_options?select=question_id,option_text,is_correct,order_index&question_id=in.(${this.formatInFilter(
      questionIds,
    )})&order=order_index.asc`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to fetch assessment question options: ${res.status} ${body}`,
      );
    }
    const rows = (await res.json()) as DbOptionRow[];
    for (const row of rows) {
      const current = map.get(row.question_id) ?? [];
      current.push(row);
      map.set(row.question_id, current);
    }
    for (const [key, value] of map.entries()) {
      value.sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0));
      map.set(key, value);
    }
    return map;
  }

  private async fetchTextAnswers(questionIds: string[], userToken?: string) {
    const map = new Map<string, DbTextAnswerRow>();
    if (!questionIds.length) return map;

    const url = `${this.restUrl}/assessment_text_answers?select=question_id,correct_answer,case_sensitive,exact_match,alternate_answers,keywords&question_id=in.(${this.formatInFilter(
      questionIds,
    )})`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to fetch assessment text answers: ${res.status} ${body}`,
      );
    }
    const rows = (await res.json()) as DbTextAnswerRow[];
    for (const row of rows) {
      map.set(row.question_id, row);
    }
    return map;
  }

  private evaluateTextAnswer(
    answer: string | null | undefined,
    spec: DbTextAnswerRow | null,
  ): boolean {
    if (!spec) return false;
    const submitted = (answer ?? '').trim();
    if (!submitted) return false;

    const correctAnswer = (spec.correct_answer ?? '').trim();
    if (!correctAnswer) return false;

    if (spec.exact_match) {
      if (spec.case_sensitive) return submitted === correctAnswer;
      return submitted.toLowerCase() === correctAnswer.toLowerCase();
    }

    const normalize = (value: string) =>
      spec.case_sensitive ? value : value.toLowerCase();
    const answerToCheck = normalize(submitted);
    const correctToCheck = normalize(correctAnswer);

    if (answerToCheck.includes(correctToCheck)) {
      return true;
    }

    const alternates = Array.isArray(spec.alternate_answers)
      ? spec.alternate_answers
      : [];
    if (alternates.some((alt) => answerToCheck.includes(normalize(alt)))) {
      return true;
    }

    const keywords = Array.isArray(spec.keywords) ? spec.keywords : [];
    if (!keywords.length) {
      return false;
    }
    const keywordMatches = keywords.filter((keyword) =>
      answerToCheck.includes(normalize(keyword)),
    );
    return keywordMatches.length >= Math.ceil(keywords.length / 2);
  }

  private scoreResponse(
    question: FullQuestion | undefined,
    response: { answer: string | null; skipped?: boolean },
  ): {
    moduleId: string | null;
    storedAnswer: string | null;
    correct: boolean;
    skipped: boolean;
  } {
    let storedAnswer: string | null = response.answer ?? null;
    let correct = false;
    const moduleId = question?.module_id ?? null;
    const skipped = Boolean(response.skipped);

    if (skipped) {
      return { moduleId, storedAnswer: null, correct: false, skipped: true };
    }

    if (question) {
      if (question.type === 'mcq') {
        const idx = Number.isFinite(Number(response.answer))
          ? parseInt(String(response.answer), 10)
          : NaN;
        const option = Number.isNaN(idx) ? undefined : question.options[idx];
        storedAnswer = option ? option.option_text : null;
        correct = Boolean(option?.is_correct);
      } else if (question.type === 'text') {
        const submitted = (response.answer ?? '').trim();
        storedAnswer = submitted || null;
        correct = this.evaluateTextAnswer(submitted, question.textAnswer);
      }
    }

    const hasValidAnswer = storedAnswer !== null && storedAnswer !== '';
    if (!hasValidAnswer) {
      correct = false;
    }

    return { moduleId, storedAnswer, correct, skipped: false };
  }

  private async getLockedModulesForUser(
    userId: string,
    userToken?: string,
  ): Promise<Set<string>> {
    const lockedModules = new Set<string>();

    try {
      // Get assessment responses for this user to calculate module mistakes
      const url = `${this.restUrl}/assessment_responses?user_id=eq.${userId}&select=module_id,correct,assessment_id&order=assessment_id.desc,q_index.asc`;
      const res = await fetch(url, { headers: this.headers(userToken) });
      if (!res.ok) {
        console.warn(
          `Failed to fetch user responses for module locking: ${res.status}`,
        );
        return lockedModules;
      }

      const responses = await res.json();
      // console.log(
      //   `[DEBUG] Found ${responses.length} responses for user ${userId}:`,
      //   responses,
      // );
      const moduleStats = new Map<
        string,
        { total: number; incorrect: number }
      >();

      // Count mistakes per module across all assessments
      for (const response of responses) {
        if (!response.module_id) continue;

        const stats = moduleStats.get(response.module_id) || {
          total: 0,
          incorrect: 0,
        };
        stats.total++;
        if (!response.correct) {
          stats.incorrect++;
        }
        moduleStats.set(response.module_id, stats);
      }

      // console.log(
      //   `[DEBUG] Module stats for user ${userId}:`,
      //   Object.fromEntries(moduleStats),
      // );

      // Lock modules with 2 or more mistakes
      for (const [moduleId, stats] of moduleStats.entries()) {
        if (stats.incorrect >= 2) {
          lockedModules.add(moduleId);
          // console.log(
          //   `[DEBUG] Locking module ${moduleId} for user ${userId} (${stats.incorrect} incorrect answers)`,
          // );
        }
      }

      // console.log(
      //   `[DEBUG] Locked modules for user ${userId}:`,
      //   Array.from(lockedModules),
      // );
    } catch (error) {
      console.warn('Error fetching locked modules for user:', error);
    }

    return lockedModules;
  }

  async getLockedModules(
    userId: string,
    userToken?: string,
  ): Promise<string[]> {
    const lockedModules = await this.getLockedModulesForUser(userId, userToken);
    return Array.from(lockedModules);
  }

  async getQuestionSet(
    userId: string,
    userToken?: string,
  ): Promise<RunnerQuestion[]> {
    const [questions, selectedSubjectIds, lockedModules] = await Promise.all([
      this.fetchQuestions(userToken),
      this.getSelectedSubjectIds(userId, userToken),
      this.getLockedModulesForUser(userId, userToken),
    ]);
    const filtered =
      selectedSubjectIds.length > 0
        ? questions.filter(
            (question) =>
              !question.subjectId ||
              selectedSubjectIds.includes(question.subjectId),
          )
        : questions;

    // Filter out questions from locked modules
    // console.log(
    //   `[DEBUG] Filtering questions for user ${userId}. Total questions: ${filtered.length}, Locked modules: ${Array.from(lockedModules)}`,
    // );
    const availableQuestions = filtered.filter((question) => {
      const isLocked =
        question.module_id && lockedModules.has(question.module_id);
      if (isLocked) {
        // console.log(
        //   `[DEBUG] Filtering out question ${question.id} from locked module ${question.module_id}`,
        // );
      }
      return !question.module_id || !lockedModules.has(question.module_id);
    });
    // console.log(
    //   `[DEBUG] Available questions after filtering: ${availableQuestions.length}`,
    // );

    return availableQuestions.map((question) => {
      if (question.type === 'mcq') {
        return {
          id: question.id,
          type: 'mcq',
          prompt: question.prompt,
          options: question.options.map((opt) => opt.option_text),
          imageUrl: question.imageUrl,
          rawType: question.rawType,
          timeLimit: question.timeLimit,
          moduleId: question.module_id ?? null,
          subjectId: question.subjectId ?? null,
        } as RunnerQuestion;
      }
      return {
        id: question.id,
        type: 'text',
        prompt: question.prompt,
        imageUrl: question.imageUrl,
        rawType: question.rawType,
        timeLimit: question.timeLimit,
        moduleId: question.module_id ?? null,
        subjectId: question.subjectId ?? null,
      } as RunnerQuestion;
    });
  }

  async evaluateResponse(
    questionId: string,
    answer: string | null,
    skipped: boolean,
    userToken?: string,
  ) {
    const questions = await this.fetchQuestions(userToken, [questionId]);
    const [question] = questions;
    if (!question) {
      throw new BadRequestException(`Question ${questionId} not found`);
    }
    const evaluation = this.scoreResponse(question, { answer, skipped });
    return {
      correct: evaluation.skipped ? false : evaluation.correct,
      moduleId: evaluation.moduleId,
      subjectId: question.subjectId,
    };
  }

  async start(userId: string, userToken?: string) {
    const url = `${this.restUrl}/assessments`;
    const now = new Date().toISOString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify([{ user_id: userId, started_at: now }]),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `assessments insert failed: ${res.status} ${await res.text()}`,
      );
    const [row] = (await res.json()) as AssessmentRow[];
    return row;
  }

  async finish(
    userId: string,
    assessmentId: string,
    responses: {
      q_index: number;
      question_id: string;
      answer: string | null;
      skipped?: boolean;
    }[],
    userToken?: string,
  ) {
    const orderedResponses = [...responses].sort(
      (a, b) => a.q_index - b.q_index,
    );
    const questionIds = Array.from(
      new Set(
        orderedResponses
          .map((response) => response.question_id)
          .filter(Boolean),
      ),
    );
    const questions = await this.fetchQuestions(userToken, questionIds);
    const questionMap = new Map(
      questions.map((question) => [question.id, question]),
    );

    const moduleState = new Map<
      string,
      { incorrect: number; locked: boolean }
    >();
    let correctCount = 0;
    let countedQuestions = 0;
    let skippedCount = 0;

    const toSave: Omit<ResponseRow, 'id'>[] = orderedResponses.map(
      (response) => {
        const question = questionMap.get(response.question_id);
        const evaluation = this.scoreResponse(question, response);
        let { moduleId, storedAnswer, correct, skipped } = evaluation;

        const state = moduleId ? moduleState.get(moduleId) : undefined;
        const moduleLocked = Boolean(state?.locked);

        if (moduleLocked) {
          skipped = true;
          correct = false;
          storedAnswer = null;
        }

        if (!skipped) {
          countedQuestions++;
          if (correct) correctCount++;
        } else {
          skippedCount++;
        }

        if (moduleId) {
          let incorrect = state?.incorrect ?? 0;
          let locked = moduleLocked;

          if (!skipped && !correct) {
            incorrect += 1;
            if (incorrect >= 2) {
              locked = true;
            }
          }

          moduleState.set(moduleId, { incorrect, locked });
        }

        return {
          assessment_id: assessmentId,
          q_index: response.q_index,
          question_id: response.question_id,
          user_id: userId,
          module_id: moduleId,
          answer_text: skipped ? null : storedAnswer,
          correct,
          skipped,
        };
      },
    );

    const totalQuestions = countedQuestions;
    const score =
      totalQuestions > 0
        ? Math.round((correctCount / totalQuestions) * 100)
        : 0;
    const passed = score >= this.PASSING_SCORE;

    const rUrl = `${this.restUrl}/assessment_responses`;
    const rRes = await fetch(rUrl, {
      method: 'POST',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify(toSave),
    });
    if (!rRes.ok)
      throw new InternalServerErrorException(
        `responses insert failed: ${rRes.status} ${await rRes.text()}`,
      );

    const aUrl = `${this.restUrl}/assessments?id=eq.${assessmentId}`;
    const aRes = await fetch(aUrl, {
      method: 'PATCH',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify({
        completed_at: new Date().toISOString(),
        score,
        passed,
      }),
    });
    if (!aRes.ok)
      throw new InternalServerErrorException(
        `assessment update failed: ${aRes.status} ${await aRes.text()}`,
      );
    const [updated] = (await aRes.json()) as AssessmentRow[];

    try {
      const profileUrl = `${this.restUrl}/profiles?id=eq.${userId}`;
      await fetch(profileUrl, {
        method: 'PATCH',
        headers: { ...this.headers(userToken) },
        body: JSON.stringify({
          assessment_completed_at: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.warn('Failed to update profile assessment completion:', error);
    }

    // Refresh and fetch personalized learning path after assessment completion
    let learningPath: LearningPath | null = null;
    let moduleScores: Record<string, number> | null = null;

    try {
      moduleScores = await this.learningPathService.syncUserModuleStatus(
        userId,
        userToken,
      );
    } catch (error) {
      console.warn(
        'Failed to sync module status after assessment completion:',
        error,
      );
    }

    // Check if user already has a learning path
    let hasExistingLearningPath = false;
    try {
      const existingPaths =
        await this.learningPathService.getUserLearningPath(userToken);
      hasExistingLearningPath = !!existingPaths;
    } catch (error) {
      console.warn('Failed to check existing learning paths for user:', error);
    }

    // If no existing learning path, generate and save one
    if (!hasExistingLearningPath && moduleScores) {
      try {
        console.log(
          `No existing learning path found for user ${userId}, generating and saving a new one...`,
        );
        // Get a recommended path based on user profile
        const profileData = { career_goals: [], focus_areas: [] }; // Basic profile for recommendation
        const recommendedPath =
          await this.learningPathService.getRecommendedPath(
            profileData,
            userToken,
          );

        if (recommendedPath) {
          // Generate personalized path for the user
          learningPath = await this.learningPathService.getPersonalizedPath(
            recommendedPath.id,
            userToken,
          );
          console.log(
            `Successfully generated and saved new learning path for user ${userId}`,
          );
        }
      } catch (error) {
        console.warn(
          `Failed to generate and save new learning path for user ${userId} after assessment:`,
          error,
        );
      }
    }

    // Refresh existing learning paths with new module scores
    try {
      await this.learningPathService.refreshUserLearningPaths(
        userToken,
        moduleScores ?? undefined,
      );
    } catch (error) {
      console.warn(
        'Failed to refresh learning paths after assessment completion:',
        error,
      );
    }

    // If we still don't have a learning path, try to fetch or generate one
    if (!learningPath) {
      try {
        learningPath =
          await this.learningPathService.getUserLearningPath(userToken);
      } catch (error) {
        console.warn(
          'Failed to fetch learning path after assessment completion:',
          error,
        );
      }
    }

    return {
      score,
      passed,
      total: totalQuestions,
      correct: correctCount,
      skipped: skippedCount,
      assessment: updated,
      learningPath,
    };
  }

  async latest(userId: string, userToken?: string) {
    const url = `${this.restUrl}/assessments?user_id=eq.${userId}&select=id,user_id,started_at,completed_at,score,passed&order=started_at.desc&limit=1`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok)
      throw new InternalServerErrorException(
        `assessments select failed: ${res.status} ${await res.text()}`,
      );
    const rows = (await res.json()) as AssessmentRow[];
    return rows[0] ?? null;
  }

  // Session Management Methods

  async getCurrentSession(
    userId: string,
    userToken?: string,
  ): Promise<{
    session: AssessmentSessionRow | null;
    responses: SessionResponseRow[];
  }> {
    // Check for existing in-progress session
    const url = `${this.restUrl}/assessment_sessions?user_id=eq.${userId}&status=eq.in_progress&select=id,user_id,assessment_id,current_position,started_at,last_updated,status&order=last_updated.desc&limit=1`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to fetch assessment session: ${res.status} ${body}`,
      );
    }
    const rows = (await res.json()) as AssessmentSessionRow[];
    const session = rows[0] ?? null;

    let responses: SessionResponseRow[] = [];
    if (session) {
      // Fetch session responses
      const responsesUrl = `${this.restUrl}/assessment_session_responses?session_id=eq.${session.id}&select=id,session_id,q_index,question_id,answer_text,skipped,created_at&order=q_index.asc`;
      const responsesRes = await fetch(responsesUrl, {
        headers: this.headers(userToken),
      });
      if (responsesRes.ok) {
        responses = (await responsesRes.json()) as SessionResponseRow[];
      }
    }

    return { session, responses };
  }

  async createSession(
    userId: string,
    assessmentId: string,
    userToken?: string,
  ): Promise<AssessmentSessionRow> {
    const url = `${this.restUrl}/assessment_sessions`;
    const now = new Date().toISOString();
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify([
        {
          user_id: userId,
          assessment_id: assessmentId,
          current_position: 0,
          started_at: now,
          last_updated: now,
          status: 'in_progress',
        },
      ]),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to create assessment session: ${res.status} ${body}`,
      );
    }
    const [row] = (await res.json()) as AssessmentSessionRow[];
    return row;
  }

  async saveSessionProgress(
    sessionId: string,
    position: number,
    responses: {
      q_index: number;
      question_id: string;
      answer_text: string | null;
      skipped: boolean;
    }[],
    userToken?: string,
  ): Promise<void> {
    // Update session last_updated and current_position
    const now = new Date().toISOString();
    const sessionUrl = `${this.restUrl}/assessment_sessions?id=eq.${sessionId}`;
    const sessionRes = await fetch(sessionUrl, {
      method: 'PATCH',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify({
        current_position: position,
        last_updated: now,
      }),
    });
    if (!sessionRes.ok) {
      const body = await sessionRes.text();
      throw new InternalServerErrorException(
        `Failed to update assessment session: ${sessionRes.status} ${body}`,
      );
    }

    // Save session responses
    if (responses.length > 0) {
      const responsesUrl = `${this.restUrl}/assessment_session_responses`;
      const existingResponses = await this.getSessionResponses(
        sessionId,
        userToken,
      );
      const existingMap = new Map<number, string>();
      existingResponses.forEach((response) => {
        existingMap.set(response.q_index, response.id);
      });

      const toSave: Omit<SessionResponseRow, 'id' | 'created_at'>[] = [];
      responses.forEach((response) => {
        const existingId = existingMap.get(response.q_index);
        if (existingId) {
          // Update existing response
          const updateUrl = `${this.restUrl}/assessment_session_responses?id=eq.${existingId}`;
          fetch(updateUrl, {
            method: 'PATCH',
            headers: { ...this.headers(userToken) },
            body: JSON.stringify({
              answer_text: response.answer_text,
              skipped: response.skipped,
            }),
          }).catch((error) => {
            console.warn(
              `Failed to update session response ${existingId}:`,
              error,
            );
          });
        } else {
          // Add new response
          toSave.push({
            session_id: sessionId,
            q_index: response.q_index,
            question_id: response.question_id,
            answer_text: response.answer_text,
            skipped: response.skipped,
          });
        }
      });

      if (toSave.length > 0) {
        const saveRes = await fetch(responsesUrl, {
          method: 'POST',
          headers: {
            ...this.headers(userToken),
            Prefer: 'return=representation',
          },
          body: JSON.stringify(toSave),
        });
        if (!saveRes.ok) {
          const body = await saveRes.text();
          console.warn(
            `Failed to save some session responses: ${saveRes.status} ${body}`,
          );
          // Log the exact request being sent for debugging
          console.log('Failed request data:', JSON.stringify(toSave, null, 2));
        }
      }
    }
  }

  async getSessionResponses(
    sessionId: string,
    userToken?: string,
  ): Promise<SessionResponseRow[]> {
    const url = `${this.restUrl}/assessment_session_responses?session_id=eq.${sessionId}&select=id,session_id,q_index,question_id,answer_text,skipped,created_at&order=q_index.asc`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to fetch session responses: ${res.status} ${body}`,
      );
    }
    return (await res.json()) as SessionResponseRow[];
  }

  async resumeSession(
    sessionId: string,
    userToken?: string,
  ): Promise<{
    session: AssessmentSessionRow;
    responses: SessionResponseRow[];
  }> {
    // Get session and responses
    const sessionUrl = `${this.restUrl}/assessment_sessions?id=eq.${sessionId}&select=id,user_id,assessment_id,current_position,started_at,last_updated,status`;
    const sessionRes = await fetch(sessionUrl, {
      headers: this.headers(userToken),
    });
    if (!sessionRes.ok) {
      const body = await sessionRes.text();
      throw new InternalServerErrorException(
        `Failed to fetch assessment session: ${sessionRes.status} ${body}`,
      );
    }
    const rows = (await sessionRes.json()) as AssessmentSessionRow[];
    const session = rows[0];
    if (!session) {
      throw new BadRequestException(`Session ${sessionId} not found`);
    }

    // Update last_updated
    const now = new Date().toISOString();
    await fetch(sessionUrl, {
      method: 'PATCH',
      headers: { ...this.headers(userToken) },
      body: JSON.stringify({ last_updated: now }),
    });

    // Get responses
    const responses = await this.getSessionResponses(sessionId, userToken);

    return { session, responses };
  }

  async abandonSession(sessionId: string, userToken?: string): Promise<void> {
    const url = `${this.restUrl}/assessment_sessions?id=eq.${sessionId}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { ...this.headers(userToken) },
      body: JSON.stringify({
        status: 'abandoned',
        last_updated: new Date().toISOString(),
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new InternalServerErrorException(
        `Failed to abandon assessment session: ${res.status} ${body}`,
      );
    }
  }

  async startWithSessionCheck(
    userId: string,
    userToken?: string,
  ): Promise<{
    assessment_id: string;
    questions: RunnerQuestion[];
    lockedModules: string[];
    session?: {
      session_id: string;
      current_position: number;
      responses: Record<string, { answer: string | null; skipped: boolean }>;
    };
  }> {
    // Check for existing in-progress session
    const { session, responses } = await this.getCurrentSession(
      userId,
      userToken,
    );

    if (session) {
      // Resume existing session
      const questions = await this.getQuestionSet(userId, userToken);
      const lockedModules = await this.getLockedModules(userId, userToken);

      // Convert responses to map by question_id
      const responsesMap: Record<
        string,
        { answer: string | null; skipped: boolean }
      > = {};
      responses.forEach((response) => {
        responsesMap[response.question_id] = {
          answer: response.answer_text,
          skipped: response.skipped,
        };
      });

      return {
        assessment_id: session.assessment_id,
        questions,
        lockedModules,
        session: {
          session_id: session.id,
          current_position: session.current_position,
          responses: responsesMap,
        },
      };
    } else {
      // Start new assessment
      const assessment = await this.start(userId, userToken);
      const questions = await this.getQuestionSet(userId, userToken);
      const lockedModules = await this.getLockedModules(userId, userToken);

      // Create new session
      const newSession = await this.createSession(
        userId,
        assessment.id,
        userToken,
      );

      return {
        assessment_id: assessment.id,
        questions,
        lockedModules,
        session: {
          session_id: newSession.id,
          current_position: 0,
          responses: {},
        },
      };
    }
  }
}
