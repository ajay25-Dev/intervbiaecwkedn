// Validation script for migration logic
// This tests the data transformation logic without requiring database connection

const { v4: uuidv4 } = require('uuid');

// Mock data structure for testing
const mockPlanData = {
  id: 123,
  user_id: '550e8400-e29b-41d4-a716-446655440000',
  profile_id: 1,
  jd_id: 1,
  plan_content: {
    domains: [],
    case_studies: [],
    subject_prep: {
      'SQL': {
        subject: 'SQL',
        case_studies: [
          {
            title: 'Sales Data Analysis',
            description: 'Analyze sales data to find insights',
            dataset_overview: 'Sales data with products, regions, and dates',
            problem_statement: 'Write SQL queries to analyze sales data',
            questions: [
              {
                question_number: 1,
                question: 'What is total sales amount for each region?',
                expected_approach: 'Use GROUP BY clause with SUM function on sales_amount',
                difficulty: 'Intermediate',
                sample_output: 'North: 50000, South: 75000, East: 60000, West: 45000'
              },
              {
                question_number: 2,
                question: 'Which product has the highest sales?',
                expected_approach: 'Use ORDER BY with DESC limit to find top product',
                difficulty: 'Beginner',
                sample_output: 'Product A with total sales of 35000'
              }
            ],
            estimated_time_minutes: 30,
            dataset_schema: `CREATE TABLE sales (
              id INT PRIMARY KEY,
              product_name VARCHAR(100),
              region VARCHAR(50),
              sales_amount DECIMAL(10,2),
              sale_date DATE
            );`,
            sample_data: `INSERT INTO sales VALUES 
              (1, 'Product A', 'North', 15000.00, '2023-01-15'),
              (2, 'Product B', 'South', 20000.00, '2023-01-16'),
              (3, 'Product A', 'East', 20000.00, '2023-01-17');`
          }
        ],
        key_learning_points: ['GROUP BY', 'Aggregate functions', 'JOIN operations'],
        common_mistakes: ['Missing GROUP BY columns', 'Incorrect aggregate functions']
      },
      'Python': {
        subject: 'Python',
        case_studies: [
          {
            title: 'Data Processing Pipeline',
            description: 'Process and transform data using Python',
            dataset_overview: 'Customer transaction data',
            problem_statement: 'Write Python scripts to process data',
            questions: [
              {
                question_number: 1,
                question: 'How would you handle missing values in the dataset?',
                expected_approach: 'Use pandas fillna() or dropna() methods',
                difficulty: 'Intermediate',
                sample_output: 'Clean dataset with no missing values'
              }
            ],
            estimated_time_minutes: 25,
            sample_data: 'customer_id,transaction_date,amount\n1,2023-01-15,100.50\n2,2023-01-16,,75.25'
          }
        ],
        key_learning_points: ['Data cleaning', 'Pandas operations'],
        common_mistakes: ['Not handling missing data properly']
      }
    },
    subjects_covered: ['SQL', 'Python']
  },
  created_at: new Date().toISOString()
};

// Helper functions (copied from service)
function generateTableName(title, subject) {
  if (!title) return `${subject.toLowerCase()}_data`;
  
  const cleanTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .substring(0, 50);
  
  return cleanTitle || `${subject.toLowerCase()}_data`;
}

