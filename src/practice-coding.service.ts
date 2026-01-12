import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';

export interface TestCase {
  input: string;
  expected_output: string;
  is_hidden?: boolean;
  points?: number;
  actual_output?: string;
  passed?: boolean;
  execution_time?: number;
  exit_code?: number;
  error_message?: string;
}

export interface ExecutionResult {
  success: boolean;
  passed: boolean;
  score: number;
  total_points: number;
  test_results: TestCase[];
  overall_result: {
    stdout: string;
    stderr: string;
    execution_time: number;
    memory_used: number;
    exit_code: number;
  };
  attempt_id?: string;
}

interface PistonResponse {
  language: string;
  version: string;
  run: {
    stdout: string;
    stderr: string;
    code: number;
    signal?: string;
    output: string;
  };
}

export interface PracticeDataset {
  id: string;
  question_id: string;
  name: string;
  description?: string;
  subject_type: 'sql' | 'python' | 'excel' | 'statistics' | 'r' | 'javascript';
  file_path?: string;
  file_url?: string;
  file_size?: number;
  public: boolean;
  table_name?: string;
  data?: any[];
  data_preview?: any;
  record_count?: number;
  columns?: string[];
  created_at: string;
  updated_at: string;
  schema_info?: {
    creation_sql?: string;
    creation_python?: string;
    dataset_csv_raw?: string;
    expected_columns?: string[];
    dataset_columns?: string[];
    dataset_description?: string;
  };
}

export interface DatasetProcessingResult {
  success: boolean;
  tables?: string[];
  schema?: any;
  record_count?: number;
  columns?: string[];
  preview_data?: any[];
  error_message?: string;
}

@Injectable()
export class PracticeCodingService {
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  private readonly PISTON_URL = 'https://emkc.org/api/v2/piston/execute';

  private readonly LANGUAGE_MAPPINGS = {
    python: { piston: 'python', version: '3.10.0' },
    javascript: { piston: 'javascript', version: '18.15.0' },
    typescript: { piston: 'typescript', version: '5.0.3' },
    java: { piston: 'java', version: '17.0.3' },
    cpp: { piston: 'cpp', version: '10.2.0' },
    c: { piston: 'c', version: '10.2.0' },
    sql: { piston: 'sqlite3', version: '3.36.0' },
    bash: { piston: 'bash', version: '5.2.0' },
    php: { piston: 'php', version: '8.2.3' },
    r: { piston: 'r', version: '4.2.1' },
  };

  private sectionQuestionsTableAvailable = true;
  private practiceDatasetsTableAvailable = true;

  async execute(
    userId: string,
    exerciseId: string,
    questionId: string,
    code: string,
    language: string,
    practiceType: string,
    providedTestCases: TestCase[],
    runType: 'sample' | 'full' | 'submit' = 'sample',
    token: string,
    providedDatasets: PracticeDataset[] = [],
    skipPracticeAttemptStorage: boolean = false,
  ): Promise<ExecutionResult> {
    if (practiceType === 'coding') {
      return this.executeWithTestCases(
        userId,
        exerciseId,
        questionId,
        code,
        language,
        providedTestCases,
        runType,
        token,
        providedDatasets,
        skipPracticeAttemptStorage,
      );
    } else {
      throw new BadRequestException(
        `Unsupported practice type: ${practiceType}`,
      );
    }
  }

