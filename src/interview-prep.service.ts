import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';
import {
  CreateInterviewProfileDto,
  UpdateInterviewProfileDto,
  UploadJDDto,
  InterviewJDAnalysisResponse,
  GenerateInterviewPlanDto,
  GenerateInterviewQuestionsDto,
  InterviewPlanResponse,
  ExtractJDDto,
  ExtractJDResponse,
  DomainKPIDto,
  DomainKPIResponse,
  GeneratePracticeExercisesDto,
  PracticeExerciseResponse,
  MigratePlanDataDto,
  MigratePlanDataResponse,
  MigrationResult,
} from './interview-prep.dto';

type PracticeGenerationOverrides = {
  domain?: string;
  learnerLevel?: 'Beginner' | 'Intermediate' | 'Advanced';
  topic?: string;
  topicHierarchy?: string;
  futureTopics?: string[];
  questionCount?: number;
  previousQuestionsContext?: string[];
  domainKnowledgeDetail?: 'summary' | 'full';
};
import { FileExtractionService } from './file-extraction.service';

@Injectable()
export class InterviewPrepService {
  private supabase: SupabaseClient;
  private aiServiceUrl: string;
  private static SUBJECT_TOPIC_MAP: Record<
    string,
    Record<'Beginner' | 'Intermediate' | 'Advanced', { topic: string; topicHierarchy: string }>
  > = {
    SQL: {
      Beginner:     { topic: 'Basic Queries',          topicHierarchy: 'Select, Where, Order By, Limit, Basic Aggregations' },
      Intermediate: { topic: 'Joins & Aggregations',   topicHierarchy: 'Select, Where, Group By, Having, Joins, Subqueries' },
      Advanced:     { topic: 'Window Functions & CTEs', topicHierarchy: 'Joins, Subqueries, CTEs, Window Functions, Query Optimisation, Indexing' },
    },
    Python: {
      Beginner:     { topic: 'Data Basics',            topicHierarchy: 'Variables, Data Types, Functions, Loops, Lists, Basic Pandas' },
      Intermediate: { topic: 'Data Frames',            topicHierarchy: 'Variables, Functions, Pandas, Matplotlib, GroupBy, Merging' },
      Advanced:     { topic: 'Advanced Analytics',     topicHierarchy: 'Pandas, NumPy, Matplotlib, Scikit-learn, APIs, Performance Optimisation' },
    },
    'Power BI': {
      Beginner:     { topic: 'Basic Reports',          topicHierarchy: 'Data Import, Basic Visuals, Filters, Slicers, Simple DAX' },
      Intermediate: { topic: 'Reporting & DAX',        topicHierarchy: 'Data Modeling, DAX Measures, Relationships, Visualizations' },
      Advanced:     { topic: 'Advanced Modeling',      topicHierarchy: 'DAX, Row Context, Filter Context, Star Schema, Row-Level Security, Publishing' },
    },
    Statistics: {
      Beginner:     { topic: 'Descriptive Statistics', topicHierarchy: 'Mean, Median, Mode, Variance, Standard Deviation, Distributions' },
      Intermediate: { topic: 'Inferential Statistics', topicHierarchy: 'Summary Stats, Distributions, Hypothesis Testing, p-value, Confidence Intervals' },
      Advanced:     { topic: 'Advanced Analytics',     topicHierarchy: 'Regression, ANOVA, Chi-Square, Bayesian Thinking, A/B Testing, Model Evaluation' },
    },
    Excel: {
      Beginner:     { topic: 'Core Formulas',          topicHierarchy: 'SUM, AVERAGE, IF, VLOOKUP, Basic Pivot Tables, Sorting, Filtering' },
      Intermediate: { topic: 'Data Analysis',          topicHierarchy: 'Formulas, Pivot Tables, VLOOKUP, HLOOKUP, Conditional Formatting, Charts' },
      Advanced:     { topic: 'Advanced Excel',         topicHierarchy: 'INDEX-MATCH, Array Formulas, Power Query, Macros, Dynamic Dashboards, Pivot Charts' },
    },
    'Problem Solving': {
      Beginner:     { topic: 'Structured Thinking',    topicHierarchy: 'Problem Definition, Assumptions, Simple Frameworks, Recommendations' },
      Intermediate: { topic: 'Case Frameworks',        topicHierarchy: 'Case Framing, Assumptions, Hypothesis, Root Cause Analysis, Recommendations' },
      Advanced:     { topic: 'Strategic Reasoning',    topicHierarchy: 'MECE, Issue Trees, Business Acumen, Trade-off Analysis, Executive Recommendations' },
    },
    Communication: {
      Beginner:     { topic: 'Clear Communication',    topicHierarchy: 'Clarity, Structure, Simple Visuals, Audience Awareness' },
      Intermediate: { topic: 'Data Storytelling',      topicHierarchy: 'Narrative, Visuals, Insight Delivery, Stakeholder Communication' },
      Advanced:     { topic: 'Executive Storytelling', topicHierarchy: 'Executive Summaries, Persuasion, Conflict Resolution, Data-driven Narratives' },
    },
    'Case Studies': {
      Beginner:     { topic: 'Case Basics',            topicHierarchy: 'Context Understanding, Objective Setting, Basic Metrics, Simple Recommendations' },
      Intermediate: { topic: 'Business Case Analysis', topicHierarchy: 'Context, Objective, Metrics, Root Cause, Recommendations' },
      Advanced:     { topic: 'End-to-End Case Design', topicHierarchy: 'Scoping, KPI Design, Root Cause Analysis, Segmentation, Strategic Recommendations' },
    },
    'Domain Knowledge': {
      Beginner:     { topic: 'Company & Industry Basics', topicHierarchy: 'Company Overview, Industry, Business Model, Key KPIs' },
      Intermediate: { topic: 'Domain Awareness',          topicHierarchy: 'Company Overview, KPIs, Use Cases, Industry Trends, Resume Tips' },
      Advanced:     { topic: 'Strategic Domain Depth',    topicHierarchy: 'Competitive Landscape, Business Strategy, KPI Trees, Industry Challenges, Growth Levers' },
    },
  };

