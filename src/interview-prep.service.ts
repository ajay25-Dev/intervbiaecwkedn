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
};
import { FileExtractionService } from './file-extraction.service';

@Injectable()
export class InterviewPrepService {
  private supabase: SupabaseClient;
  private aiServiceUrl: string;
  private static SUBJECT_TOPIC_MAP: Record<
    string,
    { topic: string; topicHierarchy: string }
  > = {
    SQL: { topic: 'Joins', topicHierarchy: 'Select, Where, Group By, Having' },
    Python: {
      topic: 'Data Frames',
      topicHierarchy: 'Variables, Functions, Pandas, Plotting',
    },
    'Power BI': {
      topic: 'Reporting',
      topicHierarchy: 'Data Modeling, DAX, Visualizations, Publishing',
    },
    Statistics: {
      topic: 'Probability Distributions',
      topicHierarchy: 'Summary Stats, Distributions, Hypothesis Testing',
    },
    Communication: {
      topic: 'Storytelling',
      topicHierarchy: 'Narrative, Visuals, Recommendations',
    },
    'Case Studies': {
      topic: 'Problem Framing',
      topicHierarchy: 'Context, Objective, Metrics, Recommendations',
    },
    'Domain Knowledge': {
      topic: 'Domain Awareness',
      topicHierarchy: 'Company Overview, KPIs, Use Cases, Resume Tips',
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
      throw new BadRequestException(`Failed to save profile: ${error.message}`);
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
        `Failed to fetch profile: ${error.message}`,
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
      throw new BadRequestException(`Failed to upload JD: ${error.message}`);
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
      throw new BadRequestException(`Failed to upload JD: ${error.message}`);
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
      const timeoutId = setTimeout(() => controller.abort(), 30000);

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
        `Failed to analyze job description: ${error.message}`,
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
      throw new BadRequestException(`Failed to fetch JD: ${error.message}`);
    }
  }

  private getPlanTopicInfo(subject: string) {
    const trimmed = (subject || '').trim();
    const key = trimmed || 'SQL';
    return (
      InterviewPrepService.SUBJECT_TOPIC_MAP[key] || {
        topic: trimmed || 'General',
        topicHierarchy: trimmed || 'General',
      }
    );
  }

