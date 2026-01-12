import { Injectable, InternalServerErrorException } from '@nestjs/common';
import {
  QuizGenerationService,
  GeneratedQuestion,
} from './quiz-generation.service';
import {
  PracticeExercisesGenerationService,
  PracticeExerciseGenerationInput,
  PracticeExerciseGenerationResponse,
} from './practice-exercises-generation.service';

type UUID = string;

export type CourseRow = {
  id: UUID;
  title: string;
  description?: string | null;
  created_by: UUID;
  created_at: string;
  updated_at: string;
};
export type SubjectRow = {
  id: UUID;
  title: string;
  course_id: UUID;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
};
export type ModuleRow = {
  id: UUID;
  title: string;
  subject_id: UUID;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
};
export type SectionRow = {
  id: UUID;
  title: string;
  module_id: UUID;
  order_index?: number | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
};
export type LectureRow = {
  id: UUID;
  title: string;
  content: string | null;
  section_id: UUID;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
};
export type PracticeRow = {
  id: UUID;
  title: string;
  content: string | null;
  description: string | null;
  section_id: UUID;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
  type?: string | null;
  data?: any;
  practice_type?: string | null;
  subject_type?: string | null;
  difficulty?: string | null;
  status?: string | null;
  time_limit?: number | null;
  passing_score?: number | null;
  max_attempts?: number | null;
  section_exercise_questions?: any[];
};
export type QuizRow = {
  id: UUID;
  title: string;
  section_id: UUID;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
};
export type QuizQuestionRow = {
  id: UUID;
  quiz_id: UUID;
  type: string;
  text: string;
  order_index?: number | null;
  created_at: string;
  updated_at: string;
};
export type QuizOptionRow = {
  id: UUID;
  question_id: UUID;
  text: string;
  correct: boolean;
};

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

type CourseIdentifier = {
  id: UUID;
  title: string;
  status?: string | null;
};

type CurriculumCourseSummary = {
  id: UUID;
  title: string;
  description?: string | null;
  difficulty?: string | null;
  status?: string | null;
  subjects?: Array<{
    id: UUID;
    title: string;
    modules?: Array<{
      id: UUID;
      title: string;
      sections?: Array<{
        id: UUID;
        title: string;
      }>;
    }>;
  }>;
};

export type CourseFullOptions = {
  includePractices?: boolean;
  includePracticeQuestions?: boolean;
  includeQuizzes?: boolean;
  includeQuizQuestions?: boolean;
};

@Injectable()
export class CourseService {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();
  private anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  private readonly cacheTtlMs = Number(
    process.env.COURSE_CACHE_TTL_MS ?? '30000',
  );
  private readonly courseFullCache = new Map<string, CacheEntry<any>>();
  private curriculumSummaryCache: CacheEntry<CurriculumCourseSummary[]> | null =
    null;
  private courseIdentifierCache: CacheEntry<CourseIdentifier[]> | null = null;

  constructor(
    private readonly quizGenerationService: QuizGenerationService,
    private readonly practiceExercisesGenerationService: PracticeExercisesGenerationService,
  ) {}

  private makeCacheEntry<T>(value: T): CacheEntry<T> {
    return { value, expiresAt: Date.now() + this.cacheTtlMs };
  }

  private buildCourseFullCacheKey(
    courseId: string,
    fetchOptions?: CourseFullOptions,
  ) {
    const normalized = {
      includePractices: fetchOptions?.includePractices ?? true,
      includePracticeQuestions: fetchOptions?.includePracticeQuestions ?? true,
      includeQuizzes: fetchOptions?.includeQuizzes ?? true,
      includeQuizQuestions: fetchOptions?.includeQuizQuestions ?? true,
    };
    return `${courseId}::${Number(normalized.includePractices)}${Number(normalized.includePracticeQuestions)}${Number(normalized.includeQuizzes)}${Number(normalized.includeQuizQuestions)}`;
  }

