import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

import { v4 as uuidv4 } from 'uuid';

import type {
  CreateQuestionDto,
  UpdateQuestionDto,
  CreateCategoryDto,
  CreateTemplateDto,
} from './admin-assessment.controller';

import { AssessmentDataSeeder } from './seed-assessment-data';

interface QueryFilters {
  page: number;

  limit: number;

  category_id?: string;

  question_type?: string;

  module_id?: string;

  difficulty_level?: string;

  search?: string;
}

interface ReportFilters {
  template_id?: string;

  start_date?: string;

  end_date?: string;
}

@Injectable()
export class AdminAssessmentService {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;

  private serviceKey = process.env.SUPABASE_SERVICE_ROLE?.trim();

  private anonKey = process.env.SUPABASE_ANON_KEY?.trim();

  private headers(userToken?: string) {
    const sk = this.serviceKey;

    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;

    if (looksJwt) {
      return {
        apikey: sk,

        Authorization: `Bearer ${sk}`,

        'Content-Type': 'application/json',
      };
    }

    if (this.anonKey && userToken) {
      return {
        apikey: this.anonKey,

        Authorization: `Bearer ${userToken}`,

        'Content-Type': 'application/json',
      };
    }

    throw new InternalServerErrorException(
      'Supabase keys missing for admin assessments',
    );
  }

  private storageHeaders(
    userToken?: string,
    contentType?: string,
  ): Record<string, string> {
    const sk = this.serviceKey;

    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;

    if (looksJwt) {
      return {
        apikey: sk,

        Authorization: `Bearer ${sk}`,

        ...(contentType ? { 'Content-Type': contentType } : {}),
      };
    }

    if (this.anonKey && userToken) {
      return {
        apikey: this.anonKey,

        Authorization: `Bearer ${userToken}`,

        ...(contentType ? { 'Content-Type': contentType } : {}),
      };
    }

    throw new InternalServerErrorException(
      'Supabase keys missing for admin assessments',
    );
  }

  // ========== Categories Management ==========

