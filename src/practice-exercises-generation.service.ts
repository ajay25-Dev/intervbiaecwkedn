import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import { ProfilesService } from './profiles.service';
import { DatasetExecutionService } from './dataset-execution.service';

const sanitizeTableName = (value?: string | null, fallback?: string) => {
  const base = (value || fallback || 'dataset').trim().toLowerCase();
  const cleaned = base
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!cleaned) return fallback || 'dataset';
  if (/^[0-9]/.test(cleaned)) {
    return `t_${cleaned}`;
  }
  return cleaned;
};

export type PracticeExerciseGenerationResponse = {
  header_text: string;
  business_context: string;
  dataset_description: string;
  data_dictionary: Record<string, string>;
  questions_raw: Array<{
    id: number;
    business_question: string;
    expected_output_table?: string[];
    topics: string[];
    difficulty: string;
    adaptive_note: string;
  }>;
  expected_cols_list: string[][];
  data_creation_sql: string;
  answers_sql_map: Record<number, string>;
  data_creation_python?: string;
  dataset_csv_raw?: string;
  dataset_columns?: string[];
  dataset_rows?: Record<string, any>[];
  dataset_table_name?: string;
  verification: Array<{
    question: number;
    columns: string[];
    rows_preview: string[][];
    columns_match_expected: boolean;
    returns_rows: boolean;
    ok: boolean;
    error?: string;
  }>;
};

export type PracticeExerciseGenerationInput = {
  field: string;
  domain: string;
  subject: string;
  topic: string;
  topic_hierarchy: string;
  future_topics?: string[];
  learner_level: string;
  coding_language: string;
  solution_coding_language?: string;
  dataset_creation_coding_language?: string;
  verify_locally: boolean;
};

export type SectionBasedExerciseGenerationInput = {
  courseId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  userId?: string;
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
  solutionCodingLanguage?: string;
  datasetCreationCodingLanguage?: string;
};

export type PracticeGenerationOverrides = {
  domain?: string;
  learnerLevel?: 'Beginner' | 'Intermediate' | 'Advanced';
  topic?: string;
  topicHierarchy?: string;
  futureTopics?: string[];
};

type SubmissionEvaluationPayload = {
  question: string;
  expected_answer: string;
  student_answer: string;
  subject?: string;
  topic_hierarchy?: string;
  future_topics?: string[];
};

type SubmissionHintPayload = SubmissionEvaluationPayload & {
  current_code?: string;
  dataset_context?: string;
};

type SubmissionEvaluationResult = {
  verdict: string;
  feedback: string;
  raw_response?: string;
};

type SubmissionHintResult = {
  verdict: string;
  message: string;
  raw_response?: string;
};

type QuestionSubmissionSummary = {
  userAnswer: string;
  isCorrect: boolean;
  score: number;
  feedback: string | null;
  verdict: string;
  evaluation: SubmissionEvaluationResult | null;
  submittedAt: string | null;
  attemptNumber?: number;
};

type MentorChatMessageRecord = {
  role: 'student' | 'mentor';
  content: string;
  created_at?: string;
};

type MentorChatPayload = {
  context: string;
  hypothesis: string;
  target_questions: string[];
  student_message: string;
  conversation_history: MentorChatMessageRecord[];
  identified_questions: string[];
  exercise_title?: string;
  exercise_description?: string;
  exercise_questions?: string[];
  section_title?: string;
  section_overview?: string;
  guiding_prompt?: string;
};

type MentorChatResult = {
  message: string;
  identified_questions: string[];
  status: 'coaching' | 'completed';
  raw_response?: string;
};

type TopicMetadata = {
  topicHierarchyValues: string[];
  futureTopicValues: string[];
};

type SectionExerciseQuestionRecord = {
  id?: string;
  points?: number | null;
  text?: string | null;
  type?: string | null;
  language?: string | null;
  content?: unknown;
  exercise_id?: string | null;
  expected_output_table?: string[] | null;
};

@Injectable()
export class PracticeExercisesGenerationService {
  private apiUrl = process.env.BASE_AI_API_URL + '/generate';
  private aiEvaluationUrl =
    (process.env.BASE_AI_API_URL || '') + '/submission/evaluate';
  private aiHintUrl = (process.env.BASE_AI_API_URL || '') + '/submission/hints';
  private aiMentorChatUrl =
    (process.env.BASE_AI_API_URL || '') + '/mentor-chat';
  private hintStorageUnavailable = false;
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  constructor(
    private readonly profilesService: ProfilesService,
    private readonly datasetExecutionService: DatasetExecutionService,
  ) {}

  private splitCsvLine(line: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }

    values.push(current.trim());

