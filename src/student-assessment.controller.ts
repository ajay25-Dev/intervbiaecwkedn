import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { StudentAssessmentService } from './student-assessment.service';

@Controller('v1/student/assessments')
@UseGuards(SupabaseGuard)
export class StudentAssessmentController {
  constructor(
    private readonly studentAssessmentService: StudentAssessmentService,
  ) {}

  @Get('available')
  async getAvailableAssessments(@Request() req: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new HttpException(
          'User not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );

      return await this.studentAssessmentService.getAvailableAssessments(
        userId,
        token,
      );
    } catch (error) {
      console.error('Error getting available assessments:', error);
      throw new HttpException(
        error.message || 'Failed to get available assessments',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('start')
  async startAssessment(@Request() req: any, @Body() body: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new HttpException(
          'User not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );

      return await this.studentAssessmentService.startAssessment(
        userId,
        token,
        body,
      );
    } catch (error) {
      console.error('Error starting assessment:', error);
      throw new HttpException(
        error.message || 'Failed to start assessment',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('evaluate')
  async evaluateResponse(@Request() req: any, @Body() body: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new HttpException(
          'User not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );

      return await this.studentAssessmentService.evaluateResponse(
        userId,
        token,
        body,
      );
    } catch (error) {
      console.error('Error evaluating response:', error);
      throw new HttpException(
        error.message || 'Failed to evaluate response',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('finish')
  async finishAssessment(@Request() req: any, @Body() body: any) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new HttpException(
          'User not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );

      return await this.studentAssessmentService.finishAssessment(
        userId,
        token,
        body,
      );
    } catch (error) {
      console.error('Error finishing assessment:', error);
      throw new HttpException(
        error.message || 'Failed to finish assessment',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':sessionId/status')
  async getAssessmentStatus(
    @Request() req: any,
    @Param('sessionId') sessionId: string,
  ) {
    try {
      const userId = req.user?.sub;
      if (!userId) {
        throw new HttpException(
          'User not authenticated',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const token = (req.headers.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        '',
      );

      return await this.studentAssessmentService.getAssessmentStatus(
        userId,
        sessionId,
        token,
      );
    } catch (error) {
      console.error('Error getting assessment status:', error);
      throw new HttpException(
        error.message || 'Failed to get assessment status',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
