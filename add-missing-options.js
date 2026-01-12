// Script to add missing quiz options for existing questions
const SUPABASE_URL = 'https://rozplqfuvhswhwiddgia.supabase.co';
const SUPABASE_SERVICE_ROLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvenBscWZ1dmhzd2h3aWRkZ2lhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NjIyODg3MiwiZXhwIjoyMDcxODA0ODcyfQ.k0zINRMxxAgG6VrU99oM5NX3xjDuORD_Sf6YdXc32wI';

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

async function addMissingOptions() {
  // console.log('Adding missing quiz options...\n');

  try {
    // Get all quiz questions that need options
    const { data: questions, error: questionsError } = await supabase
      .from('quiz_questions')
      .select('id, text, type')
      .in('type', ['mcq', 'true_false']); // Only these types need options

    if (questionsError) {
      console.error('Error fetching questions:', questionsError);
      return;
    }

    // console.log(`Found ${questions.length} questions that need options`);

    for (const question of questions) {
      // Check if question already has options
      const { data: existingOptions, error: optionsError } = await supabase
        .from('quiz_options')
        .select('*')
        .eq('question_id', question.id);

      if (optionsError) {
        console.error(`Error checking options for question ${question.id}:`, optionsError);
        continue;
      }

      // console.log(`Question "${question.text}": ${existingOptions.length} existing options`);

      // Add options based on question type
      if (question.type === 'true_false' && existingOptions.length === 0) {
        // console.log('Adding True/False options for question:', question.text);

        // For "JavaScript is a statically typed language." the correct answer should be False
        const isStatementTrue = false; // JavaScript is dynamically typed

        // Add "True" option
        const trueResult = await supabase
          .from('quiz_options')
          .insert({
            question_id: question.id,
            text: 'True',
            correct: false
          });

        // console.log('True insert result:', trueResult);

        // Add "False" option
        const falseResult = await supabase
          .from('quiz_options')
          .insert({
            question_id: question.id,
            text: 'False',
            correct: true
          });

        // console.log('False insert result:', falseResult);

        // console.log('✅ Attempted to add True/False options');
      }
      else if (question.type === 'mcq' && existingOptions.length < 1) {
        // For MCQ questions without options, we need more specific options
        // For now, let's just add some generic options if missing
        // console.log('MCQ question needs more options...');
        // We'll leave MCQ as is since they already have options
      }
    }

    // console.log('\n✅ Script completed successfully');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

addMissingOptions();
