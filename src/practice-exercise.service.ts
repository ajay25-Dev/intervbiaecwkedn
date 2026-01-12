import { Injectable, NotFoundException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import {
  PracticeExercise,
  PracticeExerciseQuestion,
  PracticeExerciseAttempt,
} from './practice-exercise.dto';

@Injectable()
export class PracticeExerciseService {
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  async getAllExercises(userId: string): Promise<PracticeExercise[]> {
    const { data, error } = await this.supabase
      .from('section_exercises')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      throw new Error('Could not fetch exercises');
    }

    return data;
  }

  async getExerciseById(exerciseId: string): Promise<PracticeExercise> {
    const { data, error } = await this.supabase
      .from('section_exercises')
      .select('*, questions:section_exercise_questions(*)')
      .eq('id', exerciseId)
      .single();

    if (error) {
      throw new NotFoundException('Exercise not found');
    }

    return data;
  }

  async getExerciseQuestions(
    exerciseId: string,
  ): Promise<PracticeExerciseQuestion[]> {
    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .select('*')
      .eq('exercise_id', exerciseId);

    if (error) {
      throw new Error('Could not fetch questions for the exercise');
    }

    return data;
  }

  async submitAttempt(
    attempt: Partial<PracticeExerciseAttempt>,
  ): Promise<PracticeExerciseAttempt> {
    // In a real app, you'd validate the answer and calculate the score here
    const is_correct = true; // Placeholder
    const score = 10; // Placeholder

    const { data, error } = await this.supabase
      .from('section_exercise_attempts')
      .insert([
        {
          ...attempt,
          is_correct,
          score,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error('Could not submit attempt');
    }

    return data;
  }

  async getUserAttemptsForQuestion(
    userId: string,
    questionId: string,
  ): Promise<PracticeExerciseAttempt[]> {
    const { data, error } = await this.supabase
      .from('section_exercise_attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .order('attempted_at', { ascending: false });

    if (error) {
      throw new Error('Could not fetch user attempts');
    }

    return data;
  }

  async getExerciseDatasets(exerciseId: string): Promise<any[]> {
    // Get all question IDs for this exercise
    const { data: questions, error: questionsError } = await this.supabase
      .from('section_exercise_questions')
      .select('id')
      .eq('exercise_id', exerciseId);

    if (questionsError) {
      throw new Error('Could not fetch questions for exercise');
    }

    if (!questions || questions.length === 0) {
      return [];
    }

    const questionIds = questions.map((q) => q.id);

    // Get all datasets for these questions
    const { data: datasets, error: datasetsError } = await this.supabase
      .from('practice_datasets')
      .select('*')
      .in('question_id', questionIds)
      .order('created_at', { ascending: true });

    if (datasetsError) {
      throw new Error('Could not fetch datasets for exercise');
    }

    return datasets || [];
  }

  // Create a new question for an exercise
  async createQuestion(
    exerciseId: string,
    questionData: any,
  ): Promise<PracticeExerciseQuestion> {
    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .insert([
        {
          exercise_id: exerciseId,
          ...questionData,
        },
      ])
      .select()
      .single();

    if (error) {
      throw new Error(`Could not create question: ${error.message}`);
    }

    return data;
  }

  // Update a question
  async updateQuestion(
    questionId: string,
    questionData: any,
  ): Promise<PracticeExerciseQuestion> {
    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .update(questionData)
      .eq('id', questionId)
      .select()
      .single();

    if (error) {
      throw new Error(`Could not update question: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException('Question not found');
    }

    return data;
  }

  // Delete a question
  async deleteQuestion(questionId: string): Promise<void> {
    const { error } = await this.supabase
      .from('section_exercise_questions')
      .delete()
      .eq('id', questionId);

    if (error) {
      throw new Error(`Could not delete question: ${error.message}`);
    }
  }

  // Update a practice exercise
  async updateExercise(
    exerciseId: string,
    exerciseData: any,
  ): Promise<PracticeExercise> {
    const { data, error } = await this.supabase
      .from('section_exercises')
      .update(exerciseData)
      .eq('id', exerciseId)
      .select()
      .single();

    if (error) {
      throw new Error(`Could not update exercise: ${error.message}`);
    }

    if (!data) {
      throw new NotFoundException('Exercise not found');
    }

    return data;
  }
}
