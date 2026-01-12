# Content Upload API Documentation

This document provides comprehensive API documentation for uploading lectures, exercises, and quizzes to the Jarvis3 learning management system.

## Table of Contents
1. [Authentication](#authentication)
2. [Lectures API](#lectures-api)
3. [Exercises API](#exercises-api)
4. [Quizzes API](#quizzes-api)
5. [File Upload Guidelines](#file-upload-guidelines)
6. [Error Handling](#error-handling)

## Authentication

All API endpoints require admin authentication. Include the Bearer token in the Authorization header:

```
Authorization: Bearer <your-jwt-token>
```

## Lectures API

### Base URL: `/v1/admin/lectures`

### 1. Create Lecture

**POST** `/section/{sectionId}`

Creates a new lecture for a specific section.

**Request Body:**
```json
{
  "title": "Introduction to JavaScript",
  "content": "This lecture covers the fundamentals of JavaScript programming language including variables, functions, and control structures.",
  "video_url": "https://example.com/video.mp4",
  "duration_minutes": 45,
  "order_index": 1,
  "status": "draft",
  "attachments": [
    {
      "name": "JavaScript Basics.pdf",
      "url": "/uploads/lectures/attachments/js-basics.pdf",
      "type": "pdf",
      "size": 2048576
    },
    {
      "name": "Code Examples.zip",
      "url": "/uploads/lectures/attachments/examples.zip",
      "type": "document",
      "size": 1024000
    }
  ],
  "learning_objectives": [
    "Understand JavaScript syntax and basic concepts",
    "Learn about variables and data types",
    "Master function declarations and expressions"
  ],
  "prerequisites": [
    "Basic understanding of HTML",
    "Familiarity with programming concepts"
  ],
  "tags": ["javascript", "programming", "web-development", "beginner"]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Introduction to JavaScript",
    "content": "This lecture covers the fundamentals...",
    "section_id": "456e7890-e89b-12d3-a456-426614174001",
    "video_url": "https://example.com/video.mp4",
    "duration_minutes": 45,
    "order_index": 1,
    "status": "draft",
    "attachments": [...],
    "learning_objectives": [...],
    "prerequisites": [...],
    "tags": [...],
    "created_at": "2024-01-15T10:30:00Z",
    "updated_at": "2024-01-15T10:30:00Z"
  }
}
```

### 2. Upload Lecture Video

**POST** `/section/{sectionId}/upload-video`

Uploads a video file and creates a lecture.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `video`: Video file (MP4, WebM, AVI, etc.)
- `title`: Lecture title
- `description`: Optional description

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "title": "Uploaded Video Lecture",
    "video_url": "/uploads/lectures/videos/lecture-video-1642248600000-123456789.mp4",
    "attachments": [
      {
        "name": "original-video.mp4",
        "url": "/uploads/lectures/videos/lecture-video-1642248600000-123456789.mp4",
        "type": "video",
        "size": 52428800
      }
    ]
  }
}
```

### 3. Get Lectures by Section

**GET** `/section/{sectionId}`

Retrieves all lectures for a specific section.

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "123e4567-e89b-12d3-a456-426614174000",
      "title": "Introduction to JavaScript",
      "content": "This lecture covers...",
      "video_url": "https://example.com/video.mp4",
      "duration_minutes": 45,
      "order_index": 1,
      "status": "published",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### 4. Update Lecture

**PUT** `/{lectureId}`

Updates an existing lecture.

**Request Body:** Same as create lecture, all fields optional.

### 5. Delete Lecture

**DELETE** `/{lectureId}`

Deletes a lecture.

**Response:**
```json
{
  "success": true,
  "message": "Lecture deleted successfully"
}
```

## Exercises API

### Base URL: `/v1/admin/exercises-upload`

### 1. Bulk Create Exercises

**POST** `/section/{sectionId}/bulk-create`

Creates multiple exercises with questions from JSON data.

**Request Body:**
```json
{
  "exercises": [
    {
      "title": "JavaScript Variables Practice",
      "description": "Practice exercises for JavaScript variables and data types",
      "content": "Complete the following exercises to test your understanding of JavaScript variables.",
      "type": "practice",
      "difficulty": "easy",
      "time_limit": 30,
      "passing_score": 70,
      "max_attempts": 3,
      "order_index": 1,
      "questions": [
        {
          "type": "mcq",
          "text": "Which of the following is the correct way to declare a variable in JavaScript?",
          "hint": "Think about the keywords used for variable declaration",
          "explanation": "The 'let' keyword is the modern way to declare variables in JavaScript",
          "points": 1,
          "order_index": 0,
          "options": [
            {
              "text": "variable x = 5;",
              "correct": false,
              "order_index": 0
            },
            {
              "text": "let x = 5;",
              "correct": true,
              "order_index": 1
            },
            {
              "text": "declare x = 5;",
              "correct": false,
              "order_index": 2
            },
            {
              "text": "x := 5;",
              "correct": false,
              "order_index": 3
            }
          ]
        },
        {
          "type": "text",
          "text": "Explain the difference between 'let' and 'const' in JavaScript.",
          "points": 2,
          "order_index": 1,
          "answers": [
            {
              "answer_text": "let allows reassignment while const does not",
              "is_case_sensitive": false
            },
            {
              "answer_text": "const creates immutable bindings",
              "is_case_sensitive": false
            }
          ]
        },
        {
          "type": "coding",
          "text": "Write a function that takes two numbers and returns their sum.",
          "content": "// Write your function here\nfunction addNumbers(a, b) {\n  // Your code here\n}",
          "language": "javascript",
          "points": 3,
          "order_index": 2,
          "answers": [
            {
              "answer_text": "return a + b",
              "is_case_sensitive": false
            }
          ]
        }
      ]
    },
    {
      "title": "JavaScript Functions Quiz",
      "description": "Test your knowledge of JavaScript functions",
      "type": "quiz",
      "difficulty": "medium",
      "time_limit": 45,
      "passing_score": 80,
      "max_attempts": 2,
      "order_index": 2,
      "questions": [
        {
          "type": "fill-in-the-blanks",
          "text": "A _____ function is a function that calls itself.",
          "points": 1,
          "order_index": 0,
          "answers": [
            {
              "answer_text": "recursive",
              "is_case_sensitive": false
            }
          ]
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "789e0123-e89b-12d3-a456-426614174002",
      "title": "JavaScript Variables Practice",
      "section_id": "456e7890-e89b-12d3-a456-426614174001",
      "type": "practice",
      "difficulty": "easy",
      "status": "draft",
      "created_at": "2024-01-15T11:00:00Z"
    }
  ],
  "summary": {
    "total_processed": 2,
    "successful": 2,
    "failed": 0,
    "errors": []
  }
}
```

### 2. Upload Exercise File

**POST** `/section/{sectionId}/upload-file`

Uploads exercises from JSON, CSV, or Excel file.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `file`: Exercise file (JSON, CSV, or Excel)
- `format`: File format ("json", "csv", or "excel")
- `options`: Optional parsing options

**Example CSV Format:**
```csv
title,description,content,type,difficulty,time_limit,passing_score,max_attempts,order_index
"Basic Math Quiz","Simple arithmetic questions","Solve the following problems","quiz","easy",20,70,3,1
"Advanced Calculus","Calculus problems","Solve these calculus problems","practice","hard",60,80,2,2
```

**Example Excel Format:**
- Sheet 1 (Exercises): title, description, type, difficulty, time_limit, passing_score
- Sheet 2 (Questions): exercise_title, type, text, points, explanation
- Sheet 3 (Options): question_text, option_text, correct

### 3. Create from Template

**POST** `/section/{sectionId}/from-template`

Creates an exercise from a predefined template.

**Request Body:**
```json
{
  "template_id": "template-123e4567-e89b-12d3-a456-426614174000",
  "title": "Customized Exercise Title",
  "description": "Custom description for this exercise",
  "customizations": {
    "difficulty": "medium",
    "time_limit": 45,
    "passing_score": 75,
    "max_attempts": 2
  }
}
```

### 4. Upload Exercise Assets

**POST** `/{exerciseId}/upload-assets`

Uploads supporting files for an exercise.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `assets`: Array of files (images, documents, etc.)
- `asset_type`: Type of assets ("question_image", "reference_document", "solution_file", "template_file")
- `descriptions`: Optional descriptions for each file

## Quizzes API

### Base URL: `/v1/admin/quiz-upload`

### 1. Bulk Create Quizzes

**POST** `/section/{sectionId}/bulk-create`

Creates multiple quizzes with questions from JSON data.

**Request Body:**
```json
{
  "quizzes": [
    {
      "title": "JavaScript Fundamentals Quiz",
      "description": "Test your understanding of JavaScript basics",
      "instructions": "Answer all questions carefully. You have 60 minutes to complete this quiz.",
      "time_limit": 60,
      "passing_score": 75,
      "max_attempts": 2,
      "randomize_questions": true,
      "show_results": true,
      "order_index": 1,
      "questions": [
        {
          "type": "mcq",
          "text": "What is the output of console.log(typeof null)?",
          "content": "console.log(typeof null);",
          "points": 1,
          "time_limit": 30,
          "order_index": 0,
          "explanation": "In JavaScript, typeof null returns 'object' due to a historical bug",
          "hint": "This is a well-known JavaScript quirk",
          "options": [
            {
              "text": "null",
              "correct": false,
              "order_index": 0,
              "explanation": "This would be logical but incorrect"
            },
            {
              "text": "object",
              "correct": true,
              "order_index": 1,
              "explanation": "Correct! This is a JavaScript quirk"
            },
            {
              "text": "undefined",
              "correct": false,
              "order_index": 2
            },
            {
              "text": "string",
              "correct": false,
              "order_index": 3
            }
          ]
        },
        {
          "type": "true_false",
          "text": "JavaScript is a statically typed language.",
          "points": 1,
          "order_index": 1,
          "explanation": "JavaScript is dynamically typed, not statically typed",
          "correct_answer": "false"
        },
        {
          "type": "fill_blank",
          "text": "The _____ operator is used to check both value and type equality in JavaScript.",
          "points": 1,
          "order_index": 2,
          "correct_answer": "===",
          "explanation": "The triple equals (===) operator checks for strict equality"
        },
        {
          "type": "matching",
          "text": "Match the JavaScript concepts with their descriptions:",
          "points": 2,
          "order_index": 3,
          "matching_pairs": [
            {
              "left": "Hoisting",
              "right": "Moving declarations to the top of their scope"
            },
            {
              "left": "Closure",
              "right": "Function with access to outer scope variables"
            },
            {
              "left": "Callback",
              "right": "Function passed as argument to another function"
            }
          ]
        },
        {
          "type": "ordering",
          "text": "Arrange the following JavaScript execution phases in correct order:",
          "points": 2,
          "order_index": 4,
          "ordering_items": [
            {
              "text": "Compilation",
              "correct_order": 1
            },
            {
              "text": "Creation Phase",
              "correct_order": 2
            },
            {
              "text": "Execution Phase",
              "correct_order": 3
            }
          ]
        }
      ]
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "quiz-123e4567-e89b-12d3-a456-426614174000",
      "title": "JavaScript Fundamentals Quiz",
      "section_id": "456e7890-e89b-12d3-a456-426614174001",
      "time_limit": 60,
      "passing_score": 75,
      "created_at": "2024-01-15T12:00:00Z"
    }
  ],
  "summary": {
    "total_processed": 1,
    "successful": 1,
    "failed": 0,
    "errors": []
  }
}
```

### 2. Upload Quiz Media

**POST** `/{quizId}/upload-media`

Uploads media files (images, videos, audio) for quiz questions.

**Content-Type:** `multipart/form-data`

**Form Data:**
- `media`: Array of media files
- `question_ids`: Optional array of question IDs to associate files with
- `alt_texts`: Optional alt text for images
- `descriptions`: Optional descriptions

### 3. Configure Quiz Settings

**PUT** `/{quizId}/settings`

Updates quiz configuration and settings.

**Request Body:**
```json
{
  "time_limit": 90,
  "passing_score": 80,
  "max_attempts": 3,
  "randomize_questions": true,
  "randomize_options": true,
  "show_results_immediately": false,
  "allow_review": true,
  "show_correct_answers": true,
  "availability_start": "2024-01-20T09:00:00Z",
  "availability_end": "2024-01-27T23:59:59Z",
  "late_submission_penalty": 10,
  "proctoring_enabled": false,
  "browser_lockdown": false
}
```

### 4. Generate Quiz from Question Bank

**POST** `/section/{sectionId}/generate-from-bank`

Automatically generates a quiz by selecting questions from the question bank.

**Request Body:**
```json
{
  "title": "Auto-Generated JavaScript Quiz",
  "description": "Automatically generated quiz from question bank",
  "question_count": 20,
  "difficulty_distribution": {
    "easy": 30,
    "medium": 50,
    "hard": 20
  },
  "topic_filters": ["javascript", "programming", "web-development"],
  "question_types": ["mcq", "true_false", "fill_blank"],
  "exclude_used_questions": true,
  "settings": {
    "time_limit": 60,
    "passing_score": 75,
    "max_attempts": 2,
    "randomize_questions": true
  }
}
```

### 5. Import from External Platform

**POST** `/section/{sectionId}/import-external`

Imports quizzes from external platforms like Moodle, Canvas, etc.

**Request Body:**
```json
{
  "platform": "moodle",
  "data": {
    // Platform-specific data structure
    "quiz_xml": "<quiz>...</quiz>",
    "questions": [...]
  },
  "mapping_config": {
    "title": "name",
    "description": "intro",
    "time_limit": "timelimit"
  },
  "import_settings": {
    "preserve_formatting": true,
    "import_media": true,
    "convert_question_types": true
  }
}
```

## File Upload Guidelines

### Supported File Types

**Lectures:**
- Videos: MP4, WebM, AVI, MOV (max 500MB)
- Documents: PDF, DOC, DOCX, PPT, PPTX (max 50MB)
- Images: JPG, PNG, GIF, WebP (max 25MB)

**Exercises:**
- Data files: JSON, CSV, Excel (max 10MB)
- Assets: Images, documents, code files (max 25MB each)

**Quizzes:**
- Data files: JSON, CSV, Excel (max 15MB)
- Media: Images, videos, audio (max 100MB each)

### File Naming Conventions

Files are automatically renamed with timestamps and unique identifiers:
- `lecture-video-{timestamp}-{random}.{ext}`
- `exercise-asset-{timestamp}-{random}.{ext}`
- `quiz-media-{timestamp}-{random}.{ext}`

### Upload Directories

```
uploads/
├── lectures/
│   ├── videos/
│   └── attachments/
├── exercises/
│   ├── imports/
│   └── assets/
└── quizzes/
    ├── imports/
    └── media/
```

## Error Handling

### Common Error Responses

**400 Bad Request:**
```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    {
      "field": "title",
      "message": "Title is required"
    },
    {
      "field": "questions",
      "message": "At least one question is required"
    }
  ]
}
```

**401 Unauthorized:**
```json
{
  "success": false,
  "message": "Admin access required"
}
```

**413 Payload Too Large:**
```json
{
  "success": false,
  "message": "File size exceeds maximum limit"
}
```

**422 Unprocessable Entity:**
```json
{
  "success": false,
  "message": "Invalid file format",
  "details": "Only JSON, CSV, and Excel files are allowed"
}
```

### Validation Rules

**Lectures:**
- Title: Required, max 255 characters
- Duration: Positive integer (minutes)
- Status: One of 'draft', 'published', 'archived'

**Exercises:**
- Title: Required, max 255 characters
- Type: One of 'practice', 'quiz', 'assignment', 'coding', 'sql', 'python', 'excel'
- Difficulty: One of 'easy', 'medium', 'hard'
- Passing score: 0-100
- Time limit: Positive integer (minutes)

**Quizzes:**
- Title: Required, max 255 characters
- Questions: At least 1 question required
- MCQ questions: At least 2 options, at least 1 correct
- Time limit: Positive integer (minutes)
- Passing score: 0-100

## Rate Limits

- File uploads: 10 requests per minute
- Bulk operations: 5 requests per minute
- Regular API calls: 100 requests per minute

## Best Practices

1. **Validate data before upload** using the validation endpoints
2. **Use appropriate file formats** for better performance
3. **Optimize media files** before uploading
4. **Test with small datasets** before bulk operations
5. **Use templates** for consistent content structure
6. **Implement proper error handling** in your client applications
7. **Monitor upload progress** for large files
8. **Use compression** for large datasets

## Example Integration

Here's a complete example of creating a lecture with video upload:

```javascript
// 1. First upload the video
const formData = new FormData();
formData.append('video', videoFile);
formData.append('title', 'My Lecture Title');
formData.append('description', 'Lecture description');

const uploadResponse = await fetch('/v1/admin/lectures/section/123/upload-video', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token
  },
  body: formData
});

const uploadResult = await uploadResponse.json();

// 2. Then update with additional details
const updateResponse = await fetch(`/v1/admin/lectures/${uploadResult.data.id}`, {
  method: 'PUT',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    learning_objectives: [
      'Understand the topic',
      'Apply the concepts'
    ],
    tags: ['programming', 'javascript']
  })
});
```

This comprehensive API allows for flexible content creation and management in the Jarvis3 learning platform.

---

## Mentor Chat Endpoints (Art of Problem Solving)

### GET `/v1/sections/exercises/{exerciseId}/questions/{questionId}/chat`

Fetch the current mentor-chat session for a practice question. The response bundles the scenario configuration, hidden target questions (for the AI only), identified student questions so far, and the full message history.

```json
{
  "question": { "id": "question-uuid", "text": "What questions would help you explore this hypothesis using data?" },
  "config": {
    "context": "App logins dropped because users are facing login errors after the latest app update.",
    "hypothesis": "Most users drop off at the document upload step due to unclear instructions.",
    "guidingQuestion": "What questions would help you explore this hypothesis using data?",
    "introMessage": "Share your end questions and I will discuss them with you.",
    "targetQuestions": ["..."] // never rendered in the UI
  },
  "chat": {
    "id": "chat-session-id",
    "status": "active",
    "messages": [
      { "role": "mentor", "content": "Hi there! Let's explore this together.", "created_at": "2025-02-06T10:30:00Z" }
    ],
    "identified_questions": []
  },
  "ai": {
    "message": "Hi there! Let's explore this together.",
    "identified_questions": [],
    "status": "coaching"
  }
}
```

### POST `/v1/sections/exercises/{exerciseId}/questions/{questionId}/chat`

Send a new student message to the mentor. The backend forwards the conversation to the AI service and returns the updated session.

**Request Body**

```json
{
  "message": "I think users might be confused during the upload step."
}
```

**Response**

Matches the GET response shape, with the new student and mentor messages appended and the identified questions array updated.
