const { createClient } = require('@supabase/supabase-js');

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://your-project.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'your-anon-key';

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testMigration() {
  console.log('Testing interview plan data migration...');

  try {
    // Step 1: Check if there are any existing plans
    console.log('\n1. Checking for existing interview plans...');
    const { data: plans, error: plansError } = await supabase
      .from('interview_prep_plans')
      .select('id, user_id, created_at')
      .limit(5);

    if (plansError) {
      console.error('Error fetching plans:', plansError);
      return;
    }

    if (!plans || plans.length === 0) {
      console.log('No interview plans found. Creating a test plan...');
      
      // Create a test plan with sample data
      const testPlan = {
        user_id: '550e8400-e29b-41d4-a716-446655440000', // Test user ID
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
                  problem_statement: 'Write SQL queries to analyze the sales data',
                  questions: [
                    {
                      question_number: 1,
                      question: 'What is the total sales amount for each region?',
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
            }
          },
          subjects_covered: ['SQL']
        },
        created_at: new Date().toISOString()
      };

      const { data: newPlan, error: createError } = await supabase
        .from('interview_prep_plans')
        .insert(testPlan)
        .select()
        .single();

      if (createError) {
        console.error('Error creating test plan:', createError);
        return;
      }

      console.log('Test plan created with ID:', newPlan.id);
      plans.push(newPlan);
    } else {
      console.log(`Found ${plans.length} existing plans:`);
      plans.forEach(plan => {
        console.log(`  - Plan ID: ${plan.id}, User: ${plan.user_id}, Created: ${plan.created_at}`);
      });
    }

    // Step 2: Test migration for the first plan
    const testPlan = plans[0];
    console.log(`\n2. Testing migration for plan ID: ${testPlan.id}`);

    const migrationPayload = {
      plan_id: testPlan.id,
      overwrite_existing: false
    };

    // Call the migration API endpoint
    const API_BASE = process.env.API_BASE || 'http://localhost:8080';
    const response = await fetch(`${API_BASE}/api/interview-prep/plan/${testPlan.id}/migrate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': testPlan.user_id
      },
      body: JSON.stringify(migrationPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Migration API returned ${response.status}:`, errorText);
      return;
    }

    const migrationResult = await response.json();
    console.log('Migration result:', JSON.stringify(migrationResult, null, 2));

    // Step 3: Verify the migrated data
    console.log('\n3. Verifying migrated data...');
    
    // Check exercises
    const { data: exercises, error: exerciseError } = await supabase
      .from('interview_practice_exercises')
      .select('*')
      .like('name', `%Plan ${testPlan.id}%`);

    if (exerciseError) {
      console.error('Error fetching exercises:', exerciseError);
    } else {
      console.log(`Created ${exercises?.length || 0} exercises`);
      exercises?.forEach(ex => {
        console.log(`  - Exercise: ${ex.name} (${ex.id})`);
      });
    }

    // Check questions
    const { data: questions, error: questionError } = await supabase
      .from('interview_practice_questions')
      .select('*')
      .in('exercise_id', exercises?.map(e => e.id) || []);

    if (questionError) {
      console.error('Error fetching questions:', questionError);
    } else {
      console.log(`Created ${questions?.length || 0} questions`);
      questions?.forEach(q => {
        console.log(`  - Question: ${q.text.substring(0, 50)}... (${q.id})`);
      });
    }

    // Check datasets
    const { data: datasets, error: datasetError } = await supabase
      .from('interview_practice_datasets')
      .select('*')
      .in('exercise_id', exercises?.map(e => e.id) || []);

    if (datasetError) {
      console.error('Error fetching datasets:', datasetError);
    } else {
      console.log(`Created ${datasets?.length || 0} datasets`);
      datasets?.forEach(ds => {
        console.log(`  - Dataset: ${ds.name} (${ds.id})`);
      });
    }

    // Check answers
    const { data: answers, error: answerError } = await supabase
      .from('interview_practice_answers')
      .select('*')
      .in('question_id', questions?.map(q => q.id) || []);

    if (answerError) {
      console.error('Error fetching answers:', answerError);
    } else {
      console.log(`Created ${answers?.length || 0} answers`);
      answers?.forEach(a => {
        console.log(`  - Answer for question ${a.question_id}`);
      });
    }

    console.log('\n✅ Migration test completed successfully!');

  } catch (error) {
    console.error('❌ Migration test failed:', error.message);
  }
}

// Run the test
testMigration();
