import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

export type GeneratedQuestion = {
  main_topic: string;
  topic_hierarchy: string;
  question_number: number;
  difficulty: string;
  question: string;
  options: {
    label: string;
    text: string;
  }[];
  correct_option: {
    label: string;
    text: string;
  };
  explanation: string;
};

export type GenerationInput = {
  main_topic: string;
  topic_hierarchy: string;
  Student_level_in_topic: string;
  question_number: number;
  target_len: number;
  conversation_history: Array<{
    main_topic: string;
    topic_hierarchy: string;
    question_number: number;
    difficulty: string;
    question: string;
    options: {
      label: string;
      text: string;
    }[];
    correct_option: {
      label: string;
      text: string;
    };
    explanation: string;
  }>;
};

export type GenerationResponse = {
  stop: boolean;
  question: GeneratedQuestion;
};

export type SectionBasedQuizGenerationInput = {
  courseId: string;
  subjectId: string;
  sectionId: string;
  sectionTitle: string;
  difficulty?: 'Beginner' | 'Intermediate' | 'Advanced';
  questionCount?: number;
  questionTypes?: string[];
  prevQuizResult?: {
    score: number;
    answers: Record<string, any>;
    feedback?: string;
    stop?: boolean;
  };
};

@Injectable()
export class QuizGenerationService {
  private apiUrl = process.env.BASE_AI_API_URL + '/generate-quiz';
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  async generateQuestions(input: GenerationInput): Promise<{
    questions: GeneratedQuestion[];
    shouldContinue: boolean;
  }> {
    const questions: GeneratedQuestion[] = [];
    const currentInput = input;
    let shouldContinue = false;

    // console.log('Starting question generation with input:', {
    //   main_topic: input.main_topic,
    //   topic_hierarchy: input.topic_hierarchy,
    //   target_len: input.target_len,
    // });

    do {
      try {
        // console.log(
        //   `Calling AI API for question ${currentInput.question_number} at ${this.apiUrl}`,
        // );
        const response = await fetch(this.apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            main_topic: currentInput.main_topic,
            topic_hierarchy: currentInput.topic_hierarchy,
            Student_level_in_topic: currentInput.Student_level_in_topic,
            question_number: currentInput.question_number,
            target_len: currentInput.target_len,
            conversation_history: currentInput.conversation_history,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(
            `Quiz generation API failed: ${response.status} ${response.statusText}`,
            errorText,
          );
          throw new InternalServerErrorException(
            `Quiz generation API failed: ${response.status} ${response.statusText}`,
          );
        }

        const data: GenerationResponse = await response.json();
        // console.log('AI API response:', {
        //   stop: data.stop,
        //   hasQuestion: !!data.question,
        // });

        questions.push(data.question);
        shouldContinue = !data.stop;

        // Update history and question_number for next iteration
        if (shouldContinue) {
          currentInput.conversation_history.push(data.question);
          currentInput.question_number += 1;
        }
      } catch (error) {
        console.error('Error generating quiz question:', error);
        throw new InternalServerErrorException(
          `Failed to generate quiz question: ${error.message}`,
        );
      }
    } while (shouldContinue);

    return { questions, shouldContinue: false };
  }

