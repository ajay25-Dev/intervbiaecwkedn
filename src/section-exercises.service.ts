import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import {
  CreateExerciseDto,
  UpdateExerciseDto,
  CreateQuestionDto,
  UpdateQuestionDto,
  QuestionAnswerDto,
  UpsertQuestionDatasetDto,
} from './section-exercises.controller';
import { DatasetExecutionService } from './dataset-execution.service';

@Injectable()
export class SectionExercisesService {
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );
  private readonly questionSelect = `
        id,
        type,
        text,
        hint,
        explanation,
        points,
        order_index,
        content,
        language,
        subject_type,
        execution_enabled,
        starter_code,
        test_cases,
        sample_data,
        expected_runtime,
        difficulty_override,
        exercise_type,
        subject_focus,
        interactive_config,
        validation_logic,
        hints_and_tips,
        created_at,
        updated_at,
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
        ),
        practice_datasets (
          id,
          name,
          subject_type,
          creation_sql,
          creation_python,
          schema_info,
          data,
          data_preview,
          columns
        )
      `;

  constructor(
    private readonly datasetExecutionService: DatasetExecutionService,
  ) {}

  private async getNextQuestionOrderIndex(exerciseId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .select('order_index')
      .eq('exercise_id', exerciseId)
      .order('order_index', { ascending: false })
      .limit(1);

    if (error) {
      throw new Error(`Failed to determine question order: ${error.message}`);
    }

    const [lastQuestion] = data ?? [];
    const previousOrder =
      typeof lastQuestion?.order_index === 'number'
        ? lastQuestion.order_index
        : -1;

    return previousOrder + 1;
  }

  private mapAnswerInput(
    answer: QuestionAnswerDto,
    questionId: string,
  ): {
    question_id: string;
    answer_text: string;
    is_case_sensitive: boolean;
  } | null {
    if (!answer) {
      return null;
    }

    const answerTextSource =
      typeof answer.answer_text === 'string'
        ? answer.answer_text
        : typeof answer.text === 'string'
          ? answer.text
          : '';
    const answerText = answerTextSource.trim();

    if (!answerText) {
      return null;
    }

    const isCaseSensitive =
      typeof answer.is_case_sensitive === 'boolean'
        ? answer.is_case_sensitive
        : typeof answer.isCaseSensitive === 'boolean'
          ? answer.isCaseSensitive
          : false;

    return {
      question_id: questionId,
      answer_text: answerText,
      is_case_sensitive: isCaseSensitive,
    };
  }

  private async fetchQuestionWithRelations(questionId: string) {
    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .select(this.questionSelect)
      .eq('id', questionId)
      .single();

    if (error) {
      const errorMessage = `Failed to fetch question ${questionId}: ${error.message} (Code: ${error.code}, Hint: ${error.hint})`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    return data;
  }

  private async createQuestionWithRelations(
    exerciseId: string,
    createQuestionDto: CreateQuestionDto,
  ) {
    const orderIndex =
      typeof createQuestionDto.order_index === 'number'
        ? createQuestionDto.order_index
        : await this.getNextQuestionOrderIndex(exerciseId);

    const questionPayload: Record<string, any> = {
      exercise_id: exerciseId,
      type: createQuestionDto.type,
      text: createQuestionDto.text,
      hint: createQuestionDto.hint,
      explanation: createQuestionDto.explanation,
      points: createQuestionDto.points ?? 1,
      order_index: orderIndex,
      content: createQuestionDto.content,
      language: createQuestionDto.language,
      test_cases: createQuestionDto.test_cases ?? [],
    };

    const optionalFields: Array<[string, unknown]> = [
      ['subject_type', createQuestionDto.subject_type],
      ['execution_enabled', createQuestionDto.execution_enabled],
      ['starter_code', createQuestionDto.starter_code],
      ['sample_data', createQuestionDto.sample_data],
      ['expected_runtime', createQuestionDto.expected_runtime],
      ['difficulty_override', createQuestionDto.difficulty_override],
      ['exercise_type', createQuestionDto.exercise_type],
      ['subject_focus', createQuestionDto.subject_focus],
      ['interactive_config', createQuestionDto.interactive_config],
      ['validation_logic', createQuestionDto.validation_logic],
      ['hints_and_tips', createQuestionDto.hints_and_tips],
    ];

    for (const [key, value] of optionalFields) {
      if (value !== undefined) {
        questionPayload[key] = value;
      }
    }

    const { data: question, error: questionError } = await this.supabase
      .from('section_exercise_questions')
      .insert(questionPayload)
      .select()
      .single();

    if (questionError) {
      throw new Error(`Failed to create question: ${questionError.message}`);
    }

    try {
      if (
        Array.isArray(createQuestionDto.options) &&
        createQuestionDto.options.length > 0
      ) {
        const optionsData = createQuestionDto.options
          .map((option, index) => ({
            question_id: question.id,
            text: option.text,
            correct: option.correct,
            order_index: option.order_index ?? index,
          }))
          .filter(
            (option) =>
              typeof option.text === 'string' && option.text.trim().length > 0,
          );

        if (optionsData.length > 0) {
          const { error: optionsError } = await this.supabase
            .from('section_exercise_options')
            .insert(optionsData);

          if (optionsError) {
            throw new Error(
              `Failed to create question options: ${optionsError.message}`,
            );
          }
        }
      }

      if (
        Array.isArray(createQuestionDto.answers) &&
        createQuestionDto.answers.length > 0
      ) {
        const answersData = createQuestionDto.answers
          .map((answer) => this.mapAnswerInput(answer, question.id))
          .filter(
            (
              answer,
            ): answer is {
              question_id: string;
              answer_text: string;
              is_case_sensitive: boolean;
            } => answer !== null,
          );

        if (answersData.length > 0) {
          const { error: answersError } = await this.supabase
            .from('section_exercise_answers')
            .insert(answersData);

          if (answersError) {
            throw new Error(
              `Failed to create question answers: ${answersError.message}`,
            );
          }
        }
      }
    } catch (error) {
      await this.supabase
        .from('section_exercise_options')
        .delete()
        .eq('question_id', question.id);
      await this.supabase
        .from('section_exercise_answers')
        .delete()
        .eq('question_id', question.id);
      await this.supabase
        .from('section_exercise_questions')
        .delete()
        .eq('id', question.id);
      throw error;
    }

    return this.fetchQuestionWithRelations(question.id);
  }

  private async fetchExerciseWithRelations(exerciseId: string) {
    const { data, error } = await this.supabase
      .from('section_exercises')
      .select(
        `
        id,
        title,
        description,
        content,
        type,
        difficulty,
        status,
        order_index,
        time_limit,
        passing_score,
        max_attempts,
        created_at,
        updated_at,
        dataset,
        section_id,
        section_exercise_questions (
${this.questionSelect}
        )
      `,
      )
      .eq('id', exerciseId)
      .single();

    if (error) {
      const errorMessage = `Failed to fetch exercise ${exerciseId}: ${error.message} (Code: ${error.code}, Hint: ${error.hint})`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }

    return data;
  }

  async getExercisesBySection(sectionId: string, userId?: string) {
    let query = this.supabase
      .from('section_exercises')
      .select(
        `
      id,
      title,
      description,
      content,
      type,
      difficulty,
      status,
      order_index,
      time_limit,
      passing_score,
      max_attempts,
      created_at,
      updated_at,
      dataset,
      section_exercise_questions (
        id,
        type,
        text,
        hint,
        explanation,
        points,
        order_index,
        content,
        language,
        subject_type,
        execution_enabled,
        starter_code,
        test_cases,
        sample_data,
        expected_runtime,
        difficulty_override,
        exercise_type,
        subject_focus,
        interactive_config,
        validation_logic,
        hints_and_tips,
        created_at,
        updated_at,
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

    if (userId) {
      query = query.eq('user_id', userId);
    } else {
      query = query.is('user_id', null);
    }

    const { data, error } = await query;

    if (error) {
      throw new Error(`Failed to get exercises: ${error.message}`);
    }

    console.log('123456789');
    return { data };
  }

  async createExercise(
    sectionId: string,
    createExerciseDto: CreateExerciseDto,
    token: string,
  ) {
    const questionsInput = Array.isArray(createExerciseDto.questions)
      ? createExerciseDto.questions
      : [];

    let orderIndex = createExerciseDto.order_index;

    // Set default order_index if not provided
    if (orderIndex === undefined) {
      const { data: existingExercises, error: orderQueryError } =
        await this.supabase
          .from('section_exercises')
          .select('order_index')
          .eq('section_id', sectionId)
          .order('order_index', { ascending: false })
          .limit(1);

      if (orderQueryError) {
        throw new Error(
          `Failed to determine exercise order: ${orderQueryError.message}`,
        );
      }

      const [lastExercise] = existingExercises ?? [];
      const previousOrder =
        typeof lastExercise?.order_index === 'number'
          ? lastExercise.order_index
          : -1;
      orderIndex = previousOrder + 1;
    }

    const { data, error } = await this.supabase
      .from('section_exercises')
      .insert({
        section_id: sectionId,
        title: createExerciseDto.title,
        description: createExerciseDto.description,
        content: createExerciseDto.content,
        type: createExerciseDto.type || 'practice',
        difficulty: createExerciseDto.difficulty || 'easy',
        time_limit: createExerciseDto.time_limit,
        passing_score: createExerciseDto.passing_score || 70,
        max_attempts: createExerciseDto.max_attempts,
        order_index: orderIndex,
        status: 'draft',
      })
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create exercise: ${error.message}`);
    }

    const createdQuestions: any[] = [];
    const createdQuestionIds: string[] = [];

    if (questionsInput.length > 0) {
      try {
        for (let index = 0; index < questionsInput.length; index += 1) {
          const rawQuestion = questionsInput[index];
          if (!rawQuestion) continue;

          const text =
            typeof rawQuestion.text === 'string' ? rawQuestion.text.trim() : '';
          if (!text) continue;

          const preparedQuestion: CreateQuestionDto = {
            ...rawQuestion,
            text,
            type:
              typeof rawQuestion.type === 'string' &&
              rawQuestion.type.trim().length > 0
                ? rawQuestion.type
                : 'text',
            order_index:
              typeof rawQuestion.order_index === 'number'
                ? rawQuestion.order_index
                : index,
          };

          const createdQuestion = await this.createQuestionWithRelations(
            data.id,
            preparedQuestion,
          );

          if (createdQuestion) {
            if (createdQuestion.id) {
              createdQuestionIds.push(createdQuestion.id);
            }
            createdQuestions.push(createdQuestion);
          }
        }
      } catch (questionError) {
        if (createdQuestionIds.length > 0) {
          await this.supabase
            .from('section_exercise_options')
            .delete()
            .in('question_id', createdQuestionIds);
          await this.supabase
            .from('section_exercise_answers')
            .delete()
            .in('question_id', createdQuestionIds);
          await this.supabase
            .from('section_exercise_questions')
            .delete()
            .in('id', createdQuestionIds);
        }
        await this.supabase
          .from('section_exercises')
          .delete()
          .eq('id', data.id);
        throw questionError;
      }
    }

    createdQuestions.sort(
      (a, b) => (a?.order_index ?? 0) - (b?.order_index ?? 0),
    );

    const responseData = {
      ...data,
      section_exercise_questions: createdQuestions,
    };

    return { data: responseData };
  }

  async getExercise(exerciseId: string) {
    const data = await this.fetchExerciseWithRelations(exerciseId);

    return { data };
  }

  async updateExercise(
    exerciseId: string,
    updateExerciseDto: UpdateExerciseDto,
    token: string,
  ) {
    const updateData: any = {};

    if (updateExerciseDto.title !== undefined)
      updateData.title = updateExerciseDto.title;
    if (updateExerciseDto.description !== undefined)
      updateData.description = updateExerciseDto.description;
    if (updateExerciseDto.content !== undefined)
      updateData.content = updateExerciseDto.content;
    if (updateExerciseDto.type !== undefined)
      updateData.type = updateExerciseDto.type;
    if (updateExerciseDto.difficulty !== undefined)
      updateData.difficulty = updateExerciseDto.difficulty;
    if (updateExerciseDto.time_limit !== undefined)
      updateData.time_limit = updateExerciseDto.time_limit;
    if (updateExerciseDto.passing_score !== undefined)
      updateData.passing_score = updateExerciseDto.passing_score;
    if (updateExerciseDto.max_attempts !== undefined)
      updateData.max_attempts = updateExerciseDto.max_attempts;
    if (updateExerciseDto.order_index !== undefined)
      updateData.order_index = updateExerciseDto.order_index;
    if (updateExerciseDto.status !== undefined)
      updateData.status = updateExerciseDto.status;

    updateData.updated_at = new Date().toISOString();

    const { data, error } = await this.supabase
      .from('section_exercises')
      .update(updateData)
      .eq('id', exerciseId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to update exercise: ${error.message}`);
    }

    return { data };
  }

  async deleteExercise(exerciseId: string, token: string) {
    const { error } = await this.supabase
      .from('section_exercises')
      .delete()
      .eq('id', exerciseId);

    if (error) {
      throw new Error(`Failed to delete exercise: ${error.message}`);
    }

    return { success: true };
  }

  async addQuestion(
    exerciseId: string,
    createQuestionDto: CreateQuestionDto,
    token: string,
  ) {
    console.log('Adding question:', createQuestionDto);
    const question = await this.createQuestionWithRelations(
      exerciseId,
      createQuestionDto,
    );

    return { data: question };
  }

  async getQuestions(exerciseId: string) {
    try {
      // Verify exercise exists first
      const { data: exercise, error: exerciseError } = await this.supabase
        .from('section_exercises')
        .select('id')
        .eq('id', exerciseId)
        .single();

      if (exerciseError && exerciseError.code !== 'PGRST116') {
        console.warn(
          `Exercise ${exerciseId} not found or error fetching it: ${exerciseError.message}`,
        );
      }

      const { data, error } = await this.supabase
        .from('section_exercise_questions')
        .select(this.questionSelect)
        .eq('exercise_id', exerciseId)
        .order('order_index', { ascending: true });

      if (error) {
        const errorMessage = `Failed to get questions for exercise ${exerciseId}: ${error.message} (Code: ${error.code}, Hint: ${error.hint})`;
        console.error(errorMessage);
        throw new Error(errorMessage);
      }

      return { data: data || [] };
    } catch (err) {
      const errorMessage = `Error in getQuestions for exercise ${exerciseId}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(errorMessage);
      throw new Error(errorMessage);
    }
  }

  async updateQuestion(
    questionId: string,
    updateQuestionDto: UpdateQuestionDto,
    token: string,
  ) {
    const updateData: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };

    if (updateQuestionDto.type !== undefined)
      updateData.type = updateQuestionDto.type;
    if (updateQuestionDto.text !== undefined)
      updateData.text = updateQuestionDto.text;
    if (updateQuestionDto.hint !== undefined)
      updateData.hint = updateQuestionDto.hint;
    if (updateQuestionDto.explanation !== undefined)
      updateData.explanation = updateQuestionDto.explanation;
    if (updateQuestionDto.points !== undefined)
      updateData.points = updateQuestionDto.points;
    if (updateQuestionDto.order_index !== undefined)
      updateData.order_index = updateQuestionDto.order_index;
    if (updateQuestionDto.content !== undefined)
      updateData.content = updateQuestionDto.content;
    if (updateQuestionDto.language !== undefined)
      updateData.language = updateQuestionDto.language;
    if (updateQuestionDto.subject_type !== undefined)
      updateData.subject_type = updateQuestionDto.subject_type;
    if (updateQuestionDto.execution_enabled !== undefined)
      updateData.execution_enabled = updateQuestionDto.execution_enabled;
    if (updateQuestionDto.starter_code !== undefined)
      updateData.starter_code = updateQuestionDto.starter_code;
    if (updateQuestionDto.test_cases !== undefined)
      updateData.test_cases = updateQuestionDto.test_cases;
    if (updateQuestionDto.sample_data !== undefined)
      updateData.sample_data = updateQuestionDto.sample_data;
    if (updateQuestionDto.expected_runtime !== undefined)
      updateData.expected_runtime = updateQuestionDto.expected_runtime;
    if (updateQuestionDto.difficulty_override !== undefined)
      updateData.difficulty_override = updateQuestionDto.difficulty_override;
    if (updateQuestionDto.exercise_type !== undefined)
      updateData.exercise_type = updateQuestionDto.exercise_type;
    if (updateQuestionDto.subject_focus !== undefined)
      updateData.subject_focus = updateQuestionDto.subject_focus;
    if (updateQuestionDto.interactive_config !== undefined)
      updateData.interactive_config = updateQuestionDto.interactive_config;
    if (updateQuestionDto.validation_logic !== undefined)
      updateData.validation_logic = updateQuestionDto.validation_logic;
    if (updateQuestionDto.hints_and_tips !== undefined)
      updateData.hints_and_tips = updateQuestionDto.hints_and_tips;

    const { error } = await this.supabase
      .from('section_exercise_questions')
      .update(updateData)
      .eq('id', questionId);

    if (error) {
      throw new Error(`Failed to update question: ${error.message}`);
    }

    // Update options if provided
    if (updateQuestionDto.options) {
      // Delete existing options
      await this.supabase
        .from('section_exercise_options')
        .delete()
        .eq('question_id', questionId);

      // Add new options
      if (updateQuestionDto.options.length > 0) {
        const optionsData = updateQuestionDto.options
          .map((option, index) => ({
            question_id: questionId,
            text: option.text,
            correct: option.correct,
            order_index: option.order_index ?? index,
          }))
          .filter(
            (option) =>
              typeof option.text === 'string' && option.text.trim().length > 0,
          );

        if (optionsData.length > 0) {
          const { error: optionsError } = await this.supabase
            .from('section_exercise_options')
            .insert(optionsData);

          if (optionsError) {
            throw new Error(
              `Failed to update question options: ${optionsError.message}`,
            );
          }
        }
      }
    }

    // Update answers if provided
    if (updateQuestionDto.answers) {
      // Delete existing answers
      await this.supabase
        .from('section_exercise_answers')
        .delete()
        .eq('question_id', questionId);

      // Add new answers
      if (updateQuestionDto.answers.length > 0) {
        const answersData = updateQuestionDto.answers
          .map((answer) => this.mapAnswerInput(answer, questionId))
          .filter(
            (
              answer,
            ): answer is {
              question_id: string;
              answer_text: string;
              is_case_sensitive: boolean;
            } => answer !== null,
          );

        if (answersData.length > 0) {
          const { error: answersError } = await this.supabase
            .from('section_exercise_answers')
            .insert(answersData);

          if (answersError) {
            throw new Error(
              `Failed to update question answers: ${answersError.message}`,
            );
          }
        }
      }
    }

    const question = await this.fetchQuestionWithRelations(questionId);

    return { data: question };
  }

  async deleteQuestion(questionId: string, token: string) {
    const { error } = await this.supabase
      .from('section_exercise_questions')
      .delete()
      .eq('id', questionId);

    if (error) {
      throw new Error(`Failed to delete question: ${error.message}`);
    }

    return { success: true };
  }

  async upsertQuestionDataset(
    questionId: string,
    payload: UpsertQuestionDatasetDto,
  ) {
    const trimmedSql =
      typeof payload.creation_sql === 'string'
        ? payload.creation_sql.trim()
        : '';

    if (!trimmedSql) {
      throw new Error('Dataset SQL is required');
    }

    const { data: question, error: questionError } = await this.supabase
      .from('section_exercise_questions')
      .select('id,text,subject_type')
      .eq('id', questionId)
      .single();

    if (questionError || !question) {
      throw new Error('Question not found');
    }

    const datasetName =
      (typeof payload.name === 'string' && payload.name.trim().length > 0
        ? payload.name.trim()
        : undefined) ||
      (typeof question.text === 'string' && question.text.trim().length > 0
        ? `Dataset for ${question.text.trim().slice(0, 60)}`
        : 'Practice Dataset');

    const targetSubjectType =
      payload.subject_type || question.subject_type || 'sql';

    const { data: existing } = await this.supabase
      .from('practice_datasets')
      .select('id,schema_info')
      .eq('question_id', questionId)
      .maybeSingle();

    const existingSchemaInfo =
      existing?.schema_info &&
      typeof existing.schema_info === 'object' &&
      !Array.isArray(existing.schema_info)
        ? { ...existing.schema_info }
        : {};

    const updatedSchemaInfo: Record<string, unknown> = {
      ...existingSchemaInfo,
      data_creation_sql: trimmedSql,
      creation_sql: trimmedSql,
    };

    if (
      typeof payload.dataset_csv_raw === 'string' &&
      payload.dataset_csv_raw.trim().length > 0
    ) {
      updatedSchemaInfo.dataset_csv_raw = payload.dataset_csv_raw.trim();
    }

    if (
      Array.isArray(payload.dataset_rows) &&
      payload.dataset_rows.length > 0
    ) {
      updatedSchemaInfo.dataset_rows = payload.dataset_rows;
    }

    if (
      Array.isArray(payload.dataset_columns) &&
      payload.dataset_columns.length > 0
    ) {
      updatedSchemaInfo.dataset_columns = payload.dataset_columns;
    }

    if (
      typeof payload.dataset_description === 'string' &&
      payload.dataset_description.trim().length > 0
    ) {
      updatedSchemaInfo.dataset_description =
        payload.dataset_description.trim();
    }

    const baseRecord = {
      name: datasetName,
      subject_type: targetSubjectType,
      schema_info: updatedSchemaInfo,
      creation_sql: trimmedSql,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { data, error } = await this.supabase
        .from('practice_datasets')
        .update(baseRecord)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) {
        throw new Error(`Failed to update practice dataset: ${error.message}`);
      }

      return { data };
    }

    const insertPayload = {
      ...baseRecord,
      question_id: questionId,
      public: false,
      description:
        typeof payload.dataset_description === 'string' &&
        payload.dataset_description.trim().length > 0
          ? payload.dataset_description.trim()
          : `Dataset for ${question.text || 'question'}`,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase
      .from('practice_datasets')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to create practice dataset: ${error.message}`);
    }

    return { data };
  }

  async deleteQuestionDataset(questionId: string) {
    const { error } = await this.supabase
      .from('practice_datasets')
      .delete()
      .eq('question_id', questionId);

    if (error) {
      throw new Error(`Failed to delete practice dataset: ${error.message}`);
    }

    return { success: true };
  }

  async reorderExercises(
    sectionId: string,
    exerciseIds: string[],
    token: string,
  ) {
    const updatePromises = exerciseIds.map((exerciseId, index) =>
      this.supabase
        .from('section_exercises')
        .update({ order_index: index, updated_at: new Date().toISOString() })
        .eq('id', exerciseId)
        .eq('section_id', sectionId),
    );

    const results = await Promise.all(updatePromises);

    for (const result of results) {
      if (result.error) {
        throw new Error(`Failed to reorder exercises: ${result.error.message}`);
      }
    }

    return { success: true };
  }

  async getQuestionDataset(questionId: string, userId: string) {
    // First verify the user has access to this question
    const { data: question, error: questionError } = await this.supabase
      .from('section_exercise_questions')
      .select(
        `
        id,
        exercise_id,
        section_exercises!inner(
          section_id,
          sections!inner(
            course_id,
            course_enrollments!inner(user_id)
          )
        )
      `,
      )
      .eq('id', questionId)
      .eq('section_exercises.sections.course_enrollments.user_id', userId)
      .single();

    if (questionError || !question) {
      throw new Error('Question not found or access denied');
    }

    // Use the unified dataset execution service to get dataset for all subject types
    const datasetResult = await this.datasetExecutionService.getQuestionDataset(
      questionId,
      userId,
    );

    if (!datasetResult.success) {
      // Return null if no dataset found (some questions may not have datasets)
      return {
        data: null,
        question_id: questionId,
        error: datasetResult.error,
      };
    }

    return {
      data: datasetResult.data,
      datasetInfo: datasetResult.datasetInfo,
      question_id: questionId,
    };
  }
}
