import {
  type Difficulty,
  type GamificationConfig,
  type QuestionProgress,
  type QuestionType,
} from './gamification-core';

export interface UserProgress {
  userId: string;
  totalXp: number;
  currentLevel: number;
  lastXpEventAt?: Date | string | null;
}

export interface UserQuestionProgress extends QuestionProgress {
  userId: string;
}

export interface LectureCompletion {
  userId: string;
  lectureId: string;
  completedAt: Date;
}

export abstract class GamificationConfigProvider {
  abstract getConfig(): Promise<GamificationConfig>;
}

export abstract class UserProgressRepository {
  abstract getUserProgress(userId: string): Promise<UserProgress | null>;
  abstract saveUserProgress(progress: UserProgress): Promise<void>;
}

export abstract class UserQuestionProgressRepository {
  abstract getQuestionProgress(
    userId: string,
    questionId: string,
  ): Promise<UserQuestionProgress | null>;
  abstract saveQuestionProgress(progress: UserQuestionProgress): Promise<void>;
}

export abstract class LectureProgressRepository {
  abstract hasUserCompletedLecture(
    userId: string,
    lectureId: string,
  ): Promise<boolean>;
  abstract markLectureCompleted(
    userId: string,
    lectureId: string,
  ): Promise<void>;
}

export class QuestionAttemptDto {
  questionId!: string;
  questionType!: QuestionType;
  difficulty!: Difficulty;
  isCorrect!: boolean;
}

export class LectureCompletionDto {
  lectureId!: string;
}
