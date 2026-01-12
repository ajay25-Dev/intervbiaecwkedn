export interface PracticeExercise {
  id: string;
  title: string;
  description: string;
  category: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  questions: PracticeExerciseQuestion[];
  created_at: string;
  updated_at: string;
}

export interface PracticeExerciseQuestion {
  id: string;
  exercise_id: string;
  question_text: string;
  question_type:
    | 'sql'
    | 'python'
    | 'google_sheets'
    | 'statistics'
    | 'reasoning'
    | 'math'
    | 'problem_solving'
    | 'geometry';
  options?: any; // For multiple choice, etc.
  correct_answer?: any;
  solution?: string;
  created_at: string;
  updated_at: string;
}

export interface PracticeExerciseAttempt {
  id: string;
  user_id: string;
  exercise_id: string;
  question_id: string;
  user_answer: any;
  is_correct: boolean;
  score: number;
  attempted_at: string;
}
