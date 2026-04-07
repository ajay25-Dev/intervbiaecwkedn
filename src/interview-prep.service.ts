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
    'Google Sheets': {
      topic: 'Spreadsheet formulas and analysis',
      topicHierarchy:
        'Formulas, Pivot tables, Lookups, Data cleaning, Analysis',
    },
    'Problem Solving': {
      topic: 'Structured reasoning',
      topicHierarchy: 'Case framing, Assumptions, Hypothesis, Recommendations',
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
    const trimmed = this.normalizeSubjectLabel(subject);
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
      const subjects = Array.from(
        new Set(
          (
            dto.suggested_subjects || [
              'SQL',
              'Python',
              'Power BI',
              'Guess Estimate',
              'Statistics',
              'Domain Knowledge',
              'Google Sheets',
            ]
          )
            .map((subject) => this.normalizeSubjectLabel(subject))
            .filter((subject) => Boolean(subject)),
        ),
      );
      console.log(
        `[generateInterviewPlan] Generating plan for subjects: ${subjects.join(', ')}`,
      );

      // Call AI service to generate base plan
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 220000);

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
            220000,
          );

          try {
            const mappedLanguage = this.mapSubjectToLanguage(subject);
            const datasetLanguage = this.mapSubjectToDatasetLanguage(subject);
            const learnerDifficulty = this.resolveLearnerDifficulty(
              undefined,
              profileData.experience_level,
            );

            const topicInfo = this.getPlanTopicInfo(subject);
            const isProblemSolving = this.isProblemSolvingSubject(subject);
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
                  }),
                  signal: subjectController.signal,
                },
              );

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

            const solutionCodingLanguage = this.resolveSolutionCodingLanguage(
              subject,
              mappedLanguage,
            );

            const subjectResponse = await fetch(
              `${this.aiServiceUrl}/generate`,
              {
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
                  future_topics: [],
                  learner_level: this.mapDifficultyToLevel(learnerDifficulty),
                  coding_language: mappedLanguage,
                  solution_coding_language: solutionCodingLanguage,
                  dataset_creation_coding_language: datasetLanguage,
                  verify_locally: false,
                }),
                signal: subjectController.signal,
              },
            );

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
          domain_knowledge_text:
            subjectPrepMap.get('Domain Knowledge')?.domain_knowledge_text ||
            null,
          created_at: new Date().toISOString(),
        })
        .select();

      if (planError) throw planError;

      const savedPlan = planData?.[0];
      if (savedPlan) {
        try {
          const migrationResult = await this.migratePlanDataToTables(userId, {
            plan_id: savedPlan.id,
            overwrite_existing: false,
          });
          if (!migrationResult.success) {
            console.warn(
              '[generateInterviewPlan] Automatic plan data migration completed with warnings:',
              migrationResult,
            );
          }

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

          return {
            ...(savedPlan as InterviewPlanResponse),
            migration_result: migrationResult,
          };
        } catch (error) {
          console.error(
            '[generateInterviewPlan] Failed to auto-save generated plan data:',
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
        `Failed to generate interview questions: ${error.message}`,
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
          summary.questionCount > 0
            ? Number(
                (
                  (summary.correctQuestions / summary.questionCount) *
                  100
                ).toFixed(1),
              )
            : 0;
        const attempted = summary.attemptedQuestions;
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

  async extractJDInfo(
    dto: ExtractJDDto,
    userId?: string,
  ): Promise<ExtractJDResponse> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const requestBody = {
        job_description: dto.job_description,
        company_name: dto.company_name,
        role: dto.role,
        user_skills: dto.user_skills,
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
        return parsedResponse;
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
          const exercisePayload = {
            id: uuidv4(),
            user_id: userId,
            profile_id,
            jd_id,
            subject,
            exercise_content: exerciseData,
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
            accumulatedPlanSubjectData[subject] = planData;
          }
        } catch (error) {
          console.error(`Error generating exercise for ${subject}:`, error);
        }
      }

      if (plan_id && Object.keys(accumulatedPlanSubjectData).length > 0) {
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
        `Failed to generate practice exercises: ${error.message}`,
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
      excel: 'Google Sheets',
      'google sheet': 'Google Sheets',
      'google sheets': 'Google Sheets',
      google_sheets: 'Google Sheets',
      sheet: 'Google Sheets',
      sheets: 'Google Sheets',
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
    if (this.isProblemSolvingSubject(subject)) {
      const controller = new AbortController();
      const timeoutMs =
        Number(process.env.AI_TIMEOUT_MS) ||
        Number(process.env.AI_TIMEOUT) ||
        120000;
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
            hint: question.expected_approach || '',
            expected_answer: '',
            adaptive_note: question.adaptive_note || '',
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
      verify_locally: false,
    };

    const timeoutMs = Number(process.env.AI_TIMEOUT_MS) || 120000;
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
          expected_answer: data.answers_sql_map?.[q.id] || '',
          adaptive_note: q.adaptive_note || '',
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
      'Power BI': 'SQL',
      'Google Sheets': 'Google Sheets',
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
      'Google Sheets': 'CSV',
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
      topics: this.resolveQuestionTopics(question, subject),
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
