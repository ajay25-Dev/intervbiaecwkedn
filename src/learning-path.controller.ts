import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Headers,
} from '@nestjs/common';
import {
  LearningPathService,
  LearningPath,
  UserProgress,
} from './learning-path.service';

@Controller('v1/learning-paths')
export class LearningPathController {
  constructor(private readonly learningPathService: LearningPathService) {}

  @Get()
  async getAllPaths(
    @Headers('authorization') auth?: string,
  ): Promise<LearningPath[]> {
    return this.learningPathService.getAllPaths(auth);
  }

  @Get(':id')
  async getPathDetails(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<LearningPath> {
    return this.learningPathService.getPathDetails(id, auth);
  }

  @Get(':id/personalized')
  async getPersonalizedPath(
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<LearningPath> {
    return this.learningPathService.getPersonalizedPath(id, auth);
  }

  @Post('recommend')
  async getRecommendedPath(
    @Body() body: any,
    @Headers('authorization') auth?: string,
  ): Promise<LearningPath> {
    return this.learningPathService.getRecommendedPath(body, auth);
  }

  @Post(':pathId/enroll')
  async enrollInPath(
    @Param('pathId') pathId: string,
    @Headers('authorization') auth?: string,
  ) {
    return this.learningPathService.enrollUserInPath(pathId, auth);
  }

  @Get('user/progress')
  async getUserProgress(
    @Headers('authorization') auth?: string,
  ): Promise<UserProgress[]> {
    return this.learningPathService.getUserProgress(auth);
  }

  @Patch('user/progress/:stepId/complete')
  async completeStep(
    @Param('stepId') stepId: string,
    @Body() body: any,
    @Headers('authorization') auth?: string,
  ) {
    return this.learningPathService.completeStep(stepId, body, auth);
  }

  @Get('user/module-status')
  async getUserModuleStatus(
    @Headers('authorization') auth?: string,
  ): Promise<any[]> {
    return this.learningPathService.getUserModuleStatus(auth);
  }

  @Get('user/my-path')
  async getMyLearningPath(
    @Headers('authorization') auth?: string,
  ): Promise<LearningPath | null> {
    return this.learningPathService.getUserLearningPath(auth);
  }

  @Post('user/refresh')
  async refreshUserLearningPaths(@Headers('authorization') auth?: string) {
    return this.learningPathService.refreshUserLearningPaths(auth);
  }

  @Get('user/insights')
  async getLearningPathInsights(@Headers('authorization') auth?: string) {
    return this.learningPathService.getLearningPathInsights(auth);
  }
}
