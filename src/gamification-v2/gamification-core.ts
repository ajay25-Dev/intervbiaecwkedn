/**
 * Difficulty buckets supported by the LMS.
 */
export type Difficulty = 'easy' | 'medium' | 'hard';

/**
 * Question categories supported by the LMS.
 */
export type QuestionType = 'quiz' | 'practice';

export interface QuestionXpConfig {
  firstAttemptXp: {
    quiz: Record<Difficulty, number>;
    practice: Record<Difficulty, number>;
  };
  secondAttemptMultiplier: number;
}

export interface LectureXpConfig {
  firstCompletionXp: number;
}

export interface LevelConfig {
  baseIncrement: number;
}

export interface GamificationConfig {
  questionXp: QuestionXpConfig;
  lectureXp: LectureXpConfig;
  level: LevelConfig;
}

export interface QuestionProgress {
  questionId: string;
  attemptsCount: number;
  firstAttemptCorrect?: boolean;
  secondAttemptCorrect?: boolean;
  totalXpEarnedForThisQuestion: number;
}

export interface QuestionAttemptInput {
  questionId: string;
  questionType: QuestionType;
  difficulty: Difficulty;
  attemptNumber?: number;
  isCorrect: boolean;
  previousProgress?: QuestionProgress;
}

export interface QuestionAttemptResult {
  xpAwarded: number;
  updatedProgress: QuestionProgress;
}

/**
 * Calculates XP for a question attempt following the config rules.
 */
export function calculateQuestionXp(
  input: QuestionAttemptInput,
  config: GamificationConfig,
): QuestionAttemptResult {
  const previous = input.previousProgress ?? {
    questionId: input.questionId,
    attemptsCount: 0,
    firstAttemptCorrect: false,
    secondAttemptCorrect: false,
    totalXpEarnedForThisQuestion: 0,
  };

  const currentAttempt = previous.attemptsCount + 1;
  let xpAwarded = 0;

  const updatedProgress: QuestionProgress = {
    questionId: input.questionId,
    attemptsCount: currentAttempt,
    firstAttemptCorrect: previous.firstAttemptCorrect ?? false,
    secondAttemptCorrect: previous.secondAttemptCorrect ?? false,
    totalXpEarnedForThisQuestion: previous.totalXpEarnedForThisQuestion ?? 0,
  };

  const typeBuckets =
    config.questionXp.firstAttemptXp[input.questionType] ??
    config.questionXp.firstAttemptXp.quiz ??
    config.questionXp.firstAttemptXp.practice;
  const baseXp = typeBuckets?.[input.difficulty] ?? typeBuckets?.medium ?? 0;

  if (currentAttempt >= 3 || !input.isCorrect) {
    xpAwarded = 0;
  } else if (currentAttempt === 1) {
    xpAwarded = baseXp;
    updatedProgress.firstAttemptCorrect = true;
  } else if (currentAttempt === 2) {
    const multiplier = config.questionXp.secondAttemptMultiplier ?? 0;
    xpAwarded = Math.round(baseXp * multiplier);
    updatedProgress.secondAttemptCorrect = true;
  }

  updatedProgress.totalXpEarnedForThisQuestion += xpAwarded;

  return {
    xpAwarded,
    updatedProgress,
  };
}

/**
 * Awards XP for lecture completion (once per lecture per user).
 */
export function calculateLectureXp(
  lectureCompletedBefore: boolean,
  config: GamificationConfig,
): number {
  if (lectureCompletedBefore) {
    return 0;
  }
  return config.lectureXp.firstCompletionXp;
}

/**
 * Triangular progression helper: XP required to reach the given level.
 */
export function xpToReachLevel(
  level: number,
  config: GamificationConfig,
): number {
  if (level <= 1) {
    return 0;
  }
  const baseIncrement = config.level.baseIncrement;
  const triangularWithoutOne = (level * (level + 1)) / 2 - 1;
  return Math.round(baseIncrement * triangularWithoutOne);
}

/**
 * Determines the player's level given a total XP value.
 */
export function getLevelForXp(
  totalXp: number,
  config: GamificationConfig,
): number {
  if (totalXp <= 0) {
    return 1;
  }

  let level = 1;
  // Iterate until the next level requires more XP than the user currently has.
  while (true) {
    const nextLevel = level + 1;
    const xpForNext = xpToReachLevel(nextLevel, config);
    if (totalXp < xpForNext) {
      break;
    }
    level = nextLevel;
  }

  return level;
}

/**
 * Returns metadata about the next level breakpoint for a given XP value.
 */
