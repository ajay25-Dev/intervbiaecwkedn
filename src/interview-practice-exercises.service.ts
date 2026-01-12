import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

type InterviewQuestionSubmissionsResult = {
  submissions: any[];
  total: number;
  success: boolean;
};

@Injectable()
export class InterviewPracticeExercisesService {
  private supabase: SupabaseClient;

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_KEY environment variables are required',
      );
    }
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  async getExercises(filters?: {
    subject?: string;
    difficulty?: string;
    page?: number;
    limit?: number;
  }) {
    try {
      let query = this.supabase
        .from('interview_practice_exercises')
        .select('*');

      if (filters?.subject) {
        query = query.ilike('name', `%${filters.subject}%`);
      }

      if (filters?.difficulty) {
        query = query.eq('difficulty', filters.difficulty);
      }

      const limit = filters?.limit || 50;
      const page = filters?.page || 1;
      const offset = (page - 1) * limit;

      const { data, error, count } = await query
        .range(offset, offset + limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return {
        data: data || [],
        pagination: {
          total: count || 0,
          page,
          limit,
          pages: Math.ceil((count || 0) / limit),
        },
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to fetch exercises: ${error.message}`,
      );
    }
  }

  async getExerciseDetail(exerciseId: string) {
    try {
      const { data: exercise, error: exerciseError } = await this.supabase
        .from('interview_practice_exercises')
        .select('*')
        .eq('id', exerciseId)
        .single();

      if (exerciseError) throw exerciseError;
      if (!exercise) throw new NotFoundException('Exercise not found');

      const { data: questions, error: questionsError } = await this.supabase
        .from('interview_practice_questions')
        .select('*')
        .eq('exercise_id', exerciseId)
        .order('question_number', { ascending: true });

      if (questionsError) throw questionsError;

      const { data: datasets, error: datasetsError } = await this.supabase
        .from('interview_practice_datasets')
        .select('*')
        .eq('exercise_id', exerciseId);

      if (datasetsError) throw datasetsError;

      return {
        ...exercise,
        questions: questions || [],
        datasets: datasets || [],
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        `Failed to fetch exercise detail: ${error.message}`,
      );
    }
  }

  async getQuestionData(exerciseId: string, questionId: string) {
    try {
      const { data: question, error: questionError } = await this.supabase
        .from('interview_practice_questions')
        .select('*')
        .eq('id', questionId)
        .eq('exercise_id', exerciseId)
        .single();

      if (questionError) throw questionError;
      if (!question) throw new NotFoundException('Question not found');

      const { data: testCases, error: testCasesError } = await this.supabase
        .from('interview_practice_test_cases')
        .select('*')
        .eq('question_id', questionId);

      if (testCasesError) throw testCasesError;

      const { data: datasets, error: datasetsError } = await this.supabase
        .from('interview_practice_datasets')
        .select('*')
        .or(`exercise_id.eq.${exerciseId},question_id.eq.${questionId}`);

      if (datasetsError) throw datasetsError;

      return {
        ...question,
        test_cases: testCases || [],
        datasets: datasets || [],
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        `Failed to fetch question data: ${error.message}`,
      );
    }
  }

  async getDatasetPreview(
    exerciseId: string,
    datasetId: string,
    limit: number = 50,
  ) {
    try {
      const { data: dataset, error: datasetError } = await this.supabase
        .from('interview_practice_datasets')
        .select('*')
        .eq('id', datasetId)
        .eq('exercise_id', exerciseId)
        .single();

      if (datasetError) throw datasetError;
      if (!dataset) throw new NotFoundException('Dataset not found');

      let preview = [];
      if (dataset.csv_data) {
        const lines = dataset.csv_data.split('\n').slice(0, limit + 1);
        const headers = lines[0].split(',');
        preview = lines.slice(1).map((line) => {
          const values = line.split(',');
          return headers.reduce((obj, header, idx) => {
            obj[header] = values[idx] || null;
            return obj;
          }, {});
        });
      }

      return {
        id: dataset.id,
        name: dataset.name,
        columns: dataset.columns || [],
        preview,
        record_count: dataset.record_count || 0,
        schema_info: dataset.schema_info,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      throw new BadRequestException(
        `Failed to fetch dataset preview: ${error.message}`,
      );
    }
  }

  async storeExerciseFromGeneration(
    exerciseData: any,
    profileId: string,
    jdId: string,
  ) {
    const exerciseId = uuidv4();

    try {
      const { error: exerciseError } = await this.supabase
        .from('interview_practice_exercises')
        .insert({
          id: exerciseId,
          name: exerciseData.header_text || 'Practice Exercise',
          description: exerciseData.business_context,
          created_at: new Date().toISOString(),
        });

      if (exerciseError) throw exerciseError;

      const questions = exerciseData.questions_raw || [];
      const datasets = exerciseData.datasets || [];

      for (const question of questions) {
        const questionId = uuidv4();
        const { error: qError } = await this.supabase
          .from('interview_practice_questions')
          .insert({
            id: questionId,
            exercise_id: exerciseId,
            question_number: question.id,
            text: question.business_question,
            type: exerciseData.type || 'sql',
            language: exerciseData.coding_language || 'sql',
            difficulty: question.difficulty,
            topics: question.topics || [],
            points: 10,
            content: question,
            expected_output_table: question.expected_output_table,
            created_at: new Date().toISOString(),
          });

        if (qError) throw qError;

        const answer = {
          id: uuidv4(),
          question_id: questionId,
          answer_text: exerciseData.answers_sql_map?.[question.id],
          explanation: question.adaptive_note,
        };

        const { error: answerError } = await this.supabase
          .from('interview_practice_answers')
          .insert(answer);

        if (answerError) throw answerError;
      }

      if (datasets && datasets.length > 0) {
        for (const dataset of datasets) {
          const { error: dsError } = await this.supabase
            .from('interview_practice_datasets')
            .insert({
              id: uuidv4(),
              exercise_id: exerciseId,
              name: dataset.name || 'Dataset',
              description: exerciseData.dataset_description,
              table_name: dataset.table_name || 'data',
              columns: dataset.columns || [],
              creation_sql: exerciseData.data_creation_sql,
              creation_python: exerciseData.data_creation_python,
              csv_data: exerciseData.dataset_csv_raw,
              record_count: dataset.record_count,
              subject_type: exerciseData.type || 'sql',
              created_at: new Date().toISOString(),
            });

          if (dsError) throw dsError;
        }
      }

      return {
        exercise_id: exerciseId,
        success: true,
      };
    } catch (error) {
      throw new BadRequestException(
        `Failed to store exercise: ${error.message}`,
      );
    }
  }

  async saveAttempt(
    userId: string,
    exerciseId: string,
    questionId: string,
    code: string,
    language: string,
    executionResult?: any,
  ) {
    try {
      const attemptId = uuidv4();
      const { error } = await this.supabase
        .from('interview_exercise_attempts')
        .insert({
          id: attemptId,
          user_id: userId,
          exercise_id: exerciseId,
          question_id: questionId,
          code,
          language,
          execution_result: executionResult,
          created_at: new Date().toISOString(),
        });

      if (error) throw error;
      return attemptId;
    } catch (error) {
      throw new BadRequestException(`Failed to save attempt: ${error.message}`);
    }
  }

  async getQuestionSubmissions(
    userId: string,
    exerciseId: string,
    questionId: string,
  ): Promise<InterviewQuestionSubmissionsResult> {
    try {
      const { data, error } = await this.supabase
        .from('interview_exercise_question_submissions')
        .select('*')
        .eq('student_id', userId)
        .eq('exercise_id', exerciseId)
        .eq('question_id', questionId)
        .order('attempt_number', { ascending: false })
        .limit(5);

      if (error) {
        console.error('Error fetching interview question submissions:', error);
        return {
          submissions: [],
          total: 0,
          success: false,
        };
      }

      const submissions = data || [];
      return {
        submissions,
        total: submissions.length,
        success: true,
      };
    } catch (error) {
      console.error('Unexpected error fetching submissions:', error);
      return {
        submissions: [],
        total: 0,
        success: false,
      };
    }
  }

  async getInterviewQuestionSubmissions(
    userId: string,
    exerciseId: string,
    questionId: string,
  ): Promise<InterviewQuestionSubmissionsResult> {
    return this.getQuestionSubmissions(userId, exerciseId, questionId);
  }
}