  async getCategories(userToken?: string) {
    const url = `${this.restUrl}/assessment_categories?order=order_index.asc,display_name.asc`;

    const res = await fetch(url, { headers: this.headers(userToken) });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch categories: ${res.status} ${await res.text()}`,
      );
    }

    return res.json();
  }

  async createCategory(
    categoryData: CreateCategoryDto,
    createdBy: string,
    userToken?: string,
  ) {
    const url = `${this.restUrl}/assessment_categories`;

    const payload = {
      ...categoryData,

      created_at: new Date().toISOString(),

      updated_at: new Date().toISOString(),
    };

    const res = await fetch(url, {
      method: 'POST',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify([payload]),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to create category: ${res.status} ${await res.text()}`,
      );
    }

    const [category] = await res.json();

    return category;
  }

  async updateCategory(
    id: string,
    updateData: Partial<CreateCategoryDto>,
    userToken?: string,
  ) {
    const url = `${this.restUrl}/assessment_categories?id=eq.${id}`;

    const payload = {
      ...updateData,

      updated_at: new Date().toISOString(),
    };

    const res = await fetch(url, {
      method: 'PATCH',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to update category: ${res.status} ${await res.text()}`,
      );
    }

    const categories = await res.json();

    if (categories.length === 0) {
      throw new NotFoundException(`Category with id ${id} not found`);
    }

    return categories[0];
  }

  async deleteCategory(id: string, userToken?: string) {
    // Check if category has questions

    const questionsUrl = `${this.restUrl}/assessment_questions?category_id=eq.${id}&select=id&limit=1`;

    const questionsRes = await fetch(questionsUrl, {
      headers: this.headers(userToken),
    });

    if (questionsRes.ok) {
      const questions = await questionsRes.json();

      if (questions.length > 0) {
        throw new BadRequestException(
          'Cannot delete category that contains questions',
        );
      }
    }

    const url = `${this.restUrl}/assessment_categories?id=eq.${id}`;

    const res = await fetch(url, {
      method: 'DELETE',

      headers: this.headers(userToken),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to delete category: ${res.status} ${await res.text()}`,
      );
    }

    return { success: true };
  }

  async getCourseModules(userToken?: string) {
    const coursesUrl = `${this.restUrl}/courses?select=id,title&order=title.asc`;

    const subjectsUrl = `${this.restUrl}/subjects?select=id,title,course_id&order=title.asc`;

    const modulesUrl = `${this.restUrl}/modules?select=id,title,subject_id&order=title.asc`;

    const [coursesRes, subjectsRes, modulesRes] = await Promise.all([
      fetch(coursesUrl, { headers: this.headers(userToken) }),

      fetch(subjectsUrl, { headers: this.headers(userToken) }),

      fetch(modulesUrl, { headers: this.headers(userToken) }),
    ]);

    if (!coursesRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch courses: ${coursesRes.status} ${await coursesRes.text()}`,
      );
    }

    if (!subjectsRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch subjects: ${subjectsRes.status} ${await subjectsRes.text()}`,
      );
    }

    if (!modulesRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch modules: ${modulesRes.status} ${await modulesRes.text()}`,
      );
    }

    const courses = await coursesRes.json();

    const subjects = await subjectsRes.json();

    const modules = await modulesRes.json();

    const courseMap = new Map<string, any>();

    courses.forEach((course: any) => {
      courseMap.set(course.id, { ...course, subjects: [] });
    });

    const subjectMap = new Map<string, any>();

    subjects.forEach((subject: any) => {
      const course = courseMap.get(subject.course_id);

      const subjectWithContext = {
        ...subject,

        course_title: course?.title ?? null,

        modules: [] as any[],
      };

      subjectMap.set(subject.id, subjectWithContext);

      if (course) {
        course.subjects.push(subjectWithContext);
      }
    });

    const enrichedModules = modules.map((module: any) => {
      const subject = subjectMap.get(module.subject_id);

      const course = subject?.course_id
        ? courseMap.get(subject.course_id)
        : null;

      const moduleWithContext = {
        ...module,

        subject_title: subject?.title ?? null,

        course_id: subject?.course_id ?? null,

        course_title: course?.title ?? null,
      };

      if (subject) {
        subject.modules.push(moduleWithContext);
      }

      return moduleWithContext;
    });

    return {
      courses: Array.from(courseMap.values()),

      subjects: Array.from(subjectMap.values()),

      modules: enrichedModules,
    };
  }

  // ========== Questions Management ==========

  async getQuestions(filters: QueryFilters, userToken?: string) {
    const {
      page,
      limit,
      category_id,
      question_type,
      module_id,
      difficulty_level,
      search,
    } = filters;

    const offset = (page - 1) * limit;

    let query = `assessment_questions?select=*,assessment_categories(display_name)&order=created_at.desc&limit=${limit}&offset=${offset}`;

    // Add filters

    const conditions: string[] = [];

    if (category_id) conditions.push(`category_id=eq.${category_id}`);

    if (question_type) conditions.push(`question_type=eq.${question_type}`);

    if (module_id) conditions.push(`module_id=eq.${module_id}`);

    if (difficulty_level)
      conditions.push(`difficulty_level=eq.${difficulty_level}`);

    if (search) conditions.push(`question_text=ilike.%${search}%`);

    if (conditions.length > 0) {
      query += `&${conditions.join('&')}`;
    }

    const url = `${this.restUrl}/${query}`;

    const res = await fetch(url, { headers: this.headers(userToken) });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch questions: ${res.status} ${await res.text()}`,
      );
    }

    const questions = await res.json();

    const moduleIds = Array.from(
      new Set(questions.map((q: any) => q.module_id).filter(Boolean)),
    );

    const modulesById: Record<string, any> = {};

    const subjectsById: Record<string, any> = {};

    const coursesById: Record<string, any> = {};

    if (moduleIds.length > 0) {
      const moduleFilter =
        moduleIds.length === 1
          ? `id=eq.${moduleIds[0]}`
          : `id=in.(${moduleIds.join(',')})`;

      const modulesUrl = `${this.restUrl}/modules?select=id,title,subject_id&${moduleFilter}`;

      const modulesRes = await fetch(modulesUrl, {
        headers: this.headers(userToken),
      });

      if (!modulesRes.ok) {
        throw new InternalServerErrorException(
          `Failed to fetch modules: ${modulesRes.status} ${await modulesRes.text()}`,
        );
      }

      const moduleRows = await modulesRes.json();

      moduleRows.forEach((module: any) => {
        modulesById[module.id] = module;
      });

      const subjectIds = Array.from(
        new Set(moduleRows.map((m: any) => m.subject_id).filter(Boolean)),
      );

      if (subjectIds.length > 0) {
        const subjectFilter =
          subjectIds.length === 1
            ? `id=eq.${subjectIds[0]}`
            : `id=in.(${subjectIds.join(',')})`;

        const subjectsUrl = `${this.restUrl}/subjects?select=id,title,course_id&${subjectFilter}`;

        const subjectsRes = await fetch(subjectsUrl, {
          headers: this.headers(userToken),
        });

        if (!subjectsRes.ok) {
          throw new InternalServerErrorException(
            `Failed to fetch subjects: ${subjectsRes.status} ${await subjectsRes.text()}`,
          );
        }

        const subjectRows = await subjectsRes.json();

        subjectRows.forEach((subject: any) => {
          subjectsById[subject.id] = subject;
        });

        const courseIds = Array.from(
          new Set(subjectRows.map((s: any) => s.course_id).filter(Boolean)),
        );

        if (courseIds.length > 0) {
          const courseFilter =
            courseIds.length === 1
              ? `id=eq.${courseIds[0]}`
              : `id=in.(${courseIds.join(',')})`;

          const coursesUrl = `${this.restUrl}/courses?select=id,title&${courseFilter}`;

          const coursesRes = await fetch(coursesUrl, {
            headers: this.headers(userToken),
          });

          if (!coursesRes.ok) {
            throw new InternalServerErrorException(
              `Failed to fetch courses: ${coursesRes.status} ${await coursesRes.text()}`,
            );
          }

          const courseRows = await coursesRes.json();

          courseRows.forEach((course: any) => {
            coursesById[course.id] = course;
          });
        }
      }
    }

    const enrichedQuestions = questions.map((question: any) => {
      if (!question.module_id) {
        return { ...question, module: null };
      }

      const module = modulesById[question.module_id];

      if (!module) {
        return { ...question, module: null };
      }

      const subject = module.subject_id
        ? subjectsById[module.subject_id]
        : null;

      const course = subject?.course_id ? coursesById[subject.course_id] : null;

      return {
        ...question,

        module: {
          ...module,

          subject_title: subject?.title ?? null,

          course_id: subject?.course_id ?? null,

          course_title: course?.title ?? null,
        },
      };
    });

    // Get total count for pagination

    const countQuery =
      conditions.length > 0
        ? `assessment_questions?select=count&${conditions.join('&')}`
        : 'assessment_questions?select=count';

    const countUrl = `${this.restUrl}/${countQuery}`;

    const countRes = await fetch(countUrl, {
      headers: this.headers(userToken),
    });

    const [{ count }] = await countRes.json();

    return {
      questions: enrichedQuestions,

      pagination: {
        page,

        limit,

        total: count,

        pages: Math.ceil(count / limit),
      },
    };
  }

  async getQuestionById(id: string, userToken?: string) {
    // Get question with options and text answers

    const questionUrl = `${this.restUrl}/assessment_questions?id=eq.${id}&select=*,assessment_categories(display_name)`;

    const optionsUrl = `${this.restUrl}/assessment_question_options?question_id=eq.${id}&order=order_index.asc`;

    const textAnswerUrl = `${this.restUrl}/assessment_text_answers?question_id=eq.${id}`;

    const [questionRes, optionsRes, textAnswerRes] = await Promise.all([
      fetch(questionUrl, { headers: this.headers(userToken) }),

      fetch(optionsUrl, { headers: this.headers(userToken) }),

      fetch(textAnswerUrl, { headers: this.headers(userToken) }),
    ]);

    if (!questionRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch question: ${questionRes.status}`,
      );
    }

    const [question] = await questionRes.json();

    if (!question) {
      throw new NotFoundException(`Question with id ${id} not found`);
    }

    const options = await optionsRes.json();

    const textAnswers = await textAnswerRes.json();

    let moduleDetails: any = null;

    if (question.module_id) {
      const moduleUrl = `${this.restUrl}/modules?id=eq.${question.module_id}&select=id,title,subject_id`;

      const moduleRes = await fetch(moduleUrl, {
        headers: this.headers(userToken),
      });

      if (moduleRes.ok) {
        const [module] = await moduleRes.json();

        if (module) {
          let subject: any = null;

          let course: any = null;

          if (module.subject_id) {
            const subjectRes = await fetch(
              `${this.restUrl}/subjects?id=eq.${module.subject_id}&select=id,title,course_id`,
              { headers: this.headers(userToken) },
            );

            if (subjectRes.ok) {
              [subject] = await subjectRes.json();

              if (subject?.course_id) {
                const courseRes = await fetch(
                  `${this.restUrl}/courses?id=eq.${subject.course_id}&select=id,title`,
                  { headers: this.headers(userToken) },
                );

                if (courseRes.ok) {
                  [course] = await courseRes.json();
                }
              }
            }
          }

          moduleDetails = {
            ...module,

            subject_title: subject?.title ?? null,

            course_id: subject?.course_id ?? null,

            course_title: course?.title ?? null,
          };
        }
      }
    }

    return {
      ...question,

      options: options || [],

      text_answer: textAnswers[0] || null,

      module: moduleDetails,
    };
  }

  async createQuestion(
    questionData: CreateQuestionDto,
    createdBy: string,
    userToken?: string,
  ) {
    // Create the main question

    const questionPayload = {
      category_id: questionData.category_id || null,

      module_id: questionData.module_id || null,

      question_type: questionData.question_type,

      question_text: questionData.question_text,

      question_image_url: questionData.question_image_url || null,

      explanation: questionData.explanation || null,

      difficulty_level: questionData.difficulty_level,

      points_value: questionData.points_value,

      time_limit_seconds: questionData.time_limit_seconds,

      tags: questionData.tags || [],

      created_by: createdBy,

      created_at: new Date().toISOString(),

      updated_at: new Date().toISOString(),
    };

    const questionUrl = `${this.restUrl}/assessment_questions`;

    const questionRes = await fetch(questionUrl, {
      method: 'POST',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify([questionPayload]),
    });

    if (!questionRes.ok) {
      throw new InternalServerErrorException(
        `Failed to create question: ${questionRes.status} ${await questionRes.text()}`,
      );
    }

    const [question] = await questionRes.json();

    // Create options for MCQ questions

    if (
      (questionData.question_type === 'mcq' ||
        questionData.question_type === 'image_mcq') &&
      questionData.options
    ) {
      const optionsPayload = questionData.options.map((option, index) => ({
        question_id: question.id,

        option_text: option.option_text,

        is_correct: option.is_correct,

        order_index: index,

        explanation: option.explanation || null,
      }));

      const optionsUrl = `${this.restUrl}/assessment_question_options`;

      const optionsRes = await fetch(optionsUrl, {
        method: 'POST',

        headers: this.headers(userToken),

        body: JSON.stringify(optionsPayload),
      });

      if (!optionsRes.ok) {
        // Clean up the question if options creation fails

        await this.deleteQuestion(question.id, userToken);

        throw new InternalServerErrorException(
          `Failed to create question options: ${optionsRes.status}`,
        );
      }
    }

    // Create text answer for text questions

    if (
      ['text', 'image_text', 'short_text', 'fill_blank'].includes(
        questionData.question_type,
      ) &&
      questionData.text_answer
    ) {
      const textAnswerPayload = {
        question_id: question.id,

        correct_answer: questionData.text_answer.correct_answer,

        case_sensitive: questionData.text_answer.case_sensitive,

        exact_match: questionData.text_answer.exact_match,

        alternate_answers: questionData.text_answer.alternate_answers || [],

        keywords: questionData.text_answer.keywords || [],
      };

      const textAnswerUrl = `${this.restUrl}/assessment_text_answers`;

      const textAnswerRes = await fetch(textAnswerUrl, {
        method: 'POST',

        headers: this.headers(userToken),

        body: JSON.stringify([textAnswerPayload]),
      });

      if (!textAnswerRes.ok) {
        // Clean up the question if text answer creation fails

        await this.deleteQuestion(question.id, userToken);

        throw new InternalServerErrorException(
          `Failed to create text answer: ${textAnswerRes.status}`,
        );
      }
    }

    return this.getQuestionById(question.id, userToken);
  }

  async updateQuestion(
    id: string,
    updateData: UpdateQuestionDto,
    userToken?: string,
  ) {
    // Update main question

    const questionPayload = {
      ...updateData,

      updated_at: new Date().toISOString(),
    };

    // Remove nested objects that should be handled separately

    delete questionPayload.options;

    delete questionPayload.text_answer;

    const questionUrl = `${this.restUrl}/assessment_questions?id=eq.${id}`;

    const questionRes = await fetch(questionUrl, {
      method: 'PATCH',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify(questionPayload),
    });

    if (!questionRes.ok) {
      throw new InternalServerErrorException(
        `Failed to update question: ${questionRes.status} ${await questionRes.text()}`,
      );
    }

    const [question] = await questionRes.json();

    if (!question) {
      throw new NotFoundException(`Question with id ${id} not found`);
    }

    // Update options if provided

    if (updateData.options) {
      // Delete existing options

      await fetch(
        `${this.restUrl}/assessment_question_options?question_id=eq.${id}`,
        {
          method: 'DELETE',

          headers: this.headers(userToken),
        },
      );

      // Create new options

      const optionsPayload = updateData.options.map((option, index) => ({
        question_id: id,

        option_text: option.option_text,

        is_correct: option.is_correct,

        order_index: index,

        explanation: option.explanation || null,
      }));

      await fetch(`${this.restUrl}/assessment_question_options`, {
        method: 'POST',

        headers: this.headers(userToken),

        body: JSON.stringify(optionsPayload),
      });
    }

    // Update text answer if provided

    if (updateData.text_answer) {
      // Delete existing text answer

      await fetch(
        `${this.restUrl}/assessment_text_answers?question_id=eq.${id}`,
        {
          method: 'DELETE',

          headers: this.headers(userToken),
        },
      );

      // Create new text answer

      const textAnswerPayload = {
        question_id: id,

        correct_answer: updateData.text_answer.correct_answer,

        case_sensitive: updateData.text_answer.case_sensitive,

        exact_match: updateData.text_answer.exact_match,

        alternate_answers: updateData.text_answer.alternate_answers || [],

        keywords: updateData.text_answer.keywords || [],
      };

      await fetch(`${this.restUrl}/assessment_text_answers`, {
        method: 'POST',

        headers: this.headers(userToken),

        body: JSON.stringify([textAnswerPayload]),
      });
    }

    return this.getQuestionById(id, userToken);
  }

  async deleteQuestion(id: string, userToken?: string) {
    const url = `${this.restUrl}/assessment_questions?id=eq.${id}`;

    const res = await fetch(url, {
      method: 'DELETE',

      headers: this.headers(userToken),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to delete question: ${res.status} ${await res.text()}`,
      );
    }

    return { success: true };
  }

  async bulkCreateQuestions(
    questionsData: CreateQuestionDto[],
    createdBy: string,
    userToken?: string,
  ) {
    const results: Array<{ index: number; question: any; success: boolean }> =
      [];

    const errors: Array<{ index: number; error: any; success: boolean }> = [];

    for (let i = 0; i < questionsData.length; i++) {
      try {
        const question = await this.createQuestion(
          questionsData[i],
          createdBy,
          userToken,
        );

        results.push({ index: i, question, success: true });
      } catch (error: any) {
        errors.push({ index: i, error: error.message, success: false });
      }
    }

    return { results, errors, totalProcessed: questionsData.length };
  }

  async toggleQuestionStatus(id: string, userToken?: string) {
    // Get current status

    const getUrl = `${this.restUrl}/assessment_questions?id=eq.${id}&select=is_active`;

    const getRes = await fetch(getUrl, { headers: this.headers(userToken) });

    if (!getRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch question status: ${getRes.status}`,
      );
    }

    const [question] = await getRes.json();

    if (!question) {
      throw new NotFoundException(`Question with id ${id} not found`);
    }

    // Toggle status

    const updateUrl = `${this.restUrl}/assessment_questions?id=eq.${id}`;

    const updateRes = await fetch(updateUrl, {
      method: 'PATCH',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify({
        is_active: !question.is_active,
        updated_at: new Date().toISOString(),
      }),
    });

    if (!updateRes.ok) {
      throw new InternalServerErrorException(
        `Failed to toggle question status: ${updateRes.status}`,
      );
    }

    const [updated] = await updateRes.json();

    return updated;
  }

  // ========== Media Upload ==========

  async uploadImage(
    file: Express.Multer.File,
    uploadedBy: string,
    userToken?: string,
  ) {
    if (!file) {
      throw new BadRequestException('No image file provided');
    }

    const supabaseUrl = process.env.SUPABASE_URL?.trim();

    if (!supabaseUrl) {
      throw new InternalServerErrorException(
        'Supabase URL not configured for media uploads',
      );
    }

    const originalName = file.originalname || 'upload';

    const lastDot = originalName.lastIndexOf('.');

    const extension = lastDot >= 0 ? originalName.slice(lastDot + 1) : 'bin';

    const safeExtension = extension.replace(/[^a-zA-Z0-9]/g, '') || 'bin';

    const fileName = `${uuidv4()}.${safeExtension}`;

    const bucket = 'plc';

    const objectPath = `assessment/${fileName}`;

    const uploadUrl = `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath}`;

    const uploadHeaders = this.storageHeaders(
      userToken,
      file.mimetype || 'application/octet-stream',
    );

    uploadHeaders['x-upsert'] = 'true';

    uploadHeaders['Cache-Control'] = 'public, max-age=31536000, immutable';

    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',

      headers: uploadHeaders,

      body: file.buffer as any,
    });

    if (!uploadRes.ok) {
      const body = await uploadRes.text();

      throw new InternalServerErrorException(
        `Failed to upload image to Supabase storage: ${uploadRes.status} ${body}`,
      );
    }

    const mediaPayload = {
      filename: fileName,

      original_filename: originalName,

      file_path: objectPath,

      file_size: file.size,

      mime_type: file.mimetype,

      uploaded_by: uploadedBy,

      upload_purpose: 'question_image',

      created_at: new Date().toISOString(),
    };

    const mediaUrl = `${this.restUrl}/assessment_media_files`;

    const mediaRes = await fetch(mediaUrl, {
      method: 'POST',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify([mediaPayload]),
    });

    if (!mediaRes.ok) {
      const body = await mediaRes.text();

      throw new InternalServerErrorException(
        `Failed to save media file info: ${mediaRes.status} ${body}`,
      );
    }

    const [mediaFile] = await mediaRes.json();

    const expiresInSeconds = 60 * 60 * 24 * 365;

    const signUrl = `${supabaseUrl}/storage/v1/object/sign/${bucket}/${objectPath}`;

    const signRes = await fetch(signUrl, {
      method: 'POST',

      headers: this.headers(userToken),

      body: JSON.stringify({ expiresIn: expiresInSeconds }),
    });

    if (!signRes.ok) {
      const body = await signRes.text();

      throw new InternalServerErrorException(
        `Failed to create signed URL: ${signRes.status} ${body}`,
      );
    }

    const signData: any = await signRes.json();

    const signedPath =
      signData?.signedURL ?? signData?.signedUrl ?? signData?.url;

    if (!signedPath) {
      throw new InternalServerErrorException(
        'Signed URL missing from Supabase response',
      );
    }

    const signedUrl = signedPath.startsWith('http')
      ? signedPath
      : `${supabaseUrl}${signedPath}`;

    return {
      ...mediaFile,

      url: signedUrl,
    };
  }

  // ========== Templates Management ==========

  async getTemplates(userToken?: string) {
    const url = `${this.restUrl}/assessment_templates?select=*,assessment_categories(display_name)&order=created_at.desc`;

    const res = await fetch(url, { headers: this.headers(userToken) });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch templates: ${res.status} ${await res.text()}`,
      );
    }

    return res.json();
  }

  async getTemplateById(id: string, userToken?: string) {
    const templateUrl = `${this.restUrl}/assessment_templates?id=eq.${id}&select=*,assessment_categories(display_name)`;

    const questionsUrl = `${this.restUrl}/assessment_template_questions?template_id=eq.${id}&select=*,assessment_questions(*)&order=order_index.asc`;

    const [templateRes, questionsRes] = await Promise.all([
      fetch(templateUrl, { headers: this.headers(userToken) }),

      fetch(questionsUrl, { headers: this.headers(userToken) }),
    ]);

    if (!templateRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch template: ${templateRes.status}`,
      );
    }

    const [template] = await templateRes.json();

    if (!template) {
      throw new NotFoundException(`Template with id ${id} not found`);
    }

    const questions = await questionsRes.json();

    return {
      ...template,

      questions: questions.map((q) => q.assessment_questions),
    };
  }

  async createTemplate(
    templateData: CreateTemplateDto,
    createdBy: string,
    userToken?: string,
  ) {
    const templatePayload = {
      title: templateData.title,

      description: templateData.description,

      instructions: templateData.instructions,

      category_id: templateData.category_id || null,

      total_questions: templateData.question_ids.length,

      time_limit_minutes: templateData.time_limit_minutes,

      passing_percentage: templateData.passing_percentage,

      randomize_questions: templateData.randomize_questions,

      randomize_options: templateData.randomize_options,

      show_results_immediately: templateData.show_results_immediately,

      allow_retakes: templateData.allow_retakes,

      max_attempts: templateData.max_attempts,

      difficulty_distribution: templateData.difficulty_distribution,

      is_public: templateData.is_public,

      created_by: createdBy,

      created_at: new Date().toISOString(),

      updated_at: new Date().toISOString(),
    };

    const templateUrl = `${this.restUrl}/assessment_templates`;

    const templateRes = await fetch(templateUrl, {
      method: 'POST',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify([templatePayload]),
    });

    if (!templateRes.ok) {
      throw new InternalServerErrorException(
        `Failed to create template: ${templateRes.status} ${await templateRes.text()}`,
      );
    }

    const [template] = await templateRes.json();

    // Add questions to template

    const questionsPayload = templateData.question_ids.map(
      (questionId, index) => ({
        template_id: template.id,

        question_id: questionId,

        order_index: index,
      }),
    );

    const questionsUrl = `${this.restUrl}/assessment_template_questions`;

    const questionsRes = await fetch(questionsUrl, {
      method: 'POST',

      headers: this.headers(userToken),

      body: JSON.stringify(questionsPayload),
    });

    if (!questionsRes.ok) {
      // Clean up template if question assignment fails

      await this.deleteTemplate(template.id, userToken);

      throw new InternalServerErrorException(
        `Failed to assign questions to template: ${questionsRes.status}`,
      );
    }

    return this.getTemplateById(template.id, userToken);
  }

  async updateTemplate(
    id: string,
    updateData: Partial<CreateTemplateDto>,
    userToken?: string,
  ) {
    const templatePayload: any = {
      ...updateData,

      updated_at: new Date().toISOString(),
    };

    // Remove question_ids from main update

    const questionIds = templatePayload.question_ids;

    delete templatePayload.question_ids;

    if (questionIds) {
      templatePayload.total_questions = questionIds.length;
    }

    const templateUrl = `${this.restUrl}/assessment_templates?id=eq.${id}`;

    const templateRes = await fetch(templateUrl, {
      method: 'PATCH',

      headers: { ...this.headers(userToken), Prefer: 'return=representation' },

      body: JSON.stringify(templatePayload),
    });

    if (!templateRes.ok) {
      throw new InternalServerErrorException(
        `Failed to update template: ${templateRes.status} ${await templateRes.text()}`,
      );
    }

    const [template] = await templateRes.json();

    if (!template) {
      throw new NotFoundException(`Template with id ${id} not found`);
    }

    // Update questions if provided

    if (questionIds) {
      // Delete existing question assignments

      await fetch(
        `${this.restUrl}/assessment_template_questions?template_id=eq.${id}`,
        {
          method: 'DELETE',

          headers: this.headers(userToken),
        },
      );

      // Add new question assignments

      const questionsPayload = questionIds.map((questionId, index) => ({
        template_id: id,

        question_id: questionId,

        order_index: index,
      }));

      await fetch(`${this.restUrl}/assessment_template_questions`, {
        method: 'POST',

        headers: this.headers(userToken),

        body: JSON.stringify(questionsPayload),
      });
    }

    return this.getTemplateById(id, userToken);
  }

  async deleteTemplate(id: string, userToken?: string) {
    const url = `${this.restUrl}/assessment_templates?id=eq.${id}`;

    const res = await fetch(url, {
      method: 'DELETE',

      headers: this.headers(userToken),
    });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to delete template: ${res.status} ${await res.text()}`,
      );
    }

    return { success: true };
  }

  // ========== Analytics and Reports ==========

  async getAnalyticsOverview(userToken?: string) {
    const queries = [
      `${this.restUrl}/assessment_questions?select=count`,

      `${this.restUrl}/assessment_templates?select=count`,

      `${this.restUrl}/student_assessment_sessions?select=count`,

      `${this.restUrl}/student_assessment_sessions?select=count&status=eq.completed`,

      `${this.restUrl}/assessment_categories?select=count`,
    ];

    const responses = await Promise.all(
      queries.map((url) => fetch(url, { headers: this.headers(userToken) })),
    );

    const [
      [{ count: totalQuestions }],

      [{ count: totalTemplates }],

      [{ count: totalSessions }],

      [{ count: completedSessions }],

      [{ count: totalCategories }],
    ] = await Promise.all(responses.map((res) => res.json()));

    return {
      totalQuestions,

      totalTemplates,

      totalSessions,

      completedSessions,

      totalCategories,

      completionRate:
        totalSessions > 0
          ? ((completedSessions / totalSessions) * 100).toFixed(2)
          : 0,
    };
  }

  async getQuestionAnalytics(questionId: string, userToken?: string) {
    const analyticsUrl = `${this.restUrl}/assessment_analytics?question_id=eq.${questionId}`;

    const responsesUrl = `${this.restUrl}/student_assessment_responses?question_id=eq.${questionId}&select=is_correct,time_spent_seconds`;

    const [analyticsRes, responsesRes] = await Promise.all([
      fetch(analyticsUrl, { headers: this.headers(userToken) }),

      fetch(responsesUrl, { headers: this.headers(userToken) }),
    ]);

    const analytics = await analyticsRes.json();

    const responses = await responsesRes.json();

    const correctResponses = responses.filter((r) => r.is_correct).length;

    const totalResponses = responses.length;

    const averageTime =
      responses.length > 0
        ? responses.reduce((sum, r) => sum + (r.time_spent_seconds || 0), 0) /
          responses.length
        : 0;

    return {
      questionId,

      totalAttempts: totalResponses,

      correctAttempts: correctResponses,

      successRate:
        totalResponses > 0
          ? ((correctResponses / totalResponses) * 100).toFixed(2)
          : 0,

      averageTimeSeconds: Math.round(averageTime),

      analytics: analytics[0] || null,

      recentResponses: responses.slice(-10),
    };
  }

  async getStudentPerformanceReport(
    filters: ReportFilters,
    userToken?: string,
  ) {
    let query = `student_assessment_sessions?select=*,assessment_templates(title)&status=eq.completed`;

    const conditions: string[] = [];

    if (filters.template_id)
      conditions.push(`template_id=eq.${filters.template_id}`);

    if (filters.start_date)
      conditions.push(`completed_at=gte.${filters.start_date}`);

    if (filters.end_date)
      conditions.push(`completed_at=lte.${filters.end_date}`);

    if (conditions.length > 0) {
      query += `&${conditions.join('&')}`;
    }

    const url = `${this.restUrl}/${query}&order=completed_at.desc&limit=100`;

    const res = await fetch(url, { headers: this.headers(userToken) });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch performance report: ${res.status}`,
      );
    }

    const sessions = await res.json();

    const totalSessions = sessions.length;

    const passedSessions = sessions.filter((s) => s.passed).length;

    const averageScore =
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + s.percentage_score, 0) /
          sessions.length
        : 0;

    const averageTimeSpent =
      sessions.length > 0
        ? sessions.reduce((sum, s) => sum + (s.time_spent_seconds || 0), 0) /
          sessions.length
        : 0;

    return {
      summary: {
        totalSessions,

        passedSessions,

        passRate:
          totalSessions > 0
            ? ((passedSessions / totalSessions) * 100).toFixed(2)
            : 0,

        averageScore: averageScore.toFixed(2),

        averageTimeMinutes: Math.round(averageTimeSpent / 60),
      },

      sessions: sessions.slice(0, 50), // Limit detailed sessions
    };
  }

  async seedInitialData(
    adminUserId: string,
    userToken?: string,
  ): Promise<{ message: string }> {
    const seeder = new AssessmentDataSeeder();

    try {
      await seeder.seedInitialData(adminUserId);

      return { message: 'Assessment data seeded successfully' };
    } catch (error) {
      console.error('Seeding failed:', error);

      throw new InternalServerErrorException('Failed to seed assessment data');
    }
  }
}
