import { Injectable } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { readFile } from 'fs/promises';
import * as XLSX from 'xlsx';
import csv from 'csv-parser';
import { createReadStream } from 'fs';
import { ExerciseFromTemplateDto } from './exercises-upload.controller';

@Injectable()
export class ExercisesUploadService {
  private supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
  );

  async processUploadedFile(
    sectionId: string,
    filePath: string,
    format: 'json' | 'csv' | 'excel',
    options: any = {},
    token: string,
  ) {
    try {
      let exercises: any[] = [];

      switch (format) {
        case 'json':
          exercises = await this.parseJsonFile(filePath);
          break;
        case 'csv':
          exercises = await this.parseCsvFile(filePath, options);
          break;
        case 'excel':
          exercises = await this.parseExcelFile(filePath, options);
          break;
        default:
          throw new Error('Unsupported file format');
      }

      // Validate the parsed data
      const validation = await this.validateExerciseData(exercises);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          message: 'Validation failed',
        };
      }

      // Create exercises in bulk
      const result = await this.bulkCreateExercises(
        sectionId,
        exercises,
        token,
      );

      return {
        success: true,
        data: result.data,
        summary: {
          total_processed: exercises.length,
          successful: result.successful,
          failed: result.failed,
          errors: result.errors,
        },
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to process file: ${error.message}`,
      };
    }
  }

  async bulkCreateExercises(
    sectionId: string,
    exercises: any[],
    token: string,
  ) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    const results: any[] = [];
    const errors: any[] = [];
    let successful = 0;
    let failed = 0;

    for (const [index, exerciseData] of exercises.entries()) {
      try {
        // Create the exercise
        const { data: exercise, error: exerciseError } = await this.supabase
          .from('section_exercises')
          .insert({
            section_id: sectionId,
            title: exerciseData.title,
            description: exerciseData.description,
            content: exerciseData.content,
            type: exerciseData.type || 'practice',
            difficulty: exerciseData.difficulty || 'easy',
            time_limit: exerciseData.time_limit,
            passing_score: exerciseData.passing_score || 70,
            max_attempts: exerciseData.max_attempts,
            order_index: exerciseData.order_index || index,
            programming_language: exerciseData.programming_language || 'python',
            status: 'draft',
          })
          .select()
          .single();

        if (exerciseError) {
          throw new Error(`Exercise creation failed: ${exerciseError.message}`);
        }

        // Create questions if provided
        if (exerciseData.questions && exerciseData.questions.length > 0) {
          await this.createQuestionsForExercise(
            exercise.id,
            exerciseData.questions,
            token,
          );
        }

        results.push(exercise);
        successful++;
      } catch (error) {
        errors.push({
          index,
          exercise: exerciseData.title,
          error: error.message,
        });
        failed++;
      }
    }

    return {
      success: true,
      data: results,
      successful,
      failed,
      errors,
    };
  }

  async createFromTemplate(
    sectionId: string,
    templateData: ExerciseFromTemplateDto,
    token: string,
  ) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    // Get template data (this would come from a templates table)
    const { data: template, error: templateError } = await this.supabase
      .from('exercise_templates')
      .select('*')
      .eq('id', templateData.template_id)
      .single();

    if (templateError) {
      throw new Error(`Template not found: ${templateError.message}`);
    }

    // Create exercise from template
    console.log('Template data:', template);
    const exerciseData = {
      ...template,
      id: undefined, // Remove template ID
      section_id: sectionId,
      title: templateData.title,
      description: templateData.description || template.description,
      difficulty:
        templateData.customizations?.difficulty || template.difficulty,
      time_limit:
        templateData.customizations?.time_limit || template.time_limit,
      passing_score:
        templateData.customizations?.passing_score || template.passing_score,
      max_attempts:
        templateData.customizations?.max_attempts || template.max_attempts,
      status: 'published',
    };

    const { data: exercise, error: exerciseError } = await this.supabase
      .from('section_exercises')
      .insert(exerciseData)
      .select()
      .single();

    if (exerciseError) {
      throw new Error(
        `Failed to create exercise from template: ${exerciseError.message}`,
      );
    }

    // Copy questions from template if they exist
    const { data: templateQuestions } = await this.supabase
      .from('exercise_template_questions')
      .select('*')
      .eq('template_id', templateData.template_id);

    if (templateQuestions && templateQuestions.length > 0) {
      await this.createQuestionsForExercise(
        exercise.id,
        templateQuestions,
        token,
      );
    }

    return { success: true, data: exercise };
  }

  async addAssets(exerciseId: string, assets: any[], token: string) {
    // Set authorization header for RLS
    this.supabase.auth.setSession({
      access_token: token,
      refresh_token: '',
    } as any);

    // Get current exercise data
    const { data: exercise, error: fetchError } = await this.supabase
      .from('section_exercises')
      .select('content')
      .eq('id', exerciseId)
      .single();

    if (fetchError) {
      throw new Error(`Failed to fetch exercise: ${fetchError.message}`);
    }

    // Parse existing content or create new structure
    let content: any = {};
    try {
      content = exercise.content;
    } catch {
      content = {};
    }

    // Add assets to content
    if (!content.assets) {
      content.assets = [];
    }
    content.assets.push(...assets);

    // Update exercise with new assets
    const { data, error } = await this.supabase
      .from('section_exercises')
      .update({
        content: content.instructions,
        updated_at: new Date().toISOString(),
      })
      .eq('id', exerciseId)
      .select()
      .single();

    if (error) {
      throw new Error(`Failed to add assets: ${error.message}`);
    }

    return { success: true, data, assets_added: assets.length };
  }

  async importFromExternal(
    sectionId: string,
    platform: string,
    data: any,
    mappingConfig: Record<string, string> = {},
    token: string,
  ) {
    try {
      let exercises: any[] = [];

      switch (platform) {
        case 'moodle':
          exercises = this.parseMoodleData(data, mappingConfig);
          break;
        case 'blackboard':
          exercises = this.parseBlackboardData(data, mappingConfig);
          break;
        case 'canvas':
          exercises = this.parseCanvasData(data, mappingConfig);
          break;
        case 'google_forms':
          exercises = this.parseGoogleFormsData(data, mappingConfig);
          break;
        default:
          throw new Error(`Unsupported platform: ${platform}`);
      }

      return this.bulkCreateExercises(sectionId, exercises, token);
    } catch (error) {
      return {
        success: false,
        message: `Failed to import from ${platform}: ${error.message}`,
      };
    }
  }

  async validateExerciseData(exercises: any[]) {
    const errors: any[] = [];
    const warnings: any[] = [];

    for (const [index, exercise] of exercises.entries()) {
      const exerciseErrors: string[] = [];

      // Required fields validation
      if (!exercise.title || exercise.title.trim() === '') {
        exerciseErrors.push('Title is required');
      }

      // Type validation
      const validTypes = [
        'practice',
        'quiz',
        'assignment',
        'coding',
        'sql',
        'python',
        'statistics',
        'excel',
        'google_sheets',
      ];
      if (exercise.type && !validTypes.includes(exercise.type)) {
        exerciseErrors.push(
          `Invalid type: ${exercise.type}. Must be one of: ${validTypes.join(', ')}`,
        );
      }

      // Difficulty validation
      const validDifficulties = ['easy', 'medium', 'hard'];
      if (
        exercise.difficulty &&
        !validDifficulties.includes(exercise.difficulty)
      ) {
        exerciseErrors.push(
          `Invalid difficulty: ${exercise.difficulty}. Must be one of: ${validDifficulties.join(', ')}`,
        );
      }

      // Numeric fields validation
      if (
        exercise.time_limit &&
        (isNaN(exercise.time_limit) || exercise.time_limit < 0)
      ) {
        exerciseErrors.push('Time limit must be a positive number');
      }

      if (
        exercise.passing_score &&
        (isNaN(exercise.passing_score) ||
          exercise.passing_score < 0 ||
          exercise.passing_score > 100)
      ) {
        exerciseErrors.push('Passing score must be between 0 and 100');
      }

      // Questions validation
      if (exercise.questions && Array.isArray(exercise.questions)) {
        for (const [qIndex, question] of exercise.questions.entries()) {
          if (!question.text || question.text.trim() === '') {
            exerciseErrors.push(`Question ${qIndex + 1}: Text is required`);
          }

          const validQuestionTypes = [
            'mcq',
            'text',
            'fill-in-the-blanks',
            'coding',
          ];
          if (!question.type || !validQuestionTypes.includes(question.type)) {
            exerciseErrors.push(
              `Question ${qIndex + 1}: Invalid type. Must be one of: ${validQuestionTypes.join(', ')}`,
            );
          }

          // MCQ specific validation
          if (question.type === 'mcq' && question.options) {
            const correctOptions = question.options.filter(
              (opt) => opt.correct,
            );
            if (correctOptions.length === 0) {
              exerciseErrors.push(
                `Question ${qIndex + 1}: At least one correct option is required for MCQ`,
              );
            }
          }
        }
      }

      if (exerciseErrors.length > 0) {
        errors.push({
          index,
          exercise: exercise.title || `Exercise ${index + 1}`,
          errors: exerciseErrors,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async getUploadTemplates(format: 'json' | 'csv' | 'excel') {
    const templates = {
      json: {
        example: {
          exercises: [
            {
              title: 'Sample Exercise',
              description: 'This is a sample exercise description',
              content: 'Exercise content goes here',
              type: 'practice',
              difficulty: 'easy',
              time_limit: 30,
              passing_score: 70,
              max_attempts: 3,
              programming_language: 'python',
              order_index: 0,
              questions: [
                {
                  type: 'mcq',
                  text: 'What is 2 + 2?',
                  hint: 'Think about basic addition',
                  explanation: '2 + 2 equals 4',
                  points: 1,
                  order_index: 0,
                  options: [
                    { text: '3', correct: false, order_index: 0 },
                    { text: '4', correct: true, order_index: 1 },
                    { text: '5', correct: false, order_index: 2 },
                  ],
                },
                {
                  type: 'text',
                  text: 'Explain the concept of variables in programming',
                  points: 2,
                  order_index: 1,
                  answers: [
                    {
                      answer_text: 'Variables store data values',
                      is_case_sensitive: false,
                    },
                  ],
                },
              ],
            },
          ],
        },
        schema: {
          type: 'object',
          properties: {
            exercises: {
              type: 'array',
              items: {
                type: 'object',
                required: ['title'],
                properties: {
                  title: { type: 'string' },
                  description: { type: 'string' },
                  content: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: [
                      'practice',
                      'quiz',
                      'assignment',
                      'coding',
                      'sql',
                      'python',
                      'excel',
                    ],
                  },
                  difficulty: {
                    type: 'string',
                    enum: ['easy', 'medium', 'hard'],
                  },
                  time_limit: { type: 'number' },
                  passing_score: { type: 'number', minimum: 0, maximum: 100 },
                  max_attempts: { type: 'number' },
                  programming_language: { type: 'string' },
                  order_index: { type: 'number' },
                  questions: { type: 'array' },
                },
              },
            },
          },
        },
      },
      csv: {
        headers: [
          'title',
          'description',
          'content',
          'type',
          'difficulty',
          'time_limit',
          'passing_score',
          'max_attempts',
          'programming_language',
          'order_index',
        ],
        example_row: [
          'Sample Exercise',
          'Description',
          'Content',
          'practice',
          'easy',
          '30',
          '70',
          '3',
          'python',
          '0',
        ],
        notes: [
          'Questions should be added separately after exercise creation',
          'Use separate CSV files for questions and options',
          'Numeric fields should not contain quotes',
        ],
      },
      excel: {
        sheets: {
          exercises: {
            columns: [
              'title',
              'description',
              'content',
              'type',
              'difficulty',
              'time_limit',
              'passing_score',
              'max_attempts',
              'programming_language',
              'order_index',
            ],
            example: [
              [
                'Sample Exercise',
                'Description',
                'Content',
                'practice',
                'easy',
                30,
                70,
                3,
                'python',
                0,
              ],
            ],
          },
          questions: {
            columns: [
              'exercise_title',
              'type',
              'text',
              'hint',
              'explanation',
              'points',
              'order_index',
            ],
            example: [
              [
                'Sample Exercise',
                'mcq',
                'What is 2 + 2?',
                'Basic math',
                'Simple addition',
                1,
                0,
              ],
            ],
          },
          options: {
            columns: ['question_text', 'option_text', 'correct', 'order_index'],
            example: [
              ['What is 2 + 2?', '4', true, 0],
              ['What is 2 + 2?', '5', false, 1],
            ],
          },
        },
      },
    };

    return {
      success: true,
      data: templates[format],
      format,
    };
  }

  // Private helper methods
  private async parseJsonFile(filePath: string): Promise<any[]> {
    const fileContent = await readFile(filePath, 'utf-8');
    const data = JSON.parse(fileContent);
    return data.exercises || data;
  }

  private async parseCsvFile(
    filePath: string,
    options: any = {},
  ): Promise<any[]> {
    return new Promise((resolve, reject) => {
      const exercises: any[] = [];
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (row) => {
          exercises.push(this.mapCsvRowToExercise(row, options.column_mapping));
        })
        .on('end', () => resolve(exercises))
        .on('error', reject);
    });
  }

  private async parseExcelFile(
    filePath: string,
    options: any = {},
  ): Promise<any[]> {
    const workbook = XLSX.readFile(filePath);
    const sheetName = options.sheet_name || workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, {
      range: options.start_row || 0,
    });

    return data.map((row) =>
      this.mapExcelRowToExercise(row, options.column_mapping),
    );
  }

  private mapCsvRowToExercise(
    row: any,
    columnMapping: Record<string, string> = {},
  ): any {
    const mapping = {
      title: 'title',
      description: 'description',
      content: 'content',
      type: 'type',
      difficulty: 'difficulty',
      time_limit: 'time_limit',
      passing_score: 'passing_score',
      max_attempts: 'max_attempts',
      order_index: 'order_index',
      programming_language: 'programming_language',
      ...columnMapping,
    };

    const exercise = {};
    for (const [key, csvColumn] of Object.entries(mapping)) {
      if (row[csvColumn] !== undefined) {
        exercise[key] = this.convertValue(row[csvColumn], key);
      }
    }

    return exercise;
  }

  private mapExcelRowToExercise(
    row: any,
    columnMapping: Record<string, string> = {},
  ): any {
    return this.mapCsvRowToExercise(row, columnMapping);
  }

  private convertValue(value: any, key: string): any {
    const numericFields = [
      'time_limit',
      'passing_score',
      'max_attempts',
      'order_index',
    ];
    if (numericFields.includes(key) && value !== undefined && value !== '') {
      return parseInt(value, 10);
    }
    return value;
  }

  private async createQuestionsForExercise(
    exerciseId: string,
    questions: any[],
    token: string,
  ) {
    for (const [index, questionData] of questions.entries()) {
      // Create question
      const { data: question, error: questionError } = await this.supabase
        .from('section_exercise_questions')
        .insert({
          exercise_id: exerciseId,
          type: questionData.type,
          text: questionData.text,
          hint: questionData.hint,
          explanation: questionData.explanation,
          points: questionData.points || 1,
          order_index: questionData.order_index || index,
          content: questionData.content,
          language: questionData.language,
        })
        .select()
        .single();

      if (questionError) {
        throw new Error(`Question creation failed: ${questionError.message}`);
      }

      // Create options for MCQ questions
      if (questionData.options && questionData.options.length > 0) {
        const options = questionData.options.map((opt, optIndex) => ({
          question_id: question.id,
          text: opt.text,
          correct: opt.correct,
          order_index: opt.order_index || optIndex,
        }));

        const { error: optionsError } = await this.supabase
          .from('section_exercise_options')
          .insert(options);

        if (optionsError) {
          throw new Error(`Options creation failed: ${optionsError.message}`);
        }
      }

      // Create answers for text questions
      if (questionData.answers && questionData.answers.length > 0) {
        const answers = questionData.answers.map((ans) => ({
          question_id: question.id,
          answer_text: ans.answer_text,
          is_case_sensitive: ans.is_case_sensitive || false,
        }));

        const { error: answersError } = await this.supabase
          .from('section_exercise_answers')
          .insert(answers);

        if (answersError) {
          throw new Error(`Answers creation failed: ${answersError.message}`);
        }
      }
    }
  }

  // Platform-specific parsers
  private parseMoodleData(
    data: any,
    mappingConfig: Record<string, string>,
  ): any[] {
    // Implementation for Moodle XML/JSON format
    // This would parse Moodle's specific format
    return [];
  }

  private parseBlackboardData(
    data: any,
    mappingConfig: Record<string, string>,
  ): any[] {
    // Implementation for Blackboard format
    return [];
  }

  private parseCanvasData(
    data: any,
    mappingConfig: Record<string, string>,
  ): any[] {
    // Implementation for Canvas format
    return [];
  }

  private parseGoogleFormsData(
    data: any,
    mappingConfig: Record<string, string>,
  ): any[] {
    // Implementation for Google Forms format
    return [];
  }
}
