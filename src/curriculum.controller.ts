import { Controller, Get, UseGuards, Req, Param, Query } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { CourseFullOptions, CourseService } from './course.service';
import { PracticeExercisesGenerationService } from './practice-exercises-generation.service';

// Helper function to slugify titles for URL-friendly names
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // Remove non-word chars
    .replace(/[\s_-]+/g, '-') // Replace spaces, underscores with single dash
    .replace(/^-+|-+$/g, ''); // Remove leading/trailing dashes
}

function parseOrderIndexValue(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function getOrderIndexValue(row: any): number | undefined {
  if (!row || typeof row !== 'object') {
    return undefined;
  }
  const candidates = [
    row.order_index,
    row.orderIndex,
    row.order,
    row.orderNumber,
    row.order_position,
    row.orderPosition,
  ];
  for (const candidate of candidates) {
    const parsed = parseOrderIndexValue(candidate);
    if (parsed !== undefined) {
      return parsed;
    }
  }
  return undefined;
}

function sortByOrderIndex<T>(items: T[] | undefined | null): T[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }
  return items
    .map((item, index) => ({
      item,
      index,
      order: getOrderIndexValue(item),
    }))
    .sort((a, b) => {
      const orderA = a.order ?? a.index;
      const orderB = b.order ?? b.index;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

@Controller('v1')
export class CurriculumController {
  constructor(
    private readonly courses: CourseService,
    private readonly practiceExercises: PracticeExercisesGenerationService,
  ) {}

  // Helper method to get course by slug (title-based) or ID (UUID)
  private async getCourseBySlugOrId(
    slugOrId: string,
    token?: string,
    options?: CourseFullOptions,
  ) {
    // First, try direct lookup as ID
    try {
      const course = await this.courses.courseFull(slugOrId, token, options);
      if (course) return course;
    } catch (error) {
      // Continue to slug lookup if direct ID lookup fails
    }

    // If not found as ID, try to find course whose title matches the slug
    const allCourses = await this.courses.listCourseIdentifiers(token);
    const published = allCourses.filter((course: any) => {
      const status =
        typeof course?.status === 'string'
          ? course.status.trim().toLowerCase()
          : '';
      if (!status) return true;
      return status === 'published';
    });

    // Find course whose slugified title matches the input slug
    for (const course of published) {
      if (slugify(course.title) === slugOrId) {
        return await this.courses.courseFull(course.id, token, options);
      }
    }

    return null;
  }

  // List all courses as curriculum tracks
  @UseGuards(SupabaseGuard)
  @Get('curriculum')
  async getCurriculum(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const all = await this.courses.listCurriculumCourses(token);
    // Only include published courses for student-facing curriculum
    const published = all.filter((course: any) => {
      const status =
        typeof course?.status === 'string'
          ? course.status.trim().toLowerCase()
          : '';
      if (!status) return true; // legacy records without a status should remain visible
      return status === 'published';
    });
    const tracks = published.map((c: any) => {
      const subjects = Array.isArray(c.subjects) ? c.subjects : [];
      const modules = subjects.map((s: any) => {
        const items: string[] = [];
        if (Array.isArray(s.modules) && s.modules.length) {
          for (const m of s.modules.slice(0, 3)) items.push(m.title);
          if (items.length === 0) {
            const secs = (s.modules[0]?.sections || []).slice(0, 3);
            for (const sec of secs) items.push(sec.title);
          }
        }
        return { slug: s.id, title: s.title, items };
      });
      return {
        slug: slugify(c.title),
        title: c.title,
        uuid: c.id, // Keep UUID for backward compatibility
        level:
          c.difficulty === 'advanced'
            ? 'Advanced'
            : c.difficulty === 'intermediate'
              ? 'Intermediate'
              : 'Beginner',
        description: c.description || '',
        modules,
      };
    });
    return { tracks };
  }

  // Course details mapped to curriculum structure
  @UseGuards(SupabaseGuard)
  @Get('curriculum/:slug')
  async getTrack(
    @Req() req: any,
    @Param('slug') slug: string,
    @Query('includeExercises') includeExercises?: string,
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const includeExercisesValue =
      typeof includeExercises === 'string'
        ? includeExercises.trim().toLowerCase()
        : '';
    const shouldIncludeExercises =
      includeExercisesValue === 'true' ||
      includeExercisesValue === '1' ||
      includeExercisesValue === 'yes';
    const courseFetchOptions: CourseFullOptions = {
      includePracticeQuestions: false,
      includeQuizQuestions: false,
    };

    try {
      const c: any = await this.getCourseBySlugOrId(
        slug,
        token,
        courseFetchOptions,
      );

      if (!c || Object.keys(c).length === 0) {
        console.warn(`Course/track not found for slug: ${slug}`);
        return {
          slug,
          title: slug
            .replace(/-/g, ' ')
            .replace(/\b\w/g, (l) => l.toUpperCase()),
          level: 'Beginner',
          description: `Content for ${slug} is being prepared.`,
          modules: [],
        };
      }

      // Collect all section IDs to fetch exercises in bulk
      const allSections: any[] = [];
      (c.subjects || []).forEach((s: any) =>
        (s.modules || []).forEach((m: any) =>
          (m.sections || []).forEach((sec: any) => allSections.push(sec)),
        ),
      );

      let sectionExercisesMap: Map<string, any[]> | null = null;
      if (shouldIncludeExercises && allSections.length) {
        const map = new Map<string, any[]>();
        sectionExercisesMap = map;
        await Promise.all(
          allSections.map(async (sec: any) => {
            try {
              const exercises =
                await this.practiceExercises.getSectionExercises(
                  sec.id,
                  'coding',
                  req.user?.sub,
                );
              if (exercises && exercises.length > 0) {
                map.set(
                  sec.id,
                  exercises
                    .filter(
                      (ex: any) =>
                        Array.isArray(ex.section_exercise_questions) &&
                        ex.section_exercise_questions.length > 0,
                    )
                    .map((ex: any) => ({ ...ex })),
                );
              }
            } catch (error) {
              console.warn(
                'Failed to fetch exercises for section',
                sec.id,
                error,
              );
            }
          }),
        );
      }

      // Now build modules synchronously using the pre-fetched exercises
      const modules = ([] as any[]).concat(
        ...(c.subjects || []).map((s: any) => {
          const modulesForSubject = sortByOrderIndex(s.modules);
          return modulesForSubject.map((m: any) => ({
            slug: m.id,
            title: m.title,
            subjectId: m.subject_id,
            order_index: getOrderIndexValue(m),
            sections: sortByOrderIndex(m.sections).map((sec: any) => {
              const lectures = Array.isArray(sec.lectures) ? sec.lectures : [];
              const explicitLecture =
                typeof sec.lecture === 'object' && sec.lecture !== null
                  ? sec.lecture
                  : undefined;
              const primaryLecture = lectures[0] || explicitLecture;
              const practices = Array.isArray(sec.practices)
                ? sec.practices
                : [];
              // filter practices with user_id, null or matching req.user.sub
              const filteredPractices = practices.filter(
                (p: any) => p.user_id == req.user?.sub,
              );
              const normalizedPractices = filteredPractices
                .map((practice: any) => ({
                  id: practice.id,
                  title: practice.title,
                  description: practice.description,
                  practice_type:
                    practice.practice_type ??
                    practice.type ??
                    practice?.data?.practice_type,
                  type: practice.type,
                  difficulty: practice.difficulty,
                  order_index: practice.order_index,
                  status: practice.status,
                }))
                .filter((practice: any) => Boolean(practice?.id));

              // Get generated exercises for this section
              const generatedExercises = sectionExercisesMap?.get(sec.id) || [];

              // Merge existing practices with generated exercises
              const allExercises = [
                ...normalizedPractices,
                ...generatedExercises,
              ];

              const overviewFallback = `${allExercises.length} practice(s)${sec.quiz ? ' - quiz' : ''}`;
              const overviewContent =
                typeof primaryLecture?.content === 'string' &&
                primaryLecture.content.trim() !== ''
                  ? primaryLecture.content
                  : overviewFallback;
              return {
                id: sec.id,
                title: sec.title,
                order_index: getOrderIndexValue(sec),
                overview: overviewContent,
                lecture: primaryLecture
                  ? {
                      id: primaryLecture.id,
                      type:
                        typeof primaryLecture.type === 'string' &&
                        primaryLecture.type.trim() !== ''
                          ? primaryLecture.type
                          : 'text',
                      title: primaryLecture.title,
                      content: primaryLecture.content,
                    }
                  : undefined,
                lectures: lectures.map((lecture: any) => ({
                  id: lecture.id,
                  title: lecture.title,
                  type:
                    typeof lecture.type === 'string' &&
                    lecture.type.trim() !== ''
                      ? lecture.type
                      : 'text',
                  content: lecture.content,
                })),
                quizzes: sec.quiz
                  ? [
                      {
                        id: sec.quiz.id,
                        title: sec.quiz.title,
                        type: 'mcq',
                        questions: Array.isArray(sec.quiz.questions)
                          ? sec.quiz.questions.length
                          : undefined,
                        questionsList: Array.isArray(sec.quiz.questions)
                          ? sec.quiz.questions.map((q: any) => ({
                              id: q.id,
                              question: q.text,
                              options: Array.isArray(q.options)
                                ? q.options
                                : [],
                              correctOptionId: q.correct_option_id,
                            }))
                          : [],
                      },
                    ]
                  : [],
                exercises: allExercises,
                futureTopics:
                  Array.isArray(sec.futureTopics) && sec.futureTopics.length > 0
                    ? sec.futureTopics
                    : [],
              };
            }),
          }));
        }),
      );

      // Include subjects summary for UI
      const subjects = (c.subjects || []).map((s: any) => {
        const mods = (s.modules || []).map((m: any) => ({
          id: m.id,
          title: m.title,
          sectionCount: Array.isArray(m.sections) ? m.sections.length : 0,
        }));
        const moduleCount = mods.length;
        const sectionCount = (s.modules || []).reduce(
          (sum: number, m: any) => sum + ((m.sections || []).length || 0),
          0,
        );
        return {
          id: s.id,
          title: s.title,
          moduleCount,
          sectionCount,
          modules: mods,
        };
      });

      // Transform subjects to include slug versions for URL-friendly names
      const subjectsWithSlugs = subjects.map((s) => ({
        ...s,
        slug: slugify(s.title),
      }));
      return {
        slug: c.id,
        title: c.title,
        level:
          c.difficulty === 'advanced'
            ? 'Advanced'
            : c.difficulty === 'intermediate'
              ? 'Intermediate'
              : 'Beginner',
        description: c.description || '',
        modules,
        subjects: subjectsWithSlugs,
      };
    } catch (error) {
      console.error(`Error fetching track for slug: ${slug}`, error);
      return {
        slug,
        title: slug.replace(/-/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        level: 'Beginner',
        description: 'An error occurred while loading the content.',
        modules: [],
      };
    }
  }
}
