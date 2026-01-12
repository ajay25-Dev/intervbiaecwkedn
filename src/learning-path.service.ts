import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { decodeJwt } from 'jose';

export interface LearningPath {
  id: string;
  title: string;
  description: string;
  career_goal: string;
  difficulty_level: string;
  estimated_duration_weeks: number;
  icon: string;
  color: string;
  is_active: boolean;
  steps?: LearningPathStep[];
}

export interface LearningPathStep {
  id: string;
  learning_path_id: string;
  title: string;
  description: string;
  step_type: string;
  order_index: number;
  estimated_hours: number;
  skills: string[];
  prerequisites: string[];
  resources: any;
  is_required: boolean;
}

export interface UserProgress {
  learning_path_id: string;
  current_step_id?: string;
  started_at: string;
  completed_at?: string;
  progress_percentage: number;
  completed_steps?: string[];
}

@Injectable()
export class LearningPathService {
  private restUrl = `${process.env.SUPABASE_URL}/rest/v1`;
  private serviceKey = process.env.SUPABASE_SERVICE_ROLE;
  private anonKey = process.env.SUPABASE_ANON_KEY;

  private headers(userToken?: string) {
    if (!process.env.SUPABASE_URL) {
      if (process.env.NODE_ENV === 'test') {
        return { 'Content-Type': 'application/json' } as Record<string, string>;
      }
      throw new InternalServerErrorException('SUPABASE_URL not set');
    }

    const sk = this.serviceKey?.trim();
    const looksJwt = sk && sk.split('.').length === 3 && sk.length > 60;
    if (looksJwt) {
      return {
        apikey: sk,
        Authorization: `Bearer ${sk}`,
        'Content-Type': 'application/json',
      } as Record<string, string>;
    }

    if (this.anonKey && userToken) {
      return {
        apikey: this.anonKey,
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      } as Record<string, string>;
    }

    if (process.env.NODE_ENV === 'test') {
      return { 'Content-Type': 'application/json' } as Record<string, string>;
    }

    throw new InternalServerErrorException('Supabase keys missing');
  }

  private getUserId(userToken?: string): string {
    if (!userToken)
      throw new InternalServerErrorException('User token required');
    const token = userToken.replace(/^Bearer\s+/i, '');

    // Handle test token for development
    if (token === 'test-token') {
      return 'test-user-id';
    }

    const decoded = decodeJwt(token);
    return decoded.sub as string;
  }

  private async getUserProfile(userToken?: string): Promise<any> {
    if (!userToken) return null;

    const userId = this.getUserId(userToken);
    const url = `${this.restUrl}/profiles?id=eq.${userId}&select=*`;

    try {
      const res = await fetch(url, {
        headers: this.headers(userToken),
        cache: 'no-store',
      });

      if (!res.ok) return null;

      const profiles = await res.json();
      return profiles?.[0] || null;
    } catch (error) {
      console.error('Failed to fetch user profile:', error);
      return null;
    }
  }

