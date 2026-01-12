import { Injectable, InternalServerErrorException } from '@nestjs/common';

interface SeedData {
  categories: any[];
  questions: any[];
  templates: any[];
  courses: any[];
  subjects: any[];
  modules: any[];
}

@Injectable()
export class AssessmentDataSeeder {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();

  private headers() {
    const sk = this.serviceKey;
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      };
    }
    throw new InternalServerErrorException('Supabase keys missing for seeding');
  }

  async seedInitialData(adminUserId: string): Promise<void> {
    console.log('Starting assessment data seeding...');

    // Check if categories already exist
    const categoriesCheck = await fetch(
      `${this.restUrl}/assessment_categories?limit=1`,
      {
        headers: this.headers(),
      },
    );
    const existingCategories = await categoriesCheck.json();

    if (existingCategories.length > 0) {
      console.log('Assessment data already exists, skipping seed...');
      return;
    }

    const seedData: SeedData = this.getSeedData(adminUserId);

    try {
      // Seed categories first
      console.log('Seeding categories...');
      const categoriesRes = await fetch(
        `${this.restUrl}/assessment_categories`,
        {
          method: 'POST',
          headers: { ...this.headers(), Prefer: 'return=representation' },
          body: JSON.stringify(seedData.categories),
        },
      );

      if (!categoriesRes.ok) {
        throw new Error(`Failed to seed categories: ${categoriesRes.status}`);
      }

      const createdCategories = await categoriesRes.json();
      console.log(`Created ${createdCategories.length} categories`);

      // Map category names to IDs for questions
      const categoryMap = createdCategories.reduce((map, cat) => {
        map[cat.name] = cat.id;
        return map;
      }, {});

      // Seed courses
      console.log('Seeding courses...');
      const coursesRes = await fetch(`${this.restUrl}/courses`, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=representation' },
        body: JSON.stringify(seedData.courses),
      });

      if (!coursesRes.ok) {
        throw new Error(`Failed to seed courses: ${coursesRes.status}`);
      }

      const createdCourses = await coursesRes.json();
      console.log(`Created ${createdCourses.length} courses`);

      // Map course names to IDs
      const courseMap = createdCourses.reduce((map, course) => {
        map[course.title] = course.id;
        return map;
      }, {});

      // Seed subjects with course IDs
      console.log('Seeding subjects...');
      const subjectsWithCourses = seedData.subjects.map((s) => ({
        ...s,
        course_id: s.course_name ? courseMap[s.course_name] : null,
      }));

      // Remove the temporary course_name field
      subjectsWithCourses.forEach((s) => delete s.course_name);

      const subjectsRes = await fetch(`${this.restUrl}/subjects`, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=representation' },
        body: JSON.stringify(subjectsWithCourses),
      });

      if (!subjectsRes.ok) {
        throw new Error(`Failed to seed subjects: ${subjectsRes.status}`);
      }

      const createdSubjects = await subjectsRes.json();
      console.log(`Created ${createdSubjects.length} subjects`);

      // Map subject names to IDs
      const subjectMap = createdSubjects.reduce((map, subject) => {
        map[subject.title] = subject.id;
        return map;
      }, {});

      // Seed modules with subject IDs
      console.log('Seeding modules...');
      const modulesWithSubjects = seedData.modules.map((m) => ({
        ...m,
        subject_id: m.subject_name ? subjectMap[m.subject_name] : null,
      }));

      // Remove the temporary subject_name field
      modulesWithSubjects.forEach((m) => delete m.subject_name);

      const modulesRes = await fetch(`${this.restUrl}/modules`, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=representation' },
        body: JSON.stringify(modulesWithSubjects),
      });

      if (!modulesRes.ok) {
        throw new Error(`Failed to seed modules: ${modulesRes.status}`);
      }

      const createdModules = await modulesRes.json();
      console.log(`Created ${createdModules.length} modules`);

      // Map module names to IDs
      const moduleMap = createdModules.reduce((map, module) => {
        map[module.title] = module.id;
        return map;
      }, {});

      // Update questions with actual category IDs and module IDs
      const questionsWithCategories = seedData.questions.map((q) => ({
        ...q,
        category_id: q.category_name ? categoryMap[q.category_name] : null,
        module_id: q.module_name ? moduleMap[q.module_name] : null,
      }));

      // Remove the temporary fields
      questionsWithCategories.forEach((q) => {
        delete q.category_name;
        delete q.module_name;
      });

      // Seed questions
      console.log('Seeding questions...');
      const questionsRes = await fetch(`${this.restUrl}/assessment_questions`, {
        method: 'POST',
        headers: { ...this.headers(), Prefer: 'return=representation' },
        body: JSON.stringify(questionsWithCategories),
      });

      if (!questionsRes.ok) {
        throw new Error(`Failed to seed questions: ${questionsRes.status}`);
      }

      const createdQuestions = await questionsRes.json();
      console.log(`Created ${createdQuestions.length} questions`);

      // Seed question options for MCQ questions
      const mcqQuestions = createdQuestions.filter(
        (q) => q.question_type === 'mcq' || q.question_type === 'image_mcq',
      );

      for (const question of mcqQuestions) {
        const options = this.getQuestionOptions(question.question_text);
        if (options.length > 0) {
          const optionsPayload = options.map((option, index) => ({
            question_id: question.id,
            option_text: option.text,
            is_correct: option.isCorrect,
            order_index: index,
          }));

          await fetch(`${this.restUrl}/assessment_question_options`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(optionsPayload),
          });
        }
      }

      // Seed text answers for text questions
      const textQuestions = createdQuestions.filter(
        (q) => q.question_type === 'text' || q.question_type === 'image_text',
      );

      for (const question of textQuestions) {
        const textAnswer = this.getTextAnswer(question.question_text);
        if (textAnswer) {
          const textAnswerPayload = {
            question_id: question.id,
            correct_answer: textAnswer.correctAnswer,
            case_sensitive: textAnswer.caseSensitive,
            exact_match: textAnswer.exactMatch,
            alternate_answers: textAnswer.alternateAnswers || [],
            keywords: textAnswer.keywords || [],
          };

          await fetch(`${this.restUrl}/assessment_text_answers`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify([textAnswerPayload]),
          });
        }
      }

      console.log('Assessment data seeding completed successfully!');
    } catch (error) {
      console.error('Error seeding assessment data:', error);
      throw error;
    }
  }

  private getSeedData(adminUserId: string): SeedData {
    const categories = [
      {
        name: 'python_basics',
        display_name: 'Python Basics',
        description: 'Fundamental Python programming concepts',
        icon: '🐍',
        color: '#3776ab',
        order_index: 1,
      },
      {
        name: 'data_structures',
        display_name: 'Data Structures',
        description: 'Lists, dictionaries, sets, and tuples',
        icon: '📊',
        color: '#ff6b35',
        order_index: 2,
      },
      {
        name: 'pandas',
        display_name: 'Pandas',
        description: 'Data manipulation and analysis with Pandas',
        icon: '🐼',
        color: '#150458',
        order_index: 3,
      },
      {
        name: 'programming_logic',
        display_name: 'Programming Logic',
        description: 'Logical thinking and problem-solving',
        icon: '🧠',
        color: '#8b5a2b',
        order_index: 4,
      },
    ];

    const courses = [
      {
        title: 'Python Programming Fundamentals',
        description:
          'Complete course covering Python programming from basics to advanced topics',
        created_by: adminUserId,
      },
    ];

    const subjects = [
      {
        title: 'Python Basics',
        course_name: 'Python Programming Fundamentals',
        order_index: 1,
      },
      {
        title: 'Data Structures',
        course_name: 'Python Programming Fundamentals',
        order_index: 2,
      },
      {
        title: 'Pandas & Data Analysis',
        course_name: 'Python Programming Fundamentals',
        order_index: 3,
      },
      {
        title: 'Programming Logic',
        course_name: 'Python Programming Fundamentals',
        order_index: 4,
      },
    ];

    const modules = [
      // Python Basics modules
      {
        title: 'Variables and Data Types',
        subject_name: 'Python Basics',
        order_index: 1,
      },
      {
        title: 'Functions and Methods',
        subject_name: 'Python Basics',
        order_index: 2,
      },
      // Data Structures modules
      {
        title: 'Lists and Tuples',
        subject_name: 'Data Structures',
        order_index: 1,
      },
      {
        title: 'Dictionaries and Sets',
        subject_name: 'Data Structures',
        order_index: 2,
      },
      // Pandas modules
      {
        title: 'DataFrame Operations',
        subject_name: 'Pandas & Data Analysis',
        order_index: 1,
      },
      {
        title: 'Data Import/Export',
        subject_name: 'Pandas & Data Analysis',
        order_index: 2,
      },
      // Programming Logic modules
      {
        title: 'Conditional Statements',
        subject_name: 'Programming Logic',
        order_index: 1,
      },
      {
        title: 'Control Flow',
        subject_name: 'Programming Logic',
        order_index: 2,
      },
    ];

    const questions = [
      // Python Basics Questions
      {
        category_name: 'python_basics',
        module_name: 'Variables and Data Types',
        question_type: 'mcq',
        question_text:
          'What is the correct way to create a variable in Python?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['variables', 'syntax'],
        created_by: adminUserId,
      },
      {
        category_name: 'python_basics',
        module_name: 'Functions and Methods',
        question_type: 'mcq',
        question_text:
          'Which function converts a string to an integer in Python?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['functions', 'type-conversion'],
        created_by: adminUserId,
      },
      {
        category_name: 'python_basics',
        module_name: 'Functions and Methods',
        question_type: 'mcq',
        question_text: 'How do you define a function in Python?',
        difficulty_level: 'medium',
        points_value: 2,
        time_limit_seconds: 45,
        tags: ['functions', 'syntax'],
        created_by: adminUserId,
      },
      {
        category_name: 'python_basics',
        module_name: 'Functions and Methods',
        question_type: 'text',
        question_text: 'What keyword is used to create a function in Python?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['functions', 'keywords'],
        created_by: adminUserId,
      },

      // Data Structures Questions
      {
        category_name: 'data_structures',
        module_name: 'Lists and Tuples',
        question_type: 'mcq',
        question_text:
          'Which of the following is an immutable data structure in Python?',
        difficulty_level: 'medium',
        points_value: 2,
        time_limit_seconds: 45,
        tags: ['immutable', 'data-structures'],
        created_by: adminUserId,
      },
      {
        category_name: 'data_structures',
        module_name: 'Lists and Tuples',
        question_type: 'mcq',
        question_text:
          'Given my_list = [1, 2, 3, 4, 5], what does print(my_list[2]) output?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['lists', 'indexing'],
        created_by: adminUserId,
      },
      {
        category_name: 'data_structures',
        module_name: 'Lists and Tuples',
        question_type: 'mcq',
        question_text: 'Which methods add an element to a list?',
        difficulty_level: 'medium',
        points_value: 2,
        time_limit_seconds: 45,
        tags: ['lists', 'methods'],
        created_by: adminUserId,
      },

      // Pandas Questions
      {
        category_name: 'pandas',
        module_name: 'Data Import/Export',
        question_type: 'mcq',
        question_text: 'How can you read a CSV file into a Pandas DataFrame?',
        difficulty_level: 'medium',
        points_value: 2,
        time_limit_seconds: 60,
        tags: ['pandas', 'csv', 'dataframe'],
        created_by: adminUserId,
      },
      {
        category_name: 'pandas',
        module_name: 'DataFrame Operations',
        question_type: 'mcq',
        question_text: 'What does the head() function in Pandas do?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['pandas', 'dataframe', 'methods'],
        created_by: adminUserId,
      },
      {
        category_name: 'pandas',
        module_name: 'DataFrame Operations',
        question_type: 'text',
        question_text:
          'What method would you use to get the first 5 rows of a DataFrame?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['pandas', 'dataframe'],
        created_by: adminUserId,
      },

      // Programming Logic Questions
      {
        category_name: 'programming_logic',
        module_name: 'Conditional Statements',
        question_type: 'mcq',
        question_text:
          'What is the output of: x = 10; if x > 5: print("Greater") else: print("Smaller")',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 45,
        tags: ['conditionals', 'logic'],
        created_by: adminUserId,
      },
      {
        category_name: 'programming_logic',
        module_name: 'Conditional Statements',
        question_type: 'text',
        question_text:
          'What Python keyword is used for conditional statements?',
        difficulty_level: 'easy',
        points_value: 1,
        time_limit_seconds: 30,
        tags: ['conditionals', 'keywords'],
        created_by: adminUserId,
      },
    ];

    const templates = [];

    return { categories, questions, templates, courses, subjects, modules };
  }

  private getQuestionOptions(
    questionText: string,
  ): Array<{ text: string; isCorrect: boolean }> {
    const optionsMap = {
      'What is the correct way to create a variable in Python?': [
        { text: 'var x = 10', isCorrect: false },
        { text: 'x := 10', isCorrect: false },
        { text: 'x = 10', isCorrect: true },
        { text: 'int x = 10', isCorrect: false },
      ],
      'Which function converts a string to an integer in Python?': [
        { text: 'toInt()', isCorrect: false },
        { text: 'convert()', isCorrect: false },
        { text: 'int()', isCorrect: true },
        { text: 'strToInt()', isCorrect: false },
      ],
      'How do you define a function in Python?': [
        { text: 'def func():', isCorrect: true },
        { text: 'function func():', isCorrect: false },
        { text: 'func def():', isCorrect: false },
        { text: 'func():', isCorrect: false },
      ],
      'Which of the following is an immutable data structure in Python?': [
        { text: 'List', isCorrect: false },
        { text: 'Dictionary', isCorrect: false },
        { text: 'Tuple', isCorrect: true },
        { text: 'Set', isCorrect: false },
      ],
      'Given my_list = [1, 2, 3, 4, 5], what does print(my_list[2]) output?': [
        { text: '2', isCorrect: false },
        { text: '3', isCorrect: true },
        { text: '4', isCorrect: false },
        { text: 'Error', isCorrect: false },
      ],
      'Which methods add an element to a list?': [
        { text: 'append()', isCorrect: false },
        { text: 'add()', isCorrect: false },
        { text: 'insert()', isCorrect: false },
        { text: 'Both append() and insert()', isCorrect: true },
      ],
      'How can you read a CSV file into a Pandas DataFrame?': [
        { text: "pd.read_csv('file.csv')", isCorrect: true },
        { text: "pandas.read_csv('file.csv')", isCorrect: false },
        { text: "DataFrame.read_csv('file.csv')", isCorrect: false },
        { text: "pd.load_csv('file.csv')", isCorrect: false },
      ],
      'What does the head() function in Pandas do?': [
        { text: 'Returns the first few rows of a DataFrame', isCorrect: true },
        { text: 'Returns the last few rows of a DataFrame', isCorrect: false },
        { text: 'Adds a new column to a DataFrame', isCorrect: false },
        { text: 'Deletes the first row of a DataFrame', isCorrect: false },
      ],
      'What is the output of: x = 10; if x > 5: print("Greater") else: print("Smaller")':
        [
          { text: 'Greater', isCorrect: true },
          { text: 'Smaller', isCorrect: false },
          { text: 'Error', isCorrect: false },
          { text: 'None of the above', isCorrect: false },
        ],
    };

    return optionsMap[questionText] || [];
  }

  private getTextAnswer(questionText: string): {
    correctAnswer: string;
    caseSensitive: boolean;
    exactMatch: boolean;
    alternateAnswers?: string[];
    keywords?: string[];
  } | null {
    const textAnswersMap = {
      'What keyword is used to create a function in Python?': {
        correctAnswer: 'def',
        caseSensitive: false,
        exactMatch: true,
        alternateAnswers: ['define'],
      },
      'What method would you use to get the first 5 rows of a DataFrame?': {
        correctAnswer: 'head',
        caseSensitive: false,
        exactMatch: false,
        alternateAnswers: ['head()', 'df.head()', '.head()'],
        keywords: ['head'],
      },
      'What Python keyword is used for conditional statements?': {
        correctAnswer: 'if',
        caseSensitive: false,
        exactMatch: true,
        alternateAnswers: [],
      },
    };

    return textAnswersMap[questionText] || null;
  }
}