  async executeWithTestCases(
    userId: string,
    exerciseId: string,
    questionId: string,
    code: string,
    language: string,
    providedTestCases: TestCase[],
    runType: 'sample' | 'full' | 'submit' = 'sample',
    token: string,
    providedDatasets: PracticeDataset[] = [],
    skipPracticeAttemptStorage: boolean = false,
  ): Promise<ExecutionResult> {
    try {
      // Get question details unless it's a generated plan or test cases are provided
      let questionData = null;
      if (!exerciseId.startsWith('plan-')) {
        try {
          questionData = await this.getQuestionData(questionId);
        } catch (e) {
          console.warn(
            'Could not fetch question data, relying on provided test cases',
          );
        }
      }

      if (!questionData && providedTestCases.length === 0) {
        throw new BadRequestException(
          'Question not found and no test cases provided',
        );
      }

      // Use provided test cases or get from database
      const testCases =
        providedTestCases.length > 0
          ? providedTestCases
          : await this.getQuestionTestCases(questionId, runType === 'submit');

      // Get question datasets
      let datasets: PracticeDataset[] = providedDatasets;
      if (datasets.length === 0 && !exerciseId.startsWith('plan-')) {
        const { datasets: dbDatasets } = await this.getQuestionDatasets(
          questionId,
          token,
          exerciseId,
        );
        datasets = dbDatasets;
      }

      // Validate language support
      if (!this.LANGUAGE_MAPPINGS[language]) {
        throw new BadRequestException(`Unsupported language: ${language}`);
      }

      // Execute code against all test cases
      const executionStartTime = Date.now();
      const testResults = await this.executeAgainstTestCases(
        code,
        language,
        testCases,
        datasets,
      );
      const totalExecutionTime = Date.now() - executionStartTime;

      // Calculate score
      const { score, totalPoints, passed } = this.calculateScore(testResults);

      // Prepare overall result (use first test case execution details)
      const overallResult = {
        stdout: testResults[0]?.actual_output || '',
        stderr: testResults[0]?.error_message || '',
        execution_time: totalExecutionTime,
        memory_used: 0, // Piston doesn't provide memory usage
        exit_code: testResults[0]?.exit_code || 0,
      };

      const result: ExecutionResult = {
        success: overallResult.exit_code === 0,
        passed,
        score,
        total_points: totalPoints,
        test_results: testResults,
        overall_result: overallResult,
      };

      // Store attempt in database for submissions
      if (runType === 'submit' && !skipPracticeAttemptStorage) {
        if (!exerciseId.startsWith('plan-')) {
          const attemptId = await this.storePracticeAttempt(
            userId,
            exerciseId,
            questionId,
            code,
            language,
            testResults,
            score,
            passed,
            totalExecutionTime,
            overallResult,
          );
          result.attempt_id = attemptId;
        } else {
          result.attempt_id = `plan-attempt-${Date.now()}`;
        }
      }

      return result;
    } catch (error) {
      console.error('Error executing code with test cases:', error);
      throw new InternalServerErrorException('Failed to execute code');
    }
  }