    return values.map((value) => value.replace(/^"(.*)"$/, '$1'));
  }

  private sanitizeCsvSource(source?: string | null): string | null {
    if (!source || typeof source !== 'string') {
      return null;
    }

    const normalized = source.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const commentPattern = /^\s*(\/\/|--|#)/;
    const headerSqlPattern =
      /\b(select|create|insert|update|delete|merge|with|drop|alter|table|into|values)\b/i;

    const csvLines: string[] = [];
    let headerDetected = false;

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();

      if (!headerDetected) {
        if (!trimmed) {
          continue;
        }
        if (commentPattern.test(trimmed)) {
          continue;
        }
        if (headerSqlPattern.test(trimmed)) {
          return null;
        }

        const cells = this.splitCsvLine(rawLine);
        if (cells.length <= 1) {
          continue;
        }

        csvLines.push(rawLine.replace(/\s+$/, ''));
        headerDetected = true;
      } else {
        if (!trimmed) {
          continue;
        }
        if (commentPattern.test(trimmed)) {
          continue;
        }
        csvLines.push(rawLine.replace(/\s+$/, ''));
      }
    }

    if (!headerDetected || csvLines.length < 2) {
      return null;
    }

    return csvLines.join('\n');
  }

  private parseSanitizedCsv(csv: string): Record<string, unknown>[] {
    const lines = csv.split('\n').filter((line) => line.trim().length > 0);
    if (lines.length < 2) {
      return [];
    }

    const headers = this.splitCsvLine(lines[0]);
    const records: Record<string, unknown>[] = [];

    lines.slice(1).forEach((line) => {
      const cells = this.splitCsvLine(line);
      const row: Record<string, unknown> = {};
      headers.forEach((header, index) => {
        const cell = cells[index] ?? '';
        row[header] = cell;
      });
      records.push(row);
    });

    return records;
  }

  private normalizeQuestionContent(content: unknown): Record<string, unknown> {
    if (!content) {
      return {};
    }

    if (typeof content === 'object' && !Array.isArray(content)) {
      return content as Record<string, unknown>;
    }

    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (!trimmed) {
        return {};
      }
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch (error) {
        console.warn('Failed to parse question content JSON:', error);
      }
    }

    return {};
  }

  private coalesceStrings(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
    }
    return null;
  }

  private normalizeTopicValue(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizeTopicList(values: Array<unknown>): string[] {
    const normalized = new Set<string>();
    for (const value of values) {
      const topic = this.normalizeTopicValue(value);
      if (topic) {
        normalized.add(topic);
      }
    }
    return [...normalized];
  }

  private resolveSolutionCodingLanguage(
    provided?: string | null,
    exerciseType?: string | null,
    subjectTitle?: string | null,
  ): string {
    if (provided && provided.trim()) {
      return provided.trim();
    }

    const type = exerciseType?.trim().toLowerCase() ?? '';
    const subject = subjectTitle?.trim();

    if (
      type === 'google_sheets' ||
      type === 'google sheets' ||
      type === 'sheets' ||
      type === 'sheet' ||
      type === 'statistics' ||
      type === 'statistic'
    ) {
      return 'excel formula';
    }

    if (type === 'python') {
      return 'python';
    }

    if (type === 'sql') {
      return 'sql';
    }

    if (subject) {
      return subject;
    }

    return exerciseType?.trim() || 'sql';
  }

  private async fetchSectionTopicMetadata(
    sectionId?: string | null,
  ): Promise<TopicMetadata> {
    if (!sectionId) {
      return { topicHierarchyValues: [], futureTopicValues: [] };
    }

    const { data, error } = await this.supabase
      .from('section_topics')
      .select('topic_hierarchy, future_topic')
      .eq('section_id', sectionId)
      .order('order_index', { ascending: true });

    if (error || !data) {
      if (error) {
        console.warn('Failed to fetch section topic metadata:', error);
      }
      return { topicHierarchyValues: [], futureTopicValues: [] };
    }
    console.log('Fetched section topic metadata:', data);

    return {
      topicHierarchyValues: this.normalizeTopicList(
        data.map((topic) => topic.topic_hierarchy),
      ),
      futureTopicValues: this.normalizeTopicList(
        data.map((topic) => topic.future_topic),
      ),
    };
  }

  private async getQuestionTopicMetadata(
    exerciseId?: string | null,
  ): Promise<TopicMetadata> {
    if (!exerciseId) {
      return { topicHierarchyValues: [], futureTopicValues: [] };
    }

    const { data: exercise, error } = await this.supabase
      .from('section_exercises')
      .select('section_id')
      .eq('id', exerciseId)
      .single();

    if (error || !exercise?.section_id) {
      if (error) {
        console.warn('Failed to resolve section for exercise metadata:', error);
      }
      return { topicHierarchyValues: [], futureTopicValues: [] };
    }

    return this.fetchSectionTopicMetadata(exercise.section_id);
  }

  private extractTopicsFromContent(content: unknown): string[] {
    const normalized = this.normalizeQuestionContent(content) as Record<
      string,
      any
    >;
    const topicsValue = normalized?.topics ?? normalized?.Topics;

    if (Array.isArray(topicsValue)) {
      return topicsValue
        .map((topic) =>
          typeof topic === 'string'
            ? topic.trim()
            : typeof topic?.name === 'string'
              ? topic.name.trim()
              : '',
        )
        .filter((topic) => topic.length > 0);
    }

    if (typeof topicsValue === 'string') {
      return topicsValue
        .split(',')
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0);
    }

    return [];
  }

  private extractFutureTopicsFromContent(content: unknown): string[] {
    const normalized = this.normalizeQuestionContent(content) as Record<
      string,
      any
    >;
    const futureTopicsValue =
      normalized?.future_topics ??
      normalized?.futureTopics ??
      normalized?.future_topics_list;

    if (Array.isArray(futureTopicsValue)) {
      return futureTopicsValue
        .map((topic) =>
          typeof topic === 'string'
            ? topic.trim()
            : typeof topic?.name === 'string'
              ? topic.name.trim()
              : '',
        )
        .filter((topic) => topic.length > 0);
    }

    if (typeof futureTopicsValue === 'string') {
      return futureTopicsValue
        .split(',')
        .map((topic) => topic.trim())
        .filter((topic) => topic.length > 0);
    }

    return [];
  }

  private extractMentorChatConfig(question: any) {
    const normalizedContent = this.normalizeQuestionContent(
      question?.content,
    ) as Record<string, any>;

    const context = this.coalesceStrings(
      normalizedContent?.context,
      normalizedContent?.scenario,
      normalizedContent?.background,
      question?.context,
      question?.description,
    );

    const hypothesis = this.coalesceStrings(
      normalizedContent?.hypothesis,
      normalizedContent?.claim,
      question?.hypothesis,
      question?.text,
    );

    const guidingQuestion = this.coalesceStrings(
      normalizedContent?.question,
      normalizedContent?.guiding_question,
      normalizedContent?.prompt,
      question?.text,
    );

    const introMessage = this.coalesceStrings(
      normalizedContent?.intro_message,
      normalizedContent?.intro,
      normalizedContent?.opening_line,
      normalizedContent?.mentor_intro,
      question?.hint,
    );

    const targetsRaw =
      normalizedContent?.target_questions ??
      normalizedContent?.targetQuestions ??
      normalizedContent?.targets ??
      normalizedContent?.ideal_questions;

    const targetQuestions = Array.isArray(targetsRaw)
      ? targetsRaw
          .map((item) => {
            if (typeof item === 'string') {
              return item.trim();
            }
            if (item && typeof item === 'object') {
              const candidate =
                (item as { text?: unknown }).text ??
                (item as { question?: unknown }).question ??
                (item as { value?: unknown }).value;
              if (typeof candidate === 'string') {
                return candidate.trim();
              }
            }
            return '';
          })
          .filter((item) => item.length > 0)
      : [];

    return {
      context: context ?? '',
      hypothesis: hypothesis ?? '',
      guidingQuestion: guidingQuestion ?? '',
      targetQuestions,
      introMessage: introMessage ?? null,
    };
  }

  private extractQuestionSummaryText(question: any): string | null {
    const direct = this.coalesceStrings(
      question?.text,
      question?.business_question,
      question?.prompt,
      question?.description,
    );

    if (direct) {
      return direct;
    }

    const normalized = this.normalizeQuestionContent(question?.content);
    return (
      this.coalesceStrings(
        normalized?.question,
        normalized?.prompt,
        normalized?.text,
        normalized?.description,
        normalized?.scenario,
        normalized?.context,
      ) ?? null
    );
  }

  private normalizeMentorChatRecord(record: any) {
    if (!record || typeof record !== 'object') {
      return {
        id: null,
        status: 'active',
        messages: [] as MentorChatMessageRecord[],
        identified_questions: [] as string[],
        final_summary: null as string | null,
        completed_at: null as string | null,
        created_at: null as string | null,
        updated_at: null as string | null,
        exercise_id: null,
        question_id: null,
      };
    }

    const rawMessages = Array.isArray(record?.messages)
      ? (record.messages as MentorChatMessageRecord[])
      : [];

    const messages = rawMessages
      .map((entry) => {
        const role =
          typeof entry?.role === 'string' &&
          entry.role.toLowerCase() === 'mentor'
            ? 'mentor'
            : 'student';
        const content =
          typeof entry?.content === 'string' ? entry.content.trim() : '';
        const createdAt =
          typeof entry?.created_at === 'string' ? entry.created_at : null;
        if (!content) {
          return null;
        }
        return {
          role,
          content,
          created_at: createdAt ?? null,
        } as MentorChatMessageRecord;
      })
      .filter((entry): entry is MentorChatMessageRecord => !!entry);

    const identified = Array.isArray(record?.identified_questions)
      ? (record.identified_questions as unknown[])
          .filter(
            (item): item is string =>
              typeof item === 'string' && item.trim().length > 0,
          )
          .map((item) => item.trim())
      : [];

    const status =
      typeof record?.status === 'string' &&
      record.status.toLowerCase() === 'completed'
        ? 'completed'
        : 'active';

    return {
      id:
        typeof record?.id === 'string'
          ? record.id
          : typeof record?.id === 'number'
            ? String(record.id)
            : null,
      status,
      messages,
      identified_questions: identified,
      final_summary:
        typeof record?.final_summary === 'string' ? record.final_summary : null,
      completed_at:
        typeof record?.completed_at === 'string' ? record.completed_at : null,
      created_at:
        typeof record?.created_at === 'string' ? record.created_at : null,
      updated_at:
        typeof record?.updated_at === 'string' ? record.updated_at : null,
      exercise_id:
        typeof record?.exercise_id === 'string'
          ? record.exercise_id
          : typeof record?.exercise_id === 'number'
            ? String(record.exercise_id)
            : null,
      question_id:
        typeof record?.question_id === 'string'
          ? record.question_id
          : typeof record?.question_id === 'number'
            ? String(record.question_id)
            : null,
    };
  }

  private mergeIdentifiedTargets(
    existing: string[] = [],
    updates: string[] = [],
  ): string[] {
    const merged: string[] = [];
    const seen = new Set<string>();

    for (const list of [existing, updates]) {
      for (const item of list) {
        if (typeof item !== 'string') {
          continue;
        }
        const trimmed = item.trim();
        if (!trimmed) {
          continue;
        }
        const key = trimmed.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        merged.push(trimmed);
        if (merged.length >= 3) {
          return merged;
        }
      }
    }

    return merged;
  }

  private async ensureMentorChatSession(
    exerciseId: string,
    questionId: string,
    userId: string,
  ) {
    const { data: question, error: questionError } = await this.supabase
      .from('section_exercise_questions')
      .select('id,text,content,hint,exercise_id')
      .eq('id', questionId)
      .maybeSingle();

    if (questionError) {
      console.error('Failed to fetch question for mentor chat:', questionError);
      throw new InternalServerErrorException(
        `Failed to load question: ${questionError.message}`,
      );
    }

    if (!question) {
      throw new NotFoundException('Question not found for mentor chat.');
    }

    const config = this.extractMentorChatConfig(question);

    const { data: exerciseRecord, error: exerciseError } = await this.supabase
      .from('section_exercises')
      .select('id,title,description,content,section_id')
      .eq('id', exerciseId)
      .maybeSingle();

    if (exerciseError) {
      console.error('Failed to fetch exercise for mentor chat:', exerciseError);
      throw new InternalServerErrorException(
        `Failed to load exercise: ${exerciseError.message}`,
      );
    }

    if (!exerciseRecord) {
      throw new NotFoundException('Exercise not found for mentor chat.');
    }

    let sectionRecord: {
      id: string | null;
      title: string | null;
      overview: string | null;
    } | null = null;

    if (exerciseRecord?.section_id) {
      const { data: sectionData, error: sectionError } = await this.supabase
        .from('sections')
        .select('id,title,overview')
        .eq('id', exerciseRecord.section_id)
        .maybeSingle();

      if (sectionError) {
        console.warn(
          'Failed to fetch section context for mentor chat:',
          sectionError,
        );
      } else if (sectionData) {
        sectionRecord = {
          id:
            sectionData.id !== undefined && sectionData.id !== null
              ? String(sectionData.id)
              : null,
          title: sectionData.title ?? null,
          overview: sectionData.overview ?? null,
        };
      }
    }

    const { data: exerciseQuestionsData, error: questionListError } =
      await this.supabase
        .from('section_exercise_questions')
        .select('id,text,content,order_index')
        .eq('exercise_id', exerciseId)
        .order('order_index', { ascending: true });

    if (questionListError) {
      console.warn(
        'Failed to fetch exercise questions for mentor chat:',
        questionListError,
      );
    }

    const normalizedQuestions = Array.isArray(exerciseQuestionsData)
      ? exerciseQuestionsData
          .map((item, index) => {
            const summary = this.extractQuestionSummaryText(item);
            return {
              id:
                item?.id !== undefined && item?.id !== null
                  ? String(item.id)
                  : null,
              order:
                typeof item?.order_index === 'number'
                  ? item.order_index
                  : index,
              text: summary ?? '',
            };
          })
          .filter((entry) => entry.text && entry.text.length > 0)
      : [];

    const exerciseDetails = {
      id:
        exerciseRecord?.id !== undefined && exerciseRecord?.id !== null
          ? String(exerciseRecord.id)
          : null,
      title: exerciseRecord?.title ?? null,
      description: exerciseRecord?.description ?? null,
      content: exerciseRecord?.content ?? null,
    };

    const sessionSelectFields =
      'id,student_id,exercise_id,question_id,messages,identified_questions,status,final_summary,completed_at,created_at,updated_at';

    const fetchExistingChatSession = () =>
      this.supabase
        .from('section_exercise_question_chats')
        .select(sessionSelectFields)
        .eq('student_id', userId)
        .eq('exercise_id', exerciseId)
        .eq('question_id', questionId)
        .maybeSingle();

    const { data: existingSession, error: sessionError } =
      await fetchExistingChatSession();

    if (sessionError && sessionError.code !== 'PGRST116') {
      console.error('Failed to fetch mentor chat session:', sessionError);
      throw new InternalServerErrorException(
        `Failed to load mentor chat session: ${sessionError.message}`,
      );
    }

    if (existingSession) {
      return {
        question,
        config,
        session: existingSession,
        exercise: exerciseDetails,
        section: sectionRecord,
        questionList: normalizedQuestions,
      };
    }

    const initialMessages =
      config.introMessage && config.introMessage.length > 0
        ? [
            {
              role: 'mentor',
              content: config.introMessage,
              created_at: new Date().toISOString(),
            },
          ]
        : [];

    const { data: createdSession, error: createError } = await this.supabase
      .from('section_exercise_question_chats')
      .insert({
        student_id: userId,
        exercise_id: exerciseId,
        question_id: questionId,
        messages: initialMessages,
        identified_questions: [],
        status: 'active',
        final_summary: null,
        completed_at: null,
      })
      .select(sessionSelectFields)
      .single();

    if (createError) {
      if (createError.code === '23505') {
        const { data: conflictSession, error: conflictFetchError } =
          await fetchExistingChatSession();

        if (conflictFetchError && conflictFetchError.code !== 'PGRST116') {
          console.error(
            'Failed to fetch mentor chat session after conflict:',
            conflictFetchError,
          );
          throw new InternalServerErrorException(
            'Failed to start mentor chat session due to a conflict fetching the existing session.',
          );
        }

        if (conflictSession) {
          return {
            question,
            config,
            session: conflictSession,
            exercise: exerciseDetails,
            section: sectionRecord,
            questionList: normalizedQuestions,
          };
        }
      }

      console.error('Failed to create mentor chat session:', createError);
      throw new InternalServerErrorException(
        `Failed to start mentor chat session: ${createError.message}`,
      );
    }

    return {
      question,
      config,
      session: createdSession,
      exercise: exerciseDetails,
      section: sectionRecord,
      questionList: normalizedQuestions,
    };
  }

  private async callAiEvaluation(
    payload: SubmissionEvaluationPayload,
  ): Promise<SubmissionEvaluationResult | null> {
    if (!this.aiEvaluationUrl) {
      console.warn('AI evaluation URL is not configured');
      return null;
    }

    try {
      const response = await fetch(this.aiEvaluationUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `AI evaluation request failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as SubmissionEvaluationResult;

      if (!data?.verdict) {
        console.warn('AI evaluation response missing verdict field');
        return null;
      }

      console.log(data);
      return data;
    } catch (error) {
      console.error('AI evaluation request error:', error);
      return null;
    }
  }

  private async callAiHint(
    payload: SubmissionHintPayload,
  ): Promise<SubmissionHintResult | null> {
    if (!this.aiHintUrl) {
      console.warn('AI hint URL is not configured');
      return null;
    }

    try {
      console.log('Calling AI hint URL', this.aiHintUrl, 'payload', payload);
      const response = await fetch(this.aiHintUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      console.log(
        `AI hint response status: ${response.status} ${response.statusText}`,
      );
      if (!response.ok) {
        console.error(
          `AI hint request failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as SubmissionHintResult;

      console.log('AI hint response body:', data);
      if (!data?.verdict || !data?.message) {
        console.warn('AI hint response missing required fields');
        return null;
      }

      return data;
    } catch (error) {
      console.error('AI hint request error:', error);
      return null;
    }
  }

  private async callMentorChat(
    payload: MentorChatPayload,
  ): Promise<MentorChatResult | null> {
    if (!this.aiMentorChatUrl) {
      console.warn('AI mentor chat URL is not configured');
      return null;
    }

    try {
      const response = await fetch(this.aiMentorChatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        console.error(
          `AI mentor chat request failed: ${response.status} ${response.statusText}`,
        );
        return null;
      }

      const data = (await response.json()) as MentorChatResult;
      if (!data || typeof data.message !== 'string') {
        console.warn('AI mentor chat response missing message field');
        return null;
      }

      const message = data.message.trim();
      const identified = Array.isArray(data.identified_questions)
        ? data.identified_questions
            .filter(
              (item): item is string =>
                typeof item === 'string' && item.trim().length > 0,
            )
            .map((item) => item.trim())
        : [];
      const status =
        data.status === 'completed'
          ? ('completed' as const)
          : ('coaching' as const);

      return {
        message,
        identified_questions: identified,
        status,
        raw_response: data.raw_response,
      };
    } catch (error) {
      console.error('AI mentor chat request error:', error);
      return null;
    }
  }

  async generateExercises(
    input: PracticeExerciseGenerationInput,
  ): Promise<PracticeExerciseGenerationResponse> {
    const datasetLanguage =
      input.dataset_creation_coding_language &&
      input.dataset_creation_coding_language.trim().length > 0
        ? input.dataset_creation_coding_language.trim()
        : 'SQL';

    const solutionLanguage =
      input.solution_coding_language &&
      input.solution_coding_language.trim().length > 0
        ? input.solution_coding_language.trim()
        : input.coding_language?.trim() || 'SQL';

    const payload = {
      ...input,
      dataset_creation_coding_language: datasetLanguage,
      solution_coding_language: solutionLanguage,
      coding_language: solutionLanguage,
    };

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new InternalServerErrorException(
          `Practice exercises generation API failed: ${response.status} ${response.statusText}`,
        );
      }

      const data: PracticeExerciseGenerationResponse = await response.json();
      console.log(`ashfbajbfajjhnlj`, data);
      return data;
    } catch (error) {
      console.error('Error generating practice exercises:', error);
      throw new InternalServerErrorException(
        `Failed to generate practice exercises: ${error.message}. Please ensure the AI service is running on ${this.apiUrl}`,
      );
    }
  }

  async generateSectionExercises(
    input: SectionBasedExerciseGenerationInput,
  ): Promise<any> {
    // Get section context from the database (with fallbacks for missing data)
    const sectionContext = await this.getSectionContext(
      input.courseId,
      input.subjectId,
      input.sectionId,
    );

    // Fetch user profile to get domain and experience level
    let userDomain = 'General';
    let userExperienceLevel: 'Beginner' | 'Intermediate' | 'Advanced' =
      input.difficulty || 'Intermediate';

    if (input.userId) {
      try {
        const userProfile = await this.profilesService.getProfile(input.userId);
        if (userProfile) {
          // Use user's domain if available
          if (userProfile.domain && userProfile.domain.trim()) {
            userDomain = userProfile.domain.trim();
          }
          // Use user's experience level if available
          if (
            userProfile.experience_level &&
            userProfile.experience_level.trim()
          ) {
            const profileLevel = userProfile.experience_level.trim();
            // Map profile experience level to difficulty level
            if (
              profileLevel.toLowerCase().includes('beginner') ||
              profileLevel.toLowerCase().includes('entry')
            ) {
              userExperienceLevel = 'Beginner';
            } else if (
              profileLevel.toLowerCase().includes('advanced') ||
              profileLevel.toLowerCase().includes('expert')
            ) {
              userExperienceLevel = 'Advanced';
            } else {
              userExperienceLevel = 'Intermediate';
            }
          }
        }
      } catch (error) {
        console.warn(
          'Failed to fetch user profile, using defaults:',
          error.message,
        );
      }
    }

    try {
      const resolvedTopicHierarchy =
        sectionContext.topicHierarchyFromDb &&
        sectionContext.topicHierarchyFromDb.length > 0
          ? sectionContext.topicHierarchyFromDb.join(', ')
          : sectionContext.allModuleLectures || input.sectionTitle;

      const requestedFutureTopics =
        Array.isArray(input.futureTopics) && input.futureTopics.length > 0
          ? this.normalizeTopicList(input.futureTopics)
          : [];
      const futureTopicSet = new Set<string>();
      if (
        Array.isArray(sectionContext.futureTopicsFromDb) &&
        sectionContext.futureTopicsFromDb.length > 0
      ) {
        sectionContext.futureTopicsFromDb.forEach((topic) => {
          const normalized = this.normalizeTopicValue(topic);
          if (normalized) {
            futureTopicSet.add(normalized);
          }
        });
      }
      requestedFutureTopics.forEach((topic) => {
        const normalized = this.normalizeTopicValue(topic);
        if (normalized) {
          futureTopicSet.add(normalized);
        }
      });
      const resolvedFutureTopics =
        futureTopicSet.size > 0 ? [...futureTopicSet] : undefined;

      const datasetCreationCodingLanguage =
        input.datasetCreationCodingLanguage?.trim().toUpperCase() || 'SQL';

      const solutionCodingLanguage = this.resolveSolutionCodingLanguage(
        input.solutionCodingLanguage,
        input.exerciseType,
        sectionContext.subjectTitle || input.sectionTitle,
      );

      // Map section-based input to the AI service format
      const aiInput: PracticeExerciseGenerationInput = {
        field: 'Data Analytics',
        domain: userDomain, // Use user's domain from profile
        subject: sectionContext.subjectTitle || input.sectionTitle,
        topic: sectionContext.currentSectionLectures || input.sectionTitle,
        topic_hierarchy: resolvedTopicHierarchy,
        future_topics: resolvedFutureTopics,
        learner_level: this.mapDifficultyToLevel(userExperienceLevel),
        coding_language: solutionCodingLanguage,
        solution_coding_language: solutionCodingLanguage,
        dataset_creation_coding_language: datasetCreationCodingLanguage,
        verify_locally: false,
      };

      // Generate exercises using the AI service
      const generatedExercises = await this.generateExercises(aiInput);

      // Store the generated exercises in the database
      const storedExercise = await this.storeGeneratedExercise(
        input,
        generatedExercises,
        sectionContext,
      );

      return {
        ...storedExercise,
        generatedContent: generatedExercises,
      };
    } catch (error) {
      console.error('Error generating section exercises:', error);
      throw new InternalServerErrorException(
        `Failed to generate exercises for section: ${error.message}`,
      );
    }
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private async getSectionContext(
    courseId: string,
    subjectId: string,
    sectionId: string,
  ) {
    let course;

    if (this.isValidUUID(courseId)) {
      // Query by UUID
      const { data: courseById, error: idError } = await this.supabase
        .from('courses')
        .select('title, id, slug')
        .eq('id', courseId)
        .single();

      if (idError) {
        console.error('Course not found by UUID:', idError);
        // Fallback to slug query
        const { data: courseBySlug, error: slugError } = await this.supabase
          .from('courses')
          .select('title, id, slug')
          .eq('slug', courseId)
          .single();

        if (slugError) {
          throw new InternalServerErrorException(
            `Course with ID/Slug ${courseId} not found: ${slugError.message}`,
          );
        }
        course = courseBySlug;
      } else {
        course = courseById;
      }
    } else {
      // Assume it's a slug, query by slug
      const { data: courseBySlug, error: slugError } = await this.supabase
        .from('courses')
        .select('title, id, slug')
        .eq('slug', courseId)
        .single();

      if (slugError) {
        console.error('Course not found by slug:', slugError);
        // Fallback to UUID query (unlikely but for completeness)
        const { data: courseById, error: idError } = await this.supabase
          .from('courses')
          .select('title, id, slug')
          .eq('id', courseId)
          .single();

        if (idError) {
          throw new InternalServerErrorException(
            `Course with ID/Slug ${courseId} not found: ${idError.message}`,
          );
        }
        course = courseById;
      } else {
        course = courseBySlug;
      }
    }

    // Get subject information
    const { data: subject, error: subjectError } = await this.supabase
      .from('subjects')
      .select('title')
      .eq('id', subjectId)
      .single();

    if (subjectError) {
      console.error('Subject not found:', subjectError);
      throw new InternalServerErrorException(
        `Subject with ID ${subjectId} not found: ${subjectError.message}`,
      );
    }

    // Get section information with module details
    const { data: section, error: sectionError } = await this.supabase
      .from('sections')
      .select('title, overview, module_id, modules(order_index)')
      .eq('id', sectionId)
      .single();

    if (sectionError) {
      console.error('Section not found:', sectionError);
      throw new InternalServerErrorException(
        `Section with ID ${sectionId} not found: ${sectionError.message}`,
      );
    }

    // Get current section's lectures for topic field
    const { data: currentSectionLectures, error: currentLecturesError } =
      await this.supabase
        .from('lectures')
        .select('title')
        .eq('section_id', sectionId)
        .order('order_index', { ascending: true });

    if (currentLecturesError) {
      console.error(
        'Error fetching current section lectures:',
        currentLecturesError,
      );
    }

    const sectionTopicMetadata =
      await this.fetchSectionTopicMetadata(sectionId);

    // Get all modules from the same subject up to and including current module
    const currentModuleOrder = section.modules?.[0]?.order_index || 0;
    const { data: modules, error: modulesError } = await this.supabase
      .from('modules')
      .select('id, order_index')
      .eq('subject_id', subjectId)
      .lte('order_index', currentModuleOrder)
      .order('order_index', { ascending: true });

    if (modulesError) {
      console.error('Error fetching modules:', modulesError);
    }

    // Get all sections from these modules
    let allModuleLectures = '';
    if (modules && modules.length > 0) {
      const moduleIds = modules.map((m) => m.id);
      const { data: sections, error: sectionsError } = await this.supabase
        .from('sections')
        .select('id, order_index, module_id')
        .in('module_id', moduleIds)
        .order('module_id', { ascending: true });

      if (sectionsError) {
        console.error('Error fetching sections:', sectionsError);
      } else if (sections && sections.length > 0) {
        // Sort sections by module order, then by section order
        const sortedSections = sections.sort((a, b) => {
          const moduleA = modules.find((m) => m.id === a.module_id);
          const moduleB = modules.find((m) => m.id === b.module_id);
          if (moduleA?.order_index !== moduleB?.order_index) {
            return (moduleA?.order_index || 0) - (moduleB?.order_index || 0);
          }
          return (a.order_index || 0) - (b.order_index || 0);
        });

        // Get all lectures from these sections
        const sectionIds = sortedSections.map((s) => s.id);
        const { data: allLectures, error: allLecturesError } =
          await this.supabase
            .from('lectures')
            .select('title, section_id, order_index')
            .in('section_id', sectionIds)
            .order('order_index', { ascending: true });

        if (allLecturesError) {
          console.error('Error fetching all lectures:', allLecturesError);
        } else if (allLectures && allLectures.length > 0) {
          // Sort lectures by section order (which is already sorted by module), then by lecture order
          const sortedLectures = allLectures.sort((a, b) => {
            const sectionA = sortedSections.find((s) => s.id === a.section_id);
            const sectionB = sortedSections.find((s) => s.id === b.section_id);
            const sectionIndexA = sortedSections.indexOf(sectionA!);
            const sectionIndexB = sortedSections.indexOf(sectionB!);

            if (sectionIndexA !== sectionIndexB) {
              return sectionIndexA - sectionIndexB;
            }
            return (a.order_index || 0) - (b.order_index || 0);
          });

          allModuleLectures = sortedLectures
            .map((lecture) => lecture.title)
            .join(', ');
        }
      }
    }

    const currentSectionLecturesStr =
      currentSectionLectures && currentSectionLectures.length > 0
        ? currentSectionLectures.map((lecture) => lecture.title).join(', ')
        : '';

    return {
      courseTitle: course.title,
      subjectTitle: subject.title,
      sectionTitle: section.title,
      sectionOverview: section.overview,
      currentSectionLectures: currentSectionLecturesStr,
      allModuleLectures: allModuleLectures || currentSectionLecturesStr,
      topicHierarchyFromDb: sectionTopicMetadata.topicHierarchyValues,
      futureTopicsFromDb: sectionTopicMetadata.futureTopicValues,
    };
  }

  private async storeGeneratedExercise(
    input: SectionBasedExerciseGenerationInput,
    generatedContent: PracticeExerciseGenerationResponse,
    context: any,
  ) {
    // console.log("userid for sectionExericse");
    // Create a practice exercise record
    const { data: exercise, error: exerciseError } = await this.supabase
      .from('section_exercises')
      .insert({
        section_id: input.sectionId,
        user_id: input.userId,
        title: `${input.sectionTitle} - Practice Exercise`,
        content: generatedContent.business_context,
        dataset: generatedContent.dataset_description,
        description:
          generatedContent.header_text ||
          `Practice exercises for ${input.sectionTitle}`,
        data: generatedContent.data_creation_sql,
        type: 'practice',
        difficulty: this.mapDifficultyToDbFormat(
          input.difficulty || 'Intermediate',
        ),
        status: 'published',
        order_index: 0,
      })
      .select()
      .single();

    if (exerciseError) {
      throw new InternalServerErrorException(
        `Failed to store exercise: ${exerciseError.message}`,
      );
    }

    // Store individual questions
    const questionsData = generatedContent.questions_raw.map(
      (question, index) => {
        const expectedOutputTable = this.normalizeStringArray(
          question.expected_output_table,
        );

        return {
          exercise_id: exercise.id,
          text: question.business_question,
          type: input.exerciseType || 'sql',
          language: input.exerciseType || 'sql',
          points: 1,
          order_index: index,
          expected_output_table:
            expectedOutputTable.length > 0 ? expectedOutputTable : null,
          content: {
            topics: question.topics,
            difficulty: question.difficulty,
            adaptive_note: question.adaptive_note,
            original_id: question.id,
            expected_output_table:
              expectedOutputTable.length > 0 ? expectedOutputTable : undefined,
          },
        };
      },
    );

    const { data: questions, error: questionsError } = await this.supabase
      .from('section_exercise_questions')
      .insert(questionsData)
      .select();

    if (questionsError) {
      // Cleanup exercise if questions failed
      await this.supabase
        .from('section_exercises')
        .delete()
        .eq('id', exercise.id);
      throw new InternalServerErrorException(
        `Failed to store questions: ${questionsError.message}`,
      );
    }

    // Store answers in section_exercise_answers table
    if (questions) {
      const answersData = questions
        .map((question, index) => {
          const originalQuestion = generatedContent.questions_raw[index];
          const answer = generatedContent.answers_sql_map[originalQuestion.id];
          if (answer) {
            return {
              question_id: question.id,
              answer_text: answer,
              is_case_sensitive: false,
            };
          }
          return null;
        })
        .filter(Boolean);

      if (answersData.length > 0) {
        const { error: answersError } = await this.supabase
          .from('section_exercise_answers')
          .insert(answersData);

        if (answersError) {
          console.error('Failed to store answers:', answersError);
          // Don't throw here as questions are already created
        }
      }
    }

    // Store dataset information if available
    const rawCreationSql =
      typeof generatedContent.data_creation_sql === 'string'
        ? generatedContent.data_creation_sql
        : '';
    const rawCreationPython =
      typeof generatedContent.data_creation_python === 'string'
        ? generatedContent.data_creation_python
        : '';
    const normalizedDatasetRows = this.normalizeArray<Record<string, any>>(
      generatedContent.dataset_rows,
    );
    const normalizedDatasetColumns = this.normalizeArray<string>(
      generatedContent.dataset_columns,
    );
    const normalizedExpectedColumnsList = Array.isArray(
      generatedContent.expected_cols_list,
    )
      ? generatedContent.expected_cols_list.map((cols) =>
          this.normalizeArray<string>(cols),
        )
      : [];
    const hasCreationSql = rawCreationSql.trim().length > 0;
    const hasCreationPython = rawCreationPython.trim().length > 0;
    const hasStructuredRows = normalizedDatasetRows.length > 0;

    let datasetCsvRaw =
      typeof generatedContent.dataset_csv_raw === 'string'
        ? generatedContent.dataset_csv_raw
        : null;

    const sanitizedExistingCsv = datasetCsvRaw
      ? (this.sanitizeCsvSource(datasetCsvRaw) ?? datasetCsvRaw)
      : null;
    const sanitizedCreationCsv = this.sanitizeCsvSource(rawCreationSql);

    if (sanitizedExistingCsv) {
      datasetCsvRaw = sanitizedExistingCsv;
    } else if (sanitizedCreationCsv) {
      datasetCsvRaw = sanitizedCreationCsv;
    }

    const csvRecords =
      datasetCsvRaw && datasetCsvRaw.trim().length > 0
        ? this.parseSanitizedCsv(datasetCsvRaw)
        : [];

    const csvColumns = csvRecords.length > 0 ? Object.keys(csvRecords[0]) : [];

    const hasDatasetCsv =
      typeof datasetCsvRaw === 'string' && datasetCsvRaw.trim().length > 0;

    console.log('=== DATASET INSERTION DEBUG ===');
    console.log('Exercise Type:', input.exerciseType);
    console.log('Has Creation SQL:', hasCreationSql);
    console.log('Has Creation Python:', hasCreationPython);
    console.log(
      'Has Structured Rows:',
      hasStructuredRows,
      'Count:',
      normalizedDatasetRows.length,
    );
    console.log('Has Dataset CSV:', hasDatasetCsv);
    console.log('Questions count:', questions?.length);
    console.log('Dataset Columns:', normalizedDatasetColumns);
    console.log('Dataset Table Name:', generatedContent.dataset_table_name);

    if (
      questions &&
      (hasCreationSql ||
        hasCreationPython ||
        hasStructuredRows ||
        hasDatasetCsv)
    ) {
      const subjectType = (input.exerciseType || 'sql').toLowerCase();
      const isPythonLike =
        subjectType === 'python' || subjectType === 'statistics';
      const structuredColumns = normalizedDatasetColumns;
      const structuredTableName =
        typeof generatedContent.dataset_table_name === 'string'
          ? generatedContent.dataset_table_name
          : null;
      const creationScript = hasCreationSql
        ? rawCreationSql
        : hasCreationPython
          ? rawCreationPython
          : null;

      const datasetData = questions
        .map((question, index) => {
          const originalQuestion = generatedContent.questions_raw[index];
          console.log(`Processing question ${index}:`, {
            hasOriginalQuestion: !!originalQuestion,
            creationScript: !!creationScript,
            hasStructuredRows,
            hasDatasetCsv,
            questionId: question.id,
          });

          if (
            originalQuestion &&
            (creationScript || hasStructuredRows || hasDatasetCsv)
          ) {
            const baseColumns = normalizedExpectedColumnsList[index] || [];

            let effectiveColumns = baseColumns;

            if (isPythonLike && structuredColumns.length > 0) {
              effectiveColumns = structuredColumns;
            } else if (csvColumns.length > 0) {
              effectiveColumns = csvColumns;
            } else if (structuredColumns.length > 0) {
              effectiveColumns = structuredColumns;
            }

            const fileExtension = isPythonLike ? 'py' : 'sql';
            const datasetLabel =
              `Dataset for ${originalQuestion.business_question?.substring(0, 50) || 'Question'}`;
            const datasetTableName = sanitizeTableName(
              structuredTableName || datasetLabel,
              `dataset_${index + 1}`,
            );
            const datasetRowsPayload =
              normalizedDatasetRows.length > 0
                ? normalizedDatasetRows
                : csvRecords;
            const hasDatasetRows = datasetRowsPayload.length > 0;
            const csvPreview = csvRecords.length > 0 ? csvRecords : null;

            const datasetRecord = {
              question_id: question.id,
              name: datasetLabel,
              description:
                generatedContent.dataset_description ||
                'Generated dataset for practice question',
              subject_type: (input.exerciseType || 'sql').toLowerCase(),
              file_path: `datasets/generated/${question.id}.${fileExtension}`,
              file_url: null, // Will be populated when dataset is actually created
              public: false,
              table_name: datasetTableName,
              data: hasDatasetRows ? datasetRowsPayload : null,
              data_preview:
                csvPreview ||
                (hasDatasetRows && datasetRowsPayload.length > 0
                  ? datasetRowsPayload.slice(0, 5)
                  : null),
              record_count: hasDatasetRows ? datasetRowsPayload.length : null,
              schema_info: {
                creation_sql:
                  subjectType === 'google_sheets' && datasetCsvRaw
                    ? datasetCsvRaw
                    : generatedContent.data_creation_sql,
                creation_python: generatedContent.data_creation_python,
                dataset_csv_raw: datasetCsvRaw || undefined,
                expected_columns: baseColumns,
                dataset_columns:
                  csvColumns.length > 0 ? csvColumns : effectiveColumns,
                dataset_rows: hasDatasetRows ? datasetRowsPayload : undefined,
                dataset_description: generatedContent.dataset_description,
              },
              columns: effectiveColumns,
              creation_sql:
                subjectType === 'google_sheets' && datasetCsvRaw
                  ? datasetCsvRaw
                  : creationScript,
              creation_python: generatedContent.data_creation_python || null,
            };

            // console.log(`Created dataset record for question ${index}:`, {
            //   question_id: datasetRecord.question_id,
            //   subject_type: datasetRecord.subject_type,
            //   table_name: datasetRecord.table_name,
            //   has_data: !!datasetRecord.data,
            //   data_count: datasetRecord.data?.length,
            //   columns_count: datasetRecord.columns?.length
            // });

            return datasetRecord;
          }
          console.log(`Skipping question ${index} - condition not met`);
          return null;
        })
        .filter(Boolean);

      // console.log('Dataset data array length:', datasetData.length);
      // console.log('Dataset data to insert:', JSON.stringify(datasetData, null, 2));

      if (datasetData.length > 0) {
        console.log(
          'Attempting to insert datasets into practice_datasets table...',
        );
        const { error: datasetError } = await this.supabase
          .from('practice_datasets')
          .insert(datasetData);

        if (datasetError) {
          console.error('Failed to store dataset information:', datasetError);
          console.error(
            'Dataset error details:',
            JSON.stringify(datasetError, null, 2),
          );
          // Don't throw here as questions are already created
        } else {
          console.log('Successfully inserted datasets!');
        }
      } else {
        console.log('No dataset data to insert - datasetData array is empty');
      }
    } else {
      console.log('Skipping dataset insertion - condition not met:', {
        hasQuestions: !!questions,
        hasCreationSql,
        hasCreationPython,
        hasStructuredRows,
        hasDatasetCsv,
      });
    }

    const hydratedQuestions = this.enrichQuestionsWithExpectedOutputs(
      questions,
      generatedContent.questions_raw,
    );

    // Also create a section exercise if it doesn't exist
    await this.createSectionExerciseIfNotExists(
      input.sectionId,
      exercise.id,
      input,
    );

    return {
      exercise,
      questions: hydratedQuestions ?? questions,
      context: generatedContent,
    };
  }

  private async createSectionExerciseIfNotExists(
    sectionId: string,
    practiceExerciseId: string,
    input: SectionBasedExerciseGenerationInput,
  ) {
    // Check if section exercise already exists for this type
    const { data: existingExercise } = await this.supabase
      .from('section_exercises')
      .select('id')
      .eq('section_id', sectionId)
      .eq('type', 'practice')
      .eq('practice_type', input.exerciseType || 'sql')
      .single();

    if (!existingExercise) {
      // Create a section exercise record
      const { error } = await this.supabase.from('section_exercises').insert({
        section_id: sectionId,
        title: `${input.sectionTitle} Practice`,
        description: `Interactive practice exercises for ${input.sectionTitle}`,
        type: 'practice',
        practice_type: input.exerciseType || 'sql',
        difficulty: input.difficulty?.toLowerCase() || 'intermediate',
        status: 'published',
        order_index: 0,
        content: JSON.stringify({ practiceExerciseId }),
      });

      if (error) {
        console.error('Failed to create section exercise:', error);
      }
    }
  }

  private enrichQuestionsWithExpectedOutputs(
    questionRecords: any[] | null | undefined,
    generatedQuestions: PracticeExerciseGenerationResponse['questions_raw'],
  ) {
    if (!Array.isArray(questionRecords) || questionRecords.length === 0) {
      return questionRecords ?? null;
    }

    const sourceQuestionMap = new Map<
      string,
      PracticeExerciseGenerationResponse['questions_raw'][number]
    >();
    generatedQuestions.forEach((rawQuestion, index) => {
      const key =
        rawQuestion?.id !== undefined && rawQuestion?.id !== null
          ? String(rawQuestion.id)
          : `index-${index}`;
      sourceQuestionMap.set(key, rawQuestion);
    });

    return questionRecords.map((question) => {
      const normalizedContent =
        this.normalizeObject<Record<string, any>>(question?.content) ??
        undefined;
      const originalIdValue =
        normalizedContent && normalizedContent.original_id !== undefined
          ? normalizedContent.original_id
          : undefined;
      const originalId =
        typeof originalIdValue === 'number' ||
        typeof originalIdValue === 'string'
          ? String(originalIdValue)
          : null;
      const fallbackKey =
        question?.order_index !== undefined && question?.order_index !== null
          ? `index-${question.order_index}`
          : null;
      const sourceQuestion =
        (originalId && sourceQuestionMap.get(originalId)) ||
        (fallbackKey && sourceQuestionMap.get(fallbackKey)) ||
        null;

      const expectedOutputTable = this.selectExpectedOutputTable(
        question?.expected_output_table,
        normalizedContent?.expected_output_table,
        sourceQuestion?.expected_output_table,
      );

      const mergedContent =
        normalizedContent ??
        (question?.content &&
        typeof question.content === 'object' &&
        !Array.isArray(question.content)
          ? (question.content as Record<string, any>)
          : undefined);

      const contentWithExpected =
        mergedContent && typeof mergedContent === 'object'
          ? {
              ...mergedContent,
              expected_output_table:
                expectedOutputTable ??
                (Array.isArray(mergedContent.expected_output_table)
                  ? this.normalizeStringArray(
                      mergedContent.expected_output_table,
                    )
                  : null),
            }
          : undefined;

      const fallbackContent =
        contentWithExpected ??
        normalizedContent ??
        (typeof question?.content === 'string' ||
        Array.isArray(question?.content)
          ? question.content
          : (question?.content ?? null));

      return {
        ...question,
        content: fallbackContent,
        expected_output_table: expectedOutputTable ?? null,
      };
    });
  }

  private selectExpectedOutputTable(
    ...candidates: Array<unknown>
  ): string[] | null {
    for (const candidate of candidates) {
      const normalized = this.normalizeStringArray(candidate);
      if (normalized.length > 0) {
        return normalized;
      }
    }
    return null;
  }

  private normalizeStringArray(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry.trim();
          }
          if (entry === null || entry === undefined) {
            return '';
          }
          return `${entry}`.trim();
        })
        .filter((entry) => entry.length > 0);
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }

      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            return parsed
              .map((entry) => {
                if (typeof entry === 'string') {
                  return entry.trim();
                }
                if (entry === null || entry === undefined) {
                  return '';
                }
                return `${entry}`.trim();
              })
              .filter((entry) => entry.length > 0);
          }
        } catch (error) {
          // Fall through to comma split handling
        }
      }

      return trimmed
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }

    return [];
  }

  private mapDifficultyToLevel(
    difficulty: 'Beginner' | 'Intermediate' | 'Advanced',
  ): string {
    const mapping = {
      Beginner: 'beginner',
      Intermediate: 'intermediate',
      Advanced: 'advanced',
    };
    return mapping[difficulty] || 'intermediate';
  }

  private mapDifficultyToDbFormat(
    difficulty: 'Beginner' | 'Intermediate' | 'Advanced',
  ): string {
    const mapping = {
      Beginner: 'easy',
      Intermediate: 'medium',
      Advanced: 'hard',
    };
    return mapping[difficulty] || 'medium';
  }

  async getSectionExercises(
    sectionId: string,
    exerciseType?: string,
    userId?: string,
  ) {
    let query = this.supabase
      .from('section_exercises')
      .select(
        `
        id,
        title,
        description,
        content,
        type,
        practice_type,
        difficulty,
        data,
        status,
        order_index,
        user_id,
        section_exercise_questions (
          id,
          type,
          text,
          hint,
          explanation,
          points,
          order_index,
          content,
          expected_output_table,
          language,
          practice_datasets (
            id,
            question_id,
            schema_info,
            creation_sql,
            creation_python
          ),
          section_exercise_options (
            id,
            text,
            correct,
            order_index
          ),
          section_exercise_answers (
            id,
            answer_text,
            is_case_sensitive
          )
        )
      `,
      )
      .eq('section_id', sectionId)
      .order('order_index', { ascending: true });

    if (exerciseType) {
      query = query.eq('practice_type', exerciseType);
    }

    if (userId) {
      query = query.or(`user_id.eq.${userId},user_id.is.null`);
    } else {
      query = query.is('user_id', null);
    }

    const { data, error } = await query;

    if (error) {
      throw new InternalServerErrorException(
        `Failed to get section exercises: ${error.message}`,
      );
    }

    if (!data || data.length === 0) {
      return [];
    }

    const isUserScoped = typeof userId === 'string' && userId.trim().length > 0;

    const filteredExercises = data.filter((exercise: any) =>
      isUserScoped
        ? exercise.user_id === userId || exercise.user_id === null
        : exercise.user_id === null,
    );

    if (!isUserScoped) {
      return filteredExercises;
    }

    const questionIds = filteredExercises.flatMap((exercise: any) =>
      Array.isArray(exercise.section_exercise_questions)
        ? exercise.section_exercise_questions
            .map((question: any) =>
              question?.id !== undefined && question?.id !== null
                ? String(question.id)
                : null,
            )
            .filter((value: string | null): value is string => Boolean(value))
        : [],
    );

    const uniqueQuestionIds = Array.from(new Set(questionIds));

    if (uniqueQuestionIds.length === 0) {
      return filteredExercises;
    }

    const submissionsByQuestion = new Map<string, any>();
    const hintsByQuestion = new Map<string, any>();

    const { data: submissionData, error: submissionError } = await this.supabase
      .from('section_exercise_question_submissions')
      .select(
        'question_id, exercise_id, user_answer, is_correct, score, feedback, submitted_at, attempt_number, execution_result',
      )
      .in('question_id', uniqueQuestionIds)
      .eq('student_id', userId)
      .order('submitted_at', { ascending: false });

    if (submissionError) {
      console.error(
        'Error fetching submissions for section exercises:',
        submissionError,
      );
    } else if (submissionData) {
      for (const submission of submissionData) {
        const key =
          submission?.question_id !== undefined &&
          submission?.question_id !== null
            ? String(submission.question_id)
            : null;
        if (!key || submissionsByQuestion.has(key)) {
          continue;
        }
        submissionsByQuestion.set(key, submission);
      }
    }

    if (!this.hintStorageUnavailable) {
      const { data: hintData, error: hintError } = await this.supabase
        .from('section_exercise_question_hints')
        .select(
          'question_id, exercise_id, verdict, message, user_answer, dataset_context, raw_response, created_at',
        )
        .in('question_id', uniqueQuestionIds)
        .eq('student_id', userId)
        .order('created_at', { ascending: false });

      if (hintError) {
        if (hintError.code === '42P01') {
          this.hintStorageUnavailable = true;
          console.warn(
            'Hint storage table section_exercise_question_hints is not available. Skipping hint hydration.',
          );
        } else {
          console.warn(
            'Error fetching hint history for section exercises:',
            hintError,
          );
        }
      } else if (hintData) {
        for (const hint of hintData) {
          const key =
            hint?.question_id !== undefined && hint?.question_id !== null
              ? String(hint.question_id)
              : null;
          if (!key || hintsByQuestion.has(key)) {
            continue;
          }
          hintsByQuestion.set(key, hint);
        }
      }
    }

    return filteredExercises.map((exercise: any) => {
      const normalizedQuestions = Array.isArray(
        exercise.section_exercise_questions,
      )
        ? exercise.section_exercise_questions.map((question: any) => {
            if (question?.id === undefined || question?.id === null) {
              return question;
            }

            const questionKey = String(question.id);
            const submissionRecord = submissionsByQuestion.get(questionKey);
            const hintRecord = hintsByQuestion.get(questionKey);

            let latestSubmission: QuestionSubmissionSummary | null =
              question.latestSubmission ?? null;
            if (submissionRecord) {
              const executionRecord = this.normalizeExecutionResult(
                submissionRecord.execution_result,
              );
              const executionObject =
                executionRecord && typeof executionRecord === 'object'
                  ? executionRecord
                  : null;
              const evaluationValue =
                executionObject && executionObject['aiEvaluation'];
              const evaluation =
                evaluationValue && typeof evaluationValue === 'object'
                  ? (evaluationValue as SubmissionEvaluationResult)
                  : null;
              const evaluationFeedback = evaluation?.feedback ?? null;
              const evaluationVerdict = evaluation?.verdict ?? null;
              const rawVerdict = executionObject && executionObject['verdict'];
              const storedVerdict =
                typeof rawVerdict === 'string' ? rawVerdict : null;

              const normalizedVerdict =
                evaluationVerdict ||
                storedVerdict ||
                (submissionRecord.is_correct ? 'Correct' : 'Incorrect');

              latestSubmission = {
                userAnswer: submissionRecord.user_answer ?? '',
                isCorrect: submissionRecord.is_correct ?? false,
                score:
                  typeof submissionRecord.score === 'number'
                    ? submissionRecord.score
                    : 0,
                feedback:
                  (typeof submissionRecord.feedback === 'string' &&
                  submissionRecord.feedback.trim().length > 0
                    ? submissionRecord.feedback
                    : evaluationFeedback) ?? null,
                verdict: normalizedVerdict,
                evaluation: evaluation ?? null,
                submittedAt: submissionRecord.submitted_at,
                attemptNumber: submissionRecord.attempt_number,
              };
            }

            let latestHint = question.latestHint ?? null;
            if (hintRecord) {
              latestHint = {
                verdict: hintRecord.verdict,
                message: hintRecord.message,
                userAnswer: hintRecord.user_answer,
                datasetContext: hintRecord.dataset_context,
                requestedAt: hintRecord.created_at,
                rawResponse: hintRecord.raw_response,
              };
            }

            const normalizedContent =
              this.normalizeObject<Record<string, any>>(question?.content) ??
              undefined;
            const expectedOutputTable = this.selectExpectedOutputTable(
              question?.expected_output_table,
              normalizedContent?.expected_output_table,
            );
            const resolvedContent =
              normalizedContent && typeof normalizedContent === 'object'
                ? {
                    ...normalizedContent,
                    expected_output_table:
                      expectedOutputTable ??
                      normalizedContent.expected_output_table ??
                      null,
                  }
                : question?.content;

            return {
              ...question,
              content: resolvedContent,
              expected_output_table: expectedOutputTable ?? null,
              latestSubmission,
              latestHint,
            };
          })
        : exercise.section_exercise_questions;

      return {
        ...exercise,
        section_exercise_questions: normalizedQuestions,
      };
    });
  }

  async getUserSectionExercises(sectionId: string, userId: string) {
    const { data, error } = await this.supabase
      .from('section_exercises')
      .select(
        `
        id,
        title,
        description,
        content,
        type,
        practice_type,
        difficulty,
        data,
        status,
        created_at,
        section_exercise_questions (
          id,
          type,
          text,
          hint,
          explanation,
          points,
          order_index,
          content,
          expected_output_table,
          language
        )
      `,
      )
      .eq('section_id', sectionId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to get user exercises: ${error.message}`,
      );
    }

    return data;
  }

  async getExerciseProgress(exerciseId: string, userId: string) {
    // Get exercise with questions
    const { data: exercise, error: exerciseError } = await this.supabase
      .from('section_exercises')
      .select(
        `
        id,
        title,
        description,
        content,
        type,
        practice_type,
        difficulty,
        data,
        section_exercise_questions (
          id,
          type,
          text,
          hint,
          explanation,
          points,
          order_index,
          content,
          expected_output_table,
          language,
          section_exercise_answers (
            id,
            answer_text,
            is_case_sensitive
          )
        )
      `,
      )
      .eq('id', exerciseId)
      .single();

    if (exerciseError) {
      throw new InternalServerErrorException(
        `Failed to get exercise: ${exerciseError.message}`,
      );
    }

    // Get user's question submissions
    const { data: submissions, error: submissionsError } = await this.supabase
      .from('section_exercise_question_submissions')
      .select('*')
      .eq('exercise_id', exerciseId)
      .eq('student_id', userId)
      .order('submitted_at', { ascending: false });

    if (submissionsError) {
      console.error('Error fetching submissions:', submissionsError);
    }

    // Get overall progress
    const { data: progress, error: progressError } = await this.supabase
      .from('section_exercise_progress')
      .select('*')
      .eq('exercise_id', exerciseId)
      .eq('student_id', userId)
      .single();

    if (progressError && progressError.code !== 'PGRST116') {
      console.error('Error fetching progress:', progressError);
    }

    const hintsByQuestion = new Map<string, any>();
    if (!this.hintStorageUnavailable) {
      const { data: hintData, error: hintError } = await this.supabase
        .from('section_exercise_question_hints')
        .select(
          'question_id, verdict, message, user_answer, dataset_context, raw_response, created_at',
        )
        .eq('exercise_id', exerciseId)
        .eq('student_id', userId)
        .order('created_at', { ascending: false });

      if (hintError) {
        if (hintError.code === '42P01') {
          this.hintStorageUnavailable = true;
          console.warn(
            'Hint storage table section_exercise_question_hints is not available. Skipping hint hydration.',
          );
        } else {
          console.warn('Error fetching hint history for exercise:', hintError);
        }
      } else if (hintData) {
        for (const hint of hintData) {
          const key =
            hint?.question_id !== undefined && hint?.question_id !== null
              ? String(hint.question_id)
              : null;
          if (!key || hintsByQuestion.has(key)) {
            continue;
          }
          hintsByQuestion.set(key, hint);
        }
      }
    }

    // Map submissions to questions
    const questionsWithProgress = exercise.section_exercise_questions.map(
      (question) => {
        const questionSubmissions = submissions?.filter(
          (s) => s.question_id === question.id,
        );
        const latestSubmissionRecord = questionSubmissions?.[0];
        const questionKey =
          question?.id !== undefined && question?.id !== null
            ? String(question.id)
            : null;

        let latestSubmission: QuestionSubmissionSummary | null = null;
        if (latestSubmissionRecord) {
          const executionRecord = this.normalizeExecutionResult(
            latestSubmissionRecord.execution_result,
          );
          const executionObject =
            executionRecord && typeof executionRecord === 'object'
              ? executionRecord
              : null;
          const evaluationValue =
            executionObject && executionObject['aiEvaluation'];
          const evaluation =
            evaluationValue && typeof evaluationValue === 'object'
              ? (evaluationValue as SubmissionEvaluationResult)
              : null;
          const storedVerdictValue =
            executionObject && executionObject['verdict'];
          const storedVerdict =
            typeof storedVerdictValue === 'string' ? storedVerdictValue : null;
          const normalizedVerdict =
            evaluation?.verdict ||
            storedVerdict ||
            (latestSubmissionRecord.is_correct ? 'Correct' : 'Incorrect');

          latestSubmission = {
            userAnswer: latestSubmissionRecord.user_answer ?? '',
            isCorrect: latestSubmissionRecord.is_correct ?? false,
            score:
              typeof latestSubmissionRecord.score === 'number'
                ? latestSubmissionRecord.score
                : 0,
            feedback:
              (typeof latestSubmissionRecord.feedback === 'string' &&
              latestSubmissionRecord.feedback.trim().length > 0
                ? latestSubmissionRecord.feedback
                : evaluation?.feedback) ?? null,
            verdict: normalizedVerdict,
            evaluation: evaluation ?? null,
            submittedAt: latestSubmissionRecord.submitted_at,
            attemptNumber: latestSubmissionRecord.attempt_number,
          };
        }

        const hintRecord =
          questionKey !== null ? hintsByQuestion.get(questionKey) : null;
        const latestHint = hintRecord
          ? {
              verdict: hintRecord.verdict,
              message: hintRecord.message,
              userAnswer: hintRecord.user_answer,
              datasetContext: hintRecord.dataset_context,
              requestedAt: hintRecord.created_at,
              rawResponse: hintRecord.raw_response,
            }
          : null;

        return {
          ...question,
          isCompleted: latestSubmission?.isCorrect || false,
          latestSubmission,
          latestHint,
          totalAttempts: questionSubmissions?.length || 0,
        };
      },
    );

    return {
      exercise: {
        ...exercise,
        section_exercise_questions: questionsWithProgress,
      },
      progress,
      totalQuestions: exercise.section_exercise_questions.length,
      completedQuestions: questionsWithProgress.filter((q) => q.isCompleted)
        .length,
    };
  }

  async submitQuestionAnswer(
    exerciseId: string,
    questionId: string,
    userId: string,
    userAnswer: string,
    timeSpent?: number,
  ) {
    const sanitizedAnswer = typeof userAnswer === 'string' ? userAnswer : '';

    // Get the correct answer
    const { data: correctAnswer, error: answerError } = await this.supabase
      .from('section_exercise_answers')
      .select('answer_text, is_case_sensitive')
      .eq('question_id', questionId)
      .single();

    if (answerError) {
      throw new InternalServerErrorException(
        `Failed to get correct answer: ${answerError.message}`,
      );
    }

    // Get question details
    const { data: questionData, error: questionError } = await this.supabase
      .from('section_exercise_question')
      .select('points, text, type, language, content, exercise_id')
      .eq('id', questionId)
      .single();

    if (questionError) {
      throw new InternalServerErrorException(
        `Failed to get question: ${questionError.message}`,
      );
    }

    const question = (questionData ??
      null) as SectionExerciseQuestionRecord | null;
    if (!question) {
      throw new InternalServerErrorException(
        `Question with ID ${questionId} not found.`,
      );
    }
    if (!question) {
      throw new InternalServerErrorException(
        `Question with ID ${questionId} not found.`,
      );
    }

    const correctAnswerText =
      typeof correctAnswer?.answer_text === 'string'
        ? correctAnswer.answer_text
        : `${correctAnswer?.answer_text ?? ''}`;
    const isCaseSensitive = !!correctAnswer?.is_case_sensitive;

    const topicMetadata = await this.getQuestionTopicMetadata(
      question?.exercise_id,
    );
    const topics =
      topicMetadata.topicHierarchyValues.length > 0
        ? topicMetadata.topicHierarchyValues
        : this.extractTopicsFromContent(question?.content);
    const futureTopics =
      topicMetadata.futureTopicValues.length > 0
        ? topicMetadata.futureTopicValues
        : this.extractFutureTopicsFromContent(question?.content);
    const topicHierarchy = topics.length > 0 ? topics.join(', ') : undefined;

    let evaluation: SubmissionEvaluationResult | null = null;
    if (question?.text && correctAnswerText) {
      evaluation = await this.callAiEvaluation({
        question: question.text,
        expected_answer: correctAnswerText,
        student_answer: sanitizedAnswer,
        subject: question.language ?? question.type ?? undefined,
        topic_hierarchy: topicHierarchy,
        future_topics: futureTopics.length > 0 ? futureTopics : undefined,
      });
    }

    let comparisonResult: any = null;
    if (question.type === 'sql' && correctAnswerText) {
      comparisonResult = await this.compareSQLResults(
        sanitizedAnswer,
        correctAnswerText,
        questionId,
      );
    }

    let isCorrect = false;
    let verdict = 'Incorrect';
    let feedback = '';

    if (evaluation?.verdict) {
      verdict = evaluation.verdict;
      const normalizedVerdict = evaluation.verdict.toLowerCase();
      isCorrect = normalizedVerdict === 'correct';
      feedback = evaluation.feedback?.trim() || '';
    }

    if (!evaluation) {
      if (comparisonResult) {
        isCorrect = comparisonResult.isCorrect;
        verdict = isCorrect ? 'Correct' : 'Incorrect';
        feedback = comparisonResult.feedback;
      } else {
        if (isCaseSensitive) {
          isCorrect = sanitizedAnswer.trim() === correctAnswerText.trim();
        } else {
          isCorrect =
            sanitizedAnswer.trim().toLowerCase() ===
            correctAnswerText.trim().toLowerCase();
        }
        verdict = isCorrect ? 'Correct' : 'Incorrect';
        feedback = isCorrect
          ? 'Correct answer!'
          : 'Incorrect answer. Please try again.';
      }
    } else if (!feedback) {
      feedback =
        comparisonResult?.feedback ||
        (isCorrect
          ? 'Great job! Your answer looks correct.'
          : 'Thanks for submitting. Review the feedback and try again.');
    }

    const executionDetails: Record<string, unknown> = {};
    if (evaluation) {
      executionDetails.aiEvaluation = evaluation;
    }
    if (comparisonResult) {
      executionDetails.comparison = comparisonResult;
    }
    executionDetails.verdict = verdict;
    executionDetails.userAnswer = sanitizedAnswer;

    const executionResult =
      Object.keys(executionDetails).length > 0 ? executionDetails : null;

    // Get previous attempt count
    const { data: previousSubmissions } = await this.supabase
      .from('section_exercise_question_submissions')
      .select('attempt_number')
      .eq('question_id', questionId)
      .eq('student_id', userId)
      .order('attempt_number', { ascending: false })
      .limit(1);

    const attemptNumber =
      previousSubmissions && previousSubmissions.length > 0
        ? previousSubmissions[0].attempt_number + 1
        : 1;

    // Store submission
    const { data: submission, error: submissionError } = await this.supabase
      .from('section_exercise_question_submissions')
      .insert({
        student_id: userId,
        exercise_id: exerciseId,
        question_id: questionId,
        user_answer: sanitizedAnswer,
        is_correct: isCorrect,
        score: isCorrect
          ? typeof question.points === 'number'
            ? question.points
            : typeof question.points === 'string'
              ? Number(question.points) || 0
              : 0
          : 0,
        feedback,
        execution_result: executionResult,
        attempt_number: attemptNumber,
        time_spent_seconds: timeSpent || 0,
        graded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (submissionError) {
      throw new InternalServerErrorException(
        `Failed to store submission: ${submissionError.message}`,
      );
    }

    // Update overall exercise progress
    await this.updateExerciseProgress(exerciseId, userId);

    return {
      submission,
      isCorrect,
      verdict,
      feedback,
      correctAnswer: isCorrect ? null : correctAnswerText,
      evaluation,
      executionResult,
    };
  }

  async submitInterviewQuestionAnswer(
    exerciseId: string,
    questionId: string,
    userId: string,
    userAnswer: string,
    timeSpent?: number,
  ) {
    if (!userId) {
      throw new BadRequestException(
        'User authentication required for interview question submission.',
      );
    }

    const sanitizedAnswer = typeof userAnswer === 'string' ? userAnswer : '';

    const { data: correctAnswer, error: answerError } = await this.supabase
      .from('interview_practice_answers')
      .select('answer_text, is_case_sensitive')
      .eq('question_id', questionId)
      .single();

    if (answerError || !correctAnswer?.answer_text) {
      throw new InternalServerErrorException(
        `Failed to get correct answer: ${answerError?.message ?? 'not configured'}`,
      );
    }

    const correctAnswerText =
      typeof correctAnswer.answer_text === 'string'
        ? correctAnswer.answer_text
        : `${correctAnswer.answer_text ?? ''}`;
    const isCaseSensitive = !!correctAnswer.is_case_sensitive;

    const { data: questionData, error: questionError } = await this.supabase
      .from('interview_practice_questions')
      .select('exercise_id, text, type, language, content')
      .eq('id', questionId)
      .single();

    if (questionError) {
      throw new InternalServerErrorException(
        `Failed to get question: ${questionError.message}`,
      );
    }

    const question = (questionData ?? null) as SectionExerciseQuestionRecord | null;
    if (!question) {
      throw new InternalServerErrorException(
        `Question with ID ${questionId} not found.`,
      );
    }

    const topics = this.extractTopicsFromContent(question?.content);
    const futureTopics = this.extractFutureTopicsFromContent(question?.content);
    const topicHierarchy = topics.length > 0 ? topics.join(', ') : undefined;

    let evaluation: SubmissionEvaluationResult | null = null;
    if (question?.text && correctAnswerText) {
      evaluation = await this.callAiEvaluation({
        question: question.text,
        expected_answer: correctAnswerText,
        student_answer: sanitizedAnswer,
        subject: question.language ?? question.type ?? undefined,
        topic_hierarchy: topicHierarchy,
        future_topics: futureTopics.length > 0 ? futureTopics : undefined,
      });
    }

    let comparisonResult: any = null;
    if (question?.type === 'sql' && correctAnswerText) {
      comparisonResult = await this.compareSQLResults(
        sanitizedAnswer,
        correctAnswerText,
        questionId,
      );
    }

    let isCorrect = false;
    let verdict = 'Incorrect';
    let feedback = '';

    if (evaluation?.verdict) {
      const normalizedVerdict = evaluation.verdict.toLowerCase();
      verdict = evaluation.verdict;
      isCorrect = normalizedVerdict === 'correct';
      feedback = evaluation.feedback?.trim() || '';
    }

    if (!evaluation) {
      if (comparisonResult) {
        isCorrect = comparisonResult.isCorrect;
        verdict = isCorrect ? 'Correct' : 'Incorrect';
        feedback = comparisonResult.feedback;
      } else {
        if (isCaseSensitive) {
          isCorrect = sanitizedAnswer.trim() === correctAnswerText.trim();
        } else {
          isCorrect =
            sanitizedAnswer.trim().toLowerCase() ===
            correctAnswerText.trim().toLowerCase();
        }
        verdict = isCorrect ? 'Correct' : 'Incorrect';
        feedback = isCorrect
          ? 'Correct answer!'
          : 'Incorrect answer. Please try again.';
      }
    } else if (!feedback) {
      feedback =
        comparisonResult?.feedback ||
        (isCorrect
          ? 'Great job! Your answer looks correct.'
          : 'Thanks for submitting. Review the feedback and try again.');
    }

    const executionDetails: Record<string, unknown> = {};
    if (evaluation) {
      executionDetails.aiEvaluation = evaluation;
    }
    if (comparisonResult) {
      executionDetails.comparison = comparisonResult;
    }
    executionDetails.verdict = verdict;
    executionDetails.userAnswer = sanitizedAnswer;
    executionDetails.feedback = feedback;
    executionDetails.topicHierarchy = topicHierarchy;

    const executionResult =
      Object.keys(executionDetails).length > 0 ? executionDetails : null;

    const { data: previousInterviewSubmissions } = await this.supabase
      .from('interview_exercise_question_submissions')
      .select('attempt_number')
      .eq('question_id', questionId)
      .eq('student_id', userId)
      .order('attempt_number', { ascending: false })
      .limit(1);

    const attemptNumber =
      previousInterviewSubmissions && previousInterviewSubmissions.length > 0
        ? previousInterviewSubmissions[0].attempt_number + 1
        : 1;

    const submissionId = uuidv4();
    const { error: submissionError } = await this.supabase
      .from('interview_exercise_question_submissions')
      .insert({
        id: submissionId,
        student_id: userId,
        exercise_id: exerciseId,
        question_id: questionId,
        user_answer: sanitizedAnswer,
        is_correct: isCorrect,
        score: isCorrect ? 1 : 0,
        feedback,
        execution_result: executionResult,
        attempt_number: attemptNumber,
        time_spent_seconds: timeSpent || 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (submissionError) {
      throw new InternalServerErrorException(
        `Failed to store submission: ${submissionError.message}`,
      );
    }

    return {
      submissionId,
      isCorrect,
      verdict,
      feedback,
      correctAnswer: isCorrect ? null : correctAnswerText,
      evaluation,
      executionResult,
    };
  }

  async generateHintForQuestion(
    exerciseId: string,
    questionId: string,
    userId: string,
    userAnswer: string,
  ) {
    const sanitizedAnswer = typeof userAnswer === 'string' ? userAnswer : '';

    if (!sanitizedAnswer.trim()) {
      return {
        verdict: 'Incorrect',
        message:
          'Share what you have tried so far, and I can point you in the right direction.',
      };
    }

    const { data: correctAnswer, error: answerError } = await this.supabase
      .from('interview_practice_answers')
      .select('answer_text')
      .eq('question_id', questionId)
      .single();

    if (answerError || !correctAnswer?.answer_text) {
      throw new InternalServerErrorException(
        `Failed to get correct answer: ${answerError?.message ?? 'not configured'}`,
      );
    }

    const correctAnswerText =
      typeof correctAnswer.answer_text === 'string'
        ? correctAnswer.answer_text
        : `${correctAnswer.answer_text}`;

    const { data: questionData, error: questionError } = await this.supabase
      .from('interview_practice_questions')
      .select('text, type, language, content, exercise_id')
      .eq('id', questionId)
      .single();

    if (questionError) {
      throw new InternalServerErrorException(
        `Failed to get question: ${questionError.message}`,
      );
    }

    const question = (questionData ??
      null) as SectionExerciseQuestionRecord | null;

    let datasetContext = 'N/A';
    try {
      const { data: datasetRecords, error: datasetError } = await this.supabase
        .from('interview_practice_datasets')
        .select(
          'table_name,description,columns,schema_info,creation_sql,creation_python',
        )
        .eq('question_id', questionId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (datasetError) {
        console.warn('Failed to fetch dataset context for hint:', datasetError);
      } else if (datasetRecords && datasetRecords.length > 0) {
        datasetContext = this.formatDatasetContextForHint(datasetRecords[0]);
      }
    } catch (error) {
      console.warn(
        'Unexpected error while preparing dataset context for hint:',
        error,
      );
    }

    const topicMetadata = await this.getQuestionTopicMetadata(
      question?.exercise_id,
    );
    const topics =
      topicMetadata.topicHierarchyValues.length > 0
        ? topicMetadata.topicHierarchyValues
        : this.extractTopicsFromContent(question?.content);
    const futureTopics =
      topicMetadata.futureTopicValues.length > 0
        ? topicMetadata.futureTopicValues
        : this.extractFutureTopicsFromContent(question?.content);
    const topicHierarchy = topics.length > 0 ? topics.join(', ') : undefined;

    const hint = await this.callAiHint({
      question: question?.text || '',
      expected_answer: correctAnswerText,
      student_answer: sanitizedAnswer,
      subject: question?.language ?? question?.type ?? undefined,
      topic_hierarchy: topicHierarchy,
      future_topics: futureTopics.length > 0 ? futureTopics : undefined,
      current_code: sanitizedAnswer,
      dataset_context: datasetContext,
    });

    if (!hint) {
      return {
        verdict: 'Incorrect',
        message:
          'I could not generate a hint right now. Please try again in a moment.',
      };
    }

    await this.storeHintRecord({
      exerciseId,
      questionId,
      userId,
      userAnswer: sanitizedAnswer,
      hint,
      datasetContext,
    });

    await this.storeInterviewHintRecord({
      questionId,
      userAnswer: sanitizedAnswer,
      hint,
      datasetContext,
    });

    return {
      verdict: hint.verdict,
      message: hint.message,
      raw_response: hint.raw_response ?? null,
    };
  }

  private async compareSQLResults(
    userSQL: string,
    correctSQL: string,
    questionId: string,
  ) {
    try {
      // Note: This is a placeholder for actual SQL execution
      // In production, you would execute both queries in a sandboxed DuckDB environment
      // and compare the results

      // For now, we'll do a simple normalized comparison
      const normalizedUserSQL = this.normalizeSQL(userSQL);
      const normalizedCorrectSQL = this.normalizeSQL(correctSQL);

      const isCorrect = normalizedUserSQL === normalizedCorrectSQL;

      return {
        isCorrect,
        feedback: isCorrect
          ? 'Correct! Your query produces the expected results.'
          : 'Your query does not produce the expected results. Please review and try again.',
        executionResult: {
          userSQL,
          correctSQL,
          message: isCorrect
            ? 'Query executed successfully'
            : 'Query results do not match expected output',
        },
      };
    } catch (error) {
      return {
        isCorrect: false,
        feedback: `Error executing SQL: ${error.message}`,
        executionResult: {
          error: error.message,
        },
      };
    }
  }

  private formatDatasetContextForHint(
    dataset: Record<string, any> | null | undefined,
  ): string {
    if (!dataset || typeof dataset !== 'object') {
      return 'N/A';
    }

    const sections: string[] = [];

    const tableName =
      (typeof dataset.table_name === 'string' && dataset.table_name.trim()) ||
      (typeof dataset.name === 'string' && dataset.name.trim()) ||
      null;
    if (tableName) {
      sections.push(`Table: ${tableName}`);
    }

    if (typeof dataset.dataset_description === 'string') {
      const description = dataset.dataset_description.trim();
      if (description) {
        sections.push(`Description: ${description}`);
      }
    }

    const schemaInfo =
      dataset.schema_info && typeof dataset.schema_info === 'object'
        ? (dataset.schema_info as Record<string, any>)
        : null;

    const datasetColumns = Array.isArray(dataset.dataset_columns)
      ? dataset.dataset_columns
      : Array.isArray(schemaInfo?.columns)
        ? schemaInfo?.columns
        : Array.isArray(schemaInfo?.fields)
          ? schemaInfo?.fields
          : null;

    if (datasetColumns && datasetColumns.length > 0) {
      const columnList = datasetColumns
        .map((column: any) => {
          if (typeof column === 'string') {
            return column.trim();
          }
          if (column && typeof column === 'object') {
            const name =
              (typeof column.name === 'string' && column.name.trim()) ||
              (typeof column.column === 'string' && column.column.trim());
            const type =
              (typeof column.type === 'string' && column.type.trim()) || '';
            return name ? (type ? `${name} (${type})` : name) : '';
          }
          return '';
        })
        .filter((value: string) => value.length > 0);

      if (columnList.length > 0) {
        sections.push(`Columns: ${columnList.join(', ')}`);
      }
    }

    const sampleRows = Array.isArray(dataset.dataset_rows)
      ? dataset.dataset_rows
      : Array.isArray(schemaInfo?.sample_rows)
        ? schemaInfo?.sample_rows
        : null;

    if (sampleRows && sampleRows.length > 0) {
      const preview = sampleRows
        .slice(0, 2)
        .map((row: any) => {
          if (!row) {
            return '';
          }
          if (Array.isArray(row)) {
            return row.join(', ');
          }
          if (typeof row === 'object') {
            return Object.entries(row)
              .map(([key, value]) => `${key}: ${value}`)
              .join(', ');
          }
          return `${row}`;
        })
        .filter((value: string) => value.length > 0);

      if (preview.length > 0) {
        sections.push(`Sample Rows:\n- ${preview.join('\n- ')}`);
      }
    }

    if (typeof dataset.creation_sql === 'string') {
      const creationSql = dataset.creation_sql.trim();
      if (creationSql) {
        sections.push(`Creation SQL:\n${creationSql}`);
      }
    }

    if (typeof dataset.creation_python === 'string') {
      const creationPython = dataset.creation_python.trim();
      if (creationPython) {
        sections.push(`Creation Python:\n${creationPython}`);
      }
    }

    return sections.length > 0 ? sections.join('\n\n') : 'N/A';
  }

  private normalizeExecutionResult(
    value: unknown,
  ): Record<string, unknown> | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch (error) {
        console.warn('Failed to parse execution result JSON:', error);
        return null;
      }
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private async storeHintRecord({
    exerciseId,
    questionId,
    userId,
    userAnswer,
    hint,
    datasetContext,
  }: {
    exerciseId: string;
    questionId: string;
    userId: string;
    userAnswer: string;
    hint: SubmissionHintResult;
    datasetContext: string;
  }) {
    if (!userId || this.hintStorageUnavailable) {
      return;
    }

    try {
      const { error } = await this.supabase
        .from('section_exercise_question_hints')
        .insert({
          student_id: userId,
          exercise_id: exerciseId,
          question_id: questionId,
          verdict: hint.verdict,
          message: hint.message,
          user_answer: userAnswer,
          dataset_context: datasetContext,
          raw_response: hint.raw_response ?? null,
          created_at: new Date().toISOString(),
        });

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') {
          this.hintStorageUnavailable = true;
          console.warn(
            'Hint storage table section_exercise_question_hints is not available. Skipping persistence.',
          );
          return;
        }
        console.error('Failed to store hint record:', error);
      }
    } catch (error) {
      console.error('Unexpected error storing hint record:', error);
      this.hintStorageUnavailable = true;
    }
  }

  private async storeInterviewHintRecord({
    questionId,
    userAnswer,
    hint,
    datasetContext,
  }: {
    questionId: string;
    userAnswer: string;
    hint: SubmissionHintResult;
    datasetContext: string;
  }) {
    try {
      const { error } = await this.supabase
        .from('interview_question_hints')
        .insert({
          question_id: questionId,
          verdict: hint.verdict,
          message: hint.message,
          user_answer: userAnswer,
          dataset_context: datasetContext,
          raw_response: hint.raw_response ?? null,
          created_at: new Date().toISOString(),
        });

      if (error) {
        if (error.code === '42P01' || error.code === 'PGRST205') {
          console.warn(
            'Interview hint storage table missing. Skipping interview hint persistence.',
          );
          return;
        }
        console.warn('Failed to store interview hint record:', error);
      }
    } catch (error) {
      console.error('Unexpected error storing interview hint record:', error);
    }
  }

  private normalizeSQL(sql: string): string {
    return sql
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/\s*,\s*/g, ',')
      .replace(/\s*\(\s*/g, '(')
      .replace(/\s*\)\s*/g, ')')
      .toLowerCase();
  }

  private async updateExerciseProgress(exerciseId: string, userId: string) {
    // Get all questions for this exercise
    const { data: questions } = await this.supabase
      .from('section_exercise_questions')
      .select('id, points')
      .eq('exercise_id', exerciseId);

    if (!questions || questions.length === 0) {
      return;
    }

    // Get all correct submissions for this user
    const { data: correctSubmissions } = await this.supabase
      .from('section_exercise_question_submissions')
      .select('question_id, score')
      .eq('exercise_id', exerciseId)
      .eq('student_id', userId);

    const completedQuestions = new Set(
      correctSubmissions?.map((s) => s.question_id) || [],
    );
    const totalScore = correctSubmissions?.reduce(
      (sum, s) => sum + (s.score || 0),
      0,
    );
    const maxScore = questions.reduce((sum, q) => sum + (q.points || 0), 0);
    console.log('exerciseSatisfied', completedQuestions.size, questions.length);
    const status =
      completedQuestions.size === questions.length
        ? 'completed'
        : completedQuestions.size > 0
          ? 'in_progress'
          : 'not_started';

    // Upsert progress
    const { error } = await this.supabase
      .from('section_exercise_progress')
      .upsert(
        {
          student_id: userId,
          exercise_id: exerciseId,
          status,
          score: totalScore,
          completed_at:
            status === 'completed' ? new Date().toISOString() : null,
          last_attempt_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: 'student_id,exercise_id',
        },
      );

    if (error) {
      console.error('Error updating progress:', error);
    }
  }

  private normalizeArray<T>(value: unknown): T[] {
    if (Array.isArray(value)) {
      return value as T[];
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return [];
      }
      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? (parsed as T[]) : [];
      } catch (error) {
        console.warn(
          'Failed to parse array value for dataset normalization:',
          error,
        );
      }
    }
    return [];
  }

  private normalizeObject<T>(value: unknown): T | null {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as T;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) {
        return null;
      }
      try {
        const parsed = JSON.parse(trimmed);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as T)
          : null;
      } catch (error) {
        console.warn(
          'Failed to parse object value for dataset normalization:',
          error,
        );
      }
    }
    return null;
  }

  async getMentorChatSession(
    exerciseId: string,
    questionId: string,
    userId: string,
  ) {
    if (!userId) {
      throw new BadRequestException(
        'User authentication required for mentor chat.',
      );
    }

    const { question, config, session, exercise, section, questionList } =
      await this.ensureMentorChatSession(exerciseId, questionId, userId);

    const normalizedSession = this.normalizeMentorChatRecord(session);

    return {
      question: {
        id: question.id,
        text: this.coalesceStrings(question.text) || '',
      },
      config: {
        context: config.context,
        hypothesis: config.hypothesis,
        guidingQuestion: config.guidingQuestion,
        targetQuestions: config.targetQuestions,
        introMessage: config.introMessage,
      },
      chat: normalizedSession,
      exercise,
      section,
      questions: questionList,
    };
  }

  async sendMentorChatMessage(
    exerciseId: string,
    questionId: string,
    userId: string,
    studentMessage: string,
  ) {
    if (!userId) {
      throw new BadRequestException(
        'User authentication required for mentor chat.',
      );
    }

    const sanitizedMessage =
      typeof studentMessage === 'string' ? studentMessage.trim() : '';

    if (!sanitizedMessage) {
      throw new BadRequestException(
        'Please share your thinking before sending the message.',
      );
    }

    const { question, config, session, exercise, section, questionList } =
      await this.ensureMentorChatSession(exerciseId, questionId, userId);

    const normalizedSession = this.normalizeMentorChatRecord(session);

    const conversationHistory = normalizedSession.messages.map((message) => ({
      role: message.role,
      content: message.content,
      created_at: message.created_at ?? undefined,
    }));

    const studentEntry: MentorChatMessageRecord = {
      role: 'student',
      content: sanitizedMessage,
      created_at: new Date().toISOString(),
    };

    const questionStringsForAi = (questionList ?? [])
      .map((entry, index) => {
        const label =
          entry?.order !== null && entry?.order !== undefined
            ? Number(entry.order) + 1
            : index + 1;
        const text =
          typeof entry?.text === 'string' && entry.text.trim().length > 0
            ? entry.text.trim()
            : null;
        if (!text) {
          return null;
        }
        return `Q${label}: ${text}`;
      })
      .filter((value): value is string => Boolean(value));

    const aiResult = await this.callMentorChat({
      context: config.context || config.guidingQuestion || '',
      hypothesis: config.hypothesis || config.guidingQuestion || '',
      target_questions: config.targetQuestions,
      student_message: sanitizedMessage,
      conversation_history: conversationHistory,
      identified_questions: normalizedSession.identified_questions,
      exercise_title:
        exercise?.title ||
        config.guidingQuestion ||
        question?.text ||
        'Exercise',
      exercise_description:
        exercise?.description || exercise?.content || undefined,
      exercise_questions: questionStringsForAi,
      section_title: section?.title || undefined,
      section_overview: section?.overview || undefined,
      guiding_prompt: config.guidingQuestion || question?.text || undefined,
    });

    const mentorMessage =
      aiResult?.message && aiResult.message.trim().length > 0
        ? aiResult.message.trim()
        : 'That is a helpful direction. What data question could confirm or challenge that idea?';

    const mentorEntry: MentorChatMessageRecord = {
      role: 'mentor',
      content: mentorMessage,
      created_at: new Date().toISOString(),
    };

    const mergedMessages: MentorChatMessageRecord[] = [
      ...conversationHistory,
      studentEntry,
      mentorEntry,
    ];

    const mergedIdentified = this.mergeIdentifiedTargets(
      normalizedSession.identified_questions,
      aiResult?.identified_questions ?? [],
    );

    const isCompleted =
      aiResult?.status === 'completed' ||
      normalizedSession.status === 'completed';

    const finalSummary =
      isCompleted && mentorMessage
        ? mentorMessage
        : normalizedSession.final_summary;

    const completedAt = isCompleted
      ? (normalizedSession.completed_at ?? new Date().toISOString())
      : null;

    const { data: updatedRecord, error: updateError } = await this.supabase
      .from('section_exercise_question_chats')
      .update({
        messages: mergedMessages,
        identified_questions: mergedIdentified,
        status: isCompleted ? 'completed' : 'active',
        final_summary: isCompleted ? finalSummary : null,
        completed_at: isCompleted ? completedAt : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedSession.id ?? session.id)
      .select(
        'id,student_id,exercise_id,question_id,messages,identified_questions,status,final_summary,completed_at,created_at,updated_at',
      )
      .single();

    if (updateError) {
      console.error('Failed to update mentor chat session:', updateError);
      throw new InternalServerErrorException(
        `Failed to store mentor chat message: ${updateError.message}`,
      );
    }

    const refreshedSession = this.normalizeMentorChatRecord(updatedRecord);

    return {
      question: {
        id: question.id,
        text: this.coalesceStrings(question.text) || '',
      },
      config: {
        context: config.context,
        hypothesis: config.hypothesis,
        guidingQuestion: config.guidingQuestion,
        targetQuestions: config.targetQuestions,
        introMessage: config.introMessage,
      },
      chat: refreshedSession,
      ai: aiResult ?? {
        message: mentorMessage,
        identified_questions: mergedIdentified,
        status: isCompleted ? 'completed' : 'coaching',
      },
      exercise,
      section,
      questions: questionList,
    };
  }

  async getQuestionDataset(questionId: string) {
    // Use the unified dataset execution service
    // Note: userId is not required for this use case, passing empty string
    const datasetResult = await this.datasetExecutionService.getQuestionDataset(
      questionId,
      '',
    );

    if (!datasetResult.success) {
      const errorMessage =
        datasetResult.error?.trim() || 'Dataset not available';
      const normalizedMessage = errorMessage.toLowerCase();

      if (
        normalizedMessage.includes('not found') ||
        normalizedMessage.includes('no dataset')
      ) {
        throw new NotFoundException(errorMessage);
      }

      throw new InternalServerErrorException(
        `Failed to get dataset: ${errorMessage}`,
      );
    }

    return {
      creation_sql: datasetResult.data?.creation_sql,
      name: datasetResult.datasetInfo?.name,
      description: datasetResult.datasetInfo?.description,
      schema_info: datasetResult.data?.schema_info,
      subject_type: datasetResult.data?.subject_type,
      table_name: datasetResult.data?.table_name,
      columns: datasetResult.data?.columns,
    };
  }

  async getQuestionSubmissions(questionId: string, userId: string) {
    try {
      const { data: submissions, error } = await this.supabase
        .from('section_exercise_question_submissions')
        .select('*')
        .eq('question_id', questionId)
        .eq('student_id', userId)
        .order('submitted_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching submissions:', error);
        throw new InternalServerErrorException(
          `Failed to fetch submissions: ${error.message}`,
        );
      }

      return {
        submissions: submissions || [],
        total: (submissions || []).length,
        success: true,
      };
    } catch (error) {
      console.error('Error in getQuestionSubmissions:', error);
      throw new InternalServerErrorException(
        'Failed to retrieve submission history',
      );
    }
  }

  async getInterviewQuestionSubmissions(questionId: string, userId: string) {
    
  console.log(questionId);
  console.log(userId);  

    try {
      const { data: submissions, error } = await this.supabase
        .from('interview_exercise_question_submissions')
        .select('*')
        .eq('question_id', questionId)
        .eq('student_id', userId)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        console.error('Error fetching interview submissions:', error);
        throw new InternalServerErrorException(
          `Failed to fetch interview submissions: ${error.message}`,
        );
      }
console.log(submissions);
      return {
        submissions: submissions || [],
        total: (submissions || []).length,
        success: true,
      };

    } catch (error) {
      console.error('Error in getInterviewQuestionSubmissions:', error);
      throw new InternalServerErrorException(
        'Failed to retrieve interview submission history',
      );
    }
  }
}