  private getCachedCourseFull(
    courseId: string,
    fetchOptions?: CourseFullOptions,
  ) {
    const key = this.buildCourseFullCacheKey(courseId, fetchOptions);
    const entry = this.courseFullCache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.courseFullCache.delete(key);
      return null;
    }
    return entry.value;
  }

  private setCachedCourseFull(
    courseId: string,
    value: any,
    fetchOptions?: CourseFullOptions,
  ) {
    const key = this.buildCourseFullCacheKey(courseId, fetchOptions);
    this.courseFullCache.set(key, this.makeCacheEntry(value));
  }

  private getCachedCurriculumSummary() {
    if (!this.curriculumSummaryCache) return null;
    if (this.curriculumSummaryCache.expiresAt <= Date.now()) {
      this.curriculumSummaryCache = null;
      return null;
    }
    return this.curriculumSummaryCache.value;
  }

  private setCurriculumSummaryCache(value: CurriculumCourseSummary[]) {
    this.curriculumSummaryCache = this.makeCacheEntry(value);
  }

  private getCachedCourseIdentifiers() {
    if (!this.courseIdentifierCache) return null;
    if (this.courseIdentifierCache.expiresAt <= Date.now()) {
      this.courseIdentifierCache = null;
      return null;
    }
    return this.courseIdentifierCache.value;
  }

  private setCourseIdentifierCache(value: CourseIdentifier[]) {
    this.courseIdentifierCache = this.makeCacheEntry(value);
  }

  private invalidateCourseCaches(courseId?: string) {
    if (courseId) {
      const prefix = `${courseId}::`;
      for (const key of Array.from(this.courseFullCache.keys())) {
        if (key.startsWith(prefix)) {
          this.courseFullCache.delete(key);
        }
      }
    } else {
      this.courseFullCache.clear();
    }
    this.curriculumSummaryCache = null;
    this.courseIdentifierCache = null;
  }

  private async resolveCourseIdForSection(
    sectionId: string,
    userToken?: string,
  ): Promise<string | null> {
    try {
      const sectionRes = await fetch(
        `${this.restUrl}/sections?id=eq.${sectionId}&select=module_id&limit=1`,
        { headers: this.headers(userToken) },
      );
      if (!sectionRes.ok) return null;
      const sectionRows = (await sectionRes.json()) as {
        module_id?: string | null;
      }[];
      const moduleId = sectionRows[0]?.module_id;
      if (!moduleId) return null;

      const moduleRes = await fetch(
        `${this.restUrl}/modules?id=eq.${moduleId}&select=subject_id&limit=1`,
        { headers: this.headers(userToken) },
      );
      if (!moduleRes.ok) return null;
      const moduleRows = (await moduleRes.json()) as {
        subject_id?: string | null;
      }[];
      const subjectId = moduleRows[0]?.subject_id;
      if (!subjectId) return null;

      const subjectRes = await fetch(
        `${this.restUrl}/subjects?id=eq.${subjectId}&select=course_id&limit=1`,
        { headers: this.headers(userToken) },
      );
      if (!subjectRes.ok) return null;
      const subjectRows = (await subjectRes.json()) as {
        course_id?: string | null;
      }[];
      return subjectRows[0]?.course_id ?? null;
    } catch {
      return null;
    }
  }

  private async resolveCourseIdForPractice(
    practiceId: string,
    userToken?: string,
  ): Promise<string | null> {
    try {
      const practiceRes = await fetch(
        `${this.restUrl}/section_exercises?id=eq.${practiceId}&select=section_id&limit=1`,
        { headers: this.headers(userToken) },
      );
      if (!practiceRes.ok) return null;
      const practiceRows = (await practiceRes.json()) as {
        section_id?: string | null;
      }[];
      const sectionId = practiceRows[0]?.section_id;
      if (!sectionId) return null;
      return this.resolveCourseIdForSection(sectionId, userToken);
    } catch {
      return null;
    }
  }

  private headers(userToken?: string) {
    const sk = this.serviceKey;
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt)
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    if (this.anonKey && userToken)
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      };
    throw new InternalServerErrorException(
      'Supabase keys missing for course service',
    );
  }

  private async insert<T>(
    table: string,
    rows: any[],
    userToken?: string,
  ): Promise<T[]> {
    const res = await fetch(`${this.restUrl}/${table}`, {
      method: 'POST',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify(rows),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `${table} insert failed: ${res.status} ${await res.text()}`,
      );
    return (await res.json()) as T[];
  }

  private async patchById<T>(
    table: string,
    id: UUID,
    patch: any,
    userToken?: string,
  ): Promise<T> {
    const res = await fetch(`${this.restUrl}/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: { ...this.headers(userToken), Prefer: 'return=representation' },
      body: JSON.stringify(patch),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `${table} update failed: ${res.status} ${await res.text()}`,
      );
    const [row] = (await res.json()) as T[];
    return row;
  }

  private async getNextOrderIndex(
    table: string,
    parentColumn: string,
    parentId: UUID,
    userToken?: string,
  ): Promise<number> {
    const url = `${this.restUrl}/${table}?${parentColumn}=eq.${parentId}&select=order_index&order=order_index.desc.nullslast&limit=1`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `${table} select max(order_index) failed: ${res.status} ${await res.text()}`,
      );
    const rows = (await res.json()) as { order_index: number | null }[];
    const top = rows[0]?.order_index;
    return typeof top === 'number' && Number.isFinite(top) ? top + 1 : 0;
  }

  private async deleteById(
    table: string,
    id: UUID,
    userToken?: string,
  ): Promise<void> {
    const res = await fetch(`${this.restUrl}/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: this.headers(userToken),
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `${table} delete failed: ${res.status} ${await res.text()}`,
      );
  }

  private async exists(
    table: string,
    id: UUID,
    userToken?: string,
  ): Promise<boolean> {
    const res = await fetch(
      `${this.restUrl}/${table}?id=eq.${id}&select=id&limit=1`,
      { headers: this.headers(userToken) },
    );
    if (!res.ok)
      throw new InternalServerErrorException(
        `${table} exists check failed: ${res.status} ${await res.text()}`,
      );
    const rows = (await res.json()) as { id: UUID }[];
    return rows.length > 0;
  }

  async createCourse(
    userId: UUID,
    data: { title: string; description?: string | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const [row] = await this.insert<CourseRow>(
      'courses',
      [
        {
          title: data.title,
          description: data.description ?? null,
          created_by: userId,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    this.invalidateCourseCaches(row.id);
    return row;
  }

  async listCourses(userToken?: string): Promise<any[]> {
    const courses = await this._getBasicCourses(userToken);
    return Promise.all(courses.map((c) => this.courseFull(c.id, userToken)));
  }

  private async _getBasicCourses(userToken?: string): Promise<CourseRow[]> {
    const url = `${this.restUrl}/courses?select=id,title,description,created_by,created_at,updated_at&order=created_at.desc`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok)
      throw new InternalServerErrorException(
        `courses select failed: ${res.status} ${await res.text()}`,
      );
    return (await res.json()) as CourseRow[];
  }

  async listCurriculumCourses(
    userToken?: string,
  ): Promise<CurriculumCourseSummary[]> {
    const cached = this.getCachedCurriculumSummary();
    if (cached) return cached;
    const select = encodeURIComponent(
      'id,title,description,difficulty,status,subjects(id,title,modules(id,title,sections(id,title)))',
    );
    const url = `${this.restUrl}/courses?select=${select}&order=created_at.desc`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `courses summary select failed: ${res.status} ${await res.text()}`,
      );
    }
    const rows = (await res.json()) as CurriculumCourseSummary[];
    this.setCurriculumSummaryCache(rows);
    return rows;
  }

  async listCourseIdentifiers(userToken?: string): Promise<CourseIdentifier[]> {
    const cached = this.getCachedCourseIdentifiers();
    if (cached) return cached;
    const url = `${this.restUrl}/courses?select=id,title,status&order=created_at.desc`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `courses identifier select failed: ${res.status} ${await res.text()}`,
      );
    }
    const rows = (await res.json()) as CourseIdentifier[];
    this.setCourseIdentifierCache(rows);
    return rows;
  }

  async addSubject(
    courseId: UUID,
    data: { title: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'subjects',
            'course_id',
            courseId,
            userToken,
          );
    const [row] = await this.insert<SubjectRow>(
      'subjects',
      [
        {
          title: data.title,
          course_id: courseId,
          order_index: orderIndex,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    this.invalidateCourseCaches(courseId);
    return row;
  }

  async addModule(
    subjectId: UUID,
    data: { title: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'modules',
            'subject_id',
            subjectId,
            userToken,
          );
    const [row] = await this.insert<ModuleRow>(
      'modules',
      [
        {
          title: data.title,
          subject_id: subjectId,
          order_index: orderIndex,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    return row;
  }

  async addSection(
    moduleId: UUID,
    data: { title: string; order?: number | null; status?: string | null },
    userToken?: string,
  ) {
    if (!(await this.exists('modules', moduleId, userToken))) {
      throw new InternalServerErrorException('Module not found');
    }
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'sections',
            'module_id',
            moduleId,
            userToken,
          );
    const [row] = await this.insert<SectionRow>(
      'sections',
      [
        {
          title: data.title,
          module_id: moduleId,
          order_index: orderIndex,
          status: data.status ?? 'draft',
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    return row;
  }

  async upsertLecture(
    sectionId: UUID,
    data: { title: string; content: string },
    userToken?: string,
  ) {
    // Check if exists
    const url = `${this.restUrl}/lectures?section_id=eq.${sectionId}&select=id&limit=1`;
    const res = await fetch(url, { headers: this.headers(userToken) });
    if (!res.ok)
      throw new InternalServerErrorException(
        `lectures select failed: ${res.status} ${await res.text()}`,
      );
    const rows = (await res.json()) as { id: UUID }[];
    const now = new Date().toISOString();
    if (rows[0]) {
      return this.patchById<LectureRow>(
        'lectures',
        rows[0].id,
        { title: data.title, content: data.content, updated_at: now },
        userToken,
      );
    }
    const [row] = await this.insert<LectureRow>(
      'lectures',
      [
        {
          title: data.title,
          content: data.content,
          section_id: sectionId,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    return row;
  }

  async addPractice(
    sectionId: UUID,
    data: {
      title: string;
      content: string;
      order?: number | null;
      description: string;
      programming_language: string;
    },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'section_exercises',
            'section_id',
            sectionId,
            userToken,
          );
    const [row] = await this.insert<PracticeRow>(
      'section_exercises',
      [
        {
          title: data.title,
          content: data.content,
          description: data.description,
          programming_language: data.programming_language,
          section_id: sectionId,
          order_index: orderIndex,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    const courseId = await this.resolveCourseIdForSection(sectionId, userToken);
    this.invalidateCourseCaches(courseId ?? undefined);
    return row;
  }

  async addLecture(
    sectionId: UUID,
    data: { title: string; content: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'lectures',
            'section_id',
            sectionId,
            userToken,
          );
    const [row] = await this.insert<LectureRow>(
      'lectures',
      [
        {
          title: data.title,
          content: data.content,
          section_id: sectionId,
          order_index: orderIndex,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    return row;
  }

  async updateLecture(
    id: UUID,
    data: { title?: string; content?: string | null; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    return this.patchById<LectureRow>(
      'lectures',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        updated_at: now,
      },
      userToken,
    );
  }

  async deleteLecture(id: UUID, userToken?: string) {
    return this.deleteById('lectures', id, userToken);
  }

  async addQuiz(
    sectionId: UUID,
    data: {
      title: string;
      order?: number | null;
      questions?: {
        type: string;
        text: string;
        options?: { text: string; correct?: boolean }[];
      }[];
    },
    userToken?: string,
  ) {
    // Validate and clean sectionId (remove any leading colon)
    const cleanSectionId = sectionId.replace(/^:/, '');
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(cleanSectionId)) {
      throw new InternalServerErrorException('Invalid sectionId format');
    }

    const now = new Date().toISOString();
    // If a quiz already exists for this section, update it instead (upsert behavior)
    const qRes = await fetch(
      `${this.restUrl}/quizzes?section_id=eq.${cleanSectionId}&select=id&limit=1`,
      { headers: this.headers(userToken) },
    );
    if (!qRes.ok)
      throw new InternalServerErrorException(
        `quizzes select failed: ${qRes.status} ${await qRes.text()}`,
      );
    const existing = (await qRes.json()) as { id: UUID }[];
    let quiz: QuizRow;
    if (existing[0]) {
      quiz = await this.patchById<QuizRow>(
        'quizzes',
        existing[0].id,
        {
          title: data.title,
          ...(data.order !== undefined ? { order_index: data.order } : {}),
          updated_at: now,
        },
        userToken,
      );
    } else {
      const orderIndex =
        typeof data.order === 'number'
          ? data.order
          : await this.getNextOrderIndex(
              'quizzes',
              'section_id',
              cleanSectionId,
              userToken,
            );
      const [q] = await this.insert<QuizRow>(
        'quizzes',
        [
          {
            title: data.title,
            section_id: cleanSectionId,
            order_index: orderIndex,
            created_at: now,
            updated_at: now,
          },
        ],
        userToken,
      );
      quiz = q;
    }

    if (Array.isArray(data.questions) && data.questions.length > 0) {
      for (let i = 0; i < data.questions.length; i++) {
        const q = data.questions[i];
        const [qq] = await this.insert<QuizQuestionRow>(
          'quiz_questions',
          [
            {
              quiz_id: quiz.id,
              type: q.type || 'mcq',
              text: q.text,
              order_index: i,
              created_at: now,
              updated_at: now,
            },
          ],
          userToken,
        );
        const opts = (q.options || []).map((o, j) => ({
          question_id: qq.id,
          text: o.text,
          correct: !!o.correct,
        }));
        if (opts.length)
          await this.insert<QuizOptionRow>('quiz_options', opts, userToken);
      }
    }
    return quiz;
  }

  // Quiz Questions CRUD
  async addQuestion(
    quizId: UUID,
    data: {
      type?: string;
      text: string;
      order?: number | null;
      options?: { text: string; correct?: boolean }[];
    },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const orderIndex =
      typeof data.order === 'number'
        ? data.order
        : await this.getNextOrderIndex(
            'quiz_questions',
            'quiz_id',
            quizId,
            userToken,
          );
    const [question] = await this.insert<QuizQuestionRow>(
      'quiz_questions',
      [
        {
          quiz_id: quizId,
          type: data.type || 'mcq',
          text: data.text,
          order_index: orderIndex,
          created_at: now,
          updated_at: now,
        },
      ],
      userToken,
    );
    if (Array.isArray(data.options) && data.options.length) {
      const opts = data.options.map((o) => ({
        question_id: question.id,
        text: o.text,
        correct: !!o.correct,
      }));
      await this.insert<QuizOptionRow>('quiz_options', opts, userToken);
    }
    return question;
  }

  async updateQuestion(
    id: UUID,
    data: { type?: string; text?: string; order?: number | null },
    userToken?: string,
  ) {
    const patch: any = { updated_at: new Date().toISOString() };
    if (data.type !== undefined) patch.type = data.type;
    if (data.text !== undefined) patch.text = data.text;
    if (data.order !== undefined) patch.order_index = data.order;
    return this.patchById<QuizQuestionRow>(
      'quiz_questions',
      id,
      patch,
      userToken,
    );
  }

  async deleteQuestion(id: UUID, userToken?: string) {
    // Cascade deletes options via FK
    return this.deleteById('quiz_questions', id, userToken);
  }

  // Quiz Options CRUD
  async addOption(
    questionId: UUID,
    data: { text: string; correct?: boolean },
    userToken?: string,
  ) {
    const [row] = await this.insert<QuizOptionRow>(
      'quiz_options',
      [
        {
          question_id: questionId,
          text: data.text,
          correct: !!data.correct,
        },
      ],
      userToken,
    );
    return row;
  }

  async updateOption(
    id: UUID,
    data: { text?: string; correct?: boolean },
    userToken?: string,
  ) {
    const patch: any = {};
    if (data.text !== undefined) patch.text = data.text;
    if (data.correct !== undefined) patch.correct = !!data.correct;
    return this.patchById<QuizOptionRow>('quiz_options', id, patch, userToken);
  }

  async deleteOption(id: UUID, userToken?: string) {
    return this.deleteById('quiz_options', id, userToken);
  }

  async courseFull(
    courseId: UUID,
    userToken?: string,
    fetchOptions?: CourseFullOptions,
  ) {
    const cached = this.getCachedCourseFull(courseId, fetchOptions);
    if (cached) return cached;
    const includePractices = fetchOptions?.includePractices ?? true;
    const includePracticeQuestions =
      fetchOptions?.includePracticeQuestions ?? true;
    const includeQuizzes = fetchOptions?.includeQuizzes ?? true;
    const includeQuizQuestions = fetchOptions?.includeQuizQuestions ?? true;
    // Fetch course
    const cRes = await fetch(
      `${this.restUrl}/courses?id=eq.${courseId}&limit=1`,
      { headers: this.headers(userToken), cache: 'no-store' },
    );
    if (!cRes.ok)
      throw new InternalServerErrorException(
        `courses select failed: ${cRes.status} ${await cRes.text()}`,
      );
    const courses = (await cRes.json()) as CourseRow[];
    const course = courses[0];
    if (!course) return null;

    // Subjects
    const sRes = await fetch(
      `${this.restUrl}/subjects?course_id=eq.${courseId}&order=order_index.asc.nullsfirst`,
      { headers: this.headers(userToken) },
    );
    const subjects = sRes.ok ? ((await sRes.json()) as SubjectRow[]) : [];
    const subjectIds = subjects.map((s) => s.id);

    // Modules
    let modules: ModuleRow[] = [];
    if (subjectIds.length) {
      const mRes = await fetch(
        `${this.restUrl}/modules?subject_id=in.(${subjectIds.join(',')})&order=order_index.asc.nullsfirst`,
        { headers: this.headers(userToken) },
      );
      modules = mRes.ok ? ((await mRes.json()) as ModuleRow[]) : [];
    }
    const moduleIds = modules.map((m) => m.id);

    // Sections
    let sections: SectionRow[] = [];
    if (moduleIds.length) {
      const secRes = await fetch(
        `${this.restUrl}/sections?module_id=in.(${moduleIds.join(',')})&order=order_index.asc.nullsfirst`,
        { headers: this.headers(userToken) },
      );
      sections = secRes.ok ? ((await secRes.json()) as SectionRow[]) : [];
    }
    const sectionIds = sections.map((s) => s.id);

    // Section topic metadata (future topics)
    let futureTopicsBySection: Record<string, string[]> = {};
    if (sectionIds.length) {
      const encodedSectionIds = sectionIds.join(',');
      const topicUrl = `${this.restUrl}/section_topics?section_id=in.(${encodedSectionIds})&select=section_id,future_topic&order=order_index.asc.nullsfirst`;
      const topicRes = await fetch(topicUrl, {
        headers: this.headers(userToken),
      });
      if (topicRes.ok) {
        type TopicRow = { section_id?: string; future_topic?: string | null };
        const topicRows = (await topicRes.json()) as TopicRow[];
        const topicMap = new Map<string, Set<string>>();
        topicRows.forEach((row) => {
          const sectionId = row.section_id;
          const topicValue =
            typeof row.future_topic === 'string' ? row.future_topic.trim() : '';
          if (!sectionId || !topicValue) {
            return;
          }
          const existing = topicMap.get(sectionId) ?? new Set<string>();
          existing.add(topicValue);
          topicMap.set(sectionId, existing);
        });
        futureTopicsBySection = Object.fromEntries(
          Array.from(topicMap.entries()).map(([sectionId, topics]) => [
            sectionId,
            Array.from(topics),
          ]),
        );
      } else {
        console.warn(
          'Failed to fetch section topic metadata:',
          topicRes.status,
          await topicRes.text(),
        );
      }
    }

    // Lectures
    let lectures: LectureRow[] = [];
    if (sectionIds.length) {
      const lRes = await fetch(
        `${this.restUrl}/lectures?section_id=in.(${sectionIds.join(',')})`,
        { headers: this.headers(userToken) },
      );
      lectures = lRes.ok ? ((await lRes.json()) as LectureRow[]) : [];
    }

    // Practices with nested questions
    let practices: PracticeRow[] = [];
    if (sectionIds.length && includePractices) {
      const practiceBaseSelect =
        'id,title,content,description,section_id,order_index,created_at,updated_at,type,difficulty,status,time_limit,passing_score,max_attempts,data,practice_type,user_id,section_id';
      const practiceSelect = includePracticeQuestions
        ? `${practiceBaseSelect},section_exercise_questions(id,type,text,hint,explanation,points,order_index,content,language,subject_type,execution_enabled,starter_code,test_cases,sample_data,expected_runtime,difficulty_override,exercise_type,subject_focus,interactive_config,validation_logic,hints_and_tips,created_at,updated_at,section_exercise_options(id,text,correct,order_index),section_exercise_answers(id,answer_text,is_case_sensitive),practice_datasets(id,question_id,schema_info,creation_sql,creation_python))`
        : practiceBaseSelect;
      const pRes = await fetch(
        `${this.restUrl}/section_exercises?section_id=in.(${sectionIds.join(',')})&order=order_index.asc.nullsfirst&select=${practiceSelect}`,
        { headers: this.headers(userToken) },
      );
      practices = pRes.ok ? ((await pRes.json()) as PracticeRow[]) : [];
    }

    // Quizzes
    let quizzes: QuizRow[] = [];
    if (sectionIds.length && includeQuizzes) {
      const qRes = await fetch(
        `${this.restUrl}/quizzes?section_id=in.(${sectionIds.join(',')})`,
        { headers: this.headers(userToken) },
      );
      quizzes = qRes.ok ? ((await qRes.json()) as QuizRow[]) : [];
    }
    const quizIds =
      includeQuizzes && quizzes.length ? quizzes.map((q) => q.id) : [];

    // Questions
    let questions: QuizQuestionRow[] = [];
    if (quizIds.length && includeQuizQuestions) {
      const qqRes = await fetch(
        `${this.restUrl}/quiz_questions?quiz_id=in.(${quizIds.join(',')})&order=order_index.asc.nullsfirst`,
        { headers: this.headers(userToken) },
      );
      questions = qqRes.ok ? ((await qqRes.json()) as QuizQuestionRow[]) : [];
    }
    const qIds =
      includeQuizQuestions && questions.length
        ? questions.map((q) => q.id)
        : [];

    // Options
    let quizOptions: QuizOptionRow[] = [];
    if (qIds.length && includeQuizQuestions) {
      const oRes = await fetch(
        `${this.restUrl}/quiz_options?question_id=in.(${qIds.join(',')})`,
        { headers: this.headers(userToken) },
      );
      quizOptions = oRes.ok ? ((await oRes.json()) as QuizOptionRow[]) : [];
    }

    // Build hierarchy
    const sectionMap = Object.fromEntries(
      sections.map((s) => [
        s.id,
        {
          ...s,
          futureTopics: futureTopicsBySection[s.id] || [],
          lectures: [] as LectureRow[],
          practices: [] as PracticeRow[],
          quiz: null as any,
        },
      ]),
    );
    lectures.forEach((l) => {
      const s = sectionMap[l.section_id];
      if (s) s.lectures.push(l);
    });
    practices.forEach((p) => {
      const s = sectionMap[p.section_id];
      if (s) s.practices.push(p);
    });
    const quizMap = Object.fromEntries(
      quizzes.map((q) => [q.id, { ...q, questions: [] as any[] }]),
    );
    const sectionQuizMap: Record<string, UUID> = {};
    quizzes.forEach((q) => {
      sectionQuizMap[q.section_id] = q.id;
    });
    if (includeQuizQuestions) {
      questions.forEach((qq) => {
        const q = quizMap[qq.quiz_id];
        if (q) q.questions.push({ ...qq, options: [] as QuizOptionRow[] });
      });
      quizOptions.forEach((op) => {
        for (const q of Object.values(quizMap) as any[]) {
          const found = q.questions.find((qq: any) => qq.id === op.question_id);
          if (found) {
            found.options.push(op);
            break;
          }
        }
      });
    }
    // Attach quiz objects to sections
    Object.keys(sectionMap).forEach((sid) => {
      const qid = sectionQuizMap[sid];
      if (qid) (sectionMap as any)[sid].quiz = quizMap[qid] || null;
    });

    const modulesBySubject: Record<string, any[]> = {};
    modules.forEach((m) => {
      (modulesBySubject[m.subject_id] ||= []).push({
        ...m,
        sections: [] as any[],
      });
    });
    const moduleObjMap: Record<string, any> = {};
    Object.values(modulesBySubject)
      .flat()
      .forEach((mo: any) => {
        moduleObjMap[mo.id] = mo;
      });
    Object.values(sectionMap).forEach((sec: any) => {
      const mo = moduleObjMap[sec.module_id];
      if (mo) mo.sections.push(sec);
    });
    const subjectsOut = subjects.map((s) => ({
      ...s,
      modules: modulesBySubject[s.id] || [],
    }));

    const fullCourse = { ...course, subjects: subjectsOut };
    this.setCachedCourseFull(courseId, fullCourse, fetchOptions);
    return fullCourse;
  }

  // Updates
  async updateCourse(
    id: UUID,
    data: {
      title?: string;
      description?: string | null;
      status?: string;
      difficulty?: string;
      category?: string | null;
      duration?: number | null;
      enrolled_count?: number | null;
    },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const result = await this.patchById<CourseRow & any>(
      'courses',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.description !== undefined
          ? { description: data.description }
          : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.difficulty !== undefined
          ? { difficulty: data.difficulty }
          : {}),
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.duration !== undefined ? { duration: data.duration } : {}),
        ...(data.enrolled_count !== undefined
          ? { enrolled_count: data.enrolled_count }
          : {}),
        updated_at: now,
      },
      userToken,
    );
    this.invalidateCourseCaches(id);
    return result;
  }

  async updateSubject(
    id: UUID,
    data: { title?: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    return this.patchById<SubjectRow>(
      'subjects',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        updated_at: now,
      },
      userToken,
    );
  }

  async updateModule(
    id: UUID,
    data: { title?: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    return this.patchById<ModuleRow>(
      'modules',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        updated_at: now,
      },
      userToken,
    );
  }

  async updateSection(
    id: UUID,
    data: { title?: string; order?: number | null; status?: string | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    return this.patchById<SectionRow>(
      'sections',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        updated_at: now,
      },
      userToken,
    );
  }

  async updatePractice(
    id: UUID,
    data: { title?: string; content?: string | null; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    const result = await this.patchById<PracticeRow>(
      'section_exercises',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.content !== undefined ? { content: data.content } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        updated_at: now,
      },
      userToken,
    );
    const courseId = await this.resolveCourseIdForPractice(id, userToken);
    this.invalidateCourseCaches(courseId ?? undefined);
    return result;
  }

  async updateQuiz(
    id: UUID,
    data: { title?: string; order?: number | null },
    userToken?: string,
  ) {
    const now = new Date().toISOString();
    return this.patchById<QuizRow>(
      'quizzes',
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.order !== undefined ? { order_index: data.order } : {}),
        updated_at: now,
      },
      userToken,
    );
  }

  // Deletes
  async deleteCourse(id: UUID, userToken?: string) {
    await this.deleteById('courses', id, userToken);
    this.invalidateCourseCaches(id);
  }
  async deleteSubject(id: UUID, userToken?: string) {
    return this.deleteById('subjects', id, userToken);
  }
  async deleteModule(id: UUID, userToken?: string) {
    return this.deleteById('modules', id, userToken);
  }
  async deleteSection(id: UUID, userToken?: string) {
    return this.deleteById('sections', id, userToken);
  }
  async deletePractice(id: UUID, userToken?: string) {
    const courseId = await this.resolveCourseIdForPractice(id, userToken);
    const result = await this.deleteById('section_exercises', id, userToken);
    this.invalidateCourseCaches(courseId ?? undefined);
    return result;
  }
  async deleteQuiz(id: UUID, userToken?: string) {
    return this.deleteById('quizzes', id, userToken);
  }

  async listModules(userToken?: string): Promise<any[]> {
    // Get all modules with subject and course info
    const url = `${this.restUrl}/modules?select=id,title,subject_id,order_index,created_at,updated_at,subjects(id,title,course_id,courses(id,title))`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `modules select failed: ${res.status} ${await res.text()}`,
      );
    }
    const modules = await res.json();

    // Transform the data to match the expected format
    return modules.map((module: any) => ({
      id: module.id,
      title: module.title,
      subject_id: module.subjects?.id || '',
      subject_title: module.subjects?.title || '',
      course_id: module.subjects?.courses?.id || '',
      course_title: module.subjects?.courses?.title || '',
      order_index: module.order_index || 0,
      created_at: module.created_at,
      updated_at: module.updated_at,
    }));
  }

  async getSectionsByModule(
    moduleId: UUID,
    userToken?: string,
  ): Promise<SectionRow[]> {
    const url = `${this.restUrl}/sections?module_id=eq.${moduleId}&order=order_index.asc.nullslast`;
    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        `sections select failed: ${res.status} ${await res.text()}`,
      );
    }
    return (await res.json()) as SectionRow[];
  }

  async getModuleWithSections(
    moduleId: UUID,
    userToken?: string,
  ): Promise<any> {
    // Get module details with its sections
    const moduleUrl = `${this.restUrl}/modules?id=eq.${moduleId}&select=id,title,subject_id,order_index,created_at,updated_at,subjects(id,title,course_id,courses(id,title))&limit=1`;
    const moduleRes = await fetch(moduleUrl, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });
    if (!moduleRes.ok) {
      throw new InternalServerErrorException(
        `module select failed: ${moduleRes.status} ${await moduleRes.text()}`,
      );
    }
    const modules = await moduleRes.json();
    if (!modules[0]) {
      throw new Error(`Module ${moduleId} not found`);
    }
    const module = modules[0];

    // Get sections for this module
    const sections = await this.getSectionsByModule(moduleId, userToken);

    return {
      id: module.id,
      title: module.title,
      subject_id: module.subjects?.id || '',
      subject_title: module.subjects?.title || '',
      course_id: module.subjects?.courses?.id || '',
      course_title: module.subjects?.courses?.title || '',
      order_index: module.order_index || 0,
      created_at: module.created_at,
      updated_at: module.updated_at,
      sections,
    };
  }

  async addGeneratedQuiz(
    sectionId: UUID,
    data: {
      title: string;
      order?: number | null;
      generationInput: {
        main_topic: string;
        topic_hierarchy: string;
        Student_level_in_topic: string;
        question_number: number;
        target_len: number;
        conversation_history?: Array<{
          main_topic: string;
          topic_hierarchy: string;
          question_number: number;
          difficulty: string;
          question: string;
          options: {
            label: string;
            text: string;
          }[];
          correct_option: {
            label: string;
            text: string;
          };
          explanation: string;
        }>;
      };
    },
    userToken?: string,
  ) {
    // Generate questions using the external API
    const { questions } = await this.quizGenerationService.generateQuestions({
      main_topic: data.generationInput.main_topic,
      topic_hierarchy: data.generationInput.topic_hierarchy,
      Student_level_in_topic: data.generationInput.Student_level_in_topic,
      question_number: data.generationInput.question_number,
      target_len: data.generationInput.target_len,
      conversation_history: data.generationInput.conversation_history || [],
    });

    // Transform to the expected format
    const transformedQuestions = questions.map((q) => {
      // Find the correct option
      const correctOptionLabel = q.correct_option.label;

      // Map options and mark the correct one
      const options = q.options.map((opt) => ({
        text: opt.text,
        correct: opt.label === correctOptionLabel,
      }));

      return {
        type: 'mcq',
        text: q.question,
        options,
      };
    });

    // Add the quiz using the existing method
    return await this.addQuiz(
      sectionId,
      {
        title: data.title,
        order: data.order,
        questions: transformedQuestions,
      },
      userToken,
    );
  }

  async addBulkGeneratedPracticeExercises(
    sectionId: UUID,
    data: {
      title: string;
      order?: number | null;
      generationInput: PracticeExerciseGenerationInput;
    },
    userToken?: string,
  ): Promise<PracticeRow[]> {
    // Generate exercises using the external API
    const generationResponse =
      await this.practiceExercisesGenerationService.generateExercises(
        data.generationInput,
      );

    const createdExercises: PracticeRow[] = [];

    // Process each question from the generated response
    for (const question of generationResponse.questions_raw) {
      const resolvedLanguage =
        data.generationInput.solution_coding_language ||
        data.generationInput.coding_language ||
        'sql';
      const normalizedLanguage =
        resolvedLanguage && resolvedLanguage.toString().trim().length > 0
          ? resolvedLanguage.toString().trim()
          : 'sql';

      // Build structured content for the practice exercise
      const exerciseContent = {
        version: 1,
        exerciseType: normalizedLanguage,
        language: normalizedLanguage,
        instructions: question.business_question,
        dataset: generationResponse.dataset_description,
        dataDictionary: generationResponse.data_dictionary,
        dataCreationSql: generationResponse.data_creation_sql,
        expectedColumns:
          generationResponse.expected_cols_list[question.id - 1] || [],
        answerSql: generationResponse.answers_sql_map[question.id] || '',
        difficulty: question.difficulty,
        adaptiveNote: question.adaptive_note,
        topics: question.topics,
        headerText: generationResponse.header_text,
        businessContext: generationResponse.business_context,
        type: 'practice',
        verification: generationResponse.verification.find(
          (v) => v.question === question.id,
        ),
      };

      // Generate title from question ID and difficulty
      const exerciseTitle = `${question.difficulty.charAt(0).toUpperCase() + question.difficulty.slice(1)} ${normalizedLanguage.toUpperCase()} Exercise ${question.id}`;

      // Add the practice exercise
      const exercise = await this.addPractice(
        sectionId,
        {
          title: exerciseTitle,
          content: exerciseContent.businessContext,
          description: exerciseContent.instructions,
          programming_language: exerciseContent.language,
          order: data.order !== undefined ? data.order : undefined,
        },
        userToken,
      );

      createdExercises.push(exercise);
    }

    return createdExercises;
  }
}