  constructor(private fileExtractionService: FileExtractionService) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_KEY environment variables are required',
      );
    }
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
  }

  private durationMs(startedAt: number): number {
    return Date.now() - startedAt;
  }

  private logTiming(scope: string, startedAt: number, details?: string): void {
    const suffix = details ? ` ${details}` : '';
    console.log(`[timing] ${scope}=${this.durationMs(startedAt)}ms${suffix}`);
  }

  async createOrUpdateProfile(
    userId: string,
    dto: CreateInterviewProfileDto | UpdateInterviewProfileDto,
  ) {
    try {
      const { data, error } = await this.supabase
        .from('interview_profiles')
        .upsert(
          {
            user_id: userId,
            ...dto,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'user_id' },
        )
        .select();

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      throw new BadRequestException(`Failed to save profile: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  async getProfile(userId: string) {
    try {
      const { data, error } = await this.supabase
        .from('interview_profiles')
        .select()
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      return data || null;
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch profile: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async uploadJobDescription(userId: string, dto: UploadJDDto) {
    try {
      if (!dto.job_description || dto.job_description.trim().length === 0) {
        throw new BadRequestException('Job description cannot be empty');
      }

      const { data, error } = await this.supabase
        .from('interview_job_descriptions')
        .insert({
          user_id: userId,
          job_description: dto.job_description,
          source_type: dto.source_type || 'paste',
          created_at: new Date().toISOString(),
        })
        .select();

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      throw new BadRequestException(`Failed to upload JD: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  async uploadJobDescriptionFile(userId: string, file: Express.Multer.File) {
    const filePath = file.path;
    try {
      if (!file) {
        throw new BadRequestException('No file provided');
      }

      const allowedMimes = [
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain',
      ];

      if (!allowedMimes.includes(file.mimetype)) {
        this.fileExtractionService.cleanupFile(filePath);
        throw new BadRequestException(
          `Unsupported file type: ${file.mimetype}. Allowed: PDF, DOCX, TXT`,
        );
      }

      console.log(
        `[uploadJobDescriptionFile] Extracting text from: ${file.originalname} (${file.mimetype})`,
      );
      const jobDescriptionText =
        await this.fileExtractionService.extractTextFromFile(
          filePath,
          file.originalname,
        );

      console.log(
        `[uploadJobDescriptionFile] Extracted text length: ${jobDescriptionText?.length || 0}`,
      );
      console.log(
        `[uploadJobDescriptionFile] First 200 chars: ${jobDescriptionText?.substring(0, 200) || 'empty'}`,
      );

      if (!jobDescriptionText || jobDescriptionText.trim().length === 0) {
        throw new BadRequestException('Extracted job description is empty');
      }

      const { data, error } = await this.supabase
        .from('interview_job_descriptions')
        .insert({
          user_id: userId,
          job_description: jobDescriptionText,
          source_type: 'upload',
          original_filename: file.originalname,
          created_at: new Date().toISOString(),
        })
        .select();

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to upload JD: ${(error instanceof Error ? error.message : String(error))}`);
    } finally {
      this.fileExtractionService.cleanupFile(filePath);
    }
  }

  async analyzeJobDescription(jdId: number, jobDescription: string) {
    try {
      if (!jobDescription || jobDescription.trim().length === 0) {
        throw new Error('Job description text cannot be empty');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000);

      const requestBody = { jd_text: jobDescription };
      console.log(
        `[analyzeJobDescription] Calling ${this.aiServiceUrl}/interview/analyze-jd with body:`,
        requestBody,
      );

      const response = await fetch(
        `${this.aiServiceUrl}/interview/analyze-jd`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      const responseText = await response.text();

      console.log(
        `[analyzeJobDescription] Response status: ${response.status}`,
      );
      console.log(`[analyzeJobDescription] Response body: ${responseText}`);

      if (!response.ok) {
        const errorDetail = responseText || response.statusText;
        throw new Error(
          `AI service returned ${response.status}: ${errorDetail}`,
        );
      }

      try {
        return JSON.parse(responseText) as InterviewJDAnalysisResponse;
      } catch (parseError) {
        throw new Error(
          `AI service returned invalid JSON: ${responseText || 'empty body'}`,
        );
      }
    } catch (error) {
      console.error('[analyzeJobDescription] Error:', error);
      throw new BadRequestException(
        `Failed to analyze job description: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async getJobDescription(jdId: number, userId?: string) {
    try {
      let query = this.supabase
        .from('interview_job_descriptions')
        .select()
        .eq('id', jdId);

      if (userId) {
        query = query.eq('user_id', userId);
      }

      const { data, error } = await query.single();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) throw new NotFoundException('Job description not found');

      return data;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch JD: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  private getPlanTopicInfo(
    subject: string,
    level: 'Beginner' | 'Intermediate' | 'Advanced' = 'Intermediate',
  ) {
    const trimmed = this.normalizeSubjectLabel(subject);
    const key = trimmed || 'SQL';
    const levelMap = InterviewPrepService.SUBJECT_TOPIC_MAP[key];
    if (levelMap) return levelMap[level];
    return { topic: trimmed || 'General', topicHierarchy: trimmed || 'General' };
  }

  private canUseStaticTopicInfo(subject: string): boolean {
    const normalizedSubject = this.normalizeSubjectLabel(subject);
    return Boolean(InterviewPrepService.SUBJECT_TOPIC_MAP[normalizedSubject]);
  }

  private async resolveDynamicTopicInfo(
    subject: string,
    learnerDifficulty: 'Beginner' | 'Intermediate' | 'Advanced',
    jdData: { job_description?: string },
    profileData: { experience_level?: string; target_role?: string; company_name?: string },
  ): Promise<{ topic: string; topicHierarchy: string }> {
    const startedAt = Date.now();
    if (this.canUseStaticTopicInfo(subject)) {
      const staticTopicInfo = this.getPlanTopicInfo(subject, learnerDifficulty);
      this.logTiming(
        'interview.topic-hierarchy',
        startedAt,
        `subject="${subject}" status=static topic="${staticTopicInfo.topic}"`,
      );
      return staticTopicInfo;
    }
    try {
      const _t0 = Date.now();
      const response = await fetch(`${this.aiServiceUrl}/interview/topic-hierarchy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          years_of_experience: profileData.experience_level || null,
          experience_level: learnerDifficulty.toLowerCase(),
          role_title: profileData.target_role || null,
          job_description: jdData.job_description
            ? jdData.job_description.substring(0, 1500)
            : null,
        }),
        signal: AbortSignal.timeout(12000),
      });

      if (response.ok) {
        const data = (await response.json()) as { topic: string; topic_hierarchy: string };
        console.log(
          `[topic-hierarchy] ${subject} → "${data.topic}" in ${Date.now() - _t0}ms`,
        );
        this.logTiming(
          'interview.topic-hierarchy',
          startedAt,
          `subject="${subject}" status=ok topic="${data.topic}"`,
        );
        return { topic: data.topic, topicHierarchy: data.topic_hierarchy };
      }
    } catch (err) {
      console.warn(
        `[topic-hierarchy] Fallback for ${subject}:`,
        err instanceof Error ? err.message : String(err),
      );
      this.logTiming(
        'interview.topic-hierarchy',
        startedAt,
        `subject="${subject}" status=fallback`,
      );
    }
    // Fallback to static map
    return this.getPlanTopicInfo(subject, learnerDifficulty);
  }

  private getSubjectPrepTimeoutMs(
    subject: string,
    fallbackMs: number,
    questionCount = 8,
  ): number {
    const normalized = this.normalizeSubjectKey(subject);
    const questionBoost =
      questionCount > 20 ? 120000 : questionCount > 12 ? 60000 : 0;
    if (
      normalized === 'excel' ||
      normalized === 'statistics' ||
      normalized === 'python' ||
      normalized === 'sql' ||
      normalized === 'power bi' ||
      normalized === 'domain knowledge'
    ) {
      const floor =
        normalized === 'excel'
          ? 420000
          : normalized === 'sql'
            ? 360000
            : 300000;
      return Math.max(fallbackMs + questionBoost, floor + questionBoost);
    }
    if (normalized === 'problem solving') {
      return Math.max(fallbackMs + questionBoost, 240000 + questionBoost);
    }
    return fallbackMs + questionBoost;
  }

  private createSubjectPrepStatus(
    subject: string,
    status: 'in_progress' | 'ready' | 'failed',
    details: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      subject,
      generation_status: status,
      generation_updated_at: new Date().toISOString(),
      ...details,
    };
  }

  private selectPlanAutoGenerationSubjects(subjects: string[]): string[] {
    if (subjects.length === 0) {
      return [];
    }

    return subjects.filter(
      (subject) => !this.isDomainKnowledgeSubject(subject),
    );
  }

  private async setPlanSubjectPrepStatus(
    userId: string,
    planId: number,
    subject: string,
    status: 'in_progress' | 'ready' | 'failed',
    details: Record<string, unknown> = {},
  ): Promise<void> {
    await this.upsertPlanSubjectPrep(userId, planId, {
      [subject]: this.createSubjectPrepStatus(subject, status, details),
    });
  }

  private buildDomainKnowledgeFallback(
    subject: string,
    profileData: any,
    jdData: any,
    reason: string,
  ): [string, Record<string, unknown>] {
    const companyName =
      profileData?.company_name?.trim() ||
      jdData?.company_name?.trim() ||
      'Company';
    const roleTitle =
      profileData?.role_title?.trim() ||
      jdData?.role_title?.trim() ||
      profileData?.target_role?.trim() ||
      'Data Analyst';
    const industry =
      profileData?.industry?.trim() ||
      jdData?.industry?.trim() ||
      'General business';
    const domainKnowledgeText = [
      '## STEP 1: CONTEXT SETUP',
      '',
      `### Company Name: ${companyName}`,
      `### Role Title: ${roleTitle}`,
      '### Business Function: Analytics',
      `### Domain Keywords: ${industry}, business metrics, KPI tracking`,
      '',
      '---',
      '',
      '## STEP 2: COMPANY + DOMAIN SNAPSHOT',
      '',
      `This role sits in ${industry} and will likely require the candidate to connect data work to business performance, reporting, and decision support.`,
      '',
      'Key areas to understand before the interview:',
      '- Business model and revenue drivers',
      '- Core customer or user segments',
      '- Operating metrics and reporting cadence',
      '- Trade-offs between growth, cost, and retention',
      '',
      '---',
      '',
      '## STEP 3: KPI MASTERCLASS',
      '',
      '### 1. KPI Name: Revenue Growth',
      '- **Definition**: Change in revenue over time.',
      '- **Formula**: (Current Revenue - Previous Revenue) / Previous Revenue',
      '- **Why It Matters**: Indicates whether the business is expanding.',
      '- **Domain Example**: Track weekly or monthly revenue movement by segment.',
      '',
      '### 2. KPI Name: Conversion Rate',
      '- **Definition**: Share of users completing the target action.',
      '- **Formula**: Conversions / Total Visitors or Users',
      '- **Why It Matters**: Measures funnel efficiency.',
      '- **Domain Example**: App install to purchase conversion.',
      '',
      '### 3. KPI Name: Retention Rate',
      '- **Definition**: Share of users who return after a period.',
      '- **Formula**: Returning Users / Starting Users',
      '- **Why It Matters**: Signals product stickiness and user value.',
      '- **Domain Example**: 30-day active user retention.',
      '',
      '### 4. KPI Name: Average Order Value',
      '- **Definition**: Average revenue per transaction.',
      '- **Formula**: Total Revenue / Number of Orders',
      '- **Why It Matters**: Helps explain monetization quality.',
      '- **Domain Example**: Basket size changes during campaigns.',
      '',
      '### 5. KPI Name: Customer Acquisition Cost',
      '- **Definition**: Cost to acquire one new customer.',
      '- **Formula**: Marketing Spend / New Customers Acquired',
      '- **Why It Matters**: Helps judge sustainable growth.',
      '- **Domain Example**: Compare CAC by channel.',
      '',
      '---',
      '',
      '## STEP 4: CLOSING FOLLOW-UP',
      '',
      `Fallback domain knowledge was generated because the full domain KPI service failed: ${reason}.`,
    ].join('\n');

    return [
      subject,
      {
        subject,
        header_text: `${companyName} Domain Knowledge`,
        company_name: companyName,
        role_title: roleTitle,
        business_function: 'Analytics',
        domain_keywords: [industry, 'business metrics', 'kpi tracking'],
        top_strategic_priorities: [
          'Understand revenue and growth drivers',
          'Connect analysis to business outcomes',
          'Explain KPI trade-offs clearly',
        ],
        domain_knowledge_text: domainKnowledgeText,
        generation_status: 'ready',
        generation_error: `Fallback used: ${reason}`,
        generation_updated_at: new Date().toISOString(),
      },
    ];
  }

  private buildPracticeSubjectFallback(
    subject: string,
    topicInfo: { topic: string; topicHierarchy: string },
    resolvedQuestionCount: number,
    reason: string,
  ): [string, Record<string, unknown>] {
    const questionTarget = Math.max(3, Math.min(resolvedQuestionCount, 5));
    const topicChain = topicInfo.topicHierarchy
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const focusTopic = topicInfo.topic || subject;
    const questionsRaw = Array.from({ length: questionTarget }, (_, index) => {
      const topicLabel = topicChain[index] || focusTopic;
      return {
        id: String(index + 1),
        text: `Explain or solve an interview problem on ${topicLabel} for ${subject}.`,
        business_question: `How would you approach ${topicLabel} in an interview setting?`,
        difficulty:
          index < 2 ? 'easy' : index < 4 ? 'medium' : 'hard',
        topics: [topicLabel, subject],
        adaptive_note: `Keep the answer structured and tied to ${focusTopic}.`,
        expected_approach: `Start with the core concept behind ${topicLabel}, then walk through the logic step by step and mention trade-offs or pitfalls.`,
        answer: `A strong answer should define ${topicLabel}, show the method clearly, and connect it to realistic interview use.`,
      };
    });

    return [
      subject,
      {
        subject,
        header_text: `${subject} Interview Practice`,
        dataset_description: `Fallback practice pack focused on ${focusTopic}.`,
        questions_raw: questionsRaw,
        data_creation_sql: '',
        data_creation_python: '',
        dataset_csv_raw: '',
        dataset_columns: [],
        generation_status: 'ready',
        generation_error: `Fallback used: ${reason}`,
        generation_updated_at: new Date().toISOString(),
      },
    ];
  }

  private async generateSingleSubjectPrep(
    subject: string,
    profileData: any,
    jdData: any,
    overrides: PracticeGenerationOverrides,
  ): Promise<[string, Record<string, unknown>] | null> {
    const startedAt = Date.now();
    const mappedLanguage = this.mapSubjectToLanguage(subject);
    const datasetLanguage = this.mapSubjectToDatasetLanguage(subject);
    const resolvedQuestionCount =
      typeof overrides.questionCount === 'number' && overrides.questionCount > 0
        ? Math.max(1, Math.trunc(overrides.questionCount))
        : 8;
    const learnerDifficulty = this.resolveLearnerDifficulty(
      overrides.learnerLevel,
      profileData.experience_level,
    );
    const normalizedSubjectKey = this.normalizeSubjectKey(subject);
    const isProblemSolving = this.isProblemSolvingSubject(subject);
    // Dynamically resolve topic + topic_hierarchy via GPT based on actual JD experience
    const topicInfo =
      isProblemSolving || normalizedSubjectKey === 'domain knowledge'
        ? { topic: subject, topicHierarchy: '' }
        : await this.resolveDynamicTopicInfo(
            subject,
            learnerDifficulty,
            jdData,
            profileData,
          );
    const timeoutMs = this.getSubjectPrepTimeoutMs(subject, 220000);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      if (isProblemSolving) {
        const subjectResponse = await fetch(
          `${this.aiServiceUrl}/interview/subject-prep`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject,
              job_description: jdData.job_description,
              experience_level: profileData.experience_level,
              company_name: profileData.company_name,
              total_questions: resolvedQuestionCount,
            }),
            signal: controller.signal,
          },
        );

        if (!subjectResponse.ok) {
          console.error(
            `[generateInterviewPlan] Problem solving subject prep failed: ${subjectResponse.status}`,
          );
          return null;
        }

        const subjectData = await subjectResponse.json();
        this.logTiming(
          'interview.subject-prep',
          startedAt,
          `subject="${subject}" mode=problem-solving status=ok questionCount=${resolvedQuestionCount}`,
        );
        return [
          subject,
          {
            ...subjectData,
            subject,
          },
        ] as const;
      }

      if (normalizedSubjectKey === 'domain knowledge') {
        const domainCompanyName =
          profileData?.company_name?.trim() ||
          jdData?.job_description?.company_name?.trim() ||
          profileData?.industry?.trim() ||
          'Company';
        const domainKnowledgeDetail =
          overrides.domainKnowledgeDetail || 'full';
        const targetKpiCount = domainKnowledgeDetail === 'summary' ? 6 : 12;
        const controller = new AbortController();
        const timeoutMs = this.getSubjectPrepTimeoutMs(
          subject,
          220000,
          resolvedQuestionCount,
        );
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetch(
            `${this.aiServiceUrl}/interview/domain-kpi`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                company_name: domainCompanyName,
                job_description: jdData?.job_description,
                domain:
                  profileData?.industry?.trim() ||
                  profileData?.company_name?.trim() ||
                  null,
                role_title:
                  jdData?.job_description?.role_title?.trim() ||
                  profileData?.role_title?.trim() ||
                  'Data Analyst',
                business_function: 'Analytics',
                detail_level: domainKnowledgeDetail,
                target_kpi_count: targetKpiCount,
              }),
              signal: controller.signal,
            },
          );
          clearTimeout(timeoutId);

          if (!response.ok) {
            console.error(
              `[generateInterviewPlan] Failed to generate domain knowledge for ${subject}: ${response.status}`,
            );
            this.logTiming(
              'interview.subject-prep',
              startedAt,
              `subject="${subject}" mode=domain-knowledge status=http_${response.status} questionCount=${resolvedQuestionCount}`,
            );
            return this.buildDomainKnowledgeFallback(
              subject,
              profileData,
              jdData,
              `http_${response.status}`,
            );
          }

          const data = await response.json();
          const kpis = Array.isArray(data?.kpis) ? data.kpis : [];
          const domainKeywords = Array.isArray(data?.domain_keywords)
            ? data.domain_keywords
                .map((keyword: unknown) => String(keyword || '').trim())
                .filter((keyword: string) => keyword.length > 0)
            : [];
          const topPriorities = Array.isArray(data?.top_strategic_priorities)
            ? data.top_strategic_priorities
                .map((priority: unknown) => String(priority || '').trim())
                .filter((priority: string) => priority.length > 0)
                .slice(0, 3)
            : [];
          const companyNameValue =
            data?.company_name?.trim() || domainCompanyName;
          const roleTitleValue =
            data?.role_title?.trim() ||
            jdData?.job_description?.role_title?.trim() ||
            profileData?.role_title?.trim() ||
            'Data Analyst';
          const businessFunctionValue =
            data?.business_function?.trim() || 'Analytics';
          const divisionValue =
            data?.division?.trim() ||
            data?.domain?.trim() ||
            profileData?.industry?.trim() ||
            '[General Business]';
          const sectorSubSectorValue =
            data?.sector_sub_sector?.trim() ||
            data?.domain_snapshot?.trim() ||
            '[Sector / sub-sector]';
          const headquartersValue =
            data?.headquarters?.trim() ||
            data?.hq?.trim() ||
            '[City of HQ - to be filled based on actual data]';
          const foundedYearValue =
            data?.founded_year?.trim() ||
            data?.foundedYear?.trim() ||
            '[Year company was founded - to be filled based on actual data]';
          const revenueFyValue =
            data?.revenue_fy?.trim() ||
            data?.revenueFY?.trim() ||
            '[Latest fiscal year revenue]';
          const employeeCountValue =
            data?.number_of_employees?.trim() ||
            data?.numberOfEmployees?.trim() ||
            '[Total headcount]';
          const domainKeywordsText =
            domainKeywords.length > 0
              ? domainKeywords.join(', ')
              : ['grocery retail', 'omnichannel', 'conversion rate']
                  .filter((value) => value.length > 0)
                  .join(', ');
          const priorityLines = topPriorities.length
            ? topPriorities.map((priority: string) => `- ${priority}`)
            : [
                '- Omnichannel Growth',
                '- Cost Optimization',
                '- Customer Experience Enhancement',
              ];
          const businessModelLines = Array.isArray(data?.business_model)
            ? data.business_model
                .map((item: unknown) => String(item || '').trim())
                .filter((item: string) => item.length > 0)
            : [];
          const valueChainLines = Array.isArray(data?.value_chain)
            ? data.value_chain
                .map((item: unknown) => String(item || '').trim())
                .filter((item: string) => item.length > 0)
            : [];
          const analyticsLines = Array.isArray(data?.analytics_in_this_domain)
            ? data.analytics_in_this_domain
                .map((item: unknown) => String(item || '').trim())
                .filter((item: string) => item.length > 0)
            : [];
          const formatParagraph = (value: unknown, fallback: string) => {
            const text = String(value || '').trim();
            return text || fallback;
          };
          const formatList = (items: string[], fallback: string) =>
            items.length > 0 ? items.map((item: string) => `- ${item}`).join('\n') : `- ${fallback}`;
          const kpiLines = kpis.length
            ? kpis
                .slice(0, 15)
                .map((kpi: any, index: number) => {
                  const name = kpi?.name || kpi?.kpi || `KPI ${index + 1}`;
                  const definition = kpi?.definition || '[Definition not provided]';
                  const formula = kpi?.formula || '[Formula not provided]';
                  const whyMatters = kpi?.why_matters || kpi?.whyMatters || '[Why it matters not provided]';
                  const example = kpi?.example || '[Example not provided]';
                  return [
                    `### ${index + 1}. KPI Name: ${name}`,
                    `- **Definition**: ${definition}`,
                    `- **Formula**: ${formula}`,
                    `- **Why It Matters**: ${whyMatters}`,
                    `- **Domain Example**: ${example}`,
                  ].join('\n');
                })
                .join('\n\n')
            : '### 1. KPI Name: [KPI not provided]\n- **Definition**: [Definition not provided]\n- **Formula**: [Formula not provided]\n- **Why It Matters**: [Why it matters not provided]\n- **Domain Example**: [Example not provided]';
          const closingNote =
            'This comprehensive overview of the company and its KPIs should help the learner speak confidently in interviews.';
          const domainKnowledgeText = [
            '## STEP 1: CONTEXT SETUP',
            '',
            `### Company Name: ${companyNameValue}`,
            `### Role Title: ${roleTitleValue}`,
            `### Business Function: ${businessFunctionValue}`,
            `### Domain Keywords: ${domainKeywordsText}`,
            '',
            '---',
            '',
            '## STEP 2: COMPANY + DOMAIN SNAPSHOT (Detailed)',
            '',
            '### Company Overview',
            formatParagraph(
              data?.company_overview,
              '[Company overview not provided]',
            ),
            '',
            '### Sector / Sub-sector',
            formatParagraph(
              data?.sector_sub_sector || data?.division || data?.domain,
              '[Sector / sub-sector not provided]',
            ),
            '',
            '### Business Model',
            formatList(businessModelLines, '[Business model not provided]'),
            '',
            '### Value Chain',
            formatList(valueChainLines, '[Value chain not provided]'),
            '',
            '### Core Customer Segments',
            formatParagraph(
              data?.core_customer_segments,
              '[Core customer segments not provided]',
            ),
            '',
            '### Operations',
            formatParagraph(data?.operations, '[Operations not provided]'),
            '',
            '### Products/Services Portfolio',
            formatParagraph(
              data?.products_services_portfolio,
              '[Products/services portfolio not provided]',
            ),
            '',
            '### Geographic Presence',
            formatParagraph(
              data?.geographic_presence,
              '[Geographic presence not provided]',
            ),
            '',
            '### Competitors & Market Positioning',
            formatParagraph(
              data?.competitors_market_positioning,
              '[Competitors & positioning not provided]',
            ),
            '',
            '### Trends & Challenges',
            formatParagraph(
              data?.trends_challenges,
              '[Trends and challenges not provided]',
            ),
            '',
            '### Analytics in this Domain',
            formatList(analyticsLines, '[Analytics in this domain not provided]'),
            '',
            'Top 3 Strategic Priorities:',
            ...priorityLines.slice(0, 3),
            '',
            '---',
            '',
            '## STEP 3: DOMAIN KPI MASTERCLASS',
            '',
            kpiLines,
            '',
            '---',
            '',
            '## STEP 4: CLOSING FOLLOW-UP',
            '',
            '📌 NOTES',
            '',
            closingNote,
          ].join('\n');

          this.logTiming(
            'interview.subject-prep',
            startedAt,
            `subject="${subject}" mode=domain-knowledge status=ok questionCount=${resolvedQuestionCount}`,
          );
          return [
            subject,
              {
                ...data,
                subject,
                header_text: `${companyNameValue} Domain Knowledge`,
                domain_knowledge_text: domainKnowledgeText,
                domain_knowledge_detail: domainKnowledgeDetail,
                generated_kpi_count: kpis.length,
                generation_status: 'ready',
                generation_error: null,
                generation_updated_at: new Date().toISOString(),
            },
          ] as const;
        } catch (error) {
          clearTimeout(timeoutId);
          this.logTiming(
            'interview.subject-prep',
            startedAt,
            `subject="${subject}" mode=domain-knowledge status=error questionCount=${resolvedQuestionCount}`,
          );
          return this.buildDomainKnowledgeFallback(
            subject,
            profileData,
            jdData,
            error instanceof Error ? error.message : String(error),
          );
        }
      }

      const solutionCodingLanguage = this.resolveSolutionCodingLanguage(
        subject,
        mappedLanguage,
      );

      const attemptQuestionCounts = Array.from(
        new Set([
          resolvedQuestionCount,
          Math.min(resolvedQuestionCount, 5),
          Math.min(resolvedQuestionCount, 3),
        ]),
      ).filter((value) => value > 0);

      let subjectData: any = null;
      let lastFailureReason = 'unknown';

      for (const attemptQuestionCount of attemptQuestionCounts) {
        const subjectResponse = await fetch(`${this.aiServiceUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            field: 'Data Analytics',
            domain:
              profileData.company_name ||
              profileData.industry ||
              'General',
            subject,
            topic: topicInfo.topic,
            topic_hierarchy: topicInfo.topicHierarchy,
            learner_level: this.mapDifficultyToLevel(learnerDifficulty),
            solution_coding_language: solutionCodingLanguage,
            dataset_creation_coding_language: datasetLanguage,
            total_questions: attemptQuestionCount,
            verify_locally: false,
          }),
          signal: controller.signal,
        });

        if (!subjectResponse.ok) {
          const errorBody = await subjectResponse.text().catch(() => '');
          lastFailureReason = `http_${subjectResponse.status}`;
          console.error(
            `[generateInterviewPlan] Failed to generate prep for ${subject}: ${subjectResponse.status} (${attemptQuestionCount} questions) ${errorBody.slice(0, 300)}`,
          );
          continue;
        }

        subjectData = await subjectResponse.json();
        break;
      }

      if (!subjectData) {
        this.logTiming(
          'interview.subject-prep',
          startedAt,
          `subject="${subject}" mode=practice status=fallback questionCount=${resolvedQuestionCount}`,
        );
        return this.buildPracticeSubjectFallback(
          subject,
          topicInfo,
          resolvedQuestionCount,
          lastFailureReason,
        );
      }
      const normalizedSubjectData =
        subject === 'Domain Knowledge'
          ? {
              subject,
              domain_knowledge_text:
                subjectData.domain_knowledge_text ||
                subjectData.business_context ||
                '',
            }
          : {
              ...subjectData,
              subject,
            };

      this.logTiming(
        'interview.subject-prep',
        startedAt,
        `subject="${subject}" mode=practice status=ok questionCount=${resolvedQuestionCount}`,
      );
      return [subject, normalizedSubjectData] as const;
    } catch (error) {
      if (
        error instanceof DOMException &&
        error.name === 'AbortError'
      ) {
        console.warn(
          `[generateInterviewPlan] Prep generation timed out for ${subject}`,
        );
        this.logTiming(
          'interview.subject-prep',
          startedAt,
          `subject="${subject}" status=timeout questionCount=${resolvedQuestionCount}`,
        );
        if (!isProblemSolving && this.normalizeSubjectKey(subject) !== 'domain knowledge') {
          return this.buildPracticeSubjectFallback(
            subject,
            topicInfo,
            resolvedQuestionCount,
            'timeout',
          );
        }
        return null;
      }
      console.error(
        `[generateInterviewPlan] Error generating prep for ${subject}:`,
        error,
      );
      this.logTiming(
        'interview.subject-prep',
        startedAt,
        `subject="${subject}" status=error questionCount=${resolvedQuestionCount}`,
      );
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async generateInterviewPlan(
    userId: string,
    dto: GenerateInterviewPlanDto,
  ): Promise<InterviewPlanResponse> {
    const startedAt = Date.now();
    try {
      // Verify profile exists and belongs to user
      const { data: profileData, error: profileError } = await this.supabase
        .from('interview_profiles')
        .select()
        .eq('id', dto.profile_id)
        .eq('user_id', userId)
        .single();

      if (profileError || !profileData) {
        throw new NotFoundException('Profile not found');
      }

      // Get JD
      const jdData = await this.getJobDescription(dto.jd_id, userId);

      // Use provided subjects or default to SQL, Python, Power BI, Guess Estimate, Statistics
      const subjects = Array.from(
        new Set(
          (
            dto.suggested_subjects || ['Domain Knowledge']
          )
            .map((subject) => this.normalizeSubjectLabel(subject))
            .filter((subject) => Boolean(subject)),
        ),
      );
      const parsedQuestionCount = Number(dto.question_count);
      const resolvedQuestionCount = Number.isFinite(parsedQuestionCount)
        ? Math.max(1, Math.trunc(parsedQuestionCount))
        : 8;
      console.log(
        `[generateInterviewPlan] Generating plan for subjects: ${subjects.join(', ')}`,
      );

      // Call AI service to generate base plan
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 220000);

      const basePlanStartedAt = Date.now();
      const basePlanResponse = await fetch(
        `${this.aiServiceUrl}/interview/generate-plan`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            profile: profileData,
            job_description: jdData.job_description,
          }),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);

      this.logTiming('interview.plan.base-plan', basePlanStartedAt);

      if (!basePlanResponse.ok) {
        throw new Error(
          `AI service returned ${basePlanResponse.status}: ${basePlanResponse.statusText}`,
        );
      }

      const planContent = await basePlanResponse.json();

      const orderedSubjects = [
        'Domain Knowledge',
        ...subjects.filter(
          (subject) => subject.toLowerCase() !== 'domain knowledge',
        ),
      ];
      const autoGeneratedSubjects = new Set(
        this.selectPlanAutoGenerationSubjects(orderedSubjects),
      );
      const subjectPrepMap = new Map<string, Record<string, unknown>>();
      orderedSubjects.forEach((subject) => {
        const isDomainKnowledge = this.isDomainKnowledgeSubject(subject);
        const isAutoGeneratedSubject = autoGeneratedSubjects.has(subject);
        subjectPrepMap.set(
          subject,
          this.createSubjectPrepStatus(subject, 'in_progress', {
            generation_mode: isDomainKnowledge
              ? 'domain_background'
              : isAutoGeneratedSubject
                ? 'background'
                : 'lazy',
            generation_error: null,
          }),
        );
      });

      // Combine plan content with subject prep data
      const enrichedPlanContent = {
        ...planContent,
        question_count: resolvedQuestionCount,
        question_count_per_subject: resolvedQuestionCount,
        subject_prep: Object.fromEntries(subjectPrepMap),
        subjects_covered: orderedSubjects,
      };

      // Save plan to database
      const { data: planData, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .insert({
          user_id: userId,
          profile_id: dto.profile_id,
          jd_id: dto.jd_id,
          plan_content: enrichedPlanContent,
          domain_knowledge_text: null,
          created_at: new Date().toISOString(),
        })
        .select();

      if (planError) throw planError;

      const savedPlan = planData?.[0];
      if (savedPlan) {
        try {
          const domainKnowledgeSubject = orderedSubjects.find((subject) =>
            this.isDomainKnowledgeSubject(subject),
          );

          if (domainKnowledgeSubject) {
            const generatedDomainKnowledge =
              await this.generateSingleSubjectPrep(
                domainKnowledgeSubject,
                {
                  ...profileData,
                },
                {
                  ...jdData,
                },
                {
                  learnerLevel: undefined,
                  questionCount: resolvedQuestionCount,
                  domainKnowledgeDetail: 'summary',
                },
              );

            if (generatedDomainKnowledge) {
              const readyDomainSubjectData = {
                ...generatedDomainKnowledge[1],
                subject: generatedDomainKnowledge[0],
                generation_status: 'ready',
                generation_mode: 'domain_background',
                generation_updated_at: new Date().toISOString(),
              };
              subjectPrepMap.set(
                generatedDomainKnowledge[0],
                readyDomainSubjectData,
              );
              await this.upsertPlanSubjectPrep(userId, savedPlan.id, {
                [generatedDomainKnowledge[0]]: readyDomainSubjectData,
              });
              savedPlan.plan_content = {
                ...(savedPlan.plan_content || {}),
                subject_prep: {
                  ...((savedPlan.plan_content?.subject_prep as Record<
                    string,
                    Record<string, unknown>
                  >) || {}),
                  [generatedDomainKnowledge[0]]: readyDomainSubjectData,
                },
              };
              const domainKnowledgeText = readyDomainSubjectData[
                'domain_knowledge_text'
              ];
              if (typeof domainKnowledgeText === 'string') {
                savedPlan.domain_knowledge_text = domainKnowledgeText;
              }
            } else {
              await this.setPlanSubjectPrepStatus(
                userId,
                savedPlan.id,
                domainKnowledgeSubject,
                'failed',
                {
                  generation_error:
                    'Timed out or failed during initial domain generation',
                  generation_mode: 'domain_background',
                },
              );
            }
          }

          void this.finalizeGeneratedPlanInBackground(
            userId,
            profileData,
            jdData,
            savedPlan.id,
            dto.profile_id ?? null,
            dto.jd_id ?? null,
            orderedSubjects,
            subjectPrepMap,
            resolvedQuestionCount,
          );

          this.logTiming(
            'interview.plan.total',
            startedAt,
            `planId=${savedPlan.id} subjects=${orderedSubjects.length} questionCount=${resolvedQuestionCount}`,
          );
          return savedPlan as InterviewPlanResponse;
        } catch (error) {
          console.error(
            '[generateInterviewPlan] Failed to auto-save generated plan data:',
            error,
          );
        }
      }

      this.logTiming(
        'interview.plan.total',
        startedAt,
        `planId=${savedPlan?.id ?? 'unknown'} subjects=${orderedSubjects.length} questionCount=${resolvedQuestionCount}`,
      );
      return (savedPlan as InterviewPlanResponse) || null;
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate interview plan: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async finalizeGeneratedPlanInBackground(
    userId: string,
    profileData: any,
    jdData: any,
    planId: number,
    profileId: number | null,
    jdId: number | null,
    subjects: string[],
    subjectPrepMap: Map<string, Record<string, unknown>>,
    questionCount?: number,
  ): Promise<void> {
    const startedAt = Date.now();
    try {
      const resolvedQuestionCount =
        typeof questionCount === 'number' && questionCount > 0
          ? Math.max(1, Math.trunc(questionCount))
          : 8;
      const backgroundQuestionCount = resolvedQuestionCount;
      const backgroundSubjects = subjects.filter((subject) => {
        const generationMode = String(
          subjectPrepMap.get(subject)?.generation_mode || '',
        ).toLowerCase();
        return generationMode === 'background';
      });
      const pendingSubjects = backgroundSubjects.filter((subject) => {
        const existingStatus = subjectPrepMap.get(subject)?.generation_status;
        return existingStatus !== 'ready';
      });
      const domainKnowledgeSubject = subjects.find((subject) =>
        this.isDomainKnowledgeSubject(subject),
      );
      const domainKnowledgeAlreadyReady = Boolean(
        domainKnowledgeSubject &&
          String(
            subjectPrepMap.get(domainKnowledgeSubject)?.generation_status || '',
          ).toLowerCase() === 'ready',
      );
      const maxConcurrent = Math.min(4, pendingSubjects.length || 1);
      let nextIndex = 0;

      const worker = async () => {
        while (nextIndex < pendingSubjects.length) {
          const currentIndex = nextIndex;
          nextIndex += 1;
          const subject = pendingSubjects[currentIndex];
          const subjectStartedAt = Date.now();
          const generated = await this.generateSingleSubjectPrep(subject, {
            ...profileData,
          }, {
            ...jdData,
          }, {
            learnerLevel: undefined,
            questionCount: backgroundQuestionCount,
          });

          this.logTiming(
            'interview.plan.background-subject',
            subjectStartedAt,
            `planId=${planId} subject="${subject}" status=${generated ? 'ok' : 'failed'} questionCount=${backgroundQuestionCount}`,
          );
          if (!generated) {
            await this.setPlanSubjectPrepStatus(
              userId,
              planId,
              subject,
              'failed',
              {
                generation_error:
                  'Timed out or failed during background generation',
                generation_mode: 'background',
              },
            );
            continue;
          }

          const readySubjectData = {
            ...generated[1],
            subject: generated[0],
            generation_status: 'ready',
            generation_mode: 'background',
            generation_updated_at: new Date().toISOString(),
          };
          subjectPrepMap.set(generated[0], readySubjectData);
          await this.upsertPlanSubjectPrep(userId, planId, {
            [generated[0]]: readySubjectData,
          });
        }
      };

      const backgroundWork: Promise<unknown>[] = [];
      if (pendingSubjects.length > 0) {
        backgroundWork.push(
          Promise.all(Array.from({ length: maxConcurrent }, () => worker())),
        );
      }

      if (domainKnowledgeSubject && !domainKnowledgeAlreadyReady) {
        backgroundWork.push(
          (async () => {
            const subjectStartedAt = Date.now();
            const summaryGenerated = await this.generateSingleSubjectPrep(
              domainKnowledgeSubject,
              {
                ...profileData,
              },
              {
                ...jdData,
              },
              {
                learnerLevel: undefined,
                questionCount: backgroundQuestionCount,
                domainKnowledgeDetail: 'summary',
              },
            );

            this.logTiming(
              'interview.plan.domain-background-subject',
              subjectStartedAt,
              `planId=${planId} subject="${domainKnowledgeSubject}" stage=summary status=${summaryGenerated ? 'ok' : 'failed'}`,
            );

            if (!summaryGenerated) {
              await this.setPlanSubjectPrepStatus(
                userId,
                planId,
                domainKnowledgeSubject,
                'failed',
                {
                  generation_error:
                    'Timed out or failed during domain background generation',
                  generation_mode: 'domain_background',
                },
              );
              return;
            }

            const readySummarySubjectData = {
              ...summaryGenerated[1],
              subject: summaryGenerated[0],
              generation_status: 'ready',
              generation_mode: 'domain_background',
              generation_error: null,
              generation_updated_at: new Date().toISOString(),
            };
            subjectPrepMap.set(summaryGenerated[0], readySummarySubjectData);
            await this.upsertPlanSubjectPrep(userId, planId, {
              [summaryGenerated[0]]: readySummarySubjectData,
            });
          })(),
        );
      }

      await Promise.all(backgroundWork);

      const migrationStartedAt = Date.now();
      const migrationResult = await this.migratePlanDataToTables(userId, {
        plan_id: planId,
        overwrite_existing: false,
      });

      this.logTiming(
        'interview.plan.migration',
        migrationStartedAt,
        `planId=${planId} success=${migrationResult.success}`,
      );

      if (!migrationResult.success) {
        console.warn(
          '[generateInterviewPlan] Automatic plan data migration completed with warnings:',
          migrationResult,
        );
      }

      try {
        await this.persistProblemSolvingCaseStudies(
          userId,
          profileId,
          jdId,
          planId,
          subjectPrepMap,
        );
      } catch (error) {
        console.error(
          '[generateInterviewPlan] Failed to persist Problem Solving case studies:',
          error,
        );
      }
      this.logTiming('interview.plan.background-total', startedAt, `planId=${planId} subjects=${backgroundSubjects.length}`);
    } catch (error) {
      console.error(
        '[generateInterviewPlan] Background finalization failed:',
        error,
      );
    }
  }

  async generateInterviewQuestions(
    _userId: string,
    dto: GenerateInterviewQuestionsDto,
  ) {
    try {
      const response = await fetch(
        `${this.aiServiceUrl}/interview/generate-interview-questions`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject: dto.subject,
            candidate_experience: dto.candidate_experience,
            company_name: dto.company_name || '',
            role: dto.role || '',
            domain: dto.domain,
            total_questions: dto.total_questions,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new BadRequestException(
          `AI service returned ${response.status}: ${errorText}`,
        );
      }

      return await response.json();
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate interview questions: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async getInterviewPlan(planId: number, userId: string) {
    console.log('[getInterviewPlan] planId=%s userId=%s', planId, userId);
    try {
      const { data, error } = await this.supabase
        .from('interview_prep_plans')
        .select('*')
        .eq('id', planId)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) {
        throw new NotFoundException('Plan not found');
      }

      if (data?.jd_id) {
        const { data: jdData, error: jdError } = await this.supabase
          .from('interview_job_descriptions')
          .select('company_name, role_title, industry')
          .eq('id', data.jd_id)
          .maybeSingle();
        if (jdError && jdError.code !== 'PGRST116') {
          console.warn('[getInterviewPlan] missing job_description', jdError);
        } else if (jdData) {
          data.job_description = jdData;
        }
      }

      return data;
    } catch (error) {
      console.error('[getInterviewPlan] failed', error);
      throw new BadRequestException(
        `Failed to fetch plan: ${error?.message || error}`,
      );
    }
  }

  async getPlanProgress(userId: string, planId: number) {
    try {
      const { data: plan, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .select('*')
        .eq('id', planId)
        .eq('user_id', userId)
        .single();

      if (planError || !plan) {
        throw new NotFoundException('Plan not found');
      }

      const planLabel =
        plan.plan_content?.summary ||
        plan.plan_content?.title ||
        plan.plan_content?.plan_title ||
        `Plan ${planId}`;

      const { data: exercisesData = [] } = await this.supabase
        .from('interview_practice_exercises')
        .select('id, name, created_at')
        .ilike('name', `%Plan ${planId}%`)
        .order('created_at', { ascending: true });

      const exercises = (exercisesData || []) as {
        id?: string;
        name?: string;
        created_at?: string;
      }[];

      const exerciseIds = exercises
        .map((exercise) => exercise.id)
        .filter(Boolean);

      let questions: { id: string; exercise_id: string }[] = [];
      if (exerciseIds.length > 0) {
        const { data: questionData, error: questionError } = await this.supabase
          .from('interview_practice_questions')
          .select('id, exercise_id')
          .in('exercise_id', exerciseIds);
        if (questionError) {
          throw new BadRequestException(
            `Failed to fetch plan questions: ${questionError.message}`,
          );
        }
        questions = questionData || [];
      }

      const questionIds = questions
        .map((question) => question.id)
        .filter(Boolean);

      let submissions: {
        question_id: string;
        score: number | null;
        created_at: string | null;
      }[] = [];
      if (questionIds.length > 0) {
        const { data: submissionData, error: submissionError } =
          await this.supabase
            .from('interview_exercise_question_submissions')
            .select('question_id, score, created_at')
            .eq('student_id', userId)
            .in('question_id', questionIds);

        if (submissionError) {
          throw new BadRequestException(
            `Failed to fetch plan submissions: ${submissionError.message}`,
          );
        }

        submissions = submissionData || [];
      }

      const mentorChatMap = new Map<
        string,
        { count: number; latest: string | null }
      >();
      if (questionIds.length > 0) {
        const { data: chatData, error: chatError } = await this.supabase
          .from('interview_exercise_mentor_chat')
          .select('question_id, created_at')
          .in('question_id', questionIds);

        if (chatError) {
          throw new BadRequestException(
            `Failed to fetch mentor chat progress: ${chatError.message}`,
          );
        }
        (chatData || []).forEach((chat) => {
          if (!chat?.question_id) {
            return;
          }
          const existing = mentorChatMap.get(chat.question_id);
          const latest = this.getLatestTimestamp(
            existing?.latest ?? null,
            chat.created_at,
          );
          mentorChatMap.set(chat.question_id, {
            count: (existing?.count ?? 0) + 1,
            latest,
          });
        });
      }

      const submissionsByQuestion = new Map<
        string,
        (typeof submissions)[0][]
      >();
      submissions.forEach((submission) => {
        if (!submission?.question_id) {
          return;
        }
        const existing =
          submissionsByQuestion.get(submission.question_id) || [];
        existing.push(submission);
        submissionsByQuestion.set(submission.question_id, existing);
      });

      const questionsByExercise = new Map<string, string[]>();
      questions.forEach((question) => {
        if (!question?.exercise_id || !question.id) {
          return;
        }
        const existing = questionsByExercise.get(question.exercise_id) || [];
        existing.push(question.id);
        questionsByExercise.set(question.exercise_id, existing);
      });

      type SubjectAccumulator = {
        subject: string;
        primaryExerciseId?: string;
        questionCount: number;
        completedQuestions: number;
        correctQuestions: number;
        attemptedQuestions: number;
        submissionAttempts: number;
        latestSubmissionAt: string | null;
      };

      const accumulator = new Map<string, SubjectAccumulator>();

      const addToAccumulator = (
        subjectLabel: string,
        values: Partial<SubjectAccumulator>,
      ) => {
        const existing = accumulator.get(subjectLabel);
        if (subjectLabel.trim().toLowerCase() === 'domain knowledge') {
          return;
        }
        if (existing) {
          existing.questionCount += values.questionCount ?? 0;
          existing.completedQuestions += values.completedQuestions ?? 0;
          existing.correctQuestions += values.correctQuestions ?? 0;
          existing.attemptedQuestions += values.attemptedQuestions ?? 0;
          existing.submissionAttempts += values.submissionAttempts ?? 0;
          existing.latestSubmissionAt = this.getLatestTimestamp(
            existing.latestSubmissionAt,
            values.latestSubmissionAt,
          );
          if (!existing.primaryExerciseId && values.primaryExerciseId) {
            existing.primaryExerciseId = values.primaryExerciseId;
          }
          return;
        }
        accumulator.set(subjectLabel, {
          subject: subjectLabel,
          primaryExerciseId: values.primaryExerciseId,
          questionCount: values.questionCount ?? 0,
          completedQuestions: values.completedQuestions ?? 0,
          correctQuestions: values.correctQuestions ?? 0,
          attemptedQuestions: values.attemptedQuestions ?? 0,
          submissionAttempts: values.submissionAttempts ?? 0,
          latestSubmissionAt: values.latestSubmissionAt ?? null,
        });
      };

      const planSubjectNames = this.collectPlanSubjectNames(plan);

      exercises.forEach((exercise) => {
        if (!exercise?.id) {
          return;
        }
        const questionIdsForExercise =
          questionsByExercise.get(exercise.id) || [];
        const subjectLabel = this.formatExerciseSubjectLabel(
          exercise.name,
          planId,
        );
        const isProblemSolvingExercise = subjectLabel
          .toLowerCase()
          .includes('problem solving');
        const exerciseStats = questionIdsForExercise.reduce(
          (acc, questionId) => {
            const questionSubs = submissionsByQuestion.get(questionId) || [];
            if (questionSubs.length > 0) {
              acc.attempted += 1;
              acc.submissionAttempts += 1;
              acc.completed += 1;
              const bestScore = questionSubs.reduce((max, sub) => {
                const value =
                  typeof sub.score === 'number'
                    ? sub.score
                    : Number(sub.score) || 0;
                return Math.max(max, value);
              }, 0);
              if (bestScore > 0) {
                acc.correct += 1;
              }
              const latestForQuestion = questionSubs.reduce(
                (latest, entry) =>
                  this.getLatestTimestamp(latest, entry.created_at),
                null as string | null,
              );
              acc.latest = this.getLatestTimestamp(
                acc.latest,
                latestForQuestion,
              );
            } else if (isProblemSolvingExercise) {
              const chatInfo = mentorChatMap.get(questionId);
              if (chatInfo) {
                acc.attempted += 1;
                if (chatInfo.count >= 7) {
                  acc.completed += 1;
                  acc.latest = this.getLatestTimestamp(
                    acc.latest,
                    chatInfo.latest,
                  );
                }
              }
            }
            acc.total += 1;
            return acc;
          },
          {
            total: 0,
            completed: 0,
            correct: 0,
            attempted: 0,
            submissionAttempts: 0,
            latest: null as string | null,
          },
        );

        addToAccumulator(subjectLabel, {
          questionCount: exerciseStats.total,
          completedQuestions: exerciseStats.completed,
          correctQuestions: exerciseStats.correct,
          latestSubmissionAt: exerciseStats.latest,
          primaryExerciseId: exercise.id,
          attemptedQuestions: exerciseStats.attempted,
          submissionAttempts: exerciseStats.submissionAttempts,
        });
        if (!planSubjectNames.includes(subjectLabel)) {
          planSubjectNames.push(subjectLabel);
        }
      });

      planSubjectNames.forEach((subjectName) => {
        if (!accumulator.has(subjectName)) {
          accumulator.set(subjectName, {
            subject: subjectName,
            questionCount: 0,
            completedQuestions: 0,
            correctQuestions: 0,
            attemptedQuestions: 0,
            submissionAttempts: 0,
            latestSubmissionAt: null,
          });
        }
      });

      const subjects = Array.from(accumulator.values()).map((summary) => {
        const attempted = summary.attemptedQuestions;
        const completionPercentage =
          summary.questionCount > 0
            ? Number(
                (
                  (summary.completedQuestions / summary.questionCount) *
                  100
                ).toFixed(1),
              )
            : 0;
        const accuracyPercentage =
          attempted > 0
            ? Number(
                (
                  (summary.correctQuestions / attempted) *
                  100
                ).toFixed(1),
              )
            : 0;
        const wrongCount = Math.max(
          summary.submissionAttempts - summary.correctQuestions,
          0,
        );
        const notAttempted = Math.max(summary.questionCount - attempted, 0);
        const inProgressQuestions = Math.max(
          attempted - summary.completedQuestions,
          0,
        );
        return {
          subject: summary.subject,
          exerciseId: summary.primaryExerciseId,
          questionCount: summary.questionCount,
          completedQuestions: summary.completedQuestions,
          correctQuestions: summary.correctQuestions,
          completionPercentage,
          accuracyPercentage,
          attemptedQuestions: attempted,
          wrongQuestions: wrongCount,
          notAttemptedQuestions: notAttempted,
          inProgressQuestions,
          latestSubmissionAt: summary.latestSubmissionAt,
        };
      });

      const totalQuestions = subjects.reduce(
        (total, subject) => total + subject.questionCount,
        0,
      );
      const completedQuestions = subjects.reduce(
        (total, subject) => total + subject.completedQuestions,
        0,
      );
      const correctQuestions = subjects.reduce(
        (total, subject) => total + subject.correctQuestions,
        0,
      );
      const attemptedQuestions = subjects.reduce(
        (total, subject) => total + subject.attemptedQuestions,
        0,
      );
      const completionPercentage =
        totalQuestions > 0
          ? Number(((completedQuestions / totalQuestions) * 100).toFixed(1))
          : 0;
      const finalScore =
        totalQuestions > 0
          ? Number(((correctQuestions / totalQuestions) * 100).toFixed(1))
          : 0;
      const lastActivityAt = subjects.reduce(
        (latest, subject) =>
          this.getLatestTimestamp(latest, subject.latestSubmissionAt),
        null as string | null,
      );

      return {
        plan_id: planId,
        plan_name: planLabel,
        stats: {
          totalQuestions,
          completedQuestions,
          correctQuestions,
          attemptedQuestions,
          completionPercentage,
          finalScore,
          lastActivityAt,
        },
        subjects,
      };
    } catch (error) {
      console.error('[getPlanProgress] failed', error);
      throw new BadRequestException(
        `Failed to fetch plan progress: ${error?.message || error}`,
      );
    }
  }

  private formatExerciseSubjectLabel(
    value: string | null | undefined,
    planId: number,
  ): string {
    const raw = value?.toString().trim() || '';
    if (!raw) {
      return `Plan ${planId}`;
    }
    const pattern = new RegExp(`\\s*-\\s*Plan\\s+${planId}\\s*$`, 'i');
    const cleaned = raw.replace(pattern, '').trim();
    return cleaned || raw;
  }

  private collectPlanSubjectNames(plan: any): string[] {
    const subjects = new Set<string>();
    const addSubject = (value?: string) => {
      const normalized = this.normalizePlanSubjectName(value);
      const lower = normalized.toLowerCase();
      if (!normalized || lower === 'domain knowledge') {
        return;
      }
      if (normalized) {
        subjects.add(normalized);
      }
    };

    const covered = plan?.plan_content?.subjects_covered;
    if (Array.isArray(covered)) {
      covered.forEach((subject) => addSubject(subject));
    }

    const prep = (plan?.plan_content?.subject_prep || {}) as Record<
      string,
      any
    >;
    Object.entries(prep).forEach(([key, value]) => {
      const entry = value as Record<string, any>;
      const subjectValue =
        typeof entry?.subject === 'string' ? entry.subject : key;
      addSubject(subjectValue);
    });

    const result = Array.from(subjects);
    return result.length > 0 ? result : ['General'];
  }

  private normalizePlanSubjectName(value?: string): string {
    return value?.toString().trim() || '';
  }

  private getLatestTimestamp(
    current: string | null | undefined,
    candidate: string | null | undefined,
  ): string | null {
    if (!current) {
      return candidate ?? null;
    }
    if (!candidate) {
      return current;
    }
    const currentTime = Date.parse(current);
    const candidateTime = Date.parse(candidate);
    if (Number.isNaN(candidateTime)) {
      return current;
    }
    if (Number.isNaN(currentTime)) {
      return candidate;
    }
    return candidateTime > currentTime ? candidate : current;
  }

  async getLatestPlan(userId: string, profileId?: number) {
    try {
      let query = this.supabase
        .from('interview_prep_plans')
        .select(
          '*, job_description:interview_job_descriptions(company_name, role_title, industry)',
        )
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1);

      if (profileId) {
        query = query.eq('profile_id', profileId);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data?.[0] || null;
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch latest plan: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async getAllUserJDs(userId: string) {
    try {
      const { data, error } = await this.supabase
        .from('interview_job_descriptions')
        .select()
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    } catch (error) {
      throw new BadRequestException(`Failed to fetch JDs: ${(error instanceof Error ? error.message : String(error))}`);
    }
  }

  async extractJDInfo(
    dto: ExtractJDDto,
    userId?: string,
  ): Promise<ExtractJDResponse> {
    const startedAt = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const requestBody = {
        job_description: dto.job_description,
        company_name: dto.company_name,
        role: dto.role,
        user_skills: dto.user_skills,
        industry: dto.industry,
      };
      console.log(
        `[extractJDInfo] Calling ${this.aiServiceUrl}/interview/extract-jd`,
      );

      const response = await fetch(
        `${this.aiServiceUrl}/interview/extract-jd`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);
      const responseText = await response.text();

      if (!response.ok) {
        console.error(
          `[extractJDInfo] Error response: ${response.status}`,
          responseText,
        );
        throw new Error(
          `AI service returned ${response.status}: ${responseText}`,
        );
      }

      try {
        const parsedResponse = JSON.parse(responseText) as ExtractJDResponse;
        await this.persistJDMetadataOnExtraction(dto, userId, parsedResponse);
        this.logTiming('interview.extract-jd.total', startedAt);
        return parsedResponse;
      } catch (parseError) {
        throw new Error(
          `AI service returned invalid JSON: ${responseText || 'empty body'}`,
        );
      }
    } catch (error) {
      console.error('[extractJDInfo] Error:', error);
      throw new BadRequestException(
        `Failed to extract JD info: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async persistJDMetadataOnExtraction(
    dto: ExtractJDDto,
    userId: string | undefined,
    extracted: ExtractJDResponse,
  ): Promise<void> {
    if (!dto.jd_id) return;

    const updates: Record<string, unknown> = {};
    if (dto.company_name?.trim()) {
      updates.company_name = dto.company_name.trim();
    }
    if (extracted.role_title) {
      updates.role_title = extracted.role_title;
    }
    const industryValue =
      dto.industry ||
      extracted.industry ||
      (Array.isArray(extracted.domains) && extracted.domains[0]);
    if (industryValue) {
      updates.industry = industryValue;
    }

    if (!Object.keys(updates).length) {
      return;
    }

    updates.updated_at = new Date().toISOString();

    let query = this.supabase
      .from('interview_job_descriptions')
      .update(updates)
      .eq('id', dto.jd_id);
    if (userId) {
      query = query.eq('user_id', userId);
    }

    const { error } = await query;
    if (error) {
      console.error(
        '[persistJDMetadataOnExtraction] Failed to update JD metadata:',
        error,
      );
    }
  }

  async generateDomainKPI(dto: DomainKPIDto): Promise<DomainKPIResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const requestBody = {
        company_name: dto.company_name,
        job_description: dto.job_description,
        domain: dto.domain,
        role_title: dto.role_title,
        business_function: dto.business_function,
      };
      console.log(
        `[generateDomainKPI] Calling ${this.aiServiceUrl}/interview/domain-kpi`,
      );

      const response = await fetch(
        `${this.aiServiceUrl}/interview/domain-kpi`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
      );

      clearTimeout(timeoutId);
      const responseText = await response.text();

      if (!response.ok) {
        console.error(
          `[generateDomainKPI] Error response: ${response.status}`,
          responseText,
        );
        throw new Error(
          `AI service returned ${response.status}: ${responseText}`,
        );
      }

      try {
        return JSON.parse(responseText) as DomainKPIResponse;
      } catch (parseError) {
        throw new Error(
          `AI service returned invalid JSON: ${responseText || 'empty body'}`,
        );
      }
    } catch (error) {
      console.error('[generateDomainKPI] Error:', error);
      throw new BadRequestException(
        `Failed to generate domain KPI: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async generatePracticeExercises(
    userId: string,
    dto: GeneratePracticeExercisesDto,
  ): Promise<PracticeExerciseResponse[]> {
    try {
      const {
        profile_id,
        jd_id,
        subjects,
        subject: singleSubject,
        domain,
        learner_level,
        topic,
        topic_hierarchy,
        future_topics,
        question_count,
        batch_size,
        exercise_id,
        plan_id,
      } = dto;

      // Verify profile exists and belongs to user
      const { data: profileData, error: profileError } = await this.supabase
        .from('interview_profiles')
        .select()
        .eq('id', profile_id)
        .eq('user_id', userId)
        .single();

      if (profileError || !profileData) {
        throw new NotFoundException('Profile not found');
      }

      // Get JD
      const jdData = await this.getJobDescription(jd_id, userId);

      // Generate practice exercises for each subject
      const exercisesResults: PracticeExerciseResponse[] = [];
      const accumulatedPlanSubjectData: Record<
        string,
        Record<string, unknown>
      > = {};

      const subjectsToGenerate =
        subjects && subjects.length > 0
          ? subjects
          : singleSubject
            ? [singleSubject]
            : [];

      if (subjectsToGenerate.length === 0) {
        throw new BadRequestException('At least one subject is required');
      }

      const parsedQuestionCount = Number(question_count);
      const requestedQuestionCount = Number.isFinite(parsedQuestionCount)
        ? Math.max(1, Math.trunc(parsedQuestionCount))
        : 8;
      const parsedBatchSize = Number(batch_size);
      const requestedBatchSize = Number.isFinite(parsedBatchSize)
        ? Math.max(1, Math.trunc(parsedBatchSize))
        : Math.min(5, requestedQuestionCount);
      const resolvedBatchSize = Math.min(
        requestedQuestionCount,
        requestedBatchSize,
      );
      const appendMode = Boolean(exercise_id);

      const overrides: PracticeGenerationOverrides = {
        domain,
        learnerLevel: learner_level,
        topic,
        topicHierarchy: topic_hierarchy,
        futureTopics: future_topics,
        questionCount: resolvedBatchSize,
      };

      for (const subject of subjectsToGenerate) {
        try {
          let previousQuestionsContext: string[] | undefined;
          let existingExerciseId = exercise_id || undefined;
          let effectiveBatchSize = resolvedBatchSize;
          if (appendMode && existingExerciseId) {
            const { data: existingExercise, error: existingExerciseError } =
              await this.supabase
                .from('interview_practice_exercises')
                .select('id')
                .eq('id', existingExerciseId)
                .eq('user_id', userId)
                .maybeSingle();
            if (existingExerciseError) {
              console.error(
                `[generatePracticeExercises] Failed to load existing exercise ${existingExerciseId}:`,
                existingExerciseError,
              );
            }
            if (!existingExercise) {
              existingExerciseId = undefined;
            } else {
              const { data: existingQuestions } = await this.supabase
                .from('interview_practice_questions')
                .select('text, content, question_number')
                .eq('exercise_id', existingExerciseId)
                .order('question_number', { ascending: true });
              previousQuestionsContext = (existingQuestions || [])
                .map((row: any) => {
                  const content = row?.content;
                  const questionText =
                    (typeof row?.text === 'string' && row.text.trim()) ||
                    (typeof content?.question === 'string' && content.question.trim()) ||
                    '';
                  return questionText;
                })
                .filter((value: string) => value.length > 0);
              const existingQuestionCount = (existingQuestions || []).length;
              const remainingQuestionCount = Math.max(
                0,
                requestedQuestionCount - existingQuestionCount,
              );
              if (remainingQuestionCount === 0) {
                continue;
              }
              effectiveBatchSize = Math.min(
                resolvedBatchSize,
                remainingQuestionCount,
              );
            }
          }

          const exerciseData = await this.generateSingleSubjectExercise(
            subject,
            profileData,
            jdData,
            {
              ...overrides,
              questionCount: effectiveBatchSize,
              previousQuestionsContext,
            },
          );

          if (appendMode && existingExerciseId) {
            let currentQuestionNumber = 1;
            const { data: existingQuestionRows } = await this.supabase
              .from('interview_practice_questions')
              .select('question_number')
              .eq('exercise_id', existingExerciseId)
              .order('question_number', { ascending: false })
              .limit(1);
            const existingQuestionNumber = Number(
              existingQuestionRows?.[0]?.question_number,
            );
            if (Number.isFinite(existingQuestionNumber) && existingQuestionNumber > 0) {
              currentQuestionNumber = existingQuestionNumber + 1;
            }

            const appendResult: MigrationResult = {
              plan_id: plan_id || 0,
              exercises_created: 0,
              questions_created: 0,
              datasets_created: 0,
              answers_created: 0,
              errors: [],
              warnings: [],
            };

            const normalizedQuestions = Array.isArray(exerciseData.questions)
              ? exerciseData.questions
              : [];
            for (let i = 0; i < normalizedQuestions.length; i += 1) {
              const question = normalizedQuestions[i];
              await this.processQuestion(
                existingExerciseId,
                null,
                {
                  question:
                    question.text || question.question || question.business_question,
                  expected_approach: question.hint || question.adaptive_note,
                  sample_output:
                    question.expected_answer || question.answer || '',
                  difficulty: question.difficulty,
                  topics: question.topics,
                  answer: question.answer || question.expected_answer || '',
                  business_context:
                    question.business_context || exerciseData.dataset_description,
                  case_study_context: question.case_study_context,
                  expected_output_table: question.expected_output_table,
                },
                subject,
                currentQuestionNumber + i,
                appendResult,
                {
                  business_context:
                    exerciseData.dataset_description ||
                    exerciseData.business_context ||
                    profileData.company_name ||
                    subject,
                  case_studies: [],
                  dataset_description: exerciseData.dataset_description,
                },
              );
            }

            exercisesResults.push({
              id: existingExerciseId,
              profile_id,
              jd_id,
              subject,
              questions: normalizedQuestions,
              dataset_description: exerciseData.dataset_description,
              data_creation_sql: exerciseData.data_creation_sql,
              data_creation_python: exerciseData.data_creation_python,
              dataset_csv: exerciseData.dataset_csv_raw,
              created_at: new Date().toISOString(),
            });
            continue;
          }

          // Store in database
          const exercisePayload = {
            id: uuidv4(),
            user_id: userId,
            profile_id,
            jd_id,
            subject,
            exercise_content: {
              ...exerciseData,
              question_count: requestedQuestionCount,
              generated_question_count: (exerciseData.questions || []).length,
            },
            created_at: new Date().toISOString(),
          };
          const { data: storedExercise, error: storeError } =
            await this.supabase
              .from('interview_practice_exercises')
              .insert(exercisePayload)
              .select();

          if (storeError) {
            console.error(
              `Failed to store exercise for ${subject}:`,
              storeError,
            );
            continue;
          }

          exercisesResults.push({
            id: storedExercise?.[0]?.id,
            profile_id,
            jd_id,
            subject,
            questions: exerciseData.questions || [],
            dataset_description: exerciseData.dataset_description,
            data_creation_sql: exerciseData.data_creation_sql,
            data_creation_python: exerciseData.data_creation_python,
            dataset_csv: exerciseData.dataset_csv_raw,
            created_at: storedExercise?.[0]?.created_at,
          });
          if (plan_id) {
            const planData =
              exerciseData.plan_subject_data &&
              typeof exerciseData.plan_subject_data === 'object'
                ? { ...exerciseData.plan_subject_data }
                : {};
            planData.subject = subject;
            planData.question_count = requestedQuestionCount;
            planData.question_count_per_subject = requestedQuestionCount;
            planData.requested_question_count = requestedQuestionCount;
            planData.generated_question_count = (exerciseData.questions || []).length;
            planData.generation_status = 'ready';
            planData.generation_mode = 'on_demand';
            planData.generation_error = null;
            planData.generation_updated_at = new Date().toISOString();
            accumulatedPlanSubjectData[subject] = planData;
          }
        } catch (error) {
          console.error(`Error generating exercise for ${subject}:`, error);
          if (plan_id) {
            await this.setPlanSubjectPrepStatus(
              userId,
              plan_id,
              subject,
              'failed',
              {
                generation_mode: 'on_demand',
                generation_error:
                  error instanceof Error ? (error instanceof Error ? error.message : String(error)) : String(error),
              },
            );
          }
        }
      }

      if (
        plan_id &&
        Object.keys(accumulatedPlanSubjectData).length > 0 &&
        !appendMode
      ) {
        try {
          await this.upsertPlanSubjectPrep(
            userId,
            plan_id,
            accumulatedPlanSubjectData,
          );
          try {
            await this.migratePlanDataToTables(userId, {
              plan_id,
              overwrite_existing: false,
            });
          } catch (migrationError) {
            console.error(
              `[generatePracticeExercises] Migration failed for plan ${plan_id}:`,
              migrationError,
            );
          }
        } catch (error) {
          console.error(
            `[generatePracticeExercises] Failed to append subject prep to plan ${plan_id}:`,
            error,
          );
        }
      }

      return exercisesResults;
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate practice exercises: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  async regeneratePlanSubjectExercises(
    userId: string,
    planId: number,
    subject: string,
  ): Promise<PracticeExerciseResponse[]> {
    try {
      await this.setPlanSubjectPrepStatus(
        userId,
        planId,
        subject,
        'in_progress',
        {
          generation_mode: 'on_demand',
          generation_error: null,
        },
      );

      const { data: plan, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .select('profile_id, jd_id, plan_content')
        .eq('id', planId)
        .eq('user_id', userId)
        .single();

      if (planError || !plan) {
        throw new NotFoundException('Plan not found');
      }

      const profileId = Number(plan.profile_id);
      const jdId = Number(plan.jd_id);
      const planContent = (plan.plan_content || {}) as Record<string, unknown>;
      const planQuestionCountRaw =
        planContent.question_count_per_subject ??
        planContent.question_count ??
        8;
      const parsedPlanQuestionCount = Number(planQuestionCountRaw);
      const resolvedPlanQuestionCount = Number.isFinite(parsedPlanQuestionCount)
        ? Math.max(1, Math.trunc(parsedPlanQuestionCount))
        : 8;
      if (Number.isNaN(profileId) || Number.isNaN(jdId)) {
        throw new BadRequestException('Plan is missing profile or JD references');
      }

      return this.generatePracticeExercises(userId, {
        profile_id: profileId,
        jd_id: jdId,
        subject,
        subjects: [subject],
        plan_id: planId,
        question_count: resolvedPlanQuestionCount,
      });
    } catch (error) {
      throw new BadRequestException(
        `Failed to regenerate subject ${subject}: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private async upsertPlanSubjectPrep(
    userId: string,
    planId: number,
    subjects: Record<string, Record<string, unknown>>,
  ): Promise<void> {
    if (!planId) {
      return;
    }
    try {
      const { data: plan, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .select('plan_content, domain_knowledge_text')
        .eq('id', planId)
        .eq('user_id', userId)
        .maybeSingle();

      if (planError) {
        console.error(
          `[upsertPlanSubjectPrep] Failed to load plan ${planId}:`,
          planError,
        );
        return;
      }

      if (!plan) {
        console.warn(
          `[upsertPlanSubjectPrep] Plan ${planId} not found for user ${userId}`,
        );
        return;
      }

      const existingPlanContent = plan.plan_content || {};
      const existingSubjectPrep =
        (existingPlanContent.subject_prep as Record<
          string,
          Record<string, unknown>
        >) || {};
      const nextSubjectPrep = { ...existingSubjectPrep };
      let updatedDomainKnowledgeText: string | null | undefined =
        plan.domain_knowledge_text;

      for (const [subject, subjectData] of Object.entries(subjects)) {
        nextSubjectPrep[subject] = {
          ...(nextSubjectPrep[subject] || {}),
          ...subjectData,
        };
        const domainText =
          subjectData['domain_knowledge_text'] ||
          subjectData['business_context'];
        if (
          subject.toLowerCase().includes('domain knowledge') &&
          typeof domainText === 'string'
        ) {
          updatedDomainKnowledgeText = domainText;
        }
      }

      const subjectsCovered = Array.from(
        new Set([
          ...(existingPlanContent.subjects_covered || []),
          ...Object.keys(nextSubjectPrep),
        ]),
      );

      const { error: updateError } = await this.supabase
        .from('interview_prep_plans')
        .update({
          plan_content: {
            ...existingPlanContent,
            subject_prep: nextSubjectPrep,
            subjects_covered: subjectsCovered,
          },
          ...(updatedDomainKnowledgeText
            ? { domain_knowledge_text: updatedDomainKnowledgeText }
            : {}),
        })
        .eq('id', planId)
        .eq('user_id', userId);

      if (updateError) {
        console.error(
          `[upsertPlanSubjectPrep] Failed to update plan ${planId}:`,
          updateError,
        );
      }
    } catch (error) {
      console.error(
        `[upsertPlanSubjectPrep] Unexpected error updating plan ${planId}:`,
        error,
      );
    }
  }

  private normalizeSubjectLabel(subject: string): string {
    const trimmed = (subject || '').replace(/\s*-\s*Plan\s+\d+$/i, '').trim();
    if (!trimmed) {
      return '';
    }

    const normalized = trimmed.toLowerCase();
    const aliasMap: Record<string, string> = {
      excel: 'Excel',
      'google sheet': 'Excel',
      'google sheets': 'Excel',
      google_sheets: 'Excel',
      sheet: 'Excel',
      sheets: 'Excel',
      'problem solving': 'Problem Solving',
      'art of problem solving': 'Problem Solving',
      aops: 'Problem Solving',
      problem_solving: 'Problem Solving',
      statistics: 'Statistics',
      statistical: 'Statistics',
    };

    return aliasMap[normalized] || trimmed;
  }

  private normalizeSubjectKey(subject: string): string {
    return this.normalizeSubjectLabel(subject).toLowerCase();
  }

  private isProblemSolvingSubject(subject: string): boolean {
    return this.normalizeSubjectKey(subject) === 'problem solving';
  }

  private isDomainKnowledgeSubject(subject: string): boolean {
    return this.normalizeSubjectKey(subject) === 'domain knowledge';
  }

  private isCodingPracticeSubject(subject: string): boolean {
    const normalized = this.normalizeSubjectKey(subject);
    return [
      'sql',
      'python',
      'excel',
      'statistics',
      'power bi',
      'powerbi',
      'google sheets',
      'google_sheets',
      'sheets',
      'sheet',
    ].includes(normalized);
  }

  private resolveCanonicalQuestionAnswer(
    question: any,
    subject: string,
    caseStudy?: any,
  ): string {
    const normalizeText = (value: unknown): string =>
      typeof value === 'string' ? value.trim() : '';

    const candidates = this.isCodingPracticeSubject(subject)
      ? [
          question?.answer_sql,
          question?.answer,
          question?.expected_answer,
          question?.sample_output,
          question?.expected_approach,
          caseStudy?.solution_outline,
        ]
      : [
          question?.expected_approach,
          question?.answer,
          question?.expected_answer,
          question?.sample_output,
          question?.answer_sql,
          caseStudy?.solution_outline,
        ];

    for (const candidate of candidates) {
      const normalized = normalizeText(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private async generateSingleSubjectExercise(
    subject: string,
    profileData: any,
    jdData: any,
    overrides: PracticeGenerationOverrides,
  ): Promise<any> {
    const mappedLanguage = this.mapSubjectToLanguage(subject);
    const datasetLanguage = this.mapSubjectToDatasetLanguage(subject);

    const resolvedDomain =
      overrides.domain?.trim() ||
      profileData.company_name ||
      profileData.industry ||
      'Tech';
    const normalizedTopic = overrides.topic?.trim();
    const normalizedTopicHierarchy = overrides.topicHierarchy?.trim();
    const resolvedTopic = normalizedTopic || subject;
    const resolvedTopicHierarchy = normalizedTopicHierarchy || subject;
    const resolvedFutureTopics =
      overrides.futureTopics && overrides.futureTopics.length > 0
        ? overrides.futureTopics
        : undefined;
    const resolvedQuestionCount =
      typeof overrides.questionCount === 'number' && overrides.questionCount > 0
        ? Math.max(1, Math.trunc(overrides.questionCount))
        : 8;
    const learnerDifficulty = this.resolveLearnerDifficulty(
      overrides.learnerLevel,
      profileData.experience_level,
    );
    if (this.isProblemSolvingSubject(subject)) {
      const controller = new AbortController();
      const timeoutMs = this.getSubjectPrepTimeoutMs(
        subject,
        220000,
        resolvedQuestionCount,
      );
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(
          `${this.aiServiceUrl}/interview/subject-prep`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject,
              job_description: jdData?.job_description,
              experience_level: profileData?.experience_level,
              company_name: profileData?.company_name,
            }),
            signal: controller.signal,
          },
        );
        clearTimeout(timeoutId);
        if (!response.ok) {
          throw new Error(
            `Practice exercise AI returned ${response.status}: ${response.statusText}`,
          );
        }
        const data = await response.json();
        const caseStudies = Array.isArray(data.case_studies)
          ? data.case_studies
          : [];
        const primaryCaseStudy = caseStudies[0] || {};
        const questionsRaw = Array.isArray(primaryCaseStudy.questions)
          ? primaryCaseStudy.questions
          : [];
        return {
          header_text:
            primaryCaseStudy?.title ||
            data?.header_text ||
            `${subject} Case Study`,
          dataset_description:
            primaryCaseStudy?.description || data?.business_context || '',
          questions: questionsRaw.map((question: any, idx: number) => ({
            id: String(question.question_number || idx),
            subject,
            text:
              question.business_question ||
              question.question ||
              question.prompt ||
              `Question ${idx + 1}`,
            difficulty: question.difficulty || 'Medium',
            topics: question.topics || [subject],
            hint: question.expected_approach || question.answer || '',
            expected_answer:
              question.answer ||
              question.expected_answer ||
              question.answer_sql ||
              question.sample_output ||
              question.expected_approach ||
              '',
            adaptive_note: question.adaptive_note || '',
            answer:
              question.answer ||
              question.expected_answer ||
              question.answer_sql ||
              question.sample_output ||
              question.expected_approach ||
              '',
          })),
          data_creation_sql: '',
          data_creation_python: '',
          dataset_csv_raw: '',
          plan_subject_data: {
            subject,
            ...data,
          },
        };
      } catch (error) {
        clearTimeout(timeoutId);
        throw error;
      }
    }
    const payload = {
      field: 'Data Analytics',
      domain: resolvedDomain,
      subject,
      topic: resolvedTopic,
      topic_hierarchy: resolvedTopicHierarchy,
      future_topics: resolvedFutureTopics,
      learner_level: this.mapDifficultyToLevel(learnerDifficulty),
      coding_language: mappedLanguage,
      solution_coding_language: mappedLanguage,
      dataset_creation_coding_language: datasetLanguage,
      total_questions: resolvedQuestionCount,
      verify_locally: false,
      previous_questions_context: overrides.previousQuestionsContext || [],
    };

    const timeoutMs = this.getSubjectPrepTimeoutMs(
      subject,
      220000,
      resolvedQuestionCount,
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const aiServiceHost =
        process.env.AI_SERVICE_URL ||
        process.env.BASE_AI_API_URL ||
        process.env.NEXT_PUBLIC_AI_SERVICE_URL ||
        'http://localhost:8000';
      const practiceApiUrl = `${aiServiceHost.replace(/\/$/, '')}/generate`;

      const response = await fetch(practiceApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `Practice exercise API returned ${response.status}: ${response.statusText}`,
        );
      }

      const data = await response.json();

      const planSubjectData = {
        ...data,
        subject,
        question_count: resolvedQuestionCount,
      };

      return {
        header_text: data.header_text || `${subject} Practice Exercises`,
        dataset_description: data.dataset_description || '',
        questions: (data.questions_raw || []).map((q: any, idx: number) => ({
          id: String(q.id || idx),
          subject,
          text: q.business_question || q.text,
          difficulty: q.difficulty || 'Intermediate',
          topics: q.topics || [subject],
          hint: q.adaptive_note || '',
          expected_answer:
            data.answers_sql_map?.[q.id] ||
            q.answer ||
            q.answer_sql ||
            q.expected_answer ||
            q.sample_output ||
            q.expected_approach ||
            '',
          adaptive_note: q.adaptive_note || '',
          answer:
            data.answers_sql_map?.[q.id] ||
            q.answer ||
            q.answer_sql ||
            q.expected_answer ||
            q.sample_output ||
            q.expected_approach ||
            '',
        })),
        data_creation_sql: data.data_creation_sql || '',
        data_creation_python: data.data_creation_python || '',
        dataset_csv_raw: data.dataset_csv_raw || '',
        plan_subject_data: planSubjectData,
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private mapSubjectToLanguage(subject: string): string {
    const normalizedSubject = this.normalizeSubjectLabel(subject);
    const mapping: Record<string, string> = {
      SQL: 'SQL',
      Python: 'Python',
      'Power BI': 'power_bi',
      Excel: 'Excel',
      Statistics: 'Python',
      Communication: 'English',
      'Case Studies': 'SQL',
      'Domain Knowledge': 'English',
    };
    return mapping[normalizedSubject] || 'SQL';
  }

  private mapSubjectToDatasetLanguage(subject: string): string {
    const normalizedSubject = this.normalizeSubjectLabel(subject);
    const mapping: Record<string, string> = {
      SQL: 'SQL',
      Python: 'Python',
      'Power BI': 'SQL',
      Excel: 'CSV',
      Statistics: 'Python',
      Communication: 'Text',
      'Case Studies': 'SQL',
      'Domain Knowledge': 'Text',
    };
    return mapping[normalizedSubject] || 'SQL';
  }

  private resolveSolutionCodingLanguage(
    subject: string,
    fallback?: string,
  ): string {
    const normalized = this.normalizeSubjectKey(subject);
    if (
      normalized === 'google_sheets' ||
      normalized === 'google sheet' ||
      normalized === 'google sheets' ||
      normalized === 'sheets' ||
      normalized === 'sheet' ||
      normalized === 'excel' ||
      normalized === 'statistics' ||
      normalized === 'statistic'
    ) {
      return 'excel formula';
    }
    if (normalized === 'python') {
      return 'python';
    }
    if (normalized === 'power bi' || normalized === 'power_bi' || normalized === 'powerbi') {
      return 'power_bi';
    }
    if (normalized === 'sql') {
      return 'sql';
    }
    return fallback?.trim() || this.mapSubjectToLanguage(subject) || 'SQL';
  }

  private resolveLearnerDifficulty(
    overridesLevel?: 'Beginner' | 'Intermediate' | 'Advanced',
    experience?: string,
  ): 'Beginner' | 'Intermediate' | 'Advanced' {
    if (overridesLevel) return overridesLevel;
    if (!experience) return 'Intermediate';
    const lower = experience.toLowerCase();
    if (lower.includes('entry') || lower.includes('junior')) {
      return 'Beginner';
    }
    if (lower.includes('senior') || lower.includes('lead')) {
      return 'Advanced';
    }
    return 'Intermediate';
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

  private mapExperienceToLevel(experience: string): string {
    if (!experience) return 'intermediate';
    const lower = experience.toLowerCase();
    if (lower.includes('entry') || lower.includes('junior')) return 'beginner';
    if (lower.includes('senior') || lower.includes('lead')) return 'advanced';
    return 'intermediate';
  }

  async migratePlanDataToTables(
    userId: string,
    dto: MigratePlanDataDto,
  ): Promise<MigratePlanDataResponse> {
    const result: MigrationResult = {
      plan_id: dto.plan_id,
      exercises_created: 0,
      questions_created: 0,
      datasets_created: 0,
      answers_created: 0,
      errors: [],
      warnings: [],
    };

    try {
      // Get the plan data
      const { data: plan, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .select('*')
        .eq('id', dto.plan_id)
        .eq('user_id', userId)
        .single();

      if (planError || !plan) {
        throw new NotFoundException(`Plan ${dto.plan_id} not found`);
      }

      const planContent = plan.plan_content;
      if (!planContent || !planContent.subject_prep) {
        throw new BadRequestException('Plan content or subject_prep not found');
      }

      console.log(
        `[migratePlanDataToTables] Starting migration for plan ${dto.plan_id}`,
      );

      // Process each subject in the plan
      for (const [subject, subjectData] of Object.entries(
        planContent.subject_prep,
      )) {
        if (this.normalizeSubjectKey(subject) === 'domain knowledge') {
          continue;
        }
        try {
          await this.processSubjectData(
            userId,
            dto.plan_id,
            plan.profile_id,
            plan.jd_id,
            subject,
            subjectData as any,
            result,
            dto.overwrite_existing ?? false,
          );
        } catch (error) {
          const errorMsg = `Failed to process subject ${subject}: ${(error instanceof Error ? error.message : String(error))}`;
          result.errors.push(errorMsg);
          console.error(errorMsg);
        }
      }

      console.log(
        `[migratePlanDataToTables] Migration completed. Exercises: ${result.exercises_created}, Questions: ${result.questions_created}, Datasets: ${result.datasets_created}, Answers: ${result.answers_created}`,
      );

      return {
        success: result.errors.length === 0,
        message:
          result.errors.length === 0
            ? 'Migration completed successfully'
            : `Migration completed with ${result.errors.length} errors`,
        result,
      };
    } catch (error) {
      return {
        success: false,
        message: `Migration failed: ${(error instanceof Error ? error.message : String(error))}`,
        result,
      };
    }
  }

  private async processSubjectData(
    userId: string,
    planId: number,
    profileId: number,
    jdId: number,
    subject: string,
    subjectData: any,
    result: MigrationResult,
    overwriteExisting: boolean,
  ): Promise<void> {
    const subjectCaseStudies =
      Array.isArray(subjectData.case_studies) &&
      subjectData.case_studies.length > 0
        ? subjectData.case_studies
        : this.buildCaseStudiesFromSubject(subject, subjectData);

    if (!subjectCaseStudies.length) {
      result.warnings.push(`No case studies found for subject: ${subject}`);
      return;
    }

    // Check if exercise already exists for this plan and subject
    const existingExerciseQuery = await this.supabase
      .from('interview_practice_exercises')
      .select('id')
      .eq('name', `${subject} - Plan ${planId}`)
      .single();

    let exerciseId: string;

    if (existingExerciseQuery.data && !overwriteExisting) {
      exerciseId = existingExerciseQuery.data.id;
      result.warnings.push(
        `Exercise already exists for ${subject}, skipping creation`,
      );
      return;
    } else if (existingExerciseQuery.data && overwriteExisting) {
      // Delete existing related data if overwriting
      await this.deleteExerciseRelatedData(
        existingExerciseQuery.data.id,
        result,
      );
    }

    // Create exercise
    const exerciseData = {
      id: uuidv4(),
      name: `${subject} - Plan ${planId}`,
      description: `Practice exercises for ${subject} from interview plan ${planId}`,
      created_at: new Date().toISOString(),
    };

    const { data: exercise, error: exerciseError } = await this.supabase
      .from('interview_practice_exercises')
      .insert(exerciseData)
      .select()
      .single();

    if (exerciseError || !exercise) {
      throw new Error(`Failed to create exercise: ${exerciseError?.message}`);
    }

    exerciseId = exercise.id;
    result.exercises_created++;

    let questionNumber = 1;

    // Process each case study
    for (const caseStudy of subjectCaseStudies) {
      await this.processCaseStudy(
        exerciseId,
        caseStudy,
        subject,
        questionNumber,
        result,
        subjectData,
      );

      // Update question number based on number of questions in this case study
      questionNumber += (caseStudy.questions || []).length;
    }
  }

  private async processCaseStudy(
    exerciseId: string,
    caseStudy: any,
    subject: string,
    startQuestionNumber: number,
    result: MigrationResult,
    subjectData: any,
  ): Promise<void> {
    // Create dataset(s) defined in the case study
    let datasetId: string | null = null;

    if (
      caseStudy.dataset_schema ||
      caseStudy.sample_data ||
      caseStudy.dataset_creation_sql
    ) {
      const datasetDefs = this.buildDatasetsFromSqlCreation({
        name: caseStudy.title || `Dataset for ${subject}`,
        description:
          caseStudy.dataset_overview ||
          caseStudy.description ||
          subjectData?.dataset_description,
        table_name: this.generateTableName(caseStudy.title, subject),
        columns: this.extractColumnsFromSchema(caseStudy.dataset_schema),
        schema_info: caseStudy.dataset_schema
          ? { schema: caseStudy.dataset_schema }
          : null,
        creation_sql:
          typeof caseStudy.dataset_schema === 'string' &&
          caseStudy.dataset_schema.trim()
            ? caseStudy.dataset_schema
            : caseStudy.dataset_creation_sql,
        creation_python:
          caseStudy.data_creation_python || caseStudy.sample_data,
        csv_data: caseStudy.sample_data,
        record_count: caseStudy.dataset_rows?.length,
      });
      for (const datasetDef of datasetDefs) {
        const createdDatasetId = await this.createDatasetRecord(
          exerciseId,
          subject,
          datasetDef,
          result,
        );
        if (createdDatasetId && !datasetId) {
          datasetId = createdDatasetId;
        }
      }
    }

    if (Array.isArray(caseStudy.datasets)) {
      for (const datasetDef of caseStudy.datasets) {
        const datasetDefs = this.buildDatasetsFromSqlCreation(datasetDef);
        for (const expandedDatasetDef of datasetDefs) {
          const createdId = await this.createDatasetRecord(
            exerciseId,
            subject,
            expandedDatasetDef,
            result,
          );
          if (createdId) {
            if (!datasetId) {
              datasetId = createdId;
            }
          }
        }
      }
    }

    // Process questions
    const questionsList =
      Array.isArray(caseStudy.questions) && caseStudy.questions.length > 0
        ? caseStudy.questions
        : [];

    if (
      subject.toLowerCase() === 'problem solving' &&
      questionsList.length === 0 &&
      caseStudy.problem_statement
    ) {
      questionsList.push({
        business_question: caseStudy.problem_statement,
        question: caseStudy.problem_statement,
        expected_approach: caseStudy.solution_outline || '',
        difficulty: 'Medium',
        topics: ['Problem Solving'],
      });
    }

    if (questionsList.length > 0) {
      for (let i = 0; i < questionsList.length; i++) {
        const question = questionsList[i];
        await this.processQuestion(
          exerciseId,
          datasetId,
          question,
          subject,
          startQuestionNumber + i,
          result,
          subjectData,
          caseStudy,
        );
      }
    }
  }

  private async processQuestion(
    exerciseId: string,
    datasetId: string | null,
    question: any,
    subject: string,
    questionNumber: number,
    result: MigrationResult,
    subjectData: any,
    caseStudy?: any,
  ): Promise<void> {
    // Create question
    const resolvedAnswerText = this.resolveCanonicalQuestionAnswer(
      question,
      subject,
      caseStudy,
    );

    if (!resolvedAnswerText) {
      result.errors.push(
        `Missing answer for question ${questionNumber} (${subject})`,
      );
      return;
    }

    const questionBusinessContext =
      question.business_context ||
      question.business_question ||
      subjectData?.business_context ||
      subjectData?.case_studies?.[0]?.business_context ||
      null;
    const questionDatasetContext =
      question.dataset_context ||
      question.case_study_context ||
      subjectData?.dataset_description ||
      null;
    const questionDatasetDescription =
      question.dataset_description ||
      subjectData?.dataset_description ||
      subjectData?.dataset_overview ||
      null;

    const caseStudyMeta = caseStudy ?? {};
    const contentTitle =
      question.title ??
      question.case_study_title ??
      caseStudyMeta.title ??
      null;
    const contentProblemStatement =
      question.problem_statement ??
      question.case_study_problem_statement ??
      caseStudyMeta.problem_statement ??
      question.question ??
      null;
    const contentDescription =
      question.description ??
      question.case_study_description ??
      caseStudyMeta.description ??
      null;

    const questionData = {
      id: uuidv4(),
      exercise_id: exerciseId,
      question_number: questionNumber,
      text: question.question,
      type: this.getQuestionTypeFromSubject(subject),
      language: this.getLanguageFromSubject(subject),
      difficulty: this.normalizeDifficultyValue(question.difficulty),
      topics: this.resolveQuestionTopics(question, subject),
      points: 10,
      content: {
        question: question.question,
        hint: question.expected_approach,
        sample_input: question.sample_input,
        sample_output: question.sample_output,
        answer: resolvedAnswerText,
        business_context: questionBusinessContext,
        dataset_context: questionDatasetContext,
        dataset_description: questionDatasetDescription,
        title: contentTitle,
        problem_statement: contentProblemStatement,
        description: contentDescription,
        case_study_title:
          question.case_study_title ?? caseStudyMeta.title ?? null,
        case_study_description:
          question.case_study_description ?? caseStudyMeta.description ?? null,
        case_study_problem_statement:
          question.case_study_problem_statement ??
          caseStudyMeta.problem_statement ??
          null,
        },
      expected_output_table: question.expected_output_table
        ? question.expected_output_table
        : question.sample_output
          ? [question.sample_output]
          : null,
      created_at: new Date().toISOString(),
    };

    const { data: questionRecord, error: questionError } = await this.supabase
      .from('interview_practice_questions')
      .insert(questionData)
      .select()
      .single();

    if (questionError) {
      result.errors.push(`Failed to create question: ${questionError.message}`);
      return;
    }

    if (!questionRecord) {
      result.errors.push('Failed to create question: No data returned');
      return;
    }

    result.questions_created++;

    const answerData = {
      id: uuidv4(),
      question_id: questionRecord.id,
      answer_text: resolvedAnswerText,
      is_case_sensitive: false,
      explanation: question.expected_approach || resolvedAnswerText,
    };

    const { error: answerError } = await this.supabase
      .from('interview_practice_answers')
      .insert(answerData);

    if (answerError) {
      result.errors.push(`Failed to create answer: ${answerError.message}`);
    } else {
      result.answers_created++;
    }
  }

  private resolveQuestionTopics(question: any, subject: string): string[] {
    const candidates = [
      question?.topics,
      question?.topic,
      question?.topic_hierarchy,
    ];

    for (const value of candidates) {
      const normalized = this.normalizeTopics(value);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    if (subject) {
      return [subject];
    }

    return [];
  }

  private normalizeTopics(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value
        .map((item) => (item ?? '').toString().trim())
        .filter((item) => item.length > 0);
    }

    if (typeof value === 'string') {
      const splitTopics = value
        .split(/[,;/\n]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      if (splitTopics.length > 0) {
        return splitTopics;
      }

      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return [trimmed];
      }
    }

    return [];
  }

  private async deleteExerciseRelatedData(
    exerciseId: string,
    result: MigrationResult,
  ): Promise<void> {
    try {
      // Get questions for this exercise
      const { data: questions } = await this.supabase
        .from('interview_practice_questions')
        .select('id')
        .eq('exercise_id', exerciseId);

      if (questions && questions.length > 0) {
        const questionIds = questions.map((q) => q.id);

        // Delete answers for these questions
        const { error: answerError } = await this.supabase
          .from('interview_practice_answers')
          .delete()
          .in('question_id', questionIds as string[]);

        if (answerError) {
          result.errors.push(
            `Failed to delete existing answers: ${answerError.message}`,
          );
        }

        // Delete questions
        const { error: questionError } = await this.supabase
          .from('interview_practice_questions')
          .delete()
          .eq('exercise_id', exerciseId);

        if (questionError) {
          result.errors.push(
            `Failed to delete existing questions: ${questionError.message}`,
          );
        }
      }

      // Delete datasets for this exercise
      const { error: datasetError } = await this.supabase
        .from('interview_practice_datasets')
        .delete()
        .eq('exercise_id', exerciseId);

      if (datasetError) {
        result.errors.push(
          `Failed to delete existing datasets: ${datasetError.message}`,
        );
      }

      // Delete the exercise
      const { error: exerciseError } = await this.supabase
        .from('interview_practice_exercises')
        .delete()
        .eq('id', exerciseId);

      if (exerciseError) {
        result.errors.push(
          `Failed to delete existing exercise: ${exerciseError.message}`,
        );
      }
    } catch (error) {
      result.errors.push(
        `Error deleting existing exercise data: ${(error instanceof Error ? error.message : String(error))}`,
      );
    }
  }

  private generateTableName(title: string, subject: string): string {
    if (!title) return `${subject.toLowerCase()}_data`;

    // Clean up the title to make it a valid table name
    const cleanTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 50);

    return cleanTitle || `${subject.toLowerCase()}_data`;
  }

  private extractColumnsFromSchema(schema: any): string[] {
    if (!schema) return [];

    if (typeof schema === 'string') {
      // Try to extract column names from SQL CREATE TABLE statement
      const createTableMatch = schema.match(
        /CREATE\s+TABLE\s+\w+\s*\(([\s\S]*?)\);?\s*$/i,
      );
      if (createTableMatch) {
        const columnDefs = createTableMatch[1];
        const lines = columnDefs.split(',').map((line) => line.trim());
        return lines
          .filter(
            (line) =>
              line &&
              !line.toUpperCase().includes('PRIMARY KEY') &&
              !line.toUpperCase().includes('FOREIGN KEY') &&
              !line.toUpperCase().includes('CONSTRAINT'),
          )
          .map((line) => {
            // Extract column name and data type, then return just the name
            const match = line.match(/^(\w+)\s+(?:\w+\s*(?:\([^)]*\))?)/);
            return match ? match[1].replace(/['"`]/g, '') : '';
          })
          .filter((col) => col && col.length > 0);
      }
    } else if (Array.isArray(schema)) {
      return schema;
    } else if (typeof schema === 'object') {
      return Object.keys(schema);
    }

    return [];
  }

  private splitSqlValuesTuple(tuple: string): string[] {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < tuple.length; i += 1) {
      const char = tuple[i];
      const nextChar = tuple[i + 1];

      if (char === "'") {
        current += char;
        if (inQuotes && nextChar === "'") {
          current += nextChar;
          i += 1;
          continue;
        }
        inQuotes = !inQuotes;
        continue;
      }

      if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
        continue;
      }

      current += char;
    }

    if (current.trim().length > 0) {
      values.push(current.trim());
    }

    return values;
  }

  private normalizeSqlLiteral(value: string): string {
    const trimmed = value.trim();
    if (!trimmed || /^null$/i.test(trimmed)) {
      return '';
    }

    if (
      trimmed.length >= 2 &&
      trimmed.startsWith("'") &&
      trimmed.endsWith("'")
    ) {
      return trimmed.slice(1, -1).replace(/''/g, "'");
    }

    return trimmed;
  }

  private buildCsvFromSqlRows(columns: string[], rows: string[][]): string {
    if (columns.length === 0 || rows.length === 0) {
      return '';
    }

    const escapeCell = (value: string) => {
      if (/[",\n]/.test(value)) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const csvRows = [
      columns.map((column) => escapeCell(column)).join(','),
      ...rows.map((row) =>
        columns
          .map((_, idx) => escapeCell(this.normalizeSqlLiteral(row[idx] ?? '')))
          .join(','),
      ),
    ];

    return csvRows.join('\n');
  }

  private buildDatasetsFromSqlCreation(
    datasetInput: {
      name?: string;
      description?: string;
      table_name?: string;
      columns?: string[];
      schema_info?: any;
      creation_sql?: string;
      creation_python?: string;
      csv_data?: string;
      record_count?: number;
      subject_type?: string;
      sample_data?: string;
    },
  ) {
    const creationSql = datasetInput.creation_sql || datasetInput.sample_data || '';
    if (typeof creationSql !== 'string' || !/CREATE\s+TABLE/i.test(creationSql)) {
      return [datasetInput];
    }

    const createTableRegex =
      /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([\w$]+)["'`]?\s*\(([\s\S]*?)\);/gim;
    const matches = Array.from(creationSql.matchAll(createTableRegex));

    if (matches.length <= 1) {
      return [datasetInput];
    }

    return matches.map((match) => {
      const tableName = match[1] || datasetInput.table_name || datasetInput.name || 'dataset';
      const schemaSql = match[0] || '';
      const columns = this.extractColumnsFromSchema(schemaSql);
      const insertRegex = new RegExp(
        `INSERT\\s+INTO\\s+["'\`]?${tableName}["'\`]?\\s+VALUES\\s*([\\s\\S]*?);`,
        'im',
      );
      const insertMatch = creationSql.match(insertRegex);
      const tuples = insertMatch?.[1]?.match(/\(([\s\S]*?)\)/g) || [];
      const rows = tuples.map((tuple) =>
        this.splitSqlValuesTuple(tuple.slice(1, -1)),
      );
      const csvData = this.buildCsvFromSqlRows(columns, rows);

      return {
        ...datasetInput,
        name: tableName,
        table_name: tableName,
        columns,
        schema_info: columns.length > 0 ? { columns } : datasetInput.schema_info,
        creation_sql: [schemaSql, insertMatch?.[0] || '']
          .filter((part) => part && part.trim().length > 0)
          .join('\n\n'),
        csv_data: csvData || datasetInput.csv_data,
        record_count: rows.length || datasetInput.record_count,
      };
    });
  }

  private getQuestionTypeFromSubject(subject: string): string {
    const subjectLower = this.normalizeSubjectKey(subject);
    const typeMap: Record<string, string> = {
      sql: 'sql',
      python: 'python',
      javascript: 'javascript',
      'google sheets': 'google_sheets',
      'google sheet': 'google_sheets',
      excel: 'google_sheets',
      statistics: 'statistics',
      'power bi': 'power_bi',
      math: 'math',
      coding: 'coding',
      programming: 'coding',
      reasoning: 'reasoning',
      'problem solving': 'problem_solving',
    };
    return typeMap[subjectLower] || 'coding';
  }

  private getLanguageFromSubject(subject: string): string {
    const subjectLower = this.normalizeSubjectKey(subject);
    const languageMap: Record<string, string> = {
      sql: 'sql',
      python: 'python',
      javascript: 'javascript',
      'google sheets': 'google_sheets',
      excel: 'google_sheets',
      statistics: 'python',
      math: 'text',
      coding: 'python',
      programming: 'python',
    };
    return languageMap[subjectLower] || 'text';
  }

  private normalizeDifficultyValue(
    difficulty?: string | null,
  ): 'beginner' | 'intermediate' | 'advanced' {
    if (!difficulty) return 'intermediate';
    const lower = difficulty.toLowerCase();
    if (lower.includes('easy') || lower.includes('beginner')) {
      return 'beginner';
    }
    if (lower.includes('hard') || lower.includes('advanced')) {
      return 'advanced';
    }
    if (
      lower.includes('medium') ||
      lower.includes('intermediate') ||
      lower.includes('mid')
    ) {
      return 'intermediate';
    }
    return 'intermediate';
  }

  private async persistProblemSolvingCaseStudies(
    userId: string,
    profileId: number | null,
    jdId: number | null,
    planId: number,
    subjectPrepMap: Map<string, any>,
  ): Promise<void> {
    const normalizedSubjectKey = Array.from(subjectPrepMap.keys()).find(
      (subjectKey) => {
        if (typeof subjectKey !== 'string') {
          return false;
        }
        return this.isProblemSolvingSubject(subjectKey);
      },
    );

    if (!normalizedSubjectKey) {
      return;
    }

    const subjectData = subjectPrepMap.get(normalizedSubjectKey);
    const rawCaseStudies = Array.isArray(subjectData?.case_studies)
      ? subjectData.case_studies.filter(Boolean)
      : [];
    if (!rawCaseStudies.length) {
      return;
    }

    const { data: existingCaseStudies } = await this.supabase
      .from('problem_solving_case_studies')
      .select('question_id')
      .eq('plan_id', planId);

    if (existingCaseStudies?.length) {
      const questionIdsToRemove = existingCaseStudies
        .map((row: any) => row.question_id)
        .filter((id: any): id is string => !!id);
      if (questionIdsToRemove.length) {
        await this.supabase
          .from('interview_practice_questions')
          .delete()
          .in('id', questionIdsToRemove);
      }
      await this.supabase
        .from('problem_solving_case_studies')
        .delete()
        .eq('plan_id', planId);
    }

    const exerciseName = `Problem Solving Case Studies - Plan ${planId}`;
    const { data: existingExercise } = await this.supabase
      .from('interview_practice_exercises')
      .select('id')
      .eq('name', exerciseName)
      .maybeSingle();

    let exerciseId: string;
    if (existingExercise && existingExercise.id) {
      exerciseId = existingExercise.id;
    } else {
      const exercisePayload: Record<string, unknown> = {
        id: uuidv4(),
        name: exerciseName,
        description: `Problem Solving case studies for plan ${planId}`,
        subject: 'Problem Solving',
        user_id: userId,
        profile_id: profileId ?? null,
        jd_id: jdId ?? null,
        exercise_content: null,
        created_at: new Date().toISOString(),
      };
      const { data: createdExercise, error: exerciseError } =
        await this.supabase
          .from('interview_practice_exercises')
          .insert(exercisePayload)
          .select()
          .single();

      if (exerciseError || !createdExercise) {
        console.error(
          '[persistProblemSolvingCaseStudies] Failed to insert exercise:',
          exerciseError?.message,
        );
        return;
      }
      exerciseId = createdExercise.id;
    }

    let questionNumber = 1;
    for (const rawCaseStudy of rawCaseStudies) {
      const caseStudy = rawCaseStudy || {};
      const questionText = (
        caseStudy.problem_statement ||
        caseStudy.title ||
        caseStudy.business_problem ||
        'Problem Solving Case Study'
      )
        .toString()
        .trim();
      const topics: string[] =
        Array.isArray(caseStudy.topics) && caseStudy.topics.length > 0
          ? caseStudy.topics
          : ['Problem Solving'];
      const questionPayload = {
        id: uuidv4(),
        exercise_id: exerciseId,
        question_number: questionNumber,
        text: questionText,
        type: this.getQuestionTypeFromSubject('Problem Solving'),
        language: this.getLanguageFromSubject('Problem Solving'),
        difficulty: this.normalizeDifficultyValue(caseStudy.difficulty),
        topics,
        points: 10,
        content: {
          question: questionText,
          hint: caseStudy.solution_outline,
          title: caseStudy.title || null,
          problem_statement: caseStudy.problem_statement || null,
          description: caseStudy.description || null,
          business_context:
            caseStudy.business_problem || subjectData?.business_context,
          dataset_context:
            caseStudy.case_study_context ||
            caseStudy.description ||
            caseStudy.business_problem,
          dataset_description:
            caseStudy.description ||
            subjectData?.business_context ||
            subjectData?.summary,
          case_study_title: caseStudy.title || null,
          case_study_description:
            caseStudy.description || caseStudy.business_problem || null,
          case_study_problem_statement:
            caseStudy.problem_statement || questionText,
        },
        expected_output_table: null,
        created_at: new Date().toISOString(),
      };

      const { data: questionRecord, error: questionError } = await this.supabase
        .from('interview_practice_questions')
        .insert(questionPayload)
        .select()
        .single();

      if (questionError || !questionRecord) {
        console.error(
          '[persistProblemSolvingCaseStudies] Failed to insert question:',
          questionError?.message,
        );
        questionNumber += 1;
        continue;
      }

      const caseStudyRecord = {
        id: uuidv4(),
        plan_id: planId,
        exercise_id: exerciseId,
        question_id: questionRecord.id,
        title: caseStudy.title || null,
        description: caseStudy.description || null,
        problem_statement: caseStudy.problem_statement || null,
        business_problem: caseStudy.business_problem || null,
        case_study_context:
          caseStudy.case_study_context ||
          caseStudy.description ||
          caseStudy.business_problem ||
          null,
        estimated_time_minutes:
          typeof caseStudy.estimated_time_minutes === 'number'
            ? caseStudy.estimated_time_minutes
            : null,
        difficulty: caseStudy.difficulty || 'Medium',
        topics,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: caseStudyError } = await this.supabase
        .from('problem_solving_case_studies')
        .insert(caseStudyRecord);

      if (caseStudyError) {
        console.error(
          '[persistProblemSolvingCaseStudies] Failed to insert case study metadata:',
          caseStudyError.message,
        );
      }

      questionNumber += 1;
    }
  }

  private buildCaseStudiesFromSubject(
    subject: string,
    subjectData: any,
  ): any[] {
    const questionsRaw = Array.isArray(subjectData.questions_raw)
      ? subjectData.questions_raw
      : [];
    if (questionsRaw.length === 0) {
      return [];
    }

    const datasetColumns = Array.isArray(subjectData.dataset_columns)
      ? subjectData.dataset_columns
      : [];
    const datasetCsv = subjectData.dataset_csv_raw || '';
    let sampleData = datasetCsv;
    if (!sampleData && Array.isArray(subjectData.dataset_rows)) {
      sampleData = JSON.stringify(subjectData.dataset_rows, null, 2);
    }
    const normalizedDatasets = this.normalizeSubjectDatasets(
      subjectData,
      subject,
    );
    const datasetSchemaRaw =
      typeof subjectData.data_creation_sql === 'string' &&
      subjectData.data_creation_sql.trim()
        ? subjectData.data_creation_sql
        : subjectData.dataset_creation_sql;
    const datasetSchema =
      datasetSchemaRaw && datasetSchemaRaw.length > 0
        ? datasetSchemaRaw
        : datasetColumns.length
          ? datasetColumns
          : undefined;

    const normalizedQuestions = questionsRaw.map(
      (question: any, idx: number) => ({
        question:
          question.business_question ||
          question.question ||
          question.text ||
          question.prompt ||
          question.title ||
          `Question ${idx + 1}`,
        difficulty: this.normalizeDifficultyValue(question.difficulty),
        expected_approach:
          question.expected_approach ||
          question.hint ||
          question.answer ||
          question.answer_sql ||
          question.expected_answer ||
          '',
        answer:
          question.answer ||
          question.answer_sql ||
          question.expected_answer ||
          question.sample_output ||
          question.expected_approach ||
          '',
        sample_output:
          question.sample_output ||
          question.answer ||
          question.answer_sql ||
          question.expected_answer ||
          '',
        sample_input: question.sample_input || question.input || null,
        topics: question.topics || [subject],
      }),
    );

    return [
      {
        title: subjectData.header_text || `${subject} Case Study`,
        dataset_overview:
          subjectData.dataset_description || subjectData.business_context,
        dataset_schema: datasetSchema,
        dataset_creation_sql: datasetSchemaRaw,
        data_creation_python: subjectData.data_creation_python,
        sample_data: sampleData,
        datasets: normalizedDatasets,
        questions: normalizedQuestions,
      },
    ];
  }

  private normalizeSubjectDatasets(subjectData: any, subject: string): any[] {
    if (!Array.isArray(subjectData.datasets)) {
      return [];
    }

    return subjectData.datasets.map((dataset: any, idx: number) => ({
      name: dataset.name || dataset.table_name || `Dataset ${idx + 1}`,
      description: dataset.description || subjectData.dataset_description,
      table_name: dataset.table_name || dataset.name,
      columns:
        dataset.columns ||
        (Array.isArray(dataset.rows) && dataset.rows.length > 0
          ? Object.keys(dataset.rows[0])
          : []),
      schema_info: dataset.schema_info || null,
      creation_sql:
        dataset.creation_sql ||
        dataset.data_creation_sql ||
        subjectData.data_creation_sql ||
        subjectData.dataset_creation_sql,
      creation_python: dataset.creation_python || dataset.data_creation_python,
      csv_data: dataset.csv || dataset.dataset_csv_raw,
      record_count: Array.isArray(dataset.rows)
        ? dataset.rows.length
        : undefined,
      subject_type: subject.toLowerCase(),
    }));
  }

  private async createDatasetRecord(
    exerciseId: string,
    subject: string,
    datasetInput: {
      name?: string;
      description?: string;
      table_name?: string;
      columns?: string[];
      schema_info?: any;
      creation_sql?: string;
      creation_python?: string;
      csv_data?: string;
      record_count?: number;
      subject_type?: string;
      sample_data?: string;
    },
    result: MigrationResult,
  ): Promise<string | null> {
    const tableName =
      datasetInput.table_name ||
      this.generateTableName(datasetInput.name || '', subject);
    const datasetData = {
      id: uuidv4(),
      exercise_id: exerciseId,
      name: datasetInput.name || `Dataset for ${subject}`,
      description: datasetInput.description || null,
      table_name: tableName,
      columns:
        datasetInput.columns && datasetInput.columns.length > 0
          ? datasetInput.columns
          : undefined,
      schema_info:
        datasetInput.schema_info ??
        (datasetInput.columns && datasetInput.columns.length > 0
          ? { columns: datasetInput.columns }
          : null),
      creation_sql: datasetInput.creation_sql || datasetInput.sample_data,
      creation_python: datasetInput.creation_python || datasetInput.sample_data,
      csv_data: datasetInput.csv_data || datasetInput.sample_data,
      record_count: datasetInput.record_count,
      subject_type: datasetInput.subject_type || subject.toLowerCase(),
      created_at: new Date().toISOString(),
    };

    const { data: dataset, error: datasetError } = await this.supabase
      .from('interview_practice_datasets')
      .insert(datasetData)
      .select()
      .single();

    if (datasetError) {
      result.errors.push(
        `Failed to create dataset ${datasetInput.name || tableName}: ${datasetError.message}`,
      );
      return null;
    }

    if (dataset) {
      result.datasets_created++;
      return dataset.id;
    }

    return null;
  }
}