  async getAllPaths(userToken?: string): Promise<LearningPath[]> {
    // Get user profile to determine role
    const profile = await this.getUserProfile(userToken);
    const userRole = profile?.role?.toLowerCase();

    const url = `${this.restUrl}/learning_paths?is_active=eq.true&order=created_at`;

    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to fetch learning paths: ${res.status} ${msg}`,
      );
    }

    let paths = await res.json();

    // Filter and customize paths based on user role
    if (userRole === 'admin') {
      // Admins get all paths but with admin-specific information
      paths = paths.map((path: any) => ({
        ...path,
        title: `[ADMIN VIEW] ${path.title}`,
        description: `${path.description} | Admin Dashboard: Manage curriculum, track student progress, and monitor learning analytics.`,
        admin_features: {
          can_edit: true,
          can_view_analytics: true,
          can_manage_assignments: true,
          total_enrolled_students: 0, // Could be populated with actual data
        },
      }));
    } else {
      // Students get the regular student view
      paths = paths.map((path: any) => ({
        ...path,
        description: `${path.description} | Student Learning: Interactive modules, personalized assessments, and progress tracking.`,
        student_features: {
          personalization_available: true,
          assessment_driven: true,
          progress_tracking: true,
        },
      }));
    }

    return paths;
  }

  async getPathDetails(
    pathId: string,
    userToken?: string,
  ): Promise<LearningPath> {
    // Get user profile to determine role
    const profile = await this.getUserProfile(userToken);
    const userRole = profile?.role?.toLowerCase();

    const url = `${this.restUrl}/learning_paths?id=eq.${pathId}&is_active=eq.true`;

    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    console.log(res);

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to fetch learning path: ${res.status} ${msg}`,
      );
    }

    const paths = await res.json();
    if (!paths || paths.length === 0) {
      throw new NotFoundException('Learning path not found');
    }

    // Fetch steps for this path
    const stepsUrl = `${this.restUrl}/learning_path_steps?learning_path_id=eq.${pathId}&order=order_index`;
    const stepsRes = await fetch(stepsUrl, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    const steps = stepsRes.ok ? await stepsRes.json() : [];

    // Customize path details based on user role
    let pathData = paths[0];

    if (userRole === 'admin') {
      pathData = {
        ...pathData,
        title: `[ADMIN VIEW] ${pathData.title}`,
        description: `${pathData.description} | Admin Management: Full access to edit curriculum, view student analytics, and manage learning content.`,
        steps: steps.map((step: any) => ({
          ...step,
          title: `📊 ${step.title}`,
          description: `${step.description} | Admin: View completion rates, student feedback, and content effectiveness metrics.`,
          admin_metadata: {
            completion_rate: Math.floor(Math.random() * 100), // Mock data - replace with real analytics
            student_feedback_score: (Math.random() * 2 + 3).toFixed(1), // Mock 3-5 rating
            edit_permissions: true,
          },
        })),
      };
    } else {
      pathData = {
        ...pathData,
        description: `${pathData.description} | Student Learning: Personalized content, interactive assessments, and skill-building exercises.`,
        steps: steps.map((step: any) => ({
          ...step,
          title: `🎓 ${step.title}`,
          description: `${step.description} | Learn through hands-on practice, guided exercises, and real-world applications.`,
          student_metadata: {
            personalized: true,
            interactive: true,
            skill_tracking: true,
          },
        })),
      };
    }

    return pathData;
  }

  async getRecommendedPath(
    profileData: any,
    userToken?: string,
  ): Promise<LearningPath> {
    // Simple recommendation logic based on career goals and focus areas
    const { career_goals, focus_areas = [], experience_level } = profileData;

    let recommendedCareerGoal = 'data_analyst'; // default

    if (
      career_goals?.includes('business') ||
      focus_areas.includes('business_intelligence')
    ) {
      recommendedCareerGoal = 'business_analyst';
    } else if (
      career_goals?.includes('data') ||
      focus_areas.includes('python') ||
      focus_areas.includes('statistics')
    ) {
      recommendedCareerGoal = 'data_analyst';
    }

    const url = `${this.restUrl}/learning_paths?career_goal=eq.${recommendedCareerGoal}&is_active=eq.true&limit=1`;

    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to get recommendation: ${res.status} ${errorText}`,
      );
    }

    const paths = await res.json();
    if (!paths || paths.length === 0) {
      // Fallback to first available path
      const allPaths = await this.getAllPaths(userToken);
      if (!allPaths || allPaths.length === 0) {
        throw new InternalServerErrorException('No learning paths available');
      }
      return allPaths[0];
    }

    return paths[0];
  }

  async enrollUserInPath(
    pathId: string,
    userToken?: string,
  ): Promise<{ success: boolean }> {
    const userId = this.getUserId(userToken);

    // Check if the user is already enrolled in this learning path
    const existingEnrollmentUrl = `${this.restUrl}/user_learning_path_progress?user_id=eq.${userId}&learning_path_id=eq.${pathId}`;
    const existingEnrollmentRes = await fetch(existingEnrollmentUrl, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!existingEnrollmentRes.ok) {
      const msg = await existingEnrollmentRes.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to check existing enrollment: ${existingEnrollmentRes.status} ${msg}`,
      );
    }

    const existingEnrollment = await existingEnrollmentRes.json();

    // If already enrolled, return success without creating a duplicate
    if (existingEnrollment && existingEnrollment.length > 0) {
      return { success: true };
    }

    // If not enrolled, proceed to enroll
    const url = `${this.restUrl}/user_learning_path_progress`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers(userToken),
        Prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify([
        {
          user_id: userId,
          learning_path_id: pathId,
          progress_percentage: 0,
        },
      ]),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to enroll in learning path: ${res.status} ${msg}`,
      );
    }

    return { success: true };
  }

  async getUserProgress(userToken?: string): Promise<UserProgress[]> {
    const userId = this.getUserId(userToken);

    // Get progress for both regular learning paths and user-specific learning paths
    const regularProgressUrl = `${this.restUrl}/user_learning_path_progress?user_id=eq.${userId}`;
    const userPathsUrl = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=id`;

    const [regularRes, userPathsRes] = await Promise.all([
      fetch(regularProgressUrl, {
        headers: this.headers(userToken),
        cache: 'no-store',
      }),
      fetch(userPathsUrl, {
        headers: this.headers(userToken),
        cache: 'no-store',
      }),
    ]);

    let progress: any[] = [];
    if (regularRes.ok) {
      progress = await regularRes.json();
    }

    // Add user-specific learning paths to progress if they don't already exist
    if (userPathsRes.ok) {
      const userPaths = await userPathsRes.json();
      for (const userPath of userPaths) {
        // Check if this user path already has progress
        const existingProgress = progress.find(
          (p) => p.learning_path_id === userPath.id,
        );
        if (!existingProgress) {
          // Add default progress for user-specific path
          progress.push({
            learning_path_id: userPath.id,
            progress_percentage: 0,
            completed_steps: [],
          });
        }
      }
    }

    // For each path, get completed steps
    for (const p of progress) {
      const stepsUrl = `${this.restUrl}/user_step_progress?user_id=eq.${userId}&learning_path_id=eq.${p.learning_path_id}`;
      const stepsRes = await fetch(stepsUrl, {
        headers: this.headers(userToken),
        cache: 'no-store',
      });

      if (stepsRes.ok) {
        const completedSteps = await stepsRes.json();
        p.completed_steps = completedSteps.map((s: any) => s.step_id);
      } else {
        p.completed_steps = [];
      }
    }

    return progress;
  }

  async completeStep(
    stepId: string,
    body: any,
    userToken?: string,
  ): Promise<{ success: boolean }> {
    const userId = this.getUserId(userToken);
    const { learning_path_id, time_spent_hours = 0, rating, notes } = body;

    const url = `${this.restUrl}/user_step_progress`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        ...this.headers(userToken),
        Prefer: 'resolution=ignore-duplicates',
      },
      body: JSON.stringify([
        {
          user_id: userId,
          step_id: stepId,
          learning_path_id,
          time_spent_hours,
          rating,
          notes,
        },
      ]),
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to complete step: ${res.status} ${msg}`,
      );
    }

    // Update overall progress percentage
    await this.updatePathProgress(userId, learning_path_id, userToken);

    return { success: true };
  }

  private async updatePathProgress(
    userId: string,
    pathId: string,
    userToken?: string,
  ): Promise<void> {
    let allSteps: any[] = [];

    // Check if this is a user-specific learning path
    if (pathId.startsWith('user-')) {
      // Get steps from user_learning_path_steps table
      const userStepsUrl = `${this.restUrl}/user_learning_path_steps?user_learning_path_id=eq.${pathId}&select=id`;
      const userStepsRes = await fetch(userStepsUrl, {
        headers: this.headers(userToken),
      });
      allSteps = userStepsRes.ok ? await userStepsRes.json() : [];
    } else {
      // Get steps from regular learning_path_steps table
      const stepsUrl = `${this.restUrl}/learning_path_steps?learning_path_id=eq.${pathId}&select=id`;
      const stepsRes = await fetch(stepsUrl, {
        headers: this.headers(userToken),
      });
      allSteps = stepsRes.ok ? await stepsRes.json() : [];
    }

    // Get completed steps
    const completedUrl = `${this.restUrl}/user_step_progress?user_id=eq.${userId}&learning_path_id=eq.${pathId}&select=step_id`;
    const completedRes = await fetch(completedUrl, {
      headers: this.headers(userToken),
    });
    const completedSteps = completedRes.ok ? await completedRes.json() : [];

    const progressPercentage =
      allSteps.length > 0
        ? Math.round((completedSteps.length / allSteps.length) * 100)
        : 0;

    // Update progress
    const updateUrl = `${this.restUrl}/user_learning_path_progress?user_id=eq.${userId}&learning_path_id=eq.${pathId}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers: this.headers(userToken),
      body: JSON.stringify({
        progress_percentage: progressPercentage,
        completed_at:
          progressPercentage === 100 ? new Date().toISOString() : null,
      }),
    });
  }

  async getPersonalizedPath(
    pathId: string,
    userToken?: string,
  ): Promise<LearningPath> {
    let userId: string;
    try {
      userId = this.getUserId(userToken);
    } catch (error) {
      console.warn(
        'Failed to extract user ID for personalized path, returning base path:',
        error,
      );
      return this.getPathDetails(pathId, userToken);
    }

    // Check if a personalized path has already been generated and saved
    const existingPath = await this.getExistingPersonalizedPath(
      userId,
      pathId,
      userToken,
    );
    if (existingPath) {
      return existingPath;
    }

    // If not, generate a new one
    const personalizedPath = await this.generatePersonalizedPath(
      pathId,
      userId,
      userToken,
    );

    // Save the newly generated path for future requests
    await this.savePersonalizedPath(
      userId,
      pathId,
      personalizedPath,
      userToken,
    );

    return personalizedPath;
  }

  private async getExistingPersonalizedPath(
    userId: string,
    pathId: string,
    userToken?: string,
  ): Promise<LearningPath | null> {
    const url = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=path&limit=1`;
    const res = await fetch(url, { headers: this.headers(userToken) });

    if (res.ok) {
      const data = await res.json();
      if (data.length > 0) {
        const payload = data[0]?.path;
        if (
          payload?.personalized_data &&
          (!payload.base_learning_path_id ||
            payload.base_learning_path_id === pathId)
        ) {
          // Check if the existing path has empty modules and needs regeneration
          const hasEmptyModules = this.checkForEmptyModules(
            payload.personalized_data,
          );
          if (hasEmptyModules) {
            console.log(
              'Found existing personalized path with empty modules, will regenerate',
            );
            return null; // Return null to trigger regeneration
          }
          return payload.personalized_data;
        }
      }
    }
    return null;
  }

  private async generatePersonalizedPath(
    pathId: string,
    userId: string,
    userToken?: string,
  ): Promise<LearningPath> {
    // Get the base learning path
    const basePath = await this.getPathDetails(pathId, userToken);

    // Get user's assigned courses to determine available modules
    const assignedCoursesUrl = `${this.restUrl}/user_course_assignments?user_id=eq.${userId}&select=course_id`;
    const assignedRes = await fetch(assignedCoursesUrl, {
      headers: this.headers(userToken),
    });
    const assignedCourses = assignedRes.ok ? await assignedRes.json() : [];
    console.log('Assigned courses count:', assignedCourses.length);

    // Capture modules already defined in the base path so we can reuse them (ensuring all modules are surfaced)
    const modulesBySubjectFromPath =
      this.extractModulesBySubjectFromLearningPath(basePath);
    let modulesBySubject: Record<string, any[]> = {
      ...modulesBySubjectFromPath,
    };

    // Get all modules from assigned courses with full details
    const courseIds = assignedCourses.map((ac: any) => ac.course_id);
    let assignedModuleIds: string[] = [];
    const fallbackModulesBySubject: Record<string, any[]> = {};

    if (courseIds.length > 0) {
      // First get all subjects from assigned courses
      const subjectsUrl = `${this.restUrl}/subjects?course_id=in.(${courseIds.join(',')})&select=id,title,order_index`;
      const subjectsRes = await fetch(subjectsUrl, {
        headers: this.headers(userToken),
      });
      const subjects = subjectsRes.ok ? await subjectsRes.json() : [];
      const subjectIds = subjects.map((s: any) => s.id);

      // Then get all modules from those subjects with full details
      if (subjectIds.length > 0) {
        const modulesUrl = `${this.restUrl}/modules?subject_id=in.(${subjectIds.join(',')})&select=id,title,subject_id,order_index`;
        const modulesRes = await fetch(modulesUrl, {
          headers: this.headers(this.serviceKey),
        });

        if (!modulesRes.ok) {
          const errorText = await modulesRes.text().catch(() => '');
          console.error(
            `Failed to fetch modules for subjects ${subjectIds.join(',')}: ${modulesRes.status} ${errorText}`,
          );
          throw new InternalServerErrorException(
            `Failed to fetch modules: ${modulesRes.status}`,
          );
        }

        const modules = await modulesRes.json();
        console.log(
          `Fetched ${modules.length} modules for subjects: ${subjectIds.join(',')}`,
        );
        if (!modules || modules.length === 0) {
          console.warn(
            `No modules found for subjects: ${subjectIds.join(',')}`,
          );
        }

        // Organize modules by subject for fallback usage
        modules.forEach((module: any) => {
          const subjectKey = module.subject_id ?? module.subjectId;
          if (!subjectKey) return;
          const normalizedSubjectId = String(subjectKey);
          if (!fallbackModulesBySubject[normalizedSubjectId]) {
            fallbackModulesBySubject[normalizedSubjectId] = [];
          }
          fallbackModulesBySubject[normalizedSubjectId].push({
            id: module.id,
            title: module.title,
            subject_id: module.subject_id,
            order_index: module.order_index || 0,
            is_mandatory: true, // Default to mandatory
            status: 'mandatory', // Default status
          });
        });

        assignedModuleIds = modules.map((m: any) => m.id);
      }
    }

    if (Object.keys(fallbackModulesBySubject).length > 0) {
      modulesBySubject = {
        ...fallbackModulesBySubject,
        ...modulesBySubject,
      };
    }

    console.log(
      'modulesBySubject keys before build:',
      Object.keys(modulesBySubject).length,
    );
    // Calculate module scores from assessment responses
    const moduleScores = await this.syncUserModuleStatus(userId, userToken);
    console.log('assigneeModuleIds', assignedModuleIds);
    console.log('moduleScores', moduleScores);
    // console.log("modulesBySubject", modulesBySubject);

    // Build proper course structure with actual modules data
    const courseStructure = await this.buildCourseStructureFromModules(
      modulesBySubject,
      assignedModuleIds,
      moduleScores,
    );
    console.log('courseStructure courses count:', courseStructure);
    const personalizedCourseStructure = this.personalizeCourseStructure(
      courseStructure,
      assignedModuleIds,
      moduleScores,
    );

    // Personalize the steps - if they contain course structure, personalize the modules within
    const personalizedSteps =
      basePath.steps?.map((step) => {
        if (step.resources && typeof step.resources === 'object') {
          return {
            ...step,
            resources: {
              ...step.resources,
              course_structure: personalizedCourseStructure,
            },
          };
        }

        // Fallback: try to personalize at step level if no course structure
        const moduleId = this.extractModuleIdFromStep(step);
        let isRequired = step.is_required;

        if (moduleId) {
          const isAssigned = assignedModuleIds.includes(moduleId);
          if (!isAssigned) {
            isRequired = true;
          } else {
            const score = moduleScores[moduleId];
            isRequired = score !== undefined ? score < 90 : true;
          }
        }

        return {
          ...step,
          is_required: isRequired,
        };
      }) || [];

    return {
      ...basePath,
      steps: personalizedSteps,
    };
  }

  private async savePersonalizedPath(
    userId: string,
    pathId: string,
    personalizedPath: LearningPath,
    userToken?: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    const selectUrl = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=id,path&limit=1`;

    let existingRecord: any = null;
    try {
      const existingRes = await fetch(selectUrl, {
        headers: this.headers(userToken),
      });
      if (existingRes.ok) {
        const payload = await existingRes.json();
        existingRecord = payload?.[0] ?? null;
      }
    } catch (error) {
      console.warn('Failed to check existing personalized path:', error);
    }

    // Add debug information about the modules being saved
    const moduleStats = this.analyzeModuleDistribution(personalizedPath);
    console.log('[DEBUG] === SAVING PERSONALIZED PATH ===');
    console.log('[DEBUG] User ID:', userId);
    console.log('[DEBUG] Module distribution:', moduleStats);

    const nextPathPayload = {
      ...(existingRecord?.path ?? {}),
      personalized_data: personalizedPath,
      base_learning_path_id: pathId,
      module_distribution: moduleStats, // Store module stats for debugging
    };

    if (existingRecord?.id) {
      const updateUrl = `${this.restUrl}/user_learning_path?id=eq.${existingRecord.id}`;
      const updateRes = await fetch(updateUrl, {
        method: 'PATCH',
        headers: this.headers(userToken),
        body: JSON.stringify({
          path: nextPathPayload,
          updated_at: timestamp,
        }),
      });

      if (!updateRes.ok) {
        console.warn(
          `Failed to update personalized learning path: ${updateRes.status} ${await updateRes.text()}`,
        );
      } else {
        console.log(
          `Successfully updated personalized learning path for user ${userId}`,
        );
      }
      return;
    }

    const insertUrl = `${this.restUrl}/user_learning_path`;
    const insertRes = await fetch(insertUrl, {
      method: 'POST',
      headers: {
        ...this.headers(userToken),
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify([
        {
          user_id: userId,
          path: nextPathPayload,
          required: true,
          updated_at: timestamp,
        },
      ]),
    });

    if (!insertRes.ok) {
      console.warn(
        `Failed to create personalized learning path: ${insertRes.status} ${await insertRes.text()}`,
      );
    } else {
      console.log(
        `Successfully created personalized learning path for user ${userId}`,
      );
    }
  }

  /**
   * Analyze module distribution in a learning path for debugging
   */
  private analyzeModuleDistribution(learningPath: any): {
    total_modules: number;
    mandatory_modules: number;
    optional_modules: number;
    modules_by_course: Record<string, number>;
  } {
    let total = 0;
    let mandatory = 0;
    let optional = 0;
    const byCourse: Record<string, number> = {};

    if (learningPath?.steps) {
      for (const step of learningPath.steps) {
        if (step.resources?.course_structure?.courses) {
          for (const course of step.resources.course_structure.courses) {
            const courseTitle = course.title || 'Unknown Course';
            byCourse[courseTitle] = byCourse[courseTitle] || 0;

            if (course.subjects) {
              for (const subject of course.subjects) {
                if (subject.modules) {
                  for (const module of subject.modules) {
                    total++;
                    byCourse[courseTitle]++;

                    if (
                      module.is_mandatory === true ||
                      module.status === 'mandatory'
                    ) {
                      mandatory++;
                    } else if (
                      module.is_mandatory === false ||
                      module.status === 'optional'
                    ) {
                      optional++;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    return {
      total_modules: total,
      mandatory_modules: mandatory,
      optional_modules: optional,
      modules_by_course: byCourse,
    };
  }

  public async syncUserModuleStatus(
    userId: string,
    userToken?: string,
  ): Promise<Record<string, number>> {
    // Get all assessment responses for the user from assessment_responses table
    const responsesUrl = `${this.restUrl}/assessment_responses?user_id=eq.${userId}&select=question_id,correct,module_id,answer_text`;
    const responsesRes = await fetch(responsesUrl, {
      headers: this.headers(userToken),
    });
    const responses = responsesRes.ok ? await responsesRes.json() : [];

    // Get all assigned modules for this user to ensure we have status for all modules
    const assignedModules = await this.getAssignedModulesForUser(
      userId,
      userToken,
    );
    const assignedModuleIds = assignedModules.map((m) => m.id);

    // Group responses by module
    const moduleStats: Record<string, { correct: number; total: number }> = {};

    responses.forEach((response: any) => {
      const moduleId = response.module_id;

      if (moduleId) {
        if (!moduleStats[moduleId]) {
          moduleStats[moduleId] = { correct: 0, total: 0 };
        }
        // Count all answered questions (answer_text is not null/empty means not skipped)
        if (response.answer_text !== null && response.answer_text !== '') {
          moduleStats[moduleId].total++;
          if (response.correct) {
            moduleStats[moduleId].correct++;
          }
        }
      }
    });

    // Calculate percentages and save to user_module_status table
    const moduleScores: Record<string, number> = {};
    const moduleStatusUpdates: any[] = [];

    // Process modules with assessment responses
    Object.keys(moduleStats).forEach((moduleId) => {
      const stats = moduleStats[moduleId];
      const percentage =
        stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
      moduleScores[moduleId] = percentage;

      // Determine status based on 90% threshold
      const status = percentage >= 90 ? 'optional' : 'mandatory';

      moduleStatusUpdates.push({
        user_id: userId,
        module_id: moduleId,
        status,
        correctness_percentage: percentage,
        last_updated: new Date().toISOString(),
      });
    });

    // Add default status for modules without assessment responses
    assignedModuleIds.forEach((moduleId) => {
      if (!moduleStats[moduleId]) {
        // No assessment responses for this module - set as mandatory with 0% score
        moduleScores[moduleId] = 0;
        moduleStatusUpdates.push({
          user_id: userId,
          module_id: moduleId,
          status: 'mandatory',
          correctness_percentage: 0,
          last_updated: new Date().toISOString(),
        });
      }
    });

    // Save module status to database
    if (moduleStatusUpdates.length > 0) {
      try {
        const statusUrl = `${this.restUrl}/user_module_status`;
        await fetch(statusUrl, {
          method: 'POST',
          headers: {
            ...this.headers(userToken),
            Prefer: 'resolution=merge-duplicates',
          },
          body: JSON.stringify(moduleStatusUpdates),
        });
        console.log(
          `Successfully saved status for ${moduleStatusUpdates.length} modules`,
        );
      } catch (error) {
        console.warn('Failed to save module status:', error);
        // Continue with personalization even if saving fails
      }
    }

    return moduleScores;
  }

  /**
   * Seed user_module_status with mandatory entries (0% progress) for every assigned module.
   * Useful when skipping the assessment for beginners so the learning path can rely on module status.
   */
  public async seedMandatoryModuleStatus(
    userId: string,
    userToken?: string,
  ): Promise<{ inserted: number }> {
    const modules = await this.getAssignedModulesForUser(userId, userToken);
    if (!modules.length) {
      return { inserted: 0 };
    }

    const timestamp = new Date().toISOString();
    const payload = modules.map((module) => ({
      user_id: userId,
      module_id: module.id,
      status: 'mandatory',
      correctness_percentage: 0,
      last_updated: timestamp,
    }));

    try {
      const statusUrl = `${this.restUrl}/user_module_status`;
      await fetch(statusUrl, {
        method: 'POST',
        headers: {
          ...this.headers(userToken),
          Prefer: 'resolution=merge-duplicates',
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      console.warn(
        'Failed to seed mandatory user module status entries:',
        error?.message ?? error,
      );
    }

    return { inserted: payload.length };
  }
  private async getAssignedModulesForUser(
    userId: string,
    userToken?: string,
  ): Promise<{ id: string }[]> {
    try {
      // Get user's assigned courses
      const assignedCoursesUrl = `${this.restUrl}/user_course_assignments?user_id=eq.${userId}&select=course_id`;
      const assignedRes = await fetch(assignedCoursesUrl, {
        headers: this.headers(userToken),
      });
      const assignedCourses = assignedRes.ok ? await assignedRes.json() : [];

      // Get all modules from assigned courses
      const courseIds = assignedCourses.map((ac: any) => ac.course_id);
      const assignedModuleIds: string[] = [];

      if (courseIds.length > 0) {
        // First get all subjects from assigned courses
        const subjectsUrl = `${this.restUrl}/subjects?course_id=in.(${courseIds.join(',')})&select=id`;
        const subjectsRes = await fetch(subjectsUrl, {
          headers: this.headers(userToken),
        });
        const subjects = subjectsRes.ok ? await subjectsRes.json() : [];
        const subjectIds = subjects.map((s: any) => s.id);

        // Then get all modules from those subjects
        if (subjectIds.length > 0) {
          const modulesUrl = `${this.restUrl}/modules?subject_id=in.(${subjectIds.join(',')})&select=id`;
          const modulesRes = await fetch(modulesUrl, {
            headers: this.headers(this.serviceKey),
          });

          if (!modulesRes.ok) {
            const errorText = await modulesRes.text().catch(() => '');
            console.error(
              `Failed to fetch modules for subjects ${subjectIds.join(',')}: ${modulesRes.status} ${errorText}`,
            );
            return [];
          }

          const modules = await modulesRes.json();
          return modules.map((m: any) => ({ id: m.id }));
        }
      }
      return [];
    } catch (error) {
      console.warn('Failed to get assigned modules:', error);
      return [];
    }
  }

  async getUserModuleStatus(userToken?: string): Promise<any[]> {
    const userId = this.getUserId(userToken);

    const url = `${this.restUrl}/user_module_status?user_id=eq.${userId}&order=last_updated.desc`;

    const res = await fetch(url, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to fetch user module status: ${res.status} ${msg}`,
      );
    }

    return res.json();
  }

  async getSubjectProgressOverview(userToken?: string): Promise<
    Array<{
      subject_id: string;
      subject_title: string;
      average_percentage: number;
      module_count: number;
      completed_modules: number;
    }>
  > {
    const userId = this.getUserId(userToken);
    const statusUrl = `${this.restUrl}/user_module_status?user_id=eq.${userId}&select=module_id,correctness_percentage&order=last_updated.desc`;

    const statusRes = await fetch(statusUrl, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!statusRes.ok) {
      const msg = await statusRes.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to fetch module status for subject progress: ${statusRes.status} ${msg}`,
      );
    }

    const rawModuleStatus = (await statusRes.json()) as Array<{
      module_id?: string | null;
      correctness_percentage?: number | string | null;
    }>;

    if (!rawModuleStatus.length) {
      return [];
    }

    const dedupedModuleStatus: Array<{
      moduleId: string;
      percentage: number;
    }> = [];
    const seenModules = new Set<string>();
    for (const status of rawModuleStatus) {
      const id = status?.module_id;
      const moduleId =
        typeof id === 'string'
          ? id.trim()
          : id !== null && id !== undefined
            ? String(id).trim()
            : '';
      if (!moduleId || seenModules.has(moduleId)) {
        continue;
      }
      const rawPercentage = Number(status?.correctness_percentage ?? 0);
      const percentage = Number.isFinite(rawPercentage)
        ? Math.max(0, Math.min(100, rawPercentage))
        : 0;
      dedupedModuleStatus.push({ moduleId, percentage });
      seenModules.add(moduleId);
    }

    if (!dedupedModuleStatus.length) {
      return [];
    }

    const moduleIds = Array.from(
      new Set(
        dedupedModuleStatus
          .map((status) => status.moduleId)
          .filter((id): id is string => Boolean(id)),
      ),
    );

    if (!moduleIds.length) {
      return [];
    }

    const moduleFilter =
      moduleIds.length === 1
        ? `id=eq.${moduleIds[0]}`
        : `id=in.(${moduleIds.join(',')})`;
    const modulesUrl = `${this.restUrl}/modules?select=id,title,subject_id,subjects(id,title)&${moduleFilter}`;
    const modulesRes = await fetch(modulesUrl, {
      headers: this.headers(userToken),
      cache: 'no-store',
    });

    if (!modulesRes.ok) {
      const msg = await modulesRes.text().catch(() => '');
      throw new InternalServerErrorException(
        `Failed to fetch modules for subject progress: ${modulesRes.status} ${msg}`,
      );
    }

    const moduleRows = await modulesRes.json();
    const moduleSubjectMap = new Map<
      string,
      { subjectId: string; subjectTitle: string }
    >();
    moduleRows.forEach((module: any) => {
      if (!module?.id || !module?.subject_id) {
        return;
      }
      const subjectTitle =
        module.subjects?.title ||
        module.subjects?.name ||
        module.title ||
        'Subject';
      moduleSubjectMap.set(module.id, {
        subjectId: module.subject_id,
        subjectTitle,
      });
    });

    const progressBySubject = new Map<
      string,
      {
        subjectId: string;
        subjectTitle: string;
        totalPercentage: number;
        moduleCount: number;
        completedModules: number;
      }
    >();

    dedupedModuleStatus.forEach(({ moduleId, percentage }) => {
      const moduleInfo = moduleSubjectMap.get(moduleId);
      if (!moduleInfo) return;

      const subjectEntry = progressBySubject.get(moduleInfo.subjectId) || {
        subjectId: moduleInfo.subjectId,
        subjectTitle: moduleInfo.subjectTitle,
        totalPercentage: 0,
        moduleCount: 0,
        completedModules: 0,
      };

      subjectEntry.totalPercentage += percentage;
      subjectEntry.moduleCount += 1;
      if (percentage >= 100) {
        subjectEntry.completedModules += 1;
      }
      if (!subjectEntry.subjectTitle && moduleInfo.subjectTitle) {
        subjectEntry.subjectTitle = moduleInfo.subjectTitle;
      }

      progressBySubject.set(moduleInfo.subjectId, subjectEntry);
    });

    return Array.from(progressBySubject.values())
      .filter((entry) => entry.moduleCount > 0)
      .map((entry) => ({
        subject_id: entry.subjectId,
        subject_title: entry.subjectTitle,
        module_count: entry.moduleCount,
        average_percentage: Math.round(
          entry.totalPercentage / entry.moduleCount,
        ),
        completed_modules: entry.completedModules,
      }))
      .sort((a, b) => b.average_percentage - a.average_percentage);
  }

  private extractModuleIdFromStep(step: LearningPathStep): string | null {
    // Try to extract module_id from step resources or description
    // This is a placeholder - actual implementation depends on how steps are linked to modules
    // For now, we'll look for module_id in resources or parse from description

    if (step.resources && typeof step.resources === 'object') {
      const resources = step.resources;
      if (resources.module_id) {
        return resources.module_id;
      }
    }

    // If not found in resources, try to parse from description or title
    // This might need to be adjusted based on actual data
    const text = `${step.title} ${step.description}`.toLowerCase();
    // Look for patterns like "module-sql-basics" or similar
    const moduleMatch = text.match(/module-([a-z0-9-]+)/);
    if (moduleMatch) {
      return `module-${moduleMatch[1]}`;
    }

    return null;
  }

  /**
   * Refresh user learning paths based on updated assessment results
   * This should be called after assessment completion to update module mandatory/optional status
   */
  async refreshUserLearningPaths(
    userToken?: string,
    moduleScoresOverride?: Record<string, number>,
  ): Promise<{
    success: boolean;
    updated_paths: string[];
    created_path?: any;
  }> {
    // If no token provided, return early with success
    if (!userToken || !userToken.trim()) {
      console.log(
        'No user token provided to refreshUserLearningPaths, skipping refresh',
      );
      return { success: true, updated_paths: [] };
    }

    let userId: string;
    try {
      userId = this.getUserId(userToken);
    } catch (error) {
      console.warn(
        'Failed to extract user ID from token, skipping learning path refresh:',
        error,
      );
      return { success: true, updated_paths: [] };
    }
    // console.log('hi');
    try {
      // Get all user-specific learning paths for this user
      console.log('refreshUserLearningPaths start for user:', userId);
      const userPathsUrl = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=id,path`;
      const userPathsRes = await fetch(userPathsUrl, {
        headers: this.headers(userToken),
      });
      const userPaths = userPathsRes.ok ? await userPathsRes.json() : [];

      // console.log(userPaths);

      if (userPaths.length === 0) {
        console.log(
          'No user-specific learning paths found, creating new learning path',
        );
        const recommendedPath = await this.getRecommendedPath({}, userToken);
        if (!recommendedPath) {
          return { success: true, updated_paths: [] };
        }
        const personalizedPath = await this.getPersonalizedPath(
          recommendedPath.id,
          userToken,
        );

        const defaultPathPayload = {
          path: {
            courses: [],
            last_updated: new Date().toISOString(),
            modules_by_status: {
              optional: [],
              mandatory: [],
            },
            personalized_data: personalizedPath,
          },
          personalized_data: personalizedPath,
          module_distribution: {
            total_modules: 0,
            optional_modules: 0,
            mandatory_modules: 0,
            modules_by_course: {},
          },
          base_learning_path_id: recommendedPath.id,
        };

        await this.savePersonalizedPath(
          userId,
          recommendedPath.id,
          personalizedPath,
          userToken,
        );

        return {
          success: true,
          updated_paths: [personalizedPath.id],
          created_path: defaultPathPayload,
        };
      }

      // Get user's assigned courses to determine available modules
      const assignedCoursesUrl = `${this.restUrl}/user_course_assignments?user_id=eq.${userId}&select=course_id`;
      const assignedRes = await fetch(assignedCoursesUrl, {
        headers: this.headers(userToken),
      });
      const assignedCourses = assignedRes.ok ? await assignedRes.json() : [];

      // Get all modules from assigned courses
      const courseIds = assignedCourses.map((ac: any) => ac.course_id);
      console.log('Assigned courses for refresh:', courseIds);
      const { modulesBySubject, moduleIds: assignedModuleIds } =
        await this.fetchModulesGroupedBySubject(courseIds, userId, userToken);

      // Recalculate module scores based on latest assessment results
      const moduleScores =
        moduleScoresOverride ??
        (await this.syncUserModuleStatus(userId, userToken));

      console.log(`Refresh Learning Paths - User ID: ${userId}`);
      console.log(`Assigned courses: ${courseIds.length}`);
      console.log(`Assigned modules: ${assignedModuleIds.length}`);
      console.log(`Module scores:`, Object.keys(moduleScores).length);

      const updatedPaths: string[] = [];

      const timestamp = new Date().toISOString();

      assignedModuleIds.forEach((moduleId) => {
        if (moduleScores[moduleId] === undefined) {
          moduleScores[moduleId] = 0;
        }
      });

      for (const userPath of userPaths) {
        const rawPath = userPath.path || {};
        const existingPersonalized =
          rawPath.personalized_data ??
          (rawPath.steps ? { ...rawPath, steps: rawPath.steps } : null);

        if (!existingPersonalized) {
          continue;
        }

        const modulesFromPath =
          this.extractModulesBySubjectFromLearningPath(existingPersonalized);

        const mergedModules = this.mergeModulesBySubject(
          modulesBySubject,
          modulesFromPath,
        );

        if (!Object.keys(mergedModules).length) {
          continue;
        }

        const moduleCount = Object.values(mergedModules).reduce(
          (sum, list) => sum + (list?.length ?? 0),
          0,
        );
        console.log('Refresh merged modules count:', moduleCount);

        const courseStructure = await this.buildCourseStructureFromModules(
          mergedModules,
          assignedModuleIds,
          moduleScores,
        );

        const personalizedCourseStructure = this.personalizeCourseStructure(
          courseStructure,
          assignedModuleIds,
          moduleScores,
        );

        const updatedSteps = this.applyCourseStructureToSteps(
          Array.isArray(existingPersonalized.steps)
            ? existingPersonalized.steps
            : [],
          personalizedCourseStructure,
        );

        const updatedPersonalized = {
          ...existingPersonalized,
          steps: updatedSteps,
        };

        const pathCourses = personalizedCourseStructure.courses ?? [];
        const nextPathCourses = Array.isArray(pathCourses) ? pathCourses : [];
        const existingPathObj = rawPath.path ?? {};
        const baseLearningPathId =
          rawPath.base_learning_path_id ??
          existingPathObj?.base_learning_path_id ??
          updatedPersonalized?.id;

        const nextPath = {
          ...rawPath,
          personalized_data: updatedPersonalized,
          steps: Array.isArray(rawPath.steps) ? updatedSteps : rawPath.steps,
          module_distribution:
            this.analyzeModuleDistribution(updatedPersonalized),
          courses: nextPathCourses,
          base_learning_path_id:
            baseLearningPathId ?? rawPath.base_learning_path_id,
          path: {
            ...existingPathObj,
            courses: nextPathCourses,
            personalized_data: updatedPersonalized,
            base_learning_path_id:
              baseLearningPathId ?? existingPathObj?.base_learning_path_id,
          },
        };

        const updateUrl = `${this.restUrl}/user_learning_path?id=eq.${userPath.id}`;
        await fetch(updateUrl, {
          method: 'PATCH',
          headers: this.headers(userToken),
          body: JSON.stringify({
            path: nextPath,
            updated_at: timestamp,
          }),
        });

        updatedPaths.push(userPath.id);
      }

      return {
        success: true,
        updated_paths: updatedPaths,
      };
    } catch (error) {
      console.error('Failed to refresh user learning paths:', error);
      return {
        success: false,
        updated_paths: [],
      };
    }
  }

  /**
   * Personalize course structure with module status information
   */
  private personalizeCourseStructure(
    courseStructure: any,
    assignedModuleIds: string[],
    moduleScores: Record<string, number>,
  ): any {
    if (!courseStructure || !courseStructure.courses) {
      return courseStructure;
    }

    const updatedCourses = courseStructure.courses.map((course: any) => {
      if (!course.subjects) return course;

      const updatedSubjects = course.subjects.map((subject: any) => {
        if (!subject.modules) return subject;

        const updatedModules = subject.modules.map((module: any) => {
          const isAssigned = assignedModuleIds.includes(module.id);
          const score = moduleScores[module.id];
          let isMandatory = module.is_mandatory !== false; // default to true

          if (!isAssigned) {
            // Module not in assigned courses - make mandatory
            isMandatory = true;
          } else {
            // Module is assigned - check score
            if (score !== undefined) {
              // If score >= 90%, make optional; else mandatory
              isMandatory = score < 90;
            } else {
              // No score available - make mandatory
              isMandatory = true;
            }
          }

          return {
            ...module,
            is_mandatory: isMandatory,
            status: isMandatory ? 'mandatory' : 'optional',
            assessment_score: score, // Add score for reference
            is_assigned: isAssigned, // Add assignment status for debugging
            // Add user_module_status information
            user_module_status: {
              status: isMandatory ? 'mandatory' : 'optional',
              correctness_percentage: score || 0,
              last_updated: new Date().toISOString(),
              is_assigned: isAssigned,
            },
          };
        });

        return {
          ...subject,
          modules: updatedModules,
        };
      });

      return {
        ...course,
        subjects: updatedSubjects,
      };
    });

    return {
      ...courseStructure,
      courses: updatedCourses,
    };
  }

  /**
   * Get assessment-based insights for a user's learning path
   */
  async getLearningPathInsights(userToken?: string): Promise<any> {
    const userId = this.getUserId(userToken);

    try {
      // Get user's module status
      const moduleStatus = await this.getUserModuleStatus(userToken);

      // Get user's learning paths
      const userPathsUrl = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=id`;
      const userPathsRes = await fetch(userPathsUrl, {
        headers: this.headers(userToken),
      });
      const userPaths = userPathsRes.ok ? await userPathsRes.json() : [];

      // Calculate insights
      const mandatoryModules = moduleStatus.filter(
        (m) => m.status === 'mandatory',
      );
      const optionalModules = moduleStatus.filter(
        (m) => m.status === 'optional',
      );

      const averageScore =
        moduleStatus.length > 0
          ? Math.round(
              moduleStatus.reduce(
                (sum, m) => sum + m.correctness_percentage,
                0,
              ) / moduleStatus.length,
            )
          : 0;

      return {
        user_id: userId,
        total_modules_assessed: moduleStatus.length,
        mandatory_modules: mandatoryModules.length,
        optional_modules: optionalModules.length,
        average_score: averageScore,
        learning_paths_count: userPaths.length,
        module_breakdown: {
          mandatory: mandatoryModules.map((m) => ({
            id: m.module_id,
            score: m.correctness_percentage,
          })),
          optional: optionalModules.map((m) => ({
            id: m.module_id,
            score: m.correctness_percentage,
          })),
        },
        recommendations: this.generateRecommendations(
          mandatoryModules,
          optionalModules,
          averageScore,
        ),
      };
    } catch (error) {
      console.error('Failed to get learning path insights:', error);
      return {
        user_id: userId,
        error: 'Failed to generate insights',
      };
    }
  }

  private generateRecommendations(
    mandatoryModules: any[],
    optionalModules: any[],
    averageScore: number,
  ): string[] {
    const recommendations: string[] = [];

    if (mandatoryModules.length > optionalModules.length) {
      recommendations.push(
        'Focus on improving scores in mandatory modules to unlock more optional content',
      );
    }

    if (averageScore < 70) {
      recommendations.push(
        'Consider reviewing fundamental concepts before advancing to complex topics',
      );
    } else if (averageScore >= 90) {
      recommendations.push(
        'Excellent performance! You can focus on advanced topics or specialization areas',
      );
    }

    if (mandatoryModules.length === 0) {
      recommendations.push(
        'Complete assessments to unlock personalized learning recommendations',
      );
    }

    return recommendations;
  }

  /**
   * Check if a learning path has empty modules that need regeneration
   */
  private checkForEmptyModules(learningPath: any): boolean {
    if (!learningPath?.steps) {
      return true;
    }

    for (const step of learningPath.steps) {
      if (step.resources?.course_structure?.courses) {
        for (const course of step.resources.course_structure.courses) {
          if (course.subjects) {
            for (const subject of course.subjects) {
              if (subject.modules && subject.modules.length === 0) {
                console.log(`Found empty modules in subject: ${subject.title}`);
                return true;
              }
            }
          }
        }
      }
    }

    return false;
  }

  /**
   * Build course structure from modules data
   */
  private async buildCourseStructureFromModules(
    modulesBySubject: Record<string, any[]>,
    assignedModuleIds: string[],
    moduleScores: Record<string, number>,
  ): Promise<any> {
    const subjectIds = Object.keys(modulesBySubject || {});
    console.log(subjectIds);
    if (!subjectIds.length) {
      console.log('No modules by subject provided to build course structure');
      return {
        courses: [],
        error: 'No modules available for course structure',
      };
    }

    const quotedSubjectIds = subjectIds.map((id) => `"${id}"`).join(',');
    console.log('Quoted subject IDs:', quotedSubjectIds);
    const subjectsUrl = `${this.restUrl}/subjects?id=in.(${quotedSubjectIds})&select=id,title,course_id,order_index`;
    const subjectsRes = await fetch(subjectsUrl, {
      headers: this.headers(this.serviceKey),
    });
    const subjects = subjectsRes.ok ? await subjectsRes.json() : [];
    console.log('Fetched subjects for course structure:', subjects.length);
    // const validSubjects = Array.isArray(subjects)
    //   ? subjects.filter((subject: any) => subject?.id && subject?.course_id)
    //   : [];

    // if (!validSubjects.length) {
    //   console.warn('No subjects found while building course structure');
    //   return { courses: [] };
    // }

    const courseIds = Array.from(
      new Set(
        subjects
          .map((s: any) => s.course_id)
          .filter((id: any) => id !== undefined && id !== null),
      ),
    );

    if (!courseIds.length) {
      console.warn('No course IDs found for the subjects');
      return { courses: [] };
    }

    const quotedCourseIds = courseIds.map((id) => `"${id}"`).join(',');
    console.log('Quoted course IDs:', quotedCourseIds);
    const coursesUrl = `${this.restUrl}/courses?id=in.(${quotedCourseIds})&select=id,title`;
    const coursesRes = await fetch(coursesUrl, {
      headers: this.headers(this.serviceKey),
    });
    const courses = coursesRes.ok ? await coursesRes.json() : [];
    console.log('Fetched courses for course structure:', courses);

    const moduleTotals = Object.values(modulesBySubject).reduce(
      (sum, list) => sum + (list?.length ?? 0),
      0,
    );
    console.log(
      'Building course structure with subjects:',
      Object.keys(modulesBySubject).length,
      'total modules:',
      moduleTotals,
    );
    // Build course structure
    const coursesById = Object.fromEntries(courses.map((c: any) => [c.id, c]));
    const subjectsById = Object.fromEntries(
      subjects.map((s: any) => [s.id, s]),
    );

    const courseStructure = {
      courses: courses.map((course: any) => {
        // Get subjects that belong to this course
        const courseSubjects = subjects
          .filter((s: any) => s.course_id === course.id)
          .map((subject: any) => {
            const subjectModules = modulesBySubject[subject.id] || [];

            // Apply personalization to modules
            const personalizedModules = subjectModules.map((module: any) => {
              const isAssigned = assignedModuleIds.includes(module.id);
              const score = moduleScores[module.id];
              let isMandatory = module.is_mandatory !== false; // default to true

              if (!isAssigned) {
                // Module not in assigned courses - make mandatory
                isMandatory = true;
              } else {
                // Module is assigned - check score
                if (score !== undefined) {
                  // If score >= 90%, make optional; else mandatory
                  isMandatory = score < 90;
                } else {
                  // No score available - make mandatory
                  isMandatory = true;
                }
              }

              return {
                ...module,
                is_mandatory: isMandatory,
                status: isMandatory ? 'mandatory' : 'optional',
                assessment_score: score, // Add score for reference
                is_assigned: isAssigned, // Add assignment status for debugging
                // Add user_module_status information
                user_module_status: {
                  status: isMandatory ? 'mandatory' : 'optional',
                  correctness_percentage: score || 0,
                  last_updated: new Date().toISOString(),
                  is_assigned: isAssigned,
                },
              };
            });

            return {
              ...subject,
              modules: personalizedModules,
            };
          });

        return {
          ...course,
          subjects: courseSubjects,
        };
      }),
    };

    return courseStructure;
  }

  private async fetchModulesGroupedBySubject(
    courseIds: string[],
    userId: string,
    userToken?: string,
  ): Promise<{ modulesBySubject: Record<string, any[]>; moduleIds: string[] }> {
    const modulesBySubject: Record<string, any[]> = {};
    const moduleIds: string[] = [];

    if (!courseIds.length) {
      return { modulesBySubject, moduleIds };
    }

    const quotedCourseIds = courseIds.map((id) => `"${id}"`).join(',');
    const subjectsUrl = `${this.restUrl}/subjects?course_id=in.(${quotedCourseIds})&select=id`;

    const subjectsRes = await fetch(subjectsUrl, {
      headers: this.headers(userToken),
    });
    const subjects = subjectsRes.ok ? await subjectsRes.json() : [];
    const subjectIds = subjects.map((s: any) => s.id).filter(Boolean);

    console.log('Fetched subjects for courses:', subjectIds.length);

    if (!subjectIds.length) {
      return { modulesBySubject, moduleIds };
    }

    const quotedSubjectIds = subjectIds.map((id) => `"${id}"`).join(',');
    const modulesUrl = `${this.restUrl}/modules?subject_id=in.(${quotedSubjectIds})&select=id,title,subject_id,order_index,slug,status`;
    const modulesRes = await fetch(modulesUrl, {
      headers: this.headers(this.serviceKey),
    });
    const modules = modulesRes.ok ? await modulesRes.json() : [];

    const seenModuleIds = new Set<string>();
    const moduleEntries: Array<{
      module: any;
      moduleId: string;
      subjectId: string;
      normalizedModuleId: string;
    }> = [];
    modules.forEach((module: any) => {
      const moduleId = module?.id ?? module?.module_id ?? module?.moduleId;
      if (!moduleId) return;
      const subjectKey =
        module?.subject_id ?? module?.subjectId ?? module?.subject_id;
      if (!subjectKey) return;
      const normalizedSubjectId = String(subjectKey);
      if (!modulesBySubject[normalizedSubjectId]) {
        modulesBySubject[normalizedSubjectId] = [];
      }
      const normalizedModuleId = String(moduleId);
      if (seenModuleIds.has(normalizedModuleId)) {
        return;
      }
      seenModuleIds.add(normalizedModuleId);
      moduleEntries.push({
        module,
        moduleId,
        subjectId: normalizedSubjectId,
        normalizedModuleId,
      });
      moduleIds.push(normalizedModuleId);
    });

    const statusMap = await this.getUserModuleStatusMap(
      moduleIds,
      userId,
      userToken,
    );

    moduleEntries.forEach((entry) => {
      const statusEntry = statusMap.get(entry.normalizedModuleId);
      const normalizedStatus =
        (
          statusEntry?.status ??
          entry.module?.status ??
          'mandatory'
        ).toLowerCase() === 'optional'
          ? 'optional'
          : 'mandatory';

      const moduleRecord = {
        id: entry.moduleId,
        title: entry.module?.title ?? entry.module?.name ?? 'Module',
        subject_id: entry.subjectId,
        order_index: entry.module?.order_index ?? 0,
        slug: entry.module?.slug,
        status: normalizedStatus,
        is_mandatory: normalizedStatus !== 'optional',
        assessment_score:
          typeof statusEntry?.correctness_percentage === 'number'
            ? statusEntry?.correctness_percentage
            : (entry.module?.assessment_score ?? null),
      };

      modulesBySubject[entry.subjectId].push(moduleRecord);
    });

    return { modulesBySubject, moduleIds };
  }

  private async getUserModuleStatusMap(
    moduleIds: string[],
    userId: string,
    userToken?: string,
  ): Promise<
    Map<string, { status?: string; correctness_percentage?: number }>
  > {
    const map = new Map<
      string,
      { status?: string; correctness_percentage?: number }
    >();
    if (!moduleIds.length) {
      return map;
    }

    const quotedModuleIds = moduleIds.map((id) => `"${id}"`).join(',');
    const statusUrl = `${this.restUrl}/user_module_status?user_id=eq.${userId}&module_id=in.(${quotedModuleIds})&select=module_id,status,correctness_percentage`;
    const statusRes = await fetch(statusUrl, {
      headers: this.headers(userToken),
    });
    if (!statusRes.ok) {
      console.warn(`Failed to fetch module status map: ${statusRes.status}`);
      return map;
    }

    const records = await statusRes.json();
    records.forEach((record: any) => {
      if (!record?.module_id) {
        return;
      }
      const moduleId = String(record.module_id).trim();
      if (!moduleId) return;
      map.set(moduleId, {
        status: record.status,
        correctness_percentage:
          typeof record.correctness_percentage === 'number'
            ? record.correctness_percentage
            : typeof record.correctness_percentage === 'string'
              ? Number(record.correctness_percentage)
              : undefined,
      });
    });

    return map;
  }

  private mergeModulesBySubject(
    base: Record<string, any[]>,
    additions: Record<string, any[]>,
  ): Record<string, any[]> {
    const merged: Record<string, any[]> = {};

    Object.entries(base).forEach(([subjectId, modules]) => {
      merged[subjectId] = Array.isArray(modules) ? [...modules] : [];
    });

    Object.entries(additions).forEach(([subjectId, modules]) => {
      if (!modules.length) return;
      if (!merged[subjectId]) {
        merged[subjectId] = [];
      }
      const existingIds = new Set(
        merged[subjectId].map((module) =>
          String(
            module?.id ??
              module?.module_id ??
              module?.moduleId ??
              module?.slug ??
              '',
          ),
        ),
      );

      modules.forEach((module) => {
        const moduleId =
          module?.id ?? module?.module_id ?? module?.moduleId ?? module?.slug;
        if (!moduleId) {
          return;
        }
        const normalized = String(moduleId);
        if (existingIds.has(normalized)) {
          return;
        }
        existingIds.add(normalized);
        merged[subjectId].push(module);
      });
    });

    return merged;
  }

  private applyCourseStructureToSteps(
    steps: any[],
    courseStructure: any,
  ): any[] {
    if (!Array.isArray(steps) || !courseStructure) return steps;
    return steps.map((step) => {
      if (
        step?.resources &&
        typeof step.resources === 'object' &&
        step.resources.course_structure?.courses
      ) {
        return {
          ...step,
          resources: {
            ...step.resources,
            course_structure: courseStructure,
          },
        };
      }
      return step;
    });
  }

  private extractModulesBySubjectFromLearningPath(
    path: LearningPath | null,
  ): Record<string, any[]> {
    const modulesMap: Record<string, any[]> = {};
    if (!path?.steps) {
      return modulesMap;
    }

    const seenModules = new Set<string>();

    for (const step of path.steps) {
      const courseStructure = step.resources?.course_structure;
      if (!courseStructure?.courses) {
        continue;
      }

      for (const course of courseStructure.courses) {
        const subjects = Array.isArray(course?.subjects) ? course.subjects : [];
        for (const subject of subjects) {
          const subjectKey =
            subject?.id ?? subject?.subject_id ?? subject?.subjectId;
          if (!subjectKey) {
            continue;
          }
          const normalizedSubjectId = String(subjectKey);
          const subjectModules = Array.isArray(subject.modules)
            ? subject.modules
            : [];
          if (!subjectModules.length) {
            continue;
          }

          if (!modulesMap[normalizedSubjectId]) {
            modulesMap[normalizedSubjectId] = [];
          }

          subjectModules.forEach((module) => {
            const moduleId =
              module?.id ?? module?.module_id ?? module?.moduleId ?? '';
            const uniqueKey = `${normalizedSubjectId}:${moduleId}`;
            if (moduleId && seenModules.has(uniqueKey)) {
              return;
            }
            if (moduleId) {
              seenModules.add(uniqueKey);
            }
            modulesMap[normalizedSubjectId].push(module);
          });
        }
      }
    }

    return modulesMap;
  }

  /**
   * Get the user's personalized learning path by user ID
   * This returns the most recently created/updated user-specific learning path
   * If no user is authenticated, returns a recommended path
   */
  async getUserLearningPath(userToken?: string): Promise<LearningPath | null> {
    try {
      // Check if user is authenticated
      const isAuthenticated = userToken && userToken.trim() !== '';

      if (isAuthenticated) {
        try {
          const userId = this.getUserId(userToken);

          // First, try to get user's personalized learning paths
          const userPathsUrl = `${this.restUrl}/user_learning_path?user_id=eq.${userId}&select=path&order=updated_at.desc&limit=1`;
          const userPathsRes = await fetch(userPathsUrl, {
            headers: this.headers(userToken),
          });

          if (userPathsRes.ok) {
            const userPaths = await userPathsRes.json();
            if (userPaths.length > 0) {
              const personalized = userPaths[0]?.path?.personalized_data;
              if (personalized) {
                return personalized;
              }
            }
          }

          // If no user-specific path exists, try to create one from a recommended path
          const profileData = {}; // Empty profile for basic recommendation
          const recommendedPath = await this.getRecommendedPath(
            profileData,
            userToken,
          );

          if (recommendedPath) {
            // Create a personalized version for this user
            const personalizedPath = await this.getPersonalizedPath(
              recommendedPath.id,
              userToken,
            );
            return personalizedPath;
          }
        } catch (userAuthError) {
          console.warn(
            'Failed to get authenticated user learning path:',
            userAuthError,
          );
          // Fall through to return a recommended path
        }
      }

      // User is not authenticated or auth failed - return a recommended path
      console.log('No valid user token, returning recommended learning path');
      const profileData = {}; // Empty profile for basic recommendation
      const recommendedPath = await this.getRecommendedPath(
        profileData,
        userToken,
      );

      if (recommendedPath) {
        return recommendedPath;
      }

      return null;
    } catch (error) {
      console.error('Failed to get user learning path:', error);
      return null;
    }
  }
}
