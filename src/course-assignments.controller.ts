import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  Req,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdminGuard } from './auth/admin.guard';
import { CourseAssignmentsService } from './course-assignments.service';
import type {
  AssignCourseRequest,
  UpdateAssignmentRequest,
} from './course-assignments.service';

@Controller('v1/admin/course-assignments')
@UseGuards(SupabaseGuard, AdminGuard)
export class CourseAssignmentsController {
  private readonly logger = new Logger(CourseAssignmentsController.name);

  constructor(
    private readonly courseAssignmentsService: CourseAssignmentsService,
  ) {}

  @Get()
  async getAssignments(
    @Query('user_id') userId?: string,
    @Query('course_id') courseId?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
  ) {
    return this.courseAssignmentsService.getAssignments({
      user_id: userId,
      course_id: courseId,
      status,
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('stats')
  async getAssignmentStats() {
    return this.courseAssignmentsService.getAssignmentStats();
  }

  @Get(':id')
  async getAssignment(@Param('id') id: string) {
    return this.courseAssignmentsService.getAssignment(id);
  }

  @Post()
  async assignCourse(
    @Body() assignCourseRequest: AssignCourseRequest,
    @Req() request: any,
  ) {
    try {
      // Enhanced logging for debugging authentication issues
      // this.logger.log('Course assignment request received', {
      //   requestBody: JSON.stringify(assignCourseRequest, null, 2),
      //   hasUser: !!request.user,
      //   userObject: request.user ? JSON.stringify(request.user, null, 2) : 'No user object',
      //   userKeys: request.user ? Object.keys(request.user) : [],
      //   userId: request.user?.id || 'Not found',
      //   userSub: request.user?.sub || 'Not found',
      //   headers: {
      //     authorization: request.headers.authorization ? 'Bearer [REDACTED]' : 'None',
      //     contentType: request.headers['content-type'],
      //     userAgent: request.headers['user-agent'],
      //   },
      //   timestamp: new Date().toISOString(),
      // });

      // Try multiple ways to extract user ID
      const assignedBy = request.user?.id || request.user?.sub;

      if (!assignedBy) {
        this.logger.error('User ID extraction failed', {
          userObject: request.user
            ? JSON.stringify(request.user, null, 2)
            : 'No user object',
          requestKeys: Object.keys(request),
          userKeys: request.user ? Object.keys(request.user) : [],
          authHeader: request.headers.authorization ? 'Present' : 'Missing',
          guardsPassed: 'Both SupabaseGuard and AdminGuard should have passed',
        });

        throw new BadRequestException({
          message: 'User ID not found in request',
          details:
            'Authentication guards passed but user ID could not be extracted',
          userObject: request.user,
          timestamp: new Date().toISOString(),
        });
      }

      // this.logger.log(`Assigning courses to user ${assignCourseRequest.user_id} by admin ${assignedBy}`);

      const result = await this.courseAssignmentsService.assignCourse(
        assignCourseRequest,
        assignedBy,
      );

      // this.logger.log('Course assignment completed successfully', {
      //   assignedBy,
      //   targetUserId: assignCourseRequest.user_id,
      //   courseIds: assignCourseRequest.course_ids,
      //   assignmentsCreated: result.length,
      // });

      return result;
    } catch (error) {
      this.logger.error('Course assignment failed', {
        error: error.message,
        stack: error.stack,
        requestBody: JSON.stringify(assignCourseRequest, null, 2),
        userObject: request.user
          ? JSON.stringify(request.user, null, 2)
          : 'No user object',
        timestamp: new Date().toISOString(),
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException({
        message: 'Failed to assign course',
        originalError: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @Put(':id')
  async updateAssignment(
    @Param('id') id: string,
    @Body() updateAssignmentRequest: UpdateAssignmentRequest,
  ) {
    return this.courseAssignmentsService.updateAssignment(
      id,
      updateAssignmentRequest,
    );
  }

  @Delete(':id')
  async removeAssignment(@Param('id') id: string) {
    await this.courseAssignmentsService.removeAssignment(id);
    return { message: 'Course assignment removed successfully' };
  }
}

// Separate controller for student-facing endpoints
@Controller('v1/student/course-assignments')
@UseGuards(SupabaseGuard)
export class StudentCourseAssignmentsController {
  private readonly logger = new Logger(StudentCourseAssignmentsController.name);

  constructor(
    private readonly courseAssignmentsService: CourseAssignmentsService,
  ) {}

  @Get()
  async getMyAssignments(@Req() request: any) {
    try {
      // this.logger.log('Student assignments request received', {
      //   hasUser: !!request.user,
      //   userObject: request.user ? JSON.stringify(request.user, null, 2) : 'No user object',
      //   userId: request.user?.id || 'Not found',
      //   userSub: request.user?.sub || 'Not found',
      // });

      const userId = request.user?.id || request.user?.sub;
      if (!userId) {
        this.logger.error('User ID extraction failed for student assignments', {
          userObject: request.user
            ? JSON.stringify(request.user, null, 2)
            : 'No user object',
          userKeys: request.user ? Object.keys(request.user) : [],
        });

        throw new BadRequestException({
          message: 'User ID not found in request',
          details:
            'Authentication guard passed but user ID could not be extracted',
          userObject: request.user,
          timestamp: new Date().toISOString(),
        });
      }

      const result =
        await this.courseAssignmentsService.getStudentAssignments(userId);

      // this.logger.log(`Retrieved ${result.length} assignments for student ${userId}`);

      return result;
    } catch (error) {
      this.logger.error('Failed to get student assignments', {
        error: error.message,
        stack: error.stack,
        userObject: request.user
          ? JSON.stringify(request.user, null, 2)
          : 'No user object',
        timestamp: new Date().toISOString(),
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException({
        message: 'Failed to retrieve assignments',
        originalError: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }

  @Put(':id/progress')
  async updateProgress(
    @Param('id') id: string,
    @Body() body: { progress_percentage: number },
    @Req() request: any,
  ) {
    try {
      // this.logger.log('Progress update request received', {
      //   assignmentId: id,
      //   progressPercentage: body.progress_percentage,
      //   hasUser: !!request.user,
      //   userId: request.user?.id || request.user?.sub || 'Not found',
      // });

      const userId = request.user?.id || request.user?.sub;
      if (!userId) {
        this.logger.error('User ID extraction failed for progress update', {
          userObject: request.user
            ? JSON.stringify(request.user, null, 2)
            : 'No user object',
          assignmentId: id,
        });

        throw new BadRequestException({
          message: 'User ID not found in request',
          details:
            'Authentication guard passed but user ID could not be extracted',
          userObject: request.user,
          timestamp: new Date().toISOString(),
        });
      }

      // Verify this assignment belongs to the current user
      const assignment = await this.courseAssignmentsService.getAssignment(id);
      if (assignment.user_id !== userId) {
        this.logger.warn('Unauthorized progress update attempt', {
          assignmentId: id,
          assignmentUserId: assignment.user_id,
          requestUserId: userId,
        });

        throw new BadRequestException({
          message: 'Unauthorized to update this assignment',
          details: 'Assignment does not belong to the current user',
          timestamp: new Date().toISOString(),
        });
      }

      const status =
        body.progress_percentage >= 100 ? 'completed' : 'in_progress';

      const result = await this.courseAssignmentsService.updateAssignment(id, {
        progress_percentage: body.progress_percentage,
        status,
      });

      // this.logger.log('Progress updated successfully', {
      //   assignmentId: id,
      //   userId,
      //   newProgress: body.progress_percentage,
      //   newStatus: status,
      // });

      return result;
    } catch (error) {
      this.logger.error('Failed to update progress', {
        error: error.message,
        stack: error.stack,
        assignmentId: id,
        progressPercentage: body.progress_percentage,
        userObject: request.user
          ? JSON.stringify(request.user, null, 2)
          : 'No user object',
        timestamp: new Date().toISOString(),
      });

      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException({
        message: 'Failed to update assignment progress',
        originalError: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  }
}