  async generateSectionQuiz(
    input: SectionBasedQuizGenerationInput,
  ): Promise<any> {
    // Check if stop flag is set from previous result
    if (input.prevQuizResult?.stop) {
      return {
        stop: true,
        shouldGenerateNext: false,
        message: 'Quiz session stopped as requested.',
      };
    }

    try {
      // Get section context from the database
      const sectionContext = await this.getSectionContext(
        input.courseId,
        input.subjectId,
        input.sectionId,
      );

      if (!sectionContext) {
        throw new InternalServerErrorException('Section not found');
      }

      // Determine student level, adjusting for previous quiz result if available
      let studentLevel = this.mapDifficultyToLevel(
        input.difficulty || 'Intermediate',
      );
      if (input.prevQuizResult) {
        const prevScore = input.prevQuizResult.score;
        if (prevScore < 60) {
          studentLevel = 'beginner';
        } else if (prevScore > 80) {
          studentLevel = 'advanced';
        }
        // Optionally adjust based on feedback/topics, but keep simple
      }

      // Map section-based input to the AI service format
      const aiInput: GenerationInput = {
        main_topic: sectionContext.currentSectionLectures.join(', '),
        topic_hierarchy: sectionContext.allPreviousLectures.join(', '),
        Student_level_in_topic: studentLevel,
        question_number: 1,
        target_len: input.questionCount || 5,
        conversation_history: [],
      };

      // Append previous quiz summary to history if available for cross-quiz adaptation
      if (input.prevQuizResult) {
        const prevSummary: any = {
          main_topic: sectionContext.currentSectionLectures.join(', '),
          topic_hierarchy: sectionContext.allPreviousLectures.join(', '),
          question_number: 0,
          difficulty: studentLevel,
          question: 'Previous quiz summary',
          options: [],
          correct_option: {
            label: 'A',
            text: `User scored ${input.prevQuizResult.score}%`,
          },
          explanation:
            input.prevQuizResult.feedback ||
            'Continue practicing to improve mastery.',
        };
        aiInput.conversation_history.push(prevSummary);
      }

      // Generate quiz using the AI service
      // console.log('Calling AI service to generate questions...');
      const { questions } = await this.generateQuestions(aiInput);
      // console.log(`AI service returned ${questions?.length || 0} questions`);
      // if (questions && questions.length > 0) {
      //   console.log(
      //     'First question structure:',
      //     JSON.stringify(questions[0], null, 2),
      //   );
      // }

      // Store the generated quiz in the database (add prev_quiz_id if present for chaining)
      const storedQuizInput = {
        ...input,
        prev_quiz_id: input.prevQuizResult ? undefined : null, // Assume prev_quiz_id from future extension
      };
      // console.log('Storing quiz in database...');
      const storedQuiz = await this.storeGeneratedQuiz(
        storedQuizInput,
        questions,
        sectionContext,
      );
      // console.log('Quiz stored successfully');

      // Determine if should generate next quiz (e.g., if score < 80%, continue session)
      const shouldGenerateNext =
        !input.prevQuizResult || input.prevQuizResult.score < 80;

      return {
        ...storedQuiz,
        questions,
        shouldGenerateNext,
      };
    } catch (error) {
      console.error('Error generating section quiz:', error);
      // Return a fallback quiz if AI service fails
      return this.createFallbackQuiz(input);
    }
  }