  private async executeAgainstTestCases(
    code: string,
    language: string,
    testCases: TestCase[],
    datasets: PracticeDataset[] = [],
  ): Promise<TestCase[]> {
    const results: TestCase[] = [];
    const langConfig = this.LANGUAGE_MAPPINGS[language];

    // Prepare setup code from datasets
    let setupCode = '';
    if (datasets.length > 0) {
      if (language === 'sql') {
        setupCode = this.generateSQLSetup(datasets);
      } else if (language === 'python') {
        setupCode = this.generatePythonSetup(datasets);
      }
    }

    // Execute sequentially to avoid overloading the API
    for (const testCase of testCases) {
      try {
        const executionStartTime = Date.now();

        // Prepare code with input
        let executionCode = '';
        const stdin = testCase.input;

        // Handle different languages
        if (language === 'python') {
          // For Python, we can use stdin but also need setup code
          executionCode = `${setupCode}\n\n${code}`;
        } else if (language === 'javascript') {
          // For JS, we might need to modify the code to read from a simulated input
          if (stdin) {
            executionCode = `const input = \`${stdin}\`;\n\n${code}`;
          } else {
            executionCode = code;
          }
        } else if (language === 'sql') {
          // For SQL, we need a different approach - create a SQLite database in memory
          executionCode = setupCode;

          if (stdin) {
            executionCode += `\nCREATE TABLE temp_data AS SELECT ${stdin};\n`;
          }

          executionCode += `\n${code}`;

          if (stdin) {
            executionCode += `\nSELECT * FROM temp_data;`;
          }
        } else {
          executionCode = code;
        }

        const pistonPayload = {
          language: langConfig.piston,
          version: langConfig.version,
          files: [
            {
              name: `main.${this.getFileExtension(language)}`,
              content: executionCode,
            },
          ],
          stdin: language === 'python' || language === 'sql' ? stdin : '',
        };

        const response = await fetch(this.PISTON_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pistonPayload),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          throw new Error(`Piston API error: ${response.status}`);
        }

        const executionTime = Date.now() - executionStartTime;
        const pistonResult: PistonResponse = await response.json();

        const actualOutput = pistonResult.run.stdout?.trim() || '';
        const expectedOutput = testCase.expected_output.trim();
        const errorMessage = pistonResult.run.stderr || '';
        const exitCode = pistonResult.run.code;

        // Validate output (simple string matching for now)
        const passed = this.validateOutput(actualOutput, expectedOutput);

        results.push({
          ...testCase,
          actual_output: actualOutput,
          passed,
          execution_time: executionTime,
          exit_code: exitCode,
          error_message: errorMessage,
        });

        // Add small delay between executions
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error executing test case:`, error);
        results.push({
          ...testCase,
          actual_output: '',
          passed: false,
          execution_time: 0,
          exit_code: -1,
          error_message: error.message || 'Execution failed',
        });
      }
    }

    return results;
  }

  private generateSQLSetup(datasets: PracticeDataset[]): string {
    let sql = '';

    for (const dataset of datasets) {
      if (dataset.schema_info?.creation_sql) {
        sql += dataset.schema_info.creation_sql + ';\n\n';
      } else if (dataset.data && dataset.data.length > 0) {
        const tableName = dataset.table_name || dataset.name || 'dataset';
        const columns = dataset.columns || Object.keys(dataset.data[0]);

        // Create table
        sql += `CREATE TABLE ${tableName} (${columns.map((c) => `${c} TEXT`).join(', ')});\n`;

        // Insert data
        // Note: SQLite supports multiple values in one INSERT, but be careful with limits
        // We'll insert row by row for simplicity and to avoid huge statements
        for (const row of dataset.data) {
          const values = columns.map((col) => {
            const val = row[col];
            if (val === null || val === undefined) return 'NULL';
            if (typeof val === 'number') return val;
            // Escape single quotes
            return `'${String(val).replace(/'/g, "''")}'`;
          });
          sql += `INSERT INTO ${tableName} VALUES (${values.join(', ')});\n`;
        }
        sql += '\n';
      }
    }

    return sql;
  }

  private generatePythonSetup(datasets: PracticeDataset[]): string {
    let python = 'import pandas as pd\nimport io\n\n';

    for (const dataset of datasets) {
      if (dataset.data && dataset.data.length > 0) {
        const varName = dataset.table_name || dataset.name || 'df';

        // Use creation python if available
        if (dataset.schema_info?.creation_python) {
          python += dataset.schema_info.creation_python + '\n\n';
          continue;
        }

        // Otherwise serialize data to JSON string and load
        // Escape backslashes and double quotes in JSON string
        const jsonStr = JSON.stringify(dataset.data);

        python += `# Load dataset: ${varName}\n`;
        // We use triple quotes to avoid most escaping issues, but still need to be careful
        // A safer way is to just put the raw JSON on one line
        python += `${varName}_data = ${jsonStr}\n`;
        python += `${varName} = pd.DataFrame(${varName}_data)\n\n`;
      }
    }

    return python;
  }

  private validateOutput(
    actualOutput: string,
    expectedOutput: string,
  ): boolean {
    // Try JSON comparison first
    try {
      const actualJson = JSON.parse(actualOutput);
      const expectedJson = JSON.parse(expectedOutput);
      // Use JSON.stringify for simple deep comparison (order matters for objects, but usually fine for arrays of rows)
      return JSON.stringify(actualJson) === JSON.stringify(expectedJson);
    } catch (e) {
      // Not JSON, fall back to string comparison
    }

    // Normalize outputs for comparison
    const normalize = (str: string) =>
      str.replace(/\s+/g, ' ').trim().toLowerCase();

    const normalizedActual = normalize(actualOutput);
    const normalizedExpected = normalize(expectedOutput);

    // For now, use exact matching (can be enhanced for different validation types)
    return normalizedActual === normalizedExpected;
  }

  private calculateScore(testResults: TestCase[]): {
    score: number;
    totalPoints: number;
    passed: boolean;
  } {
    let totalPoints = 0;
    let earnedPoints = 0;
    let allPassed = true;

    for (const result of testResults) {
      const points = result.points || 1;
      totalPoints += points;

      if (result.passed) {
        earnedPoints += points;
      } else {
        allPassed = false;
      }
    }

    const score = totalPoints > 0 ? (earnedPoints / totalPoints) * 100 : 0;

    return {
      score: Math.round(score * 100) / 100,
      totalPoints,
      passed: allPassed,
    };
  }

  private async storePracticeAttempt(
    userId: string,
    exerciseId: string,
    questionId: string,
    code: string,
    language: string,
    testResults: TestCase[],
    score: number,
    passed: boolean,
    totalExecutionTime: number,
    overallResult: any,
  ): Promise<string> {
    try {
      // Get attempt number
      const { data: existingAttempts } = await this.supabase
        .from('practice_attempts')
        .select('attempt_number')
        .eq('user_id', userId)
        .eq('question_id', questionId)
        .order('attempt_number', { ascending: false })
        .limit(1);

      const attemptNumber = (existingAttempts?.[0]?.attempt_number || 0) + 1;

      const { data, error } = await this.supabase
        .from('practice_attempts')
        .insert({
          user_id: userId,
          exercise_id: exerciseId,
          question_id: questionId,
          code,
          language,
          test_results: testResults,
          score,
          passed,
          execution_time: totalExecutionTime,
          memory_used: overallResult.memory_used || 0,
          error_message: overallResult.stderr || '',
          stdin: testResults[0]?.input || '',
          stdout: overallResult.stdout || '',
          stderr: overallResult.stderr || '',
          exit_code: overallResult.exit_code || 0,
          attempt_number: attemptNumber,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error storing practice attempt:', error);
        throw new InternalServerErrorException('Failed to store attempt');
      }

      return data.id;
    } catch (error) {
      console.error('Error storing practice attempt:', error);
      throw new InternalServerErrorException('Failed to store attempt');
    }
  }

  private getFileExtension(language: string): string {
    const extensions = {
      python: 'py',
      javascript: 'js',
      typescript: 'ts',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      sql: 'sql',
      bash: 'sh',
      php: 'php',
      r: 'r',
    };
    return extensions[language] || 'txt';
  }

  private async fetchSectionQuestionData(questionId: string) {
    if (!this.sectionQuestionsTableAvailable) {
      return null;
    }

    const { data, error } = await this.supabase
      .from('section_exercise_questions')
      .select('*, section_exercises(execution_config)')
      .eq('id', questionId)
      .single();

    if (error) {
      if (error.code === 'PGRST205') {
        this.sectionQuestionsTableAvailable = false;
        console.warn(
          'section_exercise_questions table missing, skipping section question lookups',
        );
      } else {
        console.error('Error fetching section question data:', error);
      }
      return null;
    }

    return data;
  }

  private async fetchInterviewPracticeQuestionData(questionId: string) {
    try {
      const { data: question, error } = await this.supabase
        .from('interview_practice_questions')
        .select('*')
        .eq('id', questionId)
        .single();

      if (error) {
        console.error('Error fetching interview question data:', error);
        return null;
      }

      if (!question) {
        return null;
      }

      const { data: testCases, error: testCasesError } = await this.supabase
        .from('interview_practice_test_cases')
        .select('*')
        .eq('question_id', questionId);

      if (testCasesError) {
        console.error('Error fetching interview test cases:', testCasesError);
      }

      return {
        ...question,
        test_cases: testCases || [],
      };
    } catch (error) {
      console.error('Error fetching interview question data:', error);
      return null;
    }
  }

  private async getQuestionData(questionId: string) {
    const sectionData = await this.fetchSectionQuestionData(questionId);
    if (sectionData) {
      return sectionData;
    }

    return this.fetchInterviewPracticeQuestionData(questionId);
  }

  async getQuestionTestCases(
    questionId: string,
    includeHidden: boolean = false,
  ): Promise<TestCase[]> {
    const questionData = await this.getQuestionData(questionId);

    if (!questionData?.test_cases) {
      return [];
    }

    const testCases: TestCase[] = questionData.test_cases;

    // Filter hidden test cases if not admin
    return includeHidden ? testCases : testCases.filter((tc) => !tc.is_hidden);
  }

  async getSupportedLanguages() {
    const { data, error } = await this.supabase
      .from('programming_languages')
      .select('*')
      .eq('is_active', true)
      .order('name');

    if (error) {
      console.error('Error fetching programming languages:', error);
      return [];
    }

    return data;
  }

  async getUserAttempts(
    userId: string,
    questionId: string,
    limit: number,
    token: string,
  ) {
    const { data, error } = await this.supabase
      .from('practice_attempts')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Error fetching user attempts:', error);
      return { attempts: [] };
    }

    return { attempts: data };
  }

  async savePracticeAttempt(
    userId: string,
    exerciseId: string,
    questionId: string,
    code: string,
    language: string,
    testResults: TestCase[],
    score: number,
    passed: boolean,
    totalExecutionTime: number,
  ): Promise<string> {
    const overallResult = {
      stdout: testResults[0]?.actual_output || '',
      stderr: testResults[0]?.error_message || '',
      memory_used: 0,
      exit_code: testResults[0]?.exit_code || 0,
    };

    return this.storePracticeAttempt(
      userId,
      exerciseId,
      questionId,
      code,
      language,
      testResults,
      score,
      passed,
      totalExecutionTime,
      overallResult,
    );
  }

  async getUserProgress(userId: string, questionId: string, token: string) {
    const { data, error } = await this.supabase
      .from('coding_progress')
      .select('*')
      .eq('user_id', userId)
      .eq('question_id', questionId)
      .single();

    if (error && error.code !== 'PGRST116') {
      // Not found error
      console.error('Error fetching user progress:', error);
    }

    return { progress: data || null };
  }

  async getQuestionDatasets(
    questionId: string,
    token: string,
    exerciseId?: string,
  ): Promise<{ datasets: PracticeDataset[] }> {
    let practiceDatasets: PracticeDataset[] = [];
    if (this.practiceDatasetsTableAvailable) {
      try {
        const { data, error } = await this.supabase
          .from('practice_datasets')
          .select('*')
          .or(`question_id.eq.${questionId},public.eq.true`)
          .order('created_at', { ascending: false });

        if (error) {
          if (error.code === 'PGRST205') {
            this.practiceDatasetsTableAvailable = false;
            console.warn(
              'practice_datasets table missing, skipping dataset lookups',
            );
          } else {
            console.error('Error fetching question datasets:', error);
          }
        } else {
          practiceDatasets = data || [];
        }
      } catch (error) {
        console.error('Error querying practice_datasets table:', error);
      }
    }

    const interviewDatasets: PracticeDataset[] = [];
    try {
      let interviewQuery: any = this.supabase
        .from('interview_practice_datasets')
        .select('*');

      if (exerciseId) {
        interviewQuery = interviewQuery.or(
          `question_id.eq.${questionId},exercise_id.eq.${exerciseId}`,
        );
      } else {
        interviewQuery = interviewQuery.eq('question_id', questionId);
      }

      interviewQuery = interviewQuery.order('created_at', { ascending: false });

      const { data: interviewData, error: interviewError } =
        await interviewQuery;

      if (interviewError) {
        console.error('Error fetching interview datasets:', interviewError);
      } else if (interviewData) {
        interviewDatasets.push(
          ...(interviewData.map((dataset) => ({
            ...dataset,
            subject_type:
              (dataset.subject_type as PracticeDataset['subject_type']) ||
              'sql',
            schema_info: {
              ...(dataset.schema_info || {}),
              dataset_csv_raw:
                dataset.csv_data || dataset.schema_info?.dataset_csv_raw,
              creation_sql:
                dataset.creation_sql ?? dataset.schema_info?.creation_sql,
              creation_python:
                dataset.creation_python ?? dataset.schema_info?.creation_python,
            },
            dataset_columns: dataset.columns,
          })) as PracticeDataset[]),
        );
      }
    } catch (interviewError) {
      console.error('Error fetching interview datasets:', interviewError);
    }

    const allDatasets = [...practiceDatasets, ...interviewDatasets];

    // Enrich datasets with actual data
    const enrichedDatasets = await Promise.all(
      allDatasets.map(async (dataset) => {
        try {
          // Try to get data from schema_info first
          if (dataset.schema_info?.dataset_csv_raw) {
            const parsedData = await this.parseCSVString(
              dataset.schema_info.dataset_csv_raw,
            );
            return {
              ...dataset,
              data: parsedData,
              columns:
                dataset.columns ||
                dataset.schema_info.dataset_columns ||
                (parsedData.length > 0 ? Object.keys(parsedData[0]) : []),
            };
          }

          // If no CSV in schema_info, try to fetch from file_url
          if (dataset.file_url) {
            const fileData = await this.fetchDatasetFromUrl(dataset.file_url);
            return {
              ...dataset,
              data: fileData,
              columns:
                dataset.columns ||
                (fileData.length > 0 ? Object.keys(fileData[0]) : []),
            };
          }

          // If we have data_preview, use that as fallback
          if (dataset.data_preview && Array.isArray(dataset.data_preview)) {
            return {
              ...dataset,
              data: dataset.data_preview,
              columns:
                dataset.columns ||
                (dataset.data_preview.length > 0
                  ? Object.keys(dataset.data_preview[0])
                  : []),
            };
          }

          // Return dataset without data if nothing is available
          return dataset;
        } catch (error) {
          console.error(
            `Error enriching dataset ${dataset.id}:`,
            error.message,
          );
          // Return dataset with data_preview as fallback
          return {
            ...dataset,
            data: dataset.data_preview || [],
          };
        }
      }),
    );

    return { datasets: enrichedDatasets as PracticeDataset[] };
  }

  private async parseCSVString(csvString: string): Promise<any[]> {
    try {
      const lines = csvString.trim().split(/\r?\n/);
      if (lines.length < 2) return [];

      // Parse CSV line handling quoted values
      const parseCsvLine = (line: string): string[] => {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];

          if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
              // Escaped quote
              current += '"';
              i++;
            } else {
              // Toggle quote state
              inQuotes = !inQuotes;
            }
          } else if (char === ',' && !inQuotes) {
            // End of field
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        return values.map((value) => value.replace(/^"(.*)"$/, '$1'));
      };

      const headers = parseCsvLine(lines[0]);

      // Clean up first header if it contains csv_data=''' pattern (case-insensitive, allowing spaces)
      if (headers.length > 0) {
        headers[0] = headers[0].replace(/^\s*csv_data\s*=\s*'''/i, '').trim();
      }

      const data: Array<Record<string, string | number>> = [];

      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue; // Skip empty lines

        const values = parseCsvLine(lines[i]);
        const row: Record<string, string | number> = {};
        headers.forEach((header, index) => {
          const value = values[index] || '';
          // Try to convert to number if possible
          const numValue = Number(value);
          row[header] = !isNaN(numValue) && value !== '' ? numValue : value;
        });
        data.push(row);
      }

      return data;
    } catch (error) {
      console.error('Error parsing CSV string:', error);
      return [];
    }
  }

  private async fetchDatasetFromUrl(url: string): Promise<any[]> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch dataset: ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        return await response.json();
      } else if (contentType?.includes('text/csv')) {
        const csvText = await response.text();
        return await this.parseCSVString(csvText);
      } else {
        // Try to parse as CSV by default
        const text = await response.text();
        return await this.parseCSVString(text);
      }
    } catch (error) {
      console.error('Error fetching dataset from URL:', error);
      return [];
    }
  }

  async processDatasetUpload(
    questionId: string,
    file: Express.Multer.File,
    subjectType: string,
    token: string,
  ): Promise<DatasetProcessingResult> {
    try {
      // Upload file to Supabase Storage
      const fileName = `${Date.now()}-${file.originalname}`;
      const filePath = `practice-datasets/${questionId}/${fileName}`;

      const { data: uploadData, error: uploadError } =
        await this.supabase.storage
          .from('practice-datasets')
          .upload(filePath, file.buffer, {
            contentType: file.mimetype,
            upsert: false,
          });

      if (uploadError) {
        console.error('Error uploading dataset:', uploadError);
        throw new InternalServerErrorException('Failed to upload dataset');
      }

      // Get public URL
      const { data: urlData } = this.supabase.storage
        .from('practice-datasets')
        .getPublicUrl(filePath);

      // Process dataset based on subject type
      const processingResult = await this.processDatasetByType(
        file.buffer,
        file.originalname,
        subjectType,
      );

      // Store dataset metadata
      const { data, error } = await this.supabase
        .from('practice_datasets')
        .insert({
          question_id: questionId,
          name: file.originalname,
          subject_type: subjectType as PracticeDataset['subject_type'],
          file_path: filePath,
          file_url: urlData.publicUrl,
          file_size: file.size,
          public: false,
          data_preview: processingResult.success
            ? processingResult.preview_data
            : null,
        })
        .select()
        .single();

      if (error) {
        console.error('Error storing dataset metadata:', error);
        throw new InternalServerErrorException(
          'Failed to store dataset metadata',
        );
      }

      return processingResult;
    } catch (error) {
      console.error('Error processing dataset upload:', error);
      throw new InternalServerErrorException('Failed to process dataset');
    }
  }

  private async processDatasetByType(
    buffer: Buffer,
    fileName: string,
    subjectType: string,
  ): Promise<DatasetProcessingResult> {
    try {
      const fileExtension = fileName.split('.').pop()?.toLowerCase();

      switch (subjectType) {
        case 'sql':
          return await this.processSQLDataset(buffer, fileExtension);
        case 'python':
        case 'r':
        case 'statistics':
          return await this.processDataScienceDataset(buffer, fileExtension);
        case 'excel':
          return await this.processExcelDataset(buffer, fileExtension);
        default:
          return {
            success: false,
            error_message: `Unsupported subject type: ${subjectType}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error_message: error.message || 'Dataset processing failed',
      };
    }
  }

  private async processSQLDataset(
    buffer: Buffer,
    fileExtension: string | undefined,
  ): Promise<DatasetProcessingResult> {
    try {
      let data: any[] = [];

      if (fileExtension === 'csv') {
        data = await this.parseCSVBuffer(buffer);
      } else if (fileExtension === 'json') {
        data = JSON.parse(buffer.toString());
      } else {
        return {
          success: false,
          error_message: 'Unsupported SQL dataset format',
        };
      }

      if (!Array.isArray(data) || data.length === 0) {
        return { success: false, error_message: 'Dataset is empty or invalid' };
      }

      const columns = Object.keys(data[0]);
      const previewData = data.slice(0, 5);

      // For SQL datasets, we'll create table definitions that will be injected into the execution environment
      return {
        success: true,
        tables: ['dataset_table'], // Single table for now
        schema: { columns, types: this.inferColumnTypes(data) },
        record_count: data.length,
        columns,
        preview_data: previewData,
      };
    } catch (error) {
      return { success: false, error_message: error.message };
    }
  }

  private async processDataScienceDataset(
    buffer: Buffer,
    fileExtension: string | undefined,
  ): Promise<DatasetProcessingResult> {
    try {
      let data: any[] = [];

      if (fileExtension === 'csv') {
        data = await this.parseCSVBuffer(buffer);
      } else if (fileExtension === 'json') {
        data = JSON.parse(buffer.toString());
      } else {
        return {
          success: false,
          error_message: 'Unsupported data science dataset format',
        };
      }

      if (!Array.isArray(data) || data.length === 0) {
        return { success: false, error_message: 'Dataset is empty or invalid' };
      }

      const columns = Object.keys(data[0]);
      const previewData = data.slice(0, 5);

      return {
        success: true,
        record_count: data.length,
        columns,
        preview_data: previewData,
        schema: { columns, types: this.inferColumnTypes(data) },
      };
    } catch (error) {
      return { success: false, error_message: error.message };
    }
  }

  private async processExcelDataset(
    buffer: Buffer,
    fileExtension: string | undefined,
  ): Promise<DatasetProcessingResult> {
    try {
      if (fileExtension !== 'xlsx' && fileExtension !== 'xls') {
        return {
          success: false,
          error_message: 'Excel datasets must be .xlsx or .xls files',
        };
      }

      // For Excel files, we'll store metadata and let the frontend handle the display
      // The actual processing will happen during code execution
      return {
        success: true,
        preview_data: [],
        record_count: 0,
        columns: [],
        schema: {},
      };
    } catch (error) {
      return { success: false, error_message: error.message };
    }
  }

  private async parseCSVBuffer(buffer: Buffer): Promise<any[]> {
    const csvText = buffer.toString();
    const lines = csvText.split('\n').filter((line) => line.trim());
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim());

    // Clean up first header if it contains csv_data=''' pattern (case-insensitive, allowing spaces)
    if (headers.length > 0) {
      headers[0] = headers[0].replace(/^\s*csv_data\s*='''/i, '').trim(); //it can have new lines after csv_data after = sign
    }

    const data = lines.slice(1).map((line) => {
      const values = line.split(',').map((v) => v.trim());
      const row: any = {};
      headers.forEach((header, i) => {
        row[header] = this.parseCSVValue(values[i]);
      });
      return row;
    });

    return data;
  }

  private parseCSVValue(value: string): any {
    // Remove quotes if present
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    // Try to parse as number
    const parsed = Number(value);
    return isNaN(parsed) ? value : parsed;
  }

  private inferColumnTypes(data: any[]): Record<string, string> {
    const types: Record<string, string> = {};
    const sampleRows = data.slice(0, 10); // Sample first 10 rows

    for (const row of sampleRows) {
      for (const [key, value] of Object.entries(row)) {
        if (!types[key]) {
          types[key] = typeof value;
        } else if (types[key] !== typeof value) {
          types[key] = 'mixed'; // Handle mixed types
        }
      }
    }

    return types;
  }

  async getSubjectSpecificTemplates(
    subjectType: string,
  ): Promise<Record<string, string>> {
    const templates: Record<string, Record<string, string>> = {
      sql: {
        python: `# SQL Practice Exercise
import sqlite3
import pandas as pd

# Connect to database (pre-loaded with your dataset)
conn = sqlite3.connect(':memory:')
df = pd.read_sql_query("SELECT * FROM dataset_table", conn)

# Write your analytical solution here
# For example:
# result = df.groupby('category').agg({'value': 'sum'}).reset_index()
# print(result)

# Your code here
`,
        default: `-- SQL Practice Exercise

-- Dataset tables are pre-loaded as 'dataset_table'
-- Query the data and analyze results

-- Example: SELECT COUNT(*) FROM dataset_table;

-- Your query here
`,
      },
      python: {
        python: `# Data Science Practice Exercise
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
from scipy import stats

# Dataset loaded automatically as 'df'
df = pd.read_csv('dataset.csv')  # Auto-loaded
print("Dataset shape:", df.shape)
print("Columns:", list(df.columns))
print("\\nFirst 5 rows:")
print(df.head())

# Your analytical solution here
def analyze_data(df):
    """
    Implement your data analysis logic here.

    Examples:
    - Calculate statistics
    - Create visualizations
    - Apply machine learning models
    """
    pass

# Call your function
result = analyze_data(df)
print(result)
`,
      },
      statistics: {
        r: `# Statistical Analysis Exercise
# Dataset loaded as 'data' dataframe

# Load your dataset
data <- read.csv('dataset.csv')
print(dim(data))
print(names(data))
print(head(data))

# Your statistical analysis here
# Examples:
# - Hypothesis testing
# - Regression analysis
# - Data visualization
# - Statistical modeling

# Your analysis code here
`,
        python: `# Statistics Practice Exercise
import pandas as pd
import numpy as np
import seaborn as sns
import matplotlib.pyplot as plt
from scipy import stats
import statsmodels.api as sm

# Dataset loaded automatically as 'df'
df = pd.read_csv('dataset.csv')
print("Dataset info:")
print(df.info())
print("\\nDescriptive statistics:")
print(df.describe())

# Your statistical analysis here
# Examples:
# - t-tests, ANOVA, chi-square tests
# - Linear/logistic regression
# - Time series analysis
# - A/B testing

def perform_statistical_analysis(df):
    """
    Implement your statistical analysis here.
    """
    pass

# Run your analysis
result = perform_statistical_analysis(df)
print(result)
`,
      },
    };

    return templates[subjectType] || { python: '# Write your solution here\n' };
  }

  async enhanceSubjectSpecificExecution(
    code: string,
    language: string,
    subjectType: string,
    questionId: string,
  ): Promise<{ enhancedCode: string; executionFiles?: any[] }> {
    try {
      const datasets = await this.getQuestionDatasets(questionId, '');

      switch (subjectType) {
        case 'sql':
          return this.enhanceSQLExecution(code, datasets.datasets);
        case 'python':
        case 'statistics':
          return this.enhancePythonExecution(code, language, datasets.datasets);
        case 'excel':
          return this.enhanceExcelExecution(code, datasets.datasets);
        default:
          return { enhancedCode: code };
      }
    } catch (error) {
      console.error('Error enhancing execution:', error);
      return { enhancedCode: code };
    }
  }

  private enhanceSQLExecution(
    code: string,
    datasets: PracticeDataset[],
  ): { enhancedCode: string } {
    // For SQL, we inject table creation and seeding code
    let setupCode = '';

    for (const dataset of datasets) {
      if (dataset.subject_type !== 'sql') continue;

      // This would be enhanced with actual data seeding in production
      setupCode += `
-- Dataset: ${dataset.name}
-- Create table structure
-- (Actual data seeding would happen in the execution environment)
`;
    }

    return {
      enhancedCode: setupCode + '\n' + code,
    };
  }

  private enhancePythonExecution(
    code: string,
    language: string,
    datasets: PracticeDataset[],
  ): { enhancedCode: string; executionFiles?: any[] } {
    // For Python/R, inject data loading code
    let dataLoadingCode = '';

    if (language === 'python') {
      dataLoadingCode = datasets
        .map((dataset, index) => {
          if (dataset.file_url) {
            return `df${index > 0 ? `_${index}` : ''} = pd.read_csv('${dataset.file_url}')`;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
    }

    if (dataLoadingCode) {
      dataLoadingCode = `import pandas as pd\n${dataLoadingCode}\n\n`;
    }

    return {
      enhancedCode: dataLoadingCode + code,
    };
  }

  private enhanceExcelExecution(
    code: string,
    datasets: PracticeDataset[],
  ): { enhancedCode: string } {
    // For Excel exercises, setup Google Sheets API or similar
    const excelSetup = `
// Excel/Sheets exercise setup
// Dataset URLs: ${datasets.map((d) => d.file_url).join(', ')}
`;

    return {
      enhancedCode: excelSetup + code,
    };
  }
}