export function getXpToNextLevel(
  totalXp: number,
  config: GamificationConfig,
): {
  currentLevel: number;
  xpForNextLevel: number;
  xpRemaining: number;
} {
  const currentLevel = getLevelForXp(totalXp, config);
  const xpForNextLevel = xpToReachLevel(currentLevel + 1, config);
  const xpRemaining = Math.max(0, xpForNextLevel - totalXp);

  return {
    currentLevel,
    xpForNextLevel,
    xpRemaining,
  };
}

/**
 * Simple assertion helper for the built-in lightweight test suite.
 */
function assertEqual(actual: unknown, expected: unknown, message: string) {
  const norm = (value: unknown) =>
    typeof value === 'object' && value !== null
      ? JSON.stringify(value)
      : String(value);
  if (norm(actual) !== norm(expected)) {
    throw new Error(
      `${message} | expected=${norm(expected)} actual=${norm(actual)}`,
    );
  }
}

const TEST_CONFIG: Readonly<GamificationConfig> = {
  questionXp: {
    firstAttemptXp: {
      quiz: {
        easy: 15,
        medium: 25,
        hard: 40,
      },
      practice: {
        easy: 25,
        medium: 40,
        hard: 60,
      },
    },
    secondAttemptMultiplier: 0.4,
  },
  lectureXp: {
    firstCompletionXp: 50,
  },
  level: {
    baseIncrement: 100,
  },
};

function runGamificationCoreSelfTest() {
  const lectureAward = calculateLectureXp(false, TEST_CONFIG);
  assertEqual(lectureAward, 50, 'Lecture XP should match config');
  assertEqual(
    calculateLectureXp(true, TEST_CONFIG),
    0,
    'Lecture should not award twice',
  );

  const quizEasyFirst = calculateQuestionXp(
    {
      questionId: 'q1',
      questionType: 'quiz',
      difficulty: 'easy',
      isCorrect: true,
    },
    TEST_CONFIG,
  );
  assertEqual(quizEasyFirst.xpAwarded, 15, 'Quiz easy first attempt XP');

  const quizHardAttempt1 = calculateQuestionXp(
    {
      questionId: 'q2',
      questionType: 'quiz',
      difficulty: 'hard',
      isCorrect: false,
    },
    TEST_CONFIG,
  );
  assertEqual(quizHardAttempt1.xpAwarded, 0, 'Wrong attempt yields 0 XP');
  const quizHardAttempt2 = calculateQuestionXp(
    {
      questionId: 'q2',
      questionType: 'quiz',
      difficulty: 'hard',
      isCorrect: true,
      previousProgress: quizHardAttempt1.updatedProgress,
    },
    TEST_CONFIG,
  );
  assertEqual(quizHardAttempt2.xpAwarded, 16, 'Quiz hard second attempt XP');

  const practiceMediumFirst = calculateQuestionXp(
    {
      questionId: 'q3',
      questionType: 'practice',
      difficulty: 'medium',
      isCorrect: true,
    },
    TEST_CONFIG,
  );
  assertEqual(
    practiceMediumFirst.xpAwarded,
    40,
    'Practice medium first attempt XP',
  );
  const practiceMediumSecond = calculateQuestionXp(
    {
      questionId: 'q3',
      questionType: 'practice',
      difficulty: 'medium',
      isCorrect: true,
      previousProgress: practiceMediumFirst.updatedProgress,
    },
    TEST_CONFIG,
  );
  assertEqual(
    practiceMediumSecond.xpAwarded,
    16,
    'Practice medium second attempt XP',
  );
  const practiceMediumThird = calculateQuestionXp(
    {
      questionId: 'q3',
      questionType: 'practice',
      difficulty: 'medium',
      isCorrect: true,
      previousProgress: practiceMediumSecond.updatedProgress,
    },
    TEST_CONFIG,
  );
  assertEqual(practiceMediumThird.xpAwarded, 0, 'No XP after second attempt');

  assertEqual(getLevelForXp(0, TEST_CONFIG), 1, 'Level at 0 XP');
  assertEqual(getLevelForXp(200, TEST_CONFIG), 2, 'Level at 200 XP');
  assertEqual(getLevelForXp(499, TEST_CONFIG), 2, 'Level below 500 XP');
  assertEqual(getLevelForXp(500, TEST_CONFIG), 3, 'Level at 500 XP');

  assertEqual(
    getXpToNextLevel(500, TEST_CONFIG),
    { currentLevel: 3, xpForNextLevel: 900, xpRemaining: 400 },
    'XP remaining to level 4',
  );
}

if (process.env.GAMIFICATION_CORE_TESTS !== 'skip') {
  runGamificationCoreSelfTest();
}
