import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

export type AdaptiveQuizSession = {
  id: string;
  user_id: string;
  section_id: string;
  course_id: string;
  subject_id: string;
  main_topic: string;
  topic_hierarchy: string;
  future_topic: string;
  student_level: string;
  target_length: number;
  current_question_number: number;
  conversation_history: any[];
  status: 'active' | 'completed' | 'stopped';
  created_at: string;
  updated_at: string;
};

export type AdaptiveQuizResponse = {
  id: string;
  session_id: string;
  question_number: number;
  question_text: string;
  difficulty: string;
  options: any[];
  correct_option: any;
  explanation: string;
  user_answer?: string;
  is_correct?: boolean;
  created_at: string;
};

@Injectable()
export class AdaptiveQuizService {
  private apiUrl = process.env.BASE_AI_API_URL + '/generate-quiz';
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  constructor() {}

  private isValidUUID(value: string): boolean {
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(value);
  }

  private isNoRowsError(error: any): boolean {
    if (!error) return false;
    const message = typeof error.message === 'string' ? error.message : '';
    return error.code === 'PGRST116' || /0 rows/.test(message);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  private normalizeTopicValue(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private addTopicValue(target: Set<string>, value?: string | null) {
    const normalized = this.normalizeTopicValue(value);
    if (normalized) {
      target.add(normalized);
    }
  }

  private joinTopicValues(values: string[]): string {
    if (!Array.isArray(values) || values.length === 0) {
      return '';
    }
    const normalized = new Set<string>();
    values.forEach((value) => {
      const normalizedValue = this.normalizeTopicValue(value);
      if (normalizedValue) {
        normalized.add(normalizedValue);
      }
    });
    return [...normalized].join(', ');
  }

  private async buildFutureTopicsFromSectionTitles(
    sectionTitles: string[],
  ): Promise<string[]> {
    if (!Array.isArray(sectionTitles) || sectionTitles.length === 0) {
      return [];
    }

    const futureTopicSet = new Set<string>();

    for (const sectionTitle of sectionTitles) {
      this.addTopicValue(futureTopicSet, sectionTitle);

      const { data: sectionData, error: sectionDataError } = await this.supabase
        .from('sections')
        .select('id, overview')
        .eq('title', sectionTitle)
        .single();

      if (!sectionDataError && sectionData?.overview) {
        this.addTopicValue(futureTopicSet, sectionData.overview);
      }

      const sectionId = sectionData?.id;
      if (!sectionId) {
        continue;
      }

      const { data: topics, error: topicsError } = await this.supabase
        .from('section_topics')
        .select('topic_name, future_topic')
        .eq('section_id', sectionId)
        .limit(1)
        .order('order_index', { ascending: true });

      if (topicsError) {
        console.error('Failed to fetch future section topics:', topicsError);
        continue;
      }

      if (topics && topics.length > 0) {
        topics.forEach((topic) => {
          const futureValue =
            this.normalizeTopicValue(topic.future_topic) ||
            this.normalizeTopicValue(topic.topic_name);
          if (futureValue) {
            futureTopicSet.add(futureValue);
          }
        });
      }
    }

    return [...futureTopicSet];
  }

  private createUserClient(userToken: string) {
    // console.log('Creating user client with:', {
    //   url: process.env.SUPABASE_URL || 'undefined',
    //   anonKey: process.env.SUPABASE_ANON_KEY
    //     ? `${process.env.SUPABASE_ANON_KEY.substring(0, 20)}...`
    //     : 'undefined',
    //   userToken: userToken ? `${userToken.substring(0, 10)}...` : 'undefined',
    // });

    return createClient(
      process.env.SUPABASE_URL || '',
      process.env.SUPABASE_ANON_KEY || '',
      {
        global: {
          headers: {
            Authorization: `Bearer ${userToken}`,
          },
        },
      },
    );
  }

  private async findActiveSessionForUser(
    userId: string,
    sectionId?: string,
  ): Promise<AdaptiveQuizSession | null> {
    if (!this.isValidUUID(userId)) {
      console.warn(
        `Skipping adaptive quiz session lookup due to invalid user identifier: ${userId}`,
      );
      return null;
    }

    let query = this.supabase
      .from('adaptive_quiz_sessions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (sectionId) {
      if (!this.isValidUUID(sectionId)) {
        console.warn(
          `Skipping adaptive quiz session lookup due to invalid section identifier: ${sectionId}`,
        );
        return null;
      }

      query = query.eq('section_id', sectionId);
    }

    const { data, error } = await query;
    if (error && !this.isNoRowsError(error)) {
      console.error('Failed to lookup active adaptive quiz session:', error);
      throw new InternalServerErrorException(
        'Failed to lookup adaptive quiz session',
      );
    }

    if (!data || (Array.isArray(data) && data.length === 0)) {
      return null;
    }

    return Array.isArray(data) ? data[0] : (data as AdaptiveQuizSession);
  }

  private async getSessionResponses(
    sessionId: string,
  ): Promise<AdaptiveQuizResponse[]> {
    const { data, error } = await this.supabase
      .from('adaptive_quiz_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('question_number', { ascending: true });

    if (error && !this.isNoRowsError(error)) {
      console.error('Failed to fetch adaptive quiz responses:', error);
      throw new InternalServerErrorException(
        'Failed to fetch adaptive quiz responses',
      );
    }

    if (!data) {
      return [];
    }

    return data as AdaptiveQuizResponse[];
  }

  private buildResumeState(args: {
    session: AdaptiveQuizSession;
    responses: AdaptiveQuizResponse[];
  }) {
    const sortedResponses = [...(args.responses || [])].sort(
      (a, b) => a.question_number - b.question_number,
    );

    const firstUnanswered =
      sortedResponses.find(
        (response) =>
          response.user_answer === null ||
          response.user_answer === undefined ||
          response.user_answer === '',
      ) ?? null;

    const lastAnswered =
      [...sortedResponses]
        .reverse()
        .find(
          (response) =>
            response.user_answer !== null &&
            response.user_answer !== undefined &&
            response.user_answer !== '',
        ) ?? null;

    const stop = !firstUnanswered;

    return {
      session: args.session,
      currentQuestion: firstUnanswered,
      firstQuestion: firstUnanswered,
      lastAnsweredQuestion: lastAnswered,
      resume: true,
      stop,
    };
  }

  async startAdaptiveQuizSession(input: {
    courseId: string;
    subjectId: string;
    sectionId: string;
    sectionTitle: string;
    userId?: string;
    userToken: string;
    difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
    targetLength?: number;
  }): Promise<{
    session: AdaptiveQuizSession;
    firstQuestion: any;
    currentQuestion?: any;
    lastAnsweredQuestion?: any;
    resume?: boolean;
    stop: boolean;
  }> {
    // console.log('Starting adaptive quiz with input:', {
    //   ...input,
    //   userToken: input.userToken
    //     ? `${input.userToken.substring(0, 10)}...`
    //     : 'undefined',
    // });

    let userId = input.userId;
    if (!userId && input.userToken) {
      // Extract userId from userToken JWT payload
      try {
        const jwtPayload = JSON.parse(
          Buffer.from(input.userToken.split('.')[1], 'base64').toString(),
        );
        userId = jwtPayload.sub || jwtPayload.user_id;
      } catch (error) {
        console.error('Failed to extract userId from userToken:', error);
        throw new InternalServerErrorException('Invalid userToken');
      }
    }

    if (!userId) {
      throw new InternalServerErrorException('Authentication required');
    }

    // Get section context
    const sectionContext = await this.getSectionContext(
      input.courseId,
      input.subjectId,
      input.sectionId,
    );

    if (!sectionContext) {
      throw new NotFoundException('Section not found');
    }

    const existingSession = await this.findActiveSessionForUser(
      userId,
      sectionContext.sectionId,
    );

    if (existingSession) {
      const responses = await this.getSessionResponses(existingSession.id);
      const resumeState = this.buildResumeState({
        session: existingSession,
        responses,
      });

      return resumeState;
    }

    const studentLevel = this.mapDifficultyToLevel(
      input.difficulty || 'Intermediate',
    );
    const mainTopic = sectionContext.currentSectionTopics.join(', ');
    const topicHierarchy =
      sectionContext.topicHierarchyString ??
      this.joinTopicValues(sectionContext.topicHierarchyValues ?? []);

    console.log('Adaptive quiz topicHierarchy:', topicHierarchy);

    let futureTopicList: string[] = sectionContext.futureTopicsFromDb ?? [];
    let futureTopic: string =
      sectionContext.futureTopicsString ??
      this.joinTopicValues(futureTopicList);

    console.log('Adaptive quiz futureTopic before fallback:', futureTopic);

    if (
      futureTopicList.length === 0 &&
      sectionContext.allFutureSections &&
      sectionContext.allFutureSections.length > 0
    ) {
      futureTopicList = await this.buildFutureTopicsFromSectionTitles(
        sectionContext.allFutureSections,
      );
      futureTopic = this.joinTopicValues(futureTopicList);
    }

    // ensure we still have a futureTopic string even if list is empty
    futureTopic = futureTopic || this.joinTopicValues(futureTopicList);

    // Create user-context aware client for RLS operations
    const userClient = this.createUserClient(input.userToken);

    // Create adaptive quiz session using service role client for now to avoid auth issues
    const { data: session, error: sessionError } = await this.supabase
      .from('adaptive_quiz_sessions')
      .insert({
        user_id: userId,
        section_id: sectionContext.sectionId,
        course_id: sectionContext.courseId,
        subject_id: sectionContext.subjectId,
        main_topic: mainTopic,
        topic_hierarchy: topicHierarchy,
        future_topic: futureTopic,
        student_level: studentLevel,
        target_length: input.targetLength || 10,
        current_question_number: 1,
        conversation_history: [],
        status: 'active',
      })
      .select()
      .single();

    if (sessionError) {
      console.error('Failed to create adaptive quiz session:', sessionError);
      throw new InternalServerErrorException(
        'Failed to start adaptive quiz session',
      );
    }

    // Generate first question
    const firstQuestion = await this.callAdaptiveQuizAPI({
      main_topic: mainTopic,
      topic_hierarchy: topicHierarchy,
      future_topic: futureTopic,
      Student_level_in_topic: studentLevel,
      question_number: 1,
      target_len: input.targetLength || 10,
      conversation_history: [],
      previous_verdict: null,
    });

    if (firstQuestion.stop) {
      // Update session status
      await this.supabase
        .from('adaptive_quiz_sessions')
        .update({ status: 'completed' })
        .eq('id', session.id);

      return {
        session,
        firstQuestion: null,
        stop: true,
      };
    }

    // Store first question
    const { data: storedQuestion, error: questionError } = await this.supabase
      .from('adaptive_quiz_responses')
      .insert({
        session_id: session.id,
        question_number: 1,
        question_text: firstQuestion.question.question,
        difficulty: firstQuestion.question.difficulty,
        options: firstQuestion.question.options,
        correct_option: firstQuestion.question.correct_option,
        explanation: firstQuestion.question.explanation,
      })
      .select()
      .single();

    if (questionError) {
      console.error('Failed to store question:', questionError);
      throw new InternalServerErrorException('Failed to store question');
    }

    return {
      session,
      firstQuestion: storedQuestion,
      currentQuestion: storedQuestion,
      resume: false,
      stop: false,
    };
  }

  async resumeAdaptiveQuizSession(input: {
    sectionId?: string;
    userId?: string;
    userToken: string;
  }): Promise<{
    session: AdaptiveQuizSession | null;
    currentQuestion: AdaptiveQuizResponse | null;
    firstQuestion?: AdaptiveQuizResponse | null;
    lastAnsweredQuestion: AdaptiveQuizResponse | null;
    resume: boolean;
    stop: boolean;
  }> {
    let userId = input.userId;

    if (!userId && input.userToken) {
      try {
        const jwtPayload = JSON.parse(
          Buffer.from(input.userToken.split('.')[1], 'base64').toString(),
        );
        userId = jwtPayload.sub || jwtPayload.user_id;
      } catch (error) {
        console.error('Failed to extract userId from userToken:', error);
        throw new InternalServerErrorException('Invalid userToken');
      }
    }

    if (!userId) {
      throw new InternalServerErrorException('Authentication required');
    }

    const session = await this.findActiveSessionForUser(
      userId,
      input.sectionId,
    );

    if (!session) {
      return {
        session: null,
        currentQuestion: null,
        firstQuestion: null,
        lastAnsweredQuestion: null,
        resume: false,
        stop: true,
      };
    }

    const responses = await this.getSessionResponses(session.id);
    const resumeState = this.buildResumeState({
      session,
      responses,
    });

    return resumeState;
  }

  async checkActiveQuizStatus(input: {
    userId: string;
    sectionId: string;
  }): Promise<{
    hasActiveQuiz: boolean;
    sessionId?: string;
  }> {
    if (!input.userId) {
      throw new InternalServerErrorException('Authentication required');
    }

    let session: AdaptiveQuizSession | null = null;
    try {
      session = await this.findActiveSessionForUser(
        input.userId,
        input.sectionId,
      );
    } catch (error) {
      console.error('Adaptive quiz status lookup failed:', error);
      return {
        hasActiveQuiz: false,
      };
    }

    if (!session) {
      return {
        hasActiveQuiz: false,
      };
    }

    return {
      hasActiveQuiz: true,
      sessionId: session.id,
    };
  }

  async generateNextQuestion(input: {
    sessionId: string;
    userId: string;
    userToken: string;
    previousAnswer?: {
      questionId: string;
      selectedOption: string;
      isCorrect: boolean;
    };
  }): Promise<{ question: any; stop: boolean; summary?: any }> {
    // Create user-context aware client for RLS operations
    const userClient = this.createUserClient(input.userToken);

    // Get session using service role client
    const { data: session, error: sessionError } = await this.supabase
      .from('adaptive_quiz_sessions')
      .select('*')
      .eq('id', input.sessionId)
      .eq('user_id', input.userId)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Adaptive quiz session not found');
    }

    if (session.status !== 'active') {
      throw new InternalServerErrorException('Quiz session is not active');
    }

    // Update previous answer if provided
    if (input.previousAnswer) {
      await this.supabase
        .from('adaptive_quiz_responses')
        .update({
          user_answer: input.previousAnswer.selectedOption,
          is_correct: input.previousAnswer.isCorrect,
        })
        .eq('id', input.previousAnswer.questionId);
    }

    // Get conversation history
    const { data: responses, error: responsesError } = await this.supabase
      .from('adaptive_quiz_responses')
      .select('*')
      .eq('session_id', input.sessionId)
      .order('question_number', { ascending: true });

    if (responsesError) {
      console.error('Failed to get conversation history:', responsesError);
      throw new InternalServerErrorException(
        'Failed to get conversation history',
      );
    }

    // Check stop conditions based on performance before generating next question
    const stopCondition = this.checkStopConditions(responses);
    if (stopCondition.shouldStop) {
      // console.log(
      //   'Quiz stopped due to performance condition:',
      //   stopCondition.reason,
      // );

      // Update session status to 'stopped'
      await this.supabase
        .from('adaptive_quiz_sessions')
        .update({ status: 'stopped' })
        .eq('id', session.id);

      // Create regular quiz from adaptive quiz data
      try {
        await this.createQuizFromAdaptiveSession(session.id);
      } catch (error) {
        console.error('Failed to create quiz from adaptive session:', error);
        // Don't fail the main flow, just log the error
      }

      return {
        question: null,
        stop: true,
        summary: {
          reason: stopCondition.reason,
          totalQuestions: responses.length,
          performance_stop: true,
        },
      };
    }

    // Create conversation history as array of strings for API
    const conversationHistory: string[] = responses.map((r) => {
      const verdict =
        r.is_correct === true
          ? 'Correct'
          : r.is_correct === false
            ? 'Wrong'
            : 'Not answered';
      return `Question ${r.question_number} (${r.difficulty}): ${r.question_text} - ${verdict}`;
    });

    // Determine previous verdict
    const previousVerdict = input.previousAnswer
      ? input.previousAnswer.isCorrect
        ? 'Correct'
        : 'Wrong'
      : null;

    // Generate next question
    const nextQuestionNumber = session.current_question_number + 1;
    const nextQuestion = await this.callAdaptiveQuizAPI({
      main_topic: session.main_topic,
      topic_hierarchy: session.topic_hierarchy,
      future_topic: session.future_topic,
      Student_level_in_topic: session.student_level,
      question_number: nextQuestionNumber,
      target_len: session.target_length,
      conversation_history: conversationHistory,
      previous_verdict: previousVerdict,
    });

    if (nextQuestion.stop) {
      // Update session status
      await this.supabase
        .from('adaptive_quiz_sessions')
        .update({ status: 'completed' })
        .eq('id', session.id);

      // Create regular quiz from adaptive quiz data
      try {
        await this.createQuizFromAdaptiveSession(session.id);
      } catch (error) {
        console.error('Failed to create quiz from adaptive session:', error);
        // Don't fail the main flow, just log the error
      }

      return {
        question: null,
        stop: true,
        summary: nextQuestion.summary,
      };
    }

    // Store next question
    const { data: storedQuestion, error: questionError } = await this.supabase
      .from('adaptive_quiz_responses')
      .insert({
        session_id: session.id,
        question_number: nextQuestionNumber,
        question_text: nextQuestion.question.question,
        difficulty: nextQuestion.question.difficulty,
        options: nextQuestion.question.options,
        correct_option: nextQuestion.question.correct_option,
        explanation: nextQuestion.question.explanation,
      })
      .select()
      .single();

    if (questionError) {
      console.error('Failed to store question:', questionError);
      throw new InternalServerErrorException('Failed to store question');
    }

    // Update session
    await this.supabase
      .from('adaptive_quiz_sessions')
      .update({
        current_question_number: nextQuestionNumber,
        conversation_history: conversationHistory,
      })
      .eq('id', session.id);

    return {
      question: storedQuestion,
      stop: false,
    };
  }

  async getSessionSummary(
    sessionId: string,
    userId: string,
    userToken: string,
  ): Promise<any> {
    // Create user-context aware client for RLS operations
    const userClient = this.createUserClient(userToken);

    const { data: session, error: sessionError } = await this.supabase
      .from('adaptive_quiz_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('user_id', userId)
      .single();

    if (sessionError || !session) {
      throw new NotFoundException('Adaptive quiz session not found');
    }

    const { data: responses, error: responsesError } = await this.supabase
      .from('adaptive_quiz_responses')
      .select('*')
      .eq('session_id', sessionId)
      .order('question_number', { ascending: true });

    if (responsesError) {
      console.error('Failed to get responses:', responsesError);
      throw new InternalServerErrorException('Failed to get responses');
    }

    const totalQuestions = responses.length;
    const answeredQuestions = responses.filter(
      (r) => r.user_answer !== null,
    ).length;
    const correctAnswers = responses.filter(
      (r) => r.is_correct === true,
    ).length;
    const score =
      answeredQuestions > 0
        ? Math.round((correctAnswers / answeredQuestions) * 100)
        : 0;

    return {
      session,
      responses,
      summary: {
        totalQuestions,
        answeredQuestions,
        correctAnswers,
        score,
      },
    };
  }

  private async callAdaptiveQuizAPI(input: {
    main_topic: string;
    topic_hierarchy: string;
    future_topic: string;
    Student_level_in_topic: string;
    question_number: number;
    target_len: number;
    conversation_history: string[];
    previous_verdict: string | null;
  }): Promise<{ stop: boolean; question?: any; summary?: any }> {
    try {
      // console.log(
      //   `Calling Adaptive Quiz API with input ${input.main_topic}, ${input.topic_hierarchy}, ${input.Student_level_in_topic}`,
      // );
      // console.log(
      //   `Calling Adaptive Quiz API for question ${input.question_number}`,
      // );
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          main_topic: input.main_topic,
          topic_hierarchy: input.topic_hierarchy,
          future_topic: input.future_topic,
          Student_level_in_topic: input.Student_level_in_topic,
          question_number: input.question_number,
          target_len: input.target_len,
          conversation_history: input.conversation_history,
          previous_verdict: input.previous_verdict,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `Adaptive Quiz API failed: ${response.status}`,
          errorText,
        );
        throw new InternalServerErrorException('Adaptive Quiz API failed');
      }

      const data = await response.json();
      // console.log('Adaptive Quiz API response:', data);

      return data;
    } catch (error) {
      console.error('Error calling Adaptive Quiz API:', error);
      throw new InternalServerErrorException('Failed to generate question');
    }
  }

  private async getSectionContext(
    courseId: string,
    subjectId: string,
    sectionId: string,
  ) {
    const fetchCourseById = async (id: string) => {
      const { data, error } = await this.supabase
        .from('courses')
        .select('id, title, slug')
        .eq('id', id)
        .single();

      if (error) {
        if (this.isNoRowsError(error)) {
          return null;
        }

        console.error('Failed to fetch course by id', error);
        throw new InternalServerErrorException(
          'Failed to resolve course context',
        );
      }

      return data;
    };

    const fetchCourseBySlug = async (slug: string) => {
      const { data, error } = await this.supabase
        .from('courses')
        .select('id, title, slug')
        .eq('slug', slug)
        .single();

      if (error) {
        if (this.isNoRowsError(error)) {
          return null;
        }

        console.error('Failed to fetch course by slug', error);
        throw new InternalServerErrorException(
          'Failed to resolve course context',
        );
      }

      return data;
    };

    let course = this.isValidUUID(courseId)
      ? await fetchCourseById(courseId)
      : await fetchCourseBySlug(courseId);

    if (!course) {
      course = this.isValidUUID(courseId)
        ? await fetchCourseBySlug(courseId)
        : await fetchCourseById(courseId);
    }

    if (!course) {
      const { data: courseList, error: coursesError } = await this.supabase
        .from('courses')
        .select('id, title, slug');

      if (coursesError && !this.isNoRowsError(coursesError)) {
        console.error(
          'Failed to fetch course list for slug resolution',
          coursesError,
        );
        throw new InternalServerErrorException(
          'Failed to resolve course context',
        );
      }

      if (Array.isArray(courseList)) {
        const match = courseList.find(
          (item: any) =>
            typeof item?.title === 'string' &&
            this.slugify(item.title) === courseId,
        );

        if (match) {
          course = {
            id: match.id,
            title: match.title,
            slug: match.slug ?? this.slugify(match.title || ''),
          };
        }
      }
    }

    if (!course) {
      console.warn(`Course context not found for identifier ${courseId}`);
      return null;
    }

    const { data: subject, error: subjectError } = await this.supabase
      .from('subjects')
      .select('title, id')
      .eq('id', subjectId)
      .single();

    if (subjectError && !this.isNoRowsError(subjectError)) {
      console.error('Failed to fetch subject context', subjectError);
      throw new InternalServerErrorException(
        'Failed to resolve subject context',
      );
    }

    if (!subject || (subjectError && this.isNoRowsError(subjectError))) {
      console.warn(`Subject context not found for identifier ${subjectId}`);
      return null;
    }

    const { data: section, error: sectionError } = await this.supabase
      .from('sections')
      .select('title, overview, id, order_index')
      .eq('id', sectionId)
      .single();

    if (sectionError && !this.isNoRowsError(sectionError)) {
      console.error('Failed to fetch section context', sectionError);
      throw new InternalServerErrorException(
        'Failed to resolve section context',
      );
    }

    if (!section || (sectionError && this.isNoRowsError(sectionError))) {
      console.warn(`Section context not found for identifier ${sectionId}`);
      return null;
    }

    const topicHierarchySet = new Set<string>();
    const futureTopicSet = new Set<string>();

    // Get current section's topics for main_topic
    const { data: currentSectionTopics, error: currentTopicsError } =
      await this.supabase
        .from('section_topics')
        .select('topic_name, topic_hierarchy, future_topic')
        .eq('section_id', sectionId)
        .limit(1)
        .order('order_index', { ascending: false }); // Order topics by order_index (0, 1, 2, ...)

    if (currentTopicsError) {
      console.error(
        'Error fetching current section topics:',
        currentTopicsError,
      );
      return null;
    }

    currentSectionTopics?.forEach((topic) => {
      this.addTopicValue(topicHierarchySet, topic.topic_hierarchy);
      this.addTopicValue(futureTopicSet, topic.future_topic);
    });

    console.log('topicHierarchySet:', topicHierarchySet);
    console.log('futureTopicSet:', futureTopicSet);

    // console.log('Current section topics fetched:', {
    //   sectionId,
    //   topicsCount: currentSectionTopics?.length || 0,
    //   topics: currentSectionTopics,
    // });

    // Get current section's module information
    const { data: currentModule, error: currentModuleError } =
      await this.supabase
        .from('sections')
        .select('module_id')
        .eq('id', sectionId)
        .single();

    if (currentModuleError) {
      console.error('Error fetching current module:', currentModuleError);
      return null;
    }

    // Get current module's order_index
    const { data: moduleInfo, error: moduleInfoError } = await this.supabase
      .from('modules')
      .select('order_index')
      .eq('id', currentModule.module_id)
      .single();

    if (moduleInfoError) {
      console.error('Error fetching module info:', moduleInfoError);
      return null;
    }

    // Get all modules from the same subject that come before or equal to current module
    const { data: previousModules, error: previousModulesError } =
      await this.supabase
        .from('modules')
        .select('id, order_index')
        .eq('subject_id', subjectId)
        .lte('order_index', moduleInfo.order_index)
        .order('order_index', { ascending: true });

    if (previousModulesError) {
      console.error('Error fetching previous modules:', previousModulesError);
      return null;
    }

    // Get all sections from previous modules including current module
    const allPreviousTopics: string[] = [];
    if (previousModules && previousModules.length > 0) {
      // Process modules in order (by order_index)
      for (const module of previousModules) {
        // Get all sections from this module, ordered by section order_index
        const { data: moduleSections, error: moduleSectionsError } =
          await this.supabase
            .from('sections')
            .select('id, module_id, order_index')
            .eq('module_id', module.id)
            .order('order_index', { ascending: true });

        if (moduleSectionsError) {
          console.error(
            'Error fetching sections for module:',
            moduleSectionsError,
          );
          continue;
        }

        if (moduleSections && moduleSections.length > 0) {
          // For each section in order, get its topics
          for (const moduleSection of moduleSections) {
            // Skip sections that come after the current section in the current module
            if (
              module.id === currentModule.module_id &&
              moduleSection.order_index > section.order_index
            ) {
              continue;
            }

            const { data: sectionTopics, error: sectionTopicsError } =
              await this.supabase
                .from('section_topics')
                .select('topic_name, topic_hierarchy, future_topic')
                .eq('section_id', moduleSection.id)
                .order('order_index', { ascending: true }); // Order topics by order_index (0, 1, 2, ...)

            if (sectionTopicsError) {
              console.error(
                'Error fetching topics for section:',
                sectionTopicsError,
              );
              continue;
            }

            if (sectionTopics && sectionTopics.length > 0) {
              sectionTopics.forEach((topic) => {
                const hierarchyValue =
                  this.normalizeTopicValue(topic.topic_hierarchy) ||
                  this.normalizeTopicValue(topic.topic_name);
                if (hierarchyValue) {
                  allPreviousTopics.push(hierarchyValue);
                }
                // this.addTopicValue(futureTopicSet, topic.future_topic);
              });
            }
          }
        }
      }
    }

    // console.log('All previous topics fetched in order:', {
    //   totalTopics: allPreviousTopics.length,
    //   topics: allPreviousTopics,
    // });

    // Get all modules from the same subject that come after current module
    const { data: futureModules, error: futureModulesError } =
      await this.supabase
        .from('modules')
        .select('id, order_index')
        .eq('subject_id', subjectId)
        .gt('order_index', moduleInfo.order_index)
        .order('order_index', { ascending: true });

    if (futureModulesError) {
      console.error('Error fetching future modules:', futureModulesError);
    }

    // Get sections from current module that come after current section
    const {
      data: futureSectionsCurrentModule,
      error: futureSectionsCurrentModuleError,
    } = await this.supabase
      .from('sections')
      .select('id, title, order_index')
      .eq('module_id', currentModule.module_id)
      .gt('order_index', section.order_index)
      .order('order_index', { ascending: true });

    if (futureSectionsCurrentModuleError) {
      console.error(
        'Error fetching future sections from current module:',
        futureSectionsCurrentModuleError,
      );
    }

    // Get all sections from future modules
    let futureSectionsFromFutureModules: string[] = [];
    if (futureModules && futureModules.length > 0) {
      const futureModuleIds = futureModules.map((m) => m.id);

      const { data: allFutureSections, error: allFutureSectionsError } =
        await this.supabase
          .from('sections')
          .select('id, title, module_id, order_index')
          .in('module_id', futureModuleIds)
          .order('module_id, order_index', { ascending: true });

      if (allFutureSectionsError) {
        console.error(
          'Error fetching future sections from future modules:',
          allFutureSectionsError,
        );
      } else if (allFutureSections && allFutureSections.length > 0) {
        futureSectionsFromFutureModules = allFutureSections.map((s) => s.title);
      }
    }

    // Combine future sections: current module future sections + future modules sections
    const allFutureSections = [
      ...(futureSectionsCurrentModule?.map((s) => s.title) || []),
      ...futureSectionsFromFutureModules,
    ];

    const topicHierarchyValues = [...topicHierarchySet];
    const futureTopicsFromDb = [...futureTopicSet];
    console.log('Final topicHierarchyValues:', topicHierarchyValues);
    console.log('Final futureTopicsFromDb:', futureTopicsFromDb);
    return {
      courseId: course.id,
      courseTitle: course.title,
      subjectId: subject.id,
      subjectTitle: subject.title,
      sectionId: section.id,
      sectionTitle: section.title,
      sectionOverview: section.overview,
      currentSectionTopics:
        currentSectionTopics?.map((topic) => topic.topic_name) || [],
      allPreviousTopics: allPreviousTopics,
      allFutureSections: allFutureSections,
      topicHierarchyValues,
      topicHierarchyString: this.joinTopicValues(topicHierarchyValues),
      futureTopicsFromDb,
      futureTopicsString: this.joinTopicValues(futureTopicsFromDb),
    };
  }

  private async createQuizFromAdaptiveSession(
    sessionId: string,
  ): Promise<void> {
    try {
      // Get session data
      const { data: session, error: sessionError } = await this.supabase
        .from('adaptive_quiz_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();

      if (sessionError || !session) {
        throw new Error('Failed to fetch adaptive quiz session');
      }

      // Get all responses for the session
      const { data: responses, error: responsesError } = await this.supabase
        .from('adaptive_quiz_responses')
        .select('*')
        .eq('session_id', sessionId)
        .order('question_number', { ascending: true });

      if (responsesError || !responses || responses.length === 0) {
        throw new Error('Failed to fetch adaptive quiz responses');
      }

      // Create the main quiz using direct database operations
      const quizTitle = `Adaptive Quiz: ${session.main_topic} (Generated)`;
      const { data: quiz, error: quizError } = await this.supabase
        .from('quizzes')
        .insert({
          title: quizTitle,
          section_id: session.section_id,
        })
        .select()
        .single();

      if (quizError || !quiz) {
        throw new Error('Failed to create quiz');
      }

      // console.log('Created quiz:', quiz);

      // Create questions and options
      for (const response of responses) {
        // Create the question using direct database operations
        const { data: question, error: questionError } = await this.supabase
          .from('quiz_questions')
          .insert({
            quiz_id: quiz.id,
            type: 'mcq',
            text: response.question_text,
            order_index: response.question_number,
            explanation: response.explanation || '',
          })
          .select()
          .single();

        if (questionError || !question) {
          console.error('Failed to create question:', questionError);
          continue;
        }

        // console.log('Created question:', question);

        // Create options using direct database operations
        if (Array.isArray(response.options)) {
          for (let i = 0; i < response.options.length; i++) {
            const option = response.options[i];
            const isCorrect =
              response.correct_option &&
              (option.text === response.correct_option.text ||
                option.label === response.correct_option.label);

            const { data: createdOption, error: optionError } =
              await this.supabase
                .from('quiz_options')
                .insert({
                  question_id: question.id,
                  option_text: option.text || option.label || `Option ${i + 1}`,
                  correct: isCorrect || false,
                })
                .select()
                .single();

            if (optionError) {
              console.error('Failed to create option:', optionError);
              continue;
            }

            // console.log('Created option:', createdOption);
          }
        }
      }

      // console.log(
      //   `Successfully created quiz with ${responses.length} questions from adaptive session ${sessionId}`,
      // );
    } catch (error) {
      console.error('Error creating quiz from adaptive session:', error);
      throw error;
    }
  }

  private mapDifficultyToLevel(difficulty: string): string {
    const mapping: Record<string, string> = {
      Beginner: 'beginner',
      Intermediate: 'intermediate',
      Advanced: 'advanced',
    };
    return mapping[difficulty] || 'intermediate';
  }

  /**
   * Check if quiz should be stopped based on performance conditions
   */
  private checkStopConditions(responses: AdaptiveQuizResponse[]): {
    shouldStop: boolean;
    reason?: string;
  } {
    if (!responses || responses.length === 0) {
      return { shouldStop: false };
    }

    // Filter only answered questions
    const answeredResponses = responses.filter(
      (r) => r.is_correct !== null && r.is_correct !== undefined,
    );

    if (answeredResponses.length === 0) {
      return { shouldStop: false };
    }

    // Check condition 1: 3 consecutive wrong answers for Easy questions
    const consecutiveEasyWrong =
      this.checkConsecutiveEasyWrong(answeredResponses);
    if (consecutiveEasyWrong) {
      return {
        shouldStop: true,
        reason: 'Quiz stopped: 3 consecutive wrong answers on Easy questions',
      };
    }

    // Check condition 2: 3 out of 5 Hard questions wrong
    const hardQuestionsFailed =
      this.checkHardQuestionsFailed(answeredResponses);
    if (hardQuestionsFailed) {
      return {
        shouldStop: true,
        reason: 'Quiz stopped: 3 out of 5 Hard questions answered incorrectly',
      };
    }

    // Check condition 3: 4 Medium questions wrong in total
    const mediumQuestionsFailed =
      this.checkMediumQuestionsFailed(answeredResponses);
    if (mediumQuestionsFailed) {
      return {
        shouldStop: true,
        reason: 'Quiz stopped: 4 Medium questions answered incorrectly',
      };
    }

    // Check condition 4: Maximum 10 questions reached
    if (responses.length >= 10) {
      return {
        shouldStop: true,
        reason: 'Quiz stopped: Maximum 10 questions reached',
      };
    }

    return { shouldStop: false };
  }

  /**
   * Check for 3 consecutive wrong answers on Easy questions
   */
  private checkConsecutiveEasyWrong(
    responses: AdaptiveQuizResponse[],
  ): boolean {
    let consecutiveWrong = 0;

    for (const response of responses) {
      if (this.normalizedifficulty(response.difficulty) === 'Easy') {
        if (response.is_correct === false) {
          consecutiveWrong++;
          if (consecutiveWrong >= 3) {
            return true;
          }
        } else {
          consecutiveWrong = 0; // Reset counter on correct answer
        }
      }
    }

    return false;
  }

  /**
   * Check if 3 out of 5 Hard questions were answered incorrectly
   */
  private checkHardQuestionsFailed(responses: AdaptiveQuizResponse[]): boolean {
    const hardQuestions = responses.filter(
      (r) => this.normalizedifficulty(r.difficulty) === 'Hard',
    );

    if (hardQuestions.length < 5) {
      return false; // Need at least 5 hard questions to apply this rule
    }

    // Take the first 5 hard questions
    const firstFiveHard = hardQuestions.slice(0, 5);
    const wrongCount = firstFiveHard.filter(
      (r) => r.is_correct === false,
    ).length;

    return wrongCount >= 3;
  }

  /**
   * Check if 4 Medium questions were answered incorrectly in total
   */
  private checkMediumQuestionsFailed(
    responses: AdaptiveQuizResponse[],
  ): boolean {
    const mediumQuestions = responses.filter(
      (r) => this.normalizedifficulty(r.difficulty) === 'Medium',
    );
    const wrongCount = mediumQuestions.filter(
      (r) => r.is_correct === false,
    ).length;

    return wrongCount >= 4;
  }

  /**
   * Normalize difficulty strings to standard format
   */
  private normalizedifficulty(difficulty: string): 'Easy' | 'Medium' | 'Hard' {
    const normalized = difficulty.toLowerCase().trim();

    if (normalized === 'easy' || normalized === 'beginner') {
      return 'Easy';
    } else if (normalized === 'medium' || normalized === 'intermediate') {
      return 'Medium';
    } else if (normalized === 'hard' || normalized === 'advanced') {
      return 'Hard';
    }

    // Default to Medium if unclear
    return 'Medium';
  }
}