  private async getSectionContext(
    courseId: string,
    subjectId: string,
    sectionId: string,
  ) {
    // Get course information
    const { data: course, error: courseError } = await this.supabase
      .from('courses')
      .select('title')
      .eq('id', courseId)
      .single();

    if (courseError) {
      console.error('Course not found:', courseError);
      return null;
    }

    // Get subject information
    const { data: subject, error: subjectError } = await this.supabase
      .from('subjects')
      .select('title')
      .eq('id', subjectId)
      .single();

    if (subjectError) {
      console.error('Subject not found:', subjectError);
      return null;
    }

    // Get section information
    const { data: section, error: sectionError } = await this.supabase
      .from('sections')
      .select('title, overview, order_index')
      .eq('id', sectionId)
      .single();

    if (sectionError) {
      console.error('Section not found:', sectionError);
      return null;
    }

    // Get current section's lectures for main_topic
    const { data: currentSectionLectures, error: currentLecturesError } =
      await this.supabase
        .from('lectures')
        .select('title')
        .eq('section_id', sectionId)
        .order('order_index', { ascending: true });

    if (currentLecturesError) {
      console.error(
        'Error fetching current section lectures:',
        currentLecturesError,
      );
      return null;
    }

    // Get current section's module information
    const { data: currentModule, error: currentModuleError } =
      await this.supabase
        .from('sections')
        .select('module_id')
        .eq('id', sectionId)
        .single();

    if (currentModuleError) {
      console.error('Error fetching current module:', currentModuleError);
      return null;
    }

    // Get current module's order_index
    const { data: moduleInfo, error: moduleInfoError } = await this.supabase
      .from('modules')
      .select('order_index')
      .eq('id', currentModule.module_id)
      .single();

    if (moduleInfoError) {
      console.error('Error fetching module info:', moduleInfoError);
      return null;
    }

    // Get all modules from the same subject that come before or equal to current module
    const { data: previousModules, error: previousModulesError } =
      await this.supabase
        .from('modules')
        .select('id, order_index')
        .eq('subject_id', subjectId)
        .lte('order_index', moduleInfo.order_index)
        .order('order_index', { ascending: true });

    if (previousModulesError) {
      console.error('Error fetching previous modules:', previousModulesError);
      return null;
    }

    // Get all sections from previous modules including current module
    let allPreviousLectures: string[] = [];
    if (previousModules && previousModules.length > 0) {
      const moduleIds = previousModules.map((m) => m.id);

      // Get all sections from these modules, ordered by module order, then section order
      const { data: allSections, error: allSectionsError } = await this.supabase
        .from('sections')
        .select('id, module_id, order_index')
        .in('module_id', moduleIds)
        .order('module_id, order_index', { ascending: true });

      if (allSectionsError) {
        console.error('Error fetching all sections:', allSectionsError);
        return null;
      }

      if (allSections && allSections.length > 0) {
        const sectionIds = allSections.map((s) => s.id);

        // Get all lectures from these sections, ordered by section, then lecture order
        const { data: allLectures, error: allLecturesError } =
          await this.supabase
            .from('lectures')
            .select('title, section_id, order_index')
            .in('section_id', sectionIds)
            .order('section_id, order_index', { ascending: true });

        if (allLecturesError) {
          console.error(
            'Error fetching all previous lectures:',
            allLecturesError,
          );
          return null;
        }

        allPreviousLectures =
          allLectures?.map((lecture) => lecture.title) || [];
      }
    }

    return {
      courseTitle: course.title,
      subjectTitle: subject.title,
      sectionTitle: section.title,
      sectionOverview: section.overview,
      currentSectionLectures:
        currentSectionLectures?.map((lecture) => lecture.title) || [],
      allPreviousLectures: allPreviousLectures,
    };
  }

