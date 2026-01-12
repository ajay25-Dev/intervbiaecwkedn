import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface CourseAssignment {
  id: string;
  user_id: string;
  course_id: string;
  assigned_by: string;
  assigned_at: string;
  due_date?: string;
  status: 'assigned' | 'in_progress' | 'completed' | 'overdue';
  progress_percentage: number;
  completed_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AssignCourseRequest {
  user_id: string;
  course_ids: string[];
  due_date?: string;
  notes?: string;
}

export interface UpdateAssignmentRequest {
  due_date?: string;
  status?: 'assigned' | 'in_progress' | 'completed' | 'overdue';
  progress_percentage?: number;
  notes?: string;
}

export interface CourseAssignmentWithDetails extends CourseAssignment {
  user: {
    id: string;
    email: string;
    full_name?: string;
    role: string;
  };
  course: {
    id: string;
    title: string;
    description?: string;
    status?: string;
  };
  assigner: {
    id: string;
    email: string;
    full_name?: string;
  };
}

@Injectable()
export class CourseAssignmentsService {
  private readonly logger = new Logger(CourseAssignmentsService.name);
  private supabase = createClient(
    process.env.SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE || '',
  );

  async getAssignments(filters?: {
    user_id?: string;
    course_id?: string;
    status?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    // console.log('getAssignments called with filters:', filters);

    // First try without foreign key joins to see if basic query works
    let query = this.supabase
      .from('user_course_assignments')
      .select('*', { count: 'exact' });

    // console.log('Base query created without foreign key joins');

    if (filters?.user_id) {
      query = query.eq('user_id', filters.user_id);
    }

    if (filters?.course_id) {
      query = query.eq('course_id', filters.course_id);
    }

    if (filters?.status) {
      query = query.eq('status', filters.status);
    }

    if (filters?.search) {
      // Search by user name/email or course title
      const term = filters.search;
      // Note: PostgREST doesn't support searching in related tables directly with OR
      // We'll need to implement this differently by using text search on the base table
      // For now, we'll skip the search functionality to prevent the 500 error
      // TODO: Implement proper search using full-text search or separate queries
    }

    // Pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    query = query.range(from, to).order('assigned_at', { ascending: false });

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`Failed to fetch course assignments: ${error.message}`);
    }

    // If no data, return empty result
    if (!data || data.length === 0) {
      return {
        assignments: [],
        totalPages: 0,
        currentPage: page,
        totalCount: count || 0,
      };
    }

    // Fetch related data separately to avoid foreign key issues
    const userIds = [...new Set(data.map((a) => a.user_id).filter(Boolean))];
    const courseIds = [
      ...new Set(data.map((a) => a.course_id).filter(Boolean)),
    ];
    const assignerIds = [
      ...new Set(data.map((a) => a.assigned_by).filter(Boolean)),
    ];

    // console.log(
    //   'Fetching related data for userIds:',
    //   userIds,
    //   'courseIds:',
    //   courseIds,
    //   'assignerIds:',
    //   assignerIds,
    // );

    // Fetch users
    const users = new Map();
    if (userIds.length > 0) {
      const { data: userData } = await this.supabase
        .from('profiles')
        .select('id, email, full_name, role')
        .in('id', userIds);
      userData?.forEach((user) => users.set(user.id, user));
    }

    // Fetch courses
    const courses = new Map();
    if (courseIds.length > 0) {
      const { data: courseData } = await this.supabase
        .from('courses')
        .select('id, title, description, status')
        .in('id', courseIds);
      courseData?.forEach((course) => courses.set(course.id, course));
    }

    // Fetch assigners (same as users but different map)
    const assigners = new Map();
    if (assignerIds.length > 0) {
      const { data: assignerData } = await this.supabase
        .from('profiles')
        .select('id, email, full_name')
        .in('id', assignerIds);
      assignerData?.forEach((assigner) => assigners.set(assigner.id, assigner));
    }

    // Combine the data
    const assignmentsWithDetails = data.map((assignment) => ({
      ...assignment,
      user: users.get(assignment.user_id) || null,
      course: courses.get(assignment.course_id) || null,
      assigner: assigners.get(assignment.assigned_by) || null,
    }));

    const totalPages = Math.ceil((count || 0) / limit);

    return {
      assignments: assignmentsWithDetails as CourseAssignmentWithDetails[],
      totalPages,
      currentPage: page,
      totalCount: count || 0,
    };
  }

  async getAssignment(id: string): Promise<CourseAssignmentWithDetails> {
    const { data, error } = await this.supabase
      .from('user_course_assignments')
      .select(
        `
        *,
        user:user_id(id, email, full_name, role),
        course:course_id(id, title, description, status),
        assigner:assigned_by(id, email, full_name)
      `,
      )
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Course assignment not found');
      }
      throw new Error(`Failed to fetch course assignment: ${error.message}`);
    }

    return data as CourseAssignmentWithDetails;
  }

  async assignCourse(
    assignmentData: AssignCourseRequest,
    assignedBy: string,
  ): Promise<CourseAssignment[]> {
    // this.logger.log('Starting course assignment process', {
    //   targetUserId: assignmentData.user_id,
    //   courseIds: assignmentData.course_ids,
    //   assignedBy,
    //   dueDate: assignmentData.due_date,
    //   notes: assignmentData.notes,
    // });

    // Verify the user exists
    const { data: user, error: userError } = await this.supabase
      .from('profiles')
      .select('id')
      .eq('id', assignmentData.user_id)
      .single();

    if (userError || !user) {
      this.logger.error('User verification failed', {
        targetUserId: assignmentData.user_id,
        error: userError?.message,
        errorCode: userError?.code,
        assignedBy,
      });
      throw new NotFoundException('User not found');
    }

    // this.logger.log(`User ${assignmentData.user_id} verified successfully`);

    // Prepare assignments data
    const assignmentsData = assignmentData.course_ids.map((course_id) => ({
      user_id: assignmentData.user_id,
      course_id,
      assigned_by: assignedBy,
      due_date: assignmentData.due_date,
      notes: assignmentData.notes,
      status: 'assigned' as const,
      progress_percentage: 0,
    }));

    // Verify all courses exist using a single query
    const { data: existingCourses, error: coursesError } = await this.supabase
      .from('courses')
      .select('id')
      .in('id', assignmentData.course_ids);

    if (coursesError) {
      this.logger.error('Course verification query failed', {
        courseIds: assignmentData.course_ids,
        error: coursesError.message,
        errorCode: coursesError.code,
        assignedBy,
      });
      throw new NotFoundException('Failed to verify courses');
    }

    if (
      !existingCourses ||
      existingCourses.length !== assignmentData.course_ids.length
    ) {
      const foundCourseIds = existingCourses?.map((c) => c.id) || [];
      const missingCourseIds = assignmentData.course_ids.filter(
        (id) => !foundCourseIds.includes(id),
      );

      this.logger.error('Some courses not found', {
        requestedCourseIds: assignmentData.course_ids,
        foundCourseIds,
        missingCourseIds,
        assignedBy,
      });
      throw new NotFoundException(
        `Courses not found: ${missingCourseIds.join(', ')}`,
      );
    }

    // this.logger.log(`All ${existingCourses.length} courses verified successfully`);

    // Check if any assignments already exist
    const { data: existingAssignments, error: existingError } =
      await this.supabase
        .from('user_course_assignments')
        .select('course_id')
        .eq('user_id', assignmentData.user_id)
        .in('course_id', assignmentData.course_ids);

    if (existingError) {
      throw new Error(
        `Failed to check existing assignments: ${existingError.message}`,
      );
    }

    if (existingAssignments && existingAssignments.length > 0) {
      const existingCourseIds = existingAssignments.map((a) => a.course_id);
      const courseTitles = await this.getCourseTitles(existingCourseIds);
      throw new ConflictException(
        `Courses are already assigned to this user: ${courseTitles.join(', ')}`,
      );
    }

    // this.logger.log('Inserting course assignments', {
    //   assignmentsCount: assignmentsData.length,
    //   assignmentsData: JSON.stringify(assignmentsData, null, 2),
    // });

    const { data, error } = await this.supabase
      .from('user_course_assignments')
      .insert(assignmentsData)
      .select();

    if (error) {
      this.logger.error('Course assignment insertion failed', {
        error: error.message,
        errorCode: error.code,
        errorDetails: error.details,
        errorHint: error.hint,
        assignmentsData: JSON.stringify(assignmentsData, null, 2),
        assignedBy,
      });
      throw new Error(`Failed to assign courses: ${error.message}`);
    }

    // this.logger.log('Course assignments created successfully', {
    //   assignmentsCreated: data.length,
    //   assignmentIds: data.map(a => a.id),
    //   targetUserId: assignmentData.user_id,
    //   assignedBy,
    // });

    return data as CourseAssignment[];
  }

  private async getCourseTitles(courseIds: string[]): Promise<string[]> {
    const { data, error } = await this.supabase
      .from('courses')
      .select('title')
      .in('id', courseIds);

    if (error || !data) return courseIds; // fallback to IDs if query fails

    return data.map((c) => c.title);
  }

  async updateAssignment(
    id: string,
    updateData: UpdateAssignmentRequest,
  ): Promise<CourseAssignment> {
    // If marking as completed, set completed_at timestamp
    const updatedData = {
      ...updateData,
      ...(updateData.status === 'completed' && !updateData.progress_percentage
        ? { progress_percentage: 100, completed_at: new Date().toISOString() }
        : {}),
      ...(updateData.progress_percentage === 100 &&
      updateData.status !== 'completed'
        ? { status: 'completed', completed_at: new Date().toISOString() }
        : {}),
    };

    const { data, error } = await this.supabase
      .from('user_course_assignments')
      .update(updatedData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        throw new NotFoundException('Course assignment not found');
      }
      throw new Error(`Failed to update course assignment: ${error.message}`);
    }

    return data as CourseAssignment;
  }

  async removeAssignment(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('user_course_assignments')
      .delete()
      .eq('id', id);

    if (error) {
      throw new Error(`Failed to remove course assignment: ${error.message}`);
    }
  }

  async getStudentAssignments(userId: string) {
    const { data, error } = await this.supabase
      .from('user_course_assignments')
      .select(
        `
        *,
        course:course_id(id, title, description, status)
      `,
      )
      .eq('user_id', userId)
      .order('assigned_at', { ascending: false });

    if (error) {
      // console.log(`Failed to fetch student assignments: ${error.message}`);
      throw new Error(`Failed to fetch student assignments: ${error.message}`);
    }

    return data;
  }

  async getAssignmentStats() {
    // Get total assignments by status
    const { data: statusStats, error: statusError } = await this.supabase
      .from('user_course_assignments')
      .select('status')
      .order('status');

    if (statusError) {
      throw new Error(
        `Failed to fetch assignment stats: ${statusError.message}`,
      );
    }

    const stats = statusStats.reduce(
      (acc, { status }) => {
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const totalAssignments = statusStats.length;

    // Get completion rate
    const completedCount = stats.completed || 0;
    const completionRate =
      totalAssignments > 0
        ? Math.round((completedCount / totalAssignments) * 100)
        : 0;

    // Get assignments by month (for trending)
    const { data: monthlyStats, error: monthlyError } = await this.supabase
      .from('user_course_assignments')
      .select('assigned_at')
      .gte(
        'assigned_at',
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );

    const newAssignmentsThisMonth = monthlyStats?.length || 0;

    return {
      totalAssignments,
      assigned: stats.assigned || 0,
      inProgress: stats.in_progress || 0,
      completed: stats.completed || 0,
      overdue: stats.overdue || 0,
      completionRate,
      newAssignmentsThisMonth,
    };
  }
}
