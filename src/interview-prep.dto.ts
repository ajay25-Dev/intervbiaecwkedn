import {
  IsString,
  IsEmail,
  IsEnum,
  IsArray,
  IsOptional,
  IsNumber,
} from 'class-validator';

export enum ExperienceLevel {
  ENTRY = 'entry',
  JUNIOR = 'junior',
  MID = 'mid',
  SENIOR = 'senior',
  LEAD = 'lead',
}

export enum IndustryType {
  TECH = 'tech',
  FINANCE = 'finance',
  HEALTHCARE = 'healthcare',
  EDUCATION = 'education',
  ECOMMERCE = 'ecommerce',
  OTHER = 'other',
}

export class CreateInterviewProfileDto {
  @IsEmail()
  email: string;

  @IsEnum(ExperienceLevel)
  experience_level: ExperienceLevel;

  @IsString()
  target_role: string;

  @IsEnum(IndustryType)
  industry: IndustryType;

  @IsArray()
  @IsString({ each: true })
  current_skills: string[];

  @IsNumber()
  preparation_timeline_weeks: number;

  @IsString()
  @IsOptional()
  company_name?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UpdateInterviewProfileDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsEnum(ExperienceLevel)
  @IsOptional()
  experience_level?: ExperienceLevel;

  @IsString()
  @IsOptional()
  target_role?: string;

  @IsEnum(IndustryType)
  @IsOptional()
  industry?: IndustryType;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  current_skills?: string[];

  @IsNumber()
  @IsOptional()
  preparation_timeline_weeks?: number;

  @IsString()
  @IsOptional()
  company_name?: string;

  @IsString()
  @IsOptional()
  notes?: string;
}

export class UploadJDDto {
  @IsString()
  job_description: string;

  @IsString()
  @IsOptional()
  source_type?: 'upload' | 'paste';
}

export class InterviewJDAnalysisResponse {
  role: string;
  required_skills: string[];
  experience_level: string;
  domain_focus: string;
  key_responsibilities: string[];
}

export class GenerateInterviewPlanDto {
  @IsNumber()
  profile_id: number;

  @IsNumber()
  jd_id: number;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  suggested_subjects?: string[];
}

export class KPI {
  name: string;
  description: string;
  importance: string;
}

export class CaseStudy {
  title: string;
  business_problem: string;
  solution_outline: string;
  key_learnings: string[];
}

export class Domain {
  title: string;
  description: string;
  core_topics: string[];
  kpis: KPI[];
}

export class PlanContentData {
  domains: Domain[];
  case_studies: CaseStudy[];
  summary?: string;
  estimated_hours?: number;
  subject_prep?: Record<string, SubjectPrepResponse>;
  subjects_covered?: string[];
}

export class InterviewPlanResponse {
  id?: number;
  user_id?: string;
  profile_id: number;
  jd_id: number;
  plan_content: PlanContentData;
  domain_knowledge_text?: string | null;
  created_at?: string;
  updated_at?: string;
}

export class ExtractJDDto {
  job_description: string;
  company_name?: string;
  @IsNumber()
  @IsOptional()
  jd_id?: number;
  @IsEnum(IndustryType)
  @IsOptional()
  industry?: IndustryType;
}

export class ExtractJDResponse {
  role_title: string;
  key_skills: string[];
  domains: string[];
  suggested_subjects: string[];
  experience_level: string;
  key_responsibilities: string[];
}

export class DomainKPIDto {
  company_name: string;
  job_description?: string;
  domain?: string;
}

export class KPIDetail {
  name: string;
  definition: string;
  formula: string;
  why_matters: string;
  example: string;
}

export class DomainKPIResponse {
  company_overview: string;
  domain_snapshot: string;
  kpis: KPIDetail[];
}

export class CaseStudyQuestion {
  question_number: number;
  question: string;
  expected_approach: string;
  difficulty: string;
  sample_input?: string;
  sample_output?: string;
}

export class SubjectCaseStudy {
  title: string;
  description: string;
  dataset_overview: string;
  problem_statement: string;
  questions: CaseStudyQuestion[];
  estimated_time_minutes: number;
  dataset_schema?: string;
  sample_data?: string;
}

export class SubjectPrepResponse {
  subject: string;
  case_studies: SubjectCaseStudy[];
  key_learning_points: string[];
  common_mistakes: string[];
}

export class GeneratePracticeExercisesDto {
  @IsNumber()
  profile_id: number;

  @IsNumber()
  jd_id: number;

  @IsString()
  @IsOptional()
  subject?: string;

  @IsArray()
  @IsString({ each: true })
  subjects: string[];

  @IsString()
  @IsOptional()
  domain?: string;

  @IsEnum(['Beginner', 'Intermediate', 'Advanced'] as const)
  @IsOptional()
  learner_level?: 'Beginner' | 'Intermediate' | 'Advanced';

  @IsString()
  @IsOptional()
  topic?: string;

  @IsString()
  @IsOptional()
  topic_hierarchy?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  future_topics?: string[];

  @IsNumber()
  @IsOptional()
  plan_id?: number;
}

export class PracticeQuestion {
  id: string;
  subject: string;
  text: string;
  difficulty: string;
  topics: string[];
  hint?: string;
  expected_answer: string;
  dataset?: string;
  adaptive_note?: string;
}

export class PracticeExerciseResponse {
  id?: string;
  profile_id: number;
  jd_id: number;
  subject: string;
  questions: PracticeQuestion[];
  dataset_description?: string;
  data_creation_sql?: string;
  data_creation_python?: string;
  dataset_csv?: string;
  created_at?: string;
  plan_subject_data?: Record<string, unknown>;
}

export class MigratePlanDataDto {
  @IsNumber()
  plan_id: number;

  @IsOptional()
  overwrite_existing?: boolean = false;
}

export class MigrationResult {
  plan_id: number;
  exercises_created: number;
  questions_created: number;
  datasets_created: number;
  answers_created: number;
  errors: string[];
  warnings: string[];
}

export class MigratePlanDataResponse {
  success: boolean;
  message: string;
  result?: MigrationResult;
}
