import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { AssessmentService } from './assessment.service';
import { LearningPath, LearningPathService } from './learning-path.service';

@Injectable()
export class SubjectSelectionService {
  constructor(
    private readonly assessmentService: AssessmentService,
    private readonly learningPathService: LearningPathService,
  ) {}
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
      'Supabase keys missing for subject selection',
    );
  }

  /**
   * Get all subjects from courses assigned to a student
   */
  async getAvailableSubjects(userId: string, userToken?: string) {
    const assignedCoursesUrl = `${this.restUrl}/user_course_assignments?user_id=eq.${userId}&select=course_id`;
    const assignedCoursesRes = await fetch(assignedCoursesUrl, {
      headers: this.headers(userToken),
    });

    if (!assignedCoursesRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch assigned courses: ${assignedCoursesRes.status}`,
      );
    }

    const assignments = await assignedCoursesRes.json();
    const courseIds = assignments
      .map((assignment: any) => assignment.course_id)
      .filter(
        (value): value is string =>
          typeof value === 'string' && value.trim().length > 0,
      );

    if (!courseIds.length) {
      return { courses: [], subjects: [] };
    }

    const formatInFilter = (values: string[]) =>
      values.map((value) => `"${value.replace(/"/g, '""')}"`).join(',');

    const inFilter = formatInFilter(courseIds);

    const coursesUrl = `${this.restUrl}/courses?id=in.(${inFilter})&select=id,title,description`;
    const coursesRes = await fetch(coursesUrl, {
      headers: this.headers(userToken),
    });

    if (!coursesRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch courses: ${coursesRes.status}`,
      );
    }

    const courses = await coursesRes.json();

    const subjectsUrl = `${this.restUrl}/subjects?course_id=in.(${inFilter})&select=id,title,course_id,order_index&order=order_index.asc`;
    const subjectsRes = await fetch(subjectsUrl, {
      headers: this.headers(userToken),
    });

    if (!subjectsRes.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch subjects: ${subjectsRes.status}`,
      );
    }

    const subjects = await subjectsRes.json();

    const coursesWithSubjects = courses.map((course: any) => ({
      ...course,
      subjects: subjects.filter(
        (subject: any) => subject.course_id === course.id,
      ),
    }));

    return {
      courses: coursesWithSubjects,
      subjects,
    };
  }

  private async updateProfileSubjectSelection(
    userId: string,
    completed: boolean,
    userToken?: string,
  ) {
    try {
      const url = `${this.restUrl}/profiles?id=eq.${userId}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { ...this.headers(userToken), Prefer: 'return=minimal' },
        body: JSON.stringify({
          subject_selection_completed: completed,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.warn('Failed to update profile subject selection status:', error);
    }
  }

  private async markProfileFastTracked(userId: string, userToken?: string) {
    try {
      const url = `${this.restUrl}/profiles?id=eq.${userId}`;
      await fetch(url, {
        method: 'PATCH',
        headers: { ...this.headers(userToken), Prefer: 'return=minimal' },
        body: JSON.stringify({
          onboarding_completed: true,
          subject_selection_completed: true,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.warn('Failed to mark profile as fast-tracked:', error);
    }
  }

  private async ensureSubjectSelectionRecord(
    userId: string,
    userToken?: string,
    clearSelection: boolean = true,
  ) {
    try {
      const selectUrl = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}&select=id&limit=1`;
      const selectRes = await fetch(selectUrl, {
        headers: this.headers(userToken),
      });
      const rows = selectRes.ok ? await selectRes.json() : [];
      const timestamp = new Date().toISOString();

      if (rows.length > 0) {
        const updateUrl = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}`;
        const body: Record<string, any> = {
          updated_at: timestamp,
        };
        if (clearSelection) {
          body.selected_subjects = [];
        }
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: {
            ...this.headers(userToken),
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(body),
        });
      } else {
        const createUrl = `${this.restUrl}/user_subject_selections`;
        await fetch(createUrl, {
          method: 'POST',
          headers: {
            ...this.headers(userToken),
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            user_id: userId,
            selected_subjects: [],
            created_at: timestamp,
            updated_at: timestamp,
          }),
        });
      }
    } catch (error) {
      console.warn(
        'Failed to ensure user_subject_selections record during fast track:',
        error,
      );
    }
  }

  /**
   * Save selected subjects for a student and start assessment
   */
  async saveSelectedSubjects(
    userId: string,
    selectedSubjectIds: string[],
    userToken?: string,
  ) {
    const sanitizedSubjectIds = Array.isArray(selectedSubjectIds)
      ? selectedSubjectIds.filter(
          (value): value is string =>
            typeof value === 'string' && value.trim().length > 0,
        )
      : [];
    // Check if user already has subject selections, if so, update; otherwise, create
    const existingUrl = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}`;
    const existingRes = await fetch(existingUrl, {
      headers: this.headers(userToken),
    });

    if (!existingRes.ok) {
      throw new InternalServerErrorException(
        `Failed to check existing subject selections: ${existingRes.status}`,
      );
    }

    const existing = await existingRes.json();

    let selectionRecord: any;

    if (existing.length > 0) {
      // Update existing record
      const updateUrl = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: {
          ...this.headers(userToken),
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          selected_subjects: sanitizedSubjectIds,
          updated_at: new Date().toISOString(),
        }),
      });

      if (!updateRes.ok) {
        throw new InternalServerErrorException(
          `Failed to update subject selections: ${updateRes.status}`,
        );
      }

      selectionRecord = await updateRes.json();
    } else {
      // Create new record
      const createUrl = `${this.restUrl}/user_subject_selections`;
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          user_id: userId,
          selected_subjects: sanitizedSubjectIds,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }),
      });

      if (!createRes.ok) {
        throw new InternalServerErrorException(
          `Failed to create subject selections: ${createRes.status}`,
        );
      }

      selectionRecord = await createRes.json();
    }

    await this.updateProfileSubjectSelection(
      userId,
      sanitizedSubjectIds.length > 0,
      userToken,
    );

    // Start assessment after subject selection
    const assessment = await this.assessmentService.start(userId, userToken);

    let questionCount: number | null = null;
    try {
      const previewQuestions = await this.assessmentService.getQuestionSet(
        userId,
        userToken,
      );
      questionCount = Array.isArray(previewQuestions)
        ? previewQuestions.length
        : 0;
    } catch (error) {
      console.warn(
        'Failed to preview assessment question set after selection:',
        error?.message ?? error,
      );
    }

    if (questionCount === 0) {
      const fastTrack = await this.skipSubjectSelectionAndGeneratePath(
        userId,
        userToken,
        'subjects_no_assessment_questions',
        { preserveSelection: true },
      );

      return {
        ...selectionRecord,
        assessment_id: assessment.id,
        auto_fast_tracked: true,
        question_count: questionCount,
        fast_track: fastTrack,
      };
    }

    return {
      ...selectionRecord,
      assessment_id: assessment.id,
      auto_fast_tracked: false,
      question_count: questionCount,
    };
  }

  /**
   * Get student's selected subjects
   */
  async getSelectedSubjects(userId: string, userToken?: string) {
    const url = `${this.restUrl}/user_subject_selections?user_id=eq.${userId}&select=*`;
    const res = await fetch(url, { headers: this.headers(userToken) });

    if (!res.ok) {
      throw new InternalServerErrorException(
        `Failed to fetch selected subjects: ${res.status}`,
      );
    }

    const selections = await res.json();
    return selections[0] || null;
  }

  /**
   * Skip subject selection/assessment for fast-tracked beginners and generate learning path.
   */
  async skipSubjectSelectionAndGeneratePath(
    userId: string,
    userToken?: string,
    reason?: string,
    options?: { preserveSelection?: boolean },
  ) {
    await this.ensureSubjectSelectionRecord(
      userId,
      userToken,
      !(options?.preserveSelection ?? false),
    );
    await this.updateProfileSubjectSelection(userId, true, userToken);
    await this.markProfileFastTracked(userId, userToken);

    const moduleSeedResult =
      await this.learningPathService.seedMandatoryModuleStatus(
        userId,
        userToken,
      );

    let learningPath: LearningPath | null = null;
    try {
      learningPath =
        await this.learningPathService.getUserLearningPath(userToken);
    } catch (error) {
      console.warn('Failed to load learning path after fast track:', error);
    }

    return {
      success: true,
      skipped: true,
      reason: reason ?? null,
      modules_seeded: moduleSeedResult.inserted,
      learning_path: learningPath,
    };
  }
}