function extractColumnsFromSchema(schema) {
  if (!schema) return [];

  if (typeof schema === 'string') {
    // Try to extract column names from SQL CREATE TABLE statement
    const createTableMatch = schema.match(/CREATE\s+TABLE\s+\w+\s*\(([\s\S]*?)\);?\s*$/i);
    if (createTableMatch) {
      const columnDefs = createTableMatch[1];
      const lines = columnDefs.split(',').map(line => line.trim());
      return lines
        .filter(line => line && !line.toUpperCase().includes('PRIMARY KEY') && 
                !line.toUpperCase().includes('FOREIGN KEY') &&
                !line.toUpperCase().includes('CONSTRAINT'))
        .map(line => {
          // Extract column name and data type, then return just the name
          const match = line.match(/^(\w+)\s+/);
          return match ? match[1].replace(/['"`]/g, '') : '';
        })
        .filter(col => col && col.length > 0);
    }
  } else if (Array.isArray(schema)) {
    return schema;
  } else if (typeof schema === 'object') {
    return Object.keys(schema);
  }

  return [];
}

function getQuestionTypeFromSubject(subject) {
  const subjectLower = subject.toLowerCase();
  const typeMap = {
    'sql': 'sql',
    'python': 'python',
    'javascript': 'javascript',
    'google sheets': 'google_sheets',
    'statistics': 'statistics',
    'math': 'math',
    'coding': 'coding',
    'programming': 'coding',
    'reasoning': 'reasoning',
    'problem solving': 'problem_solving',
  };
  return typeMap[subjectLower] || 'coding';
}

function getLanguageFromSubject(subject) {
  const subjectLower = subject.toLowerCase();
  const languageMap = {
    'sql': 'sql',
    'python': 'python',
    'javascript': 'javascript',
    'google sheets': 'google_sheets',
    'statistics': 'python',
    'math': 'text',
    'coding': 'python',
    'programming': 'python',
  };
  return languageMap[subjectLower] || 'text';
}

// Test the migration logic
function testMigrationLogic() {
  console.log('🧪 Testing Migration Logic');
  console.log('================================');

  const result = {
    plan_id: mockPlanData.id,
    exercises_created: 0,
    questions_created: 0,
    datasets_created: 0,
    answers_created: 0,
    errors: [],
    warnings: []
  };

  console.log(`\n📋 Processing plan ${mockPlanData.id} for user ${mockPlanData.user_id}`);
  
  const planContent = mockPlanData.plan_content;
  if (!planContent || !planContent.subject_prep) {
    console.log('❌ Plan content or subject_prep not found');
    return;
  }

  console.log(`\n📚 Found subjects: ${Object.keys(planContent.subject_prep).join(', ')}`);

  // Process each subject
  for (const [subject, subjectData] of Object.entries(planContent.subject_prep)) {
    console.log(`\n--- Processing subject: ${subject} ---`);
    
    if (!subjectData.case_studies || !Array.isArray(subjectData.case_studies)) {
      result.warnings.push(`No case studies found for subject: ${subject}`);
      continue;
    }

    // Create exercise (mock)
    const exerciseId = uuidv4();
    const exerciseName = `${subject} - Plan ${mockPlanData.id}`;
    console.log(`📝 Creating exercise: ${exerciseName} (ID: ${exerciseId})`);
    result.exercises_created++;

    let questionNumber = 1;

    // Process each case study
    for (const caseStudy of subjectData.case_studies) {
      console.log(`\n📊 Processing case study: ${caseStudy.title}`);
      
      // Create dataset if schema or data exists
      let datasetId = null;
      if (caseStudy.dataset_schema || caseStudy.sample_data) {
        datasetId = uuidv4();
        const tableName = generateTableName(caseStudy.title, subject);
        const columns = extractColumnsFromSchema(caseStudy.dataset_schema);
        
        console.log(`  🗄️  Creating dataset: ${caseStudy.title}`);
        console.log(`     Table name: ${tableName}`);
        console.log(`     Columns: [${columns.join(', ')}]`);
        console.log(`     Dataset ID: ${datasetId}`);
        result.datasets_created++;

          // Validate table name generation
        if (tableName !== caseStudy.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, '_').substring(0, 50)) {
          result.errors.push(`Table name generation failed for ${caseStudy.title}`);
        }
      }

      // Process questions
      if (caseStudy.questions && Array.isArray(caseStudy.questions)) {
        for (let i = 0; i < caseStudy.questions.length; i++) {
          const question = caseStudy.questions[i];
          const questionId = uuidv4();
          
          console.log(`  ❓ Question ${questionNumber}: ${question.question.substring(0, 50)}...`);
          console.log(`     Type: ${getQuestionTypeFromSubject(subject)}`);
          console.log(`     Language: ${getLanguageFromSubject(subject)}`);
          console.log(`     Difficulty: ${question.difficulty || 'Intermediate'}`);
          console.log(`     Question ID: ${questionId}`);
          result.questions_created++;

          // Create answer if expected output exists
          if (question.sample_output || question.expected_approach) {
            console.log(`  ✅ Creating answer for question ${questionId}`);
            result.answers_created++;
          }

          questionNumber++;
        }
      }
    }
  }

  // Summary
  console.log('\n📊 Migration Summary');
  console.log('==================');
  console.log(`✅ Exercises created: ${result.exercises_created}`);
  console.log(`✅ Questions created: ${result.questions_created}`);
  console.log(`✅ Datasets created: ${result.datasets_created}`);
  console.log(`✅ Answers created: ${result.answers_created}`);
  console.log(`⚠️  Warnings: ${result.warnings.length}`);
  console.log(`❌ Errors: ${result.errors.length}`);

  if (result.errors.length > 0) {
    console.log('\n❌ Errors:');
    result.errors.forEach(error => console.log(`  - ${error}`));
  }

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:');
    result.warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  // Validate expected results
  const expectedExercises = Object.keys(planContent.subject_prep).length;
  const expectedQuestions = Object.values(planContent.subject_prep)
    .reduce((total, subject) => total + (subject.case_studies?.reduce((csTotal, cs) => csTotal + (cs.questions?.length || 0), 0) || 0), 0);
  const expectedDatasets = Object.values(planContent.subject_prep)
    .reduce((total, subject) => total + (subject.case_studies?.filter(cs => cs.dataset_schema || cs.sample_data).length || 0), 0);

  console.log('\n🔍 Validation');
  console.log('============');
  console.log(`Expected exercises: ${expectedExercises}, Actual: ${result.exercises_created} ${expectedExercises === result.exercises_created ? '✅' : '❌'}`);
  console.log(`Expected questions: ${expectedQuestions}, Actual: ${result.questions_created} ${expectedQuestions === result.questions_created ? '✅' : '❌'}`);
  console.log(`Expected datasets: ${expectedDatasets}, Actual: ${result.datasets_created} ${expectedDatasets === result.datasets_created ? '✅' : '❌'}`);

  const allValid = expectedExercises === result.exercises_created && 
                  expectedQuestions === result.questions_created && 
                  expectedDatasets === result.datasets_created &&
                  result.errors.length === 0;

  console.log(`\n${allValid ? '🎉 All tests passed!' : '❌ Some tests failed!'}`);

  return result;
}

// Run the test
const result = testMigrationLogic();
console.log('\n🏁 Test completed');

// Test helper functions individually
console.log('\n🧪 Testing Helper Functions');
console.log('==========================');

console.log('\n1. Table name generation:');
console.log(`Input: "Sales Data Analysis", Subject: "SQL"`);
console.log(`Output: "${generateTableName('Sales Data Analysis', 'SQL')}"`);

console.log('\n2. Column extraction from SQL:');
const testSchema = `CREATE TABLE sales (
  id INT PRIMARY KEY,
  product_name VARCHAR(100),
  region VARCHAR(50),
  sales_amount DECIMAL(10,2)
);`;
console.log(`Input: ${testSchema}`);
console.log(`Output: [${extractColumnsFromSchema(testSchema).join(', ')}]`);

console.log('\n3. Question type mapping:');
['SQL', 'Python', 'Statistics', 'Google Sheets'].forEach(subject => {
  console.log(`${subject} -> ${getQuestionTypeFromSubject(subject)}`);
});

console.log('\n4. Language mapping:');
['SQL', 'Python', 'Statistics', 'Google Sheets'].forEach(subject => {
  console.log(`${subject} -> ${getLanguageFromSubject(subject)}`);
});
