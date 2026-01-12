import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { AssessmentService } from './assessment.service';

@Injectable()
export class StudentAssessmentService {
  constructor(private readonly assessmentService: AssessmentService) {}

  async getAvailableAssessments(userId: string, userToken?: string) {
    try {
      // For now, return a default assessment template
      // This can be expanded to fetch actual templates from the database
      return [
        {
          id: 'default-assessment',
          title: 'Initial Assessment',
          category_id: 'general',
          description: 'Initial assessment to determine your skill level',
          student_info: {
            total_attempts: 0,
            can_retake: true,
          },
        },
      ];
    } catch (error) {
      console.error(
        'StudentAssessmentService.getAvailableAssessments error:',
        error,
      );
      throw new HttpException(
        error.message || 'Failed to get available assessments',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async startAssessment(
    userId: string,
    userToken: string | undefined,
    body: any,
  ) {
    try {
      const token = userToken ?? body?.userToken;

      // Start the assessment using the existing AssessmentService
      const assessment = await this.assessmentService.start(userId, token);

      // Get the question set for the assessment
      const questionSet = await this.assessmentService.getQuestionSet(
        userId,
        token,
      );

      return {
        success: true,
        assessment,
        questions: questionSet,
      };
    } catch (error) {
      console.error('StudentAssessmentService.startAssessment error:', error);
      throw new HttpException(
        error.message || 'Failed to start assessment',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async evaluateResponse(
    userId: string,
    userToken: string | undefined,
    body: any,
  ) {
    try {
      const { questionId, answer, skipped = false } = body;

      if (!questionId) {
        throw new HttpException(
          'Question ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const token = userToken ?? body?.userToken;

      // Evaluate the response using the existing AssessmentService
      const evaluation = await this.assessmentService.evaluateResponse(
        questionId,
        answer,
        skipped,
        token,
      );

      return {
        success: true,
        evaluation,
      };
    } catch (error) {
      console.error('StudentAssessmentService.evaluateResponse error:', error);
      throw new HttpException(
        error.message || 'Failed to evaluate response',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async finishAssessment(
    userId: string,
    userToken: string | undefined,
    body: any,
  ) {
    try {
      const { assessmentId, responses } = body;

      if (!assessmentId) {
        throw new HttpException(
          'Assessment ID is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (!responses || !Array.isArray(responses)) {
        throw new HttpException(
          'Responses array is required',
          HttpStatus.BAD_REQUEST,
        );
      }

      const token = userToken ?? body?.userToken;

      // Finish the assessment using the existing AssessmentService
      const result = await this.assessmentService.finish(
        userId,
        assessmentId,
        responses,
        token,
      );

      return {
        success: true,
        result,
        redirectTo: '/learning-path',
      };
    } catch (error) {
      console.error('StudentAssessmentService.finishAssessment error:', error);
      throw new HttpException(
        error.message || 'Failed to finish assessment',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getAssessmentStatus(
    userId: string,
    sessionId: string,
    userToken?: string,
  ) {
    try {
      // Get the latest assessment for the user
      const assessment = await this.assessmentService.latest(userId, userToken);

      if (!assessment) {
        throw new HttpException('Assessment not found', HttpStatus.NOT_FOUND);
      }

      return {
        success: true,
        assessment,
      };
    } catch (error) {
      console.error(
        'StudentAssessmentService.getAssessmentStatus error:',
        error,
      );
      throw new HttpException(
        error.message || 'Failed to get assessment status',
        error.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