  async generateInterviewPlan(
    userId: string,
    dto: GenerateInterviewPlanDto,
  ): Promise<InterviewPlanResponse> {
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
      const subjects = dto.suggested_subjects || [
        'SQL',
        'Python',
        'Power BI',
        'Guess Estimate',
        'Statistics',
        'Domain Knowledge',
      ];
      console.log(
        `[generateInterviewPlan] Generating plan for subjects: ${subjects.join(', ')}`,
      );

      // Call AI service to generate base plan
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

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

      if (!basePlanResponse.ok) {
        throw new Error(
          `AI service returned ${basePlanResponse.status}: ${basePlanResponse.statusText}`,
        );
      }

      const planContent = await basePlanResponse.json();

      // Generate subject-specific prep materials for each subject
      const subjectPrepMap = new Map();
      for (const subject of subjects) {
        try {
          const subjectController = new AbortController();
          const subjectTimeoutId = setTimeout(
            () => subjectController.abort(),
            120000,
          );

          try {
            const mappedLanguage = this.mapSubjectToLanguage(subject);
            const datasetLanguage = this.mapSubjectToDatasetLanguage(subject);
            const learnerDifficulty = this.resolveLearnerDifficulty(
              undefined,
              profileData.experience_level,
            );

            const topicInfo = this.getPlanTopicInfo(subject);

          const isProblemSolving = subject.trim().toLowerCase() === 'problem solving';
          if (isProblemSolving) {
            const subjectResponse = await fetch(`${this.aiServiceUrl}/interview/subject-prep`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                subject,
                job_description: jdData.job_description,
                experience_level: profileData.experience_level,
                company_name: profileData.company_name,
              }),
              signal: subjectController.signal,
            });

            if (subjectResponse.ok) {
              const subjectData = await subjectResponse.json();
              subjectPrepMap.set(subject, {
                ...subjectData,
                subject,
              });
              console.log(
                `[generateInterviewPlan] Generated problem solving case studies for ${subject}`,
              );
            } else {
              console.error(
                `[generateInterviewPlan] Problem solving subject prep failed: ${subjectResponse.status}`,
              );
            }
            continue;
          }

          const subjectResponse = await fetch(`${this.aiServiceUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              field: 'Data Analytics',
                domain:
                  profileData.company_name || profileData.industry || 'General',
                subject,
                topic: topicInfo.topic,
                topic_hierarchy: topicInfo.topicHierarchy,
                future_topics: [],
                learner_level: this.mapDifficultyToLevel(learnerDifficulty),
                coding_language: mappedLanguage,
                solution_coding_language: mappedLanguage,
                dataset_creation_coding_language: datasetLanguage,
                verify_locally: false,
              }),
              signal: subjectController.signal,
            });

            if (subjectResponse.ok) {
              const subjectData = await subjectResponse.json();
              if (subject === 'Domain Knowledge') {
                subjectPrepMap.set(subject, {
                  subject,
                  domain_knowledge_text:
                    subjectData.domain_knowledge_text ||
                    subjectData.business_context ||
                    '',
                });
              } else {
                subjectPrepMap.set(subject, {
                  ...subjectData,
                  subject,
                });
              }
              console.log(
                `[generateInterviewPlan] Generated prep for ${subject}`,
              );
            } else {
              console.error(
                `[generateInterviewPlan] Failed to generate prep for ${subject}`,
              );
            }
          } finally {
            clearTimeout(subjectTimeoutId);
          }
        } catch (error) {
          console.error(
            `[generateInterviewPlan] Error generating prep for ${subject}:`,
            error,
          );
        }
      }

      // Combine plan content with subject prep data
      const enrichedPlanContent = {
        ...planContent,
        subject_prep: Object.fromEntries(subjectPrepMap),
        subjects_covered: Array.from(subjectPrepMap.keys()),
      };

      // Save plan to database
      const { data: planData, error: planError } = await this.supabase
        .from('interview_prep_plans')
        .insert({
          user_id: userId,
          profile_id: dto.profile_id,
          jd_id: dto.jd_id,
          plan_content: enrichedPlanContent,
          domain_knowledge_text: subjectPrepMap.get('Domain Knowledge')?.domain_knowledge_text || null,
          created_at: new Date().toISOString(),
        })
        .select();

      if (planError) throw planError;

      const savedPlan = planData?.[0];
      if (savedPlan) {
        try {
          await this.persistProblemSolvingCaseStudies(
            userId,
            profileData.id,
            jdData.id,
            savedPlan.id,
            subjectPrepMap,
          );
        } catch (error) {
          console.error(
            '[generateInterviewPlan] Failed to persist Problem Solving case studies:',
            error,
          );
        }
      }

      return (savedPlan as InterviewPlanResponse) || null;
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate interview plan: ${error.message}`,
      );
    }
  }

  async getInterviewPlan(planId: number, userId: string) {
    try {
      const { data, error } = await this.supabase
        .from('interview_prep_plans')
        .select()
        .eq('id', planId)
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      if (!data) throw new NotFoundException('Plan not found');

      return data;
    } catch (error) {
      throw new BadRequestException(`Failed to fetch plan: ${error.message}`);
    }
  }

  async getLatestPlan(userId: string, profileId?: number) {
    try {
      let query = this.supabase
        .from('interview_prep_plans')
        .select()
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
        `Failed to fetch latest plan: ${error.message}`,
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
      throw new BadRequestException(`Failed to fetch JDs: ${error.message}`);
    }
  }

  async extractJDInfo(dto: ExtractJDDto): Promise<ExtractJDResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const requestBody = {
        job_description: dto.job_description,
        company_name: dto.company_name,
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
        return JSON.parse(responseText) as ExtractJDResponse;
      } catch (parseError) {
        throw new Error(
          `AI service returned invalid JSON: ${responseText || 'empty body'}`,
        );
      }
    } catch (error) {
      console.error('[extractJDInfo] Error:', error);
      throw new BadRequestException(
        `Failed to extract JD info: ${error.message}`,
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
        `Failed to generate domain KPI: ${error.message}`,
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

      const subjectsToGenerate =
        subjects && subjects.length > 0
          ? subjects
          : singleSubject
            ? [singleSubject]
            : [];

      if (subjectsToGenerate.length === 0) {
        throw new BadRequestException('At least one subject is required');
      }

      const overrides: PracticeGenerationOverrides = {
        domain,
        learnerLevel: learner_level,
        topic,
        topicHierarchy: topic_hierarchy,
        futureTopics: future_topics,
      };

      for (const subject of subjectsToGenerate) {
        try {
          const exerciseData = await this.generateSingleSubjectExercise(
            subject,
            profileData,
            jdData,
            overrides,
          );

          // Store in database
          const { data: storedExercise, error: storeError } =
            await this.supabase
              .from('interview_practice_exercises')
              .insert({
                user_id: userId,
                profile_id,
                jd_id,
                subject,
                exercise_content: exerciseData,
                created_at: new Date().toISOString(),
              })
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
        } catch (error) {
          console.error(`Error generating exercise for ${subject}:`, error);
        }
      }

      return exercisesResults;
    } catch (error) {
      throw new BadRequestException(
        `Failed to generate practice exercises: ${error.message}`,
      );
    }
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
    const learnerDifficulty = this.resolveLearnerDifficulty(
      overrides.learnerLevel,
      profileData.experience_level,
    );
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
      verify_locally: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000);

    try {
      const practiceApiUrl =
        process.env.PRACTICE_EXERCISE_API_URL ||
        'http://localhost:8000/generate-exercises';

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
          expected_answer: data.answers_sql_map?.[q.id] || '',
          adaptive_note: q.adaptive_note || '',
        })),
        data_creation_sql: data.data_creation_sql || '',
        data_creation_python: data.data_creation_python || '',
        dataset_csv_raw: data.dataset_csv_raw || '',
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  private mapSubjectToLanguage(subject: string): string {
    const mapping: Record<string, string> = {
      SQL: 'SQL',
      Python: 'Python',
      'Power BI': 'SQL',
      'Google Sheets': 'Google Sheets',
      Statistics: 'Python',
      Communication: 'English',
      'Case Studies': 'SQL',
      'Domain Knowledge': 'English',
    };
    return mapping[subject] || 'SQL';
  }

  private mapSubjectToDatasetLanguage(subject: string): string {
    const mapping: Record<string, string> = {
      SQL: 'SQL',
      Python: 'Python',
      'Power BI': 'SQL',
      'Google Sheets': 'CSV',
      Statistics: 'Python',
      Communication: 'Text',
      'Case Studies': 'SQL',
      'Domain Knowledge': 'Text',
    };
    return mapping[subject] || 'SQL';
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
          const errorMsg = `Failed to process subject ${subject}: ${error.message}`;
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
        message: `Migration failed: ${error.message}`,
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
      const datasetDef = {
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
      };
      const createdDatasetId = await this.createDatasetRecord(
        exerciseId,
        subject,
        datasetDef,
        result,
      );
      if (createdDatasetId) {
        datasetId = createdDatasetId;
      }
    }

    if (Array.isArray(caseStudy.datasets)) {
      for (const datasetDef of caseStudy.datasets) {
        const createdId = await this.createDatasetRecord(
          exerciseId,
          subject,
          datasetDef,
          result,
        );
        if (createdId) {
          if (!datasetId) {
            datasetId = createdId;
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
      topics: [subject],
      points: 10,
      content: {
        question: question.question,
        hint: question.expected_approach,
        sample_input: question.sample_input,
        sample_output: question.sample_output,
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
      expected_output_table: question.sample_output
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

    // Create answer if expected output exists
    if (question.sample_output || question.expected_approach) {
      const answerData = {
        id: uuidv4(),
        question_id: questionRecord.id,
        answer_text: question.sample_output || question.expected_approach,
        is_case_sensitive: false,
        explanation: question.expected_approach,
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
        `Error deleting existing exercise data: ${error.message}`,
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

  private getQuestionTypeFromSubject(subject: string): string {
    const subjectLower = subject.toLowerCase();
    const typeMap: Record<string, string> = {
      sql: 'sql',
      python: 'python',
      javascript: 'javascript',
      'google sheets': 'google_sheets',
      'google sheet': 'google_sheets',
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
    const subjectLower = subject.toLowerCase();
    const languageMap: Record<string, string> = {
      sql: 'sql',
      python: 'python',
      javascript: 'javascript',
      'google sheets': 'google_sheets',
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
        const keyLower = subjectKey.toLowerCase();
        return (
          keyLower.includes('problem solving') ||
          keyLower.includes('art of problem solving') ||
          keyLower.includes('aops')
        );
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