  private async storeGeneratedQuiz(
    input: SectionBasedQuizGenerationInput,
    questions: GeneratedQuestion[],
    context: any,
  ) {
    // Get the max order_index for existing quizzes in this section to append
    const { data: existingQuizzes } = await this.supabase
      .from('quizzes')
      .select('order_index')
      .eq('section_id', input.sectionId)
      .eq('status', 'published')
      .order('order_index', { ascending: false })
      .limit(1);

    const nextOrderIndex =
      existingQuizzes && existingQuizzes.length > 0
        ? existingQuizzes[0].order_index + 1
        : 0;

    // Create a quiz record
    // console.log('Creating quiz for section:', input.sectionId);
    const quizData = {
      section_id: input.sectionId,
      title: `${input.sectionTitle} - Knowledge Check`,
      description: `Quiz for ${input.sectionTitle} section ${nextOrderIndex + 1}`,
      type: 'knowledge_check',
      time_limit: 300, // 5 minutes default
      passing_score: 70,
      max_attempts: 3,
      status: 'published',
      order_index: nextOrderIndex,
      // prev_quiz_id: input.prev_quiz_id, // If extending for chaining
    };
    // console.log('Quiz data:', quizData);

    const { data: quiz, error: quizError } = await this.supabase
      .from('quizzes')
      .insert(quizData)
      .select()
      .single();

    if (quizError) {
      console.error('Failed to insert quiz:', quizError);
      throw new InternalServerErrorException(
        `Failed to store quiz: ${quizError.message}`,
      );
    }

    // console.log('Quiz created successfully:', quiz.id);

    // Store quiz questions
    if (questions && Array.isArray(questions)) {
      const questionsData = questions.map(
        (question: GeneratedQuestion, index: number) => ({
          quiz_id: quiz.id,
          type: 'mcq',
          text: question.question,
          explanation: question.explanation || '',
          points: 1,
          order_index: index,
        }),
      );

      // console.log(
      //   `Inserting ${questionsData.length} questions for quiz ${quiz.id}`,
      // );

      const { data: storedQuestions, error: questionsError } =
        await this.supabase
          .from('quiz_questions')
          .insert(questionsData)
          .select();

      if (questionsError) {
        console.error('Failed to insert quiz questions:', questionsError);
        // Cleanup quiz if questions failed
        await this.supabase.from('quizzes').delete().eq('id', quiz.id);
        throw new InternalServerErrorException(
          `Failed to store quiz questions: ${questionsError.message}`,
        );
      }

      // console.log(
      //   `Successfully inserted ${storedQuestions?.length || 0} questions`,
      // );

      // Store quiz options for MCQ questions
      for (let i = 0; i < storedQuestions.length; i++) {
        const question = questions[i];
        const storedQuestion = storedQuestions[i];

        if (question.options && Array.isArray(question.options)) {
          const optionsData = question.options.map(
            (option: any, optionIndex: number) => ({
              question_id: storedQuestion.id,
              text: option.text,
              correct: option.label === question.correct_option.label,
              order_index: optionIndex,
            }),
          );

          // console.log(
          //   `Inserting ${optionsData.length} options for question ${storedQuestion.id}:`,
          //   optionsData,
          // );

          const { data: insertedOptions, error: optionsError } =
            await this.supabase
              .from('quiz_options')
              .insert(optionsData)
              .select();

          if (optionsError) {
            console.error(
              `Failed to insert quiz options for question ${storedQuestion.id}:`,
              optionsError,
            );
            // Cleanup quiz and questions if options failed
            await this.supabase.from('quizzes').delete().eq('id', quiz.id);
            throw new InternalServerErrorException(
              `Failed to store quiz options: ${optionsError.message}`,
            );
          }

          // console.log(
          //   `Successfully inserted ${insertedOptions?.length || 0} options for question ${storedQuestion.id}`,
          // );
        }
      }

      return { quiz, questions: storedQuestions };
    }

    return { quiz, questions: [] };
  }

  private createFallbackQuiz(input: SectionBasedQuizGenerationInput) {
    // Create a simple fallback quiz structure
    return {
      quiz: {
        title: `${input.sectionTitle} - Knowledge Check`,
        description: `Quiz for ${input.sectionTitle} section`,
        type: 'knowledge_check',
        questions: [
          {
            type: 'mcq',
            text: `Which concept is most important in ${input.sectionTitle}?`,
            options: [
              { text: 'Understanding the fundamentals', correct: true },
              { text: 'Memorizing syntax', correct: false },
              { text: 'Speed of execution', correct: false },
              { text: 'Advanced techniques only', correct: false },
            ],
            explanation:
              'Understanding fundamentals is crucial for building strong knowledge.',
          },
        ],
      },
      fallback: true,
    };
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

  async getSectionQuizzes(sectionId: string) {
    const { data, error } = await this.supabase
      .from('quizzes')
      .select(
        `
        id,
        title,
        description,
        type,
        time_limit,
        passing_score,
        max_attempts,
        status,
        order_index,
        quiz_questions (
          id,
          type,
          text,
          explanation,
          points,
          order_index,
          quiz_options (
            id,
            text,
            correct,
            order_index
          )
        )
      `,
      )
      .eq('section_id', sectionId)
      .eq('status', 'published')
      .order('order_index', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(
        `Failed to get section quizzes: ${error.message}`,
      );
    }

    return data;
  }
}
