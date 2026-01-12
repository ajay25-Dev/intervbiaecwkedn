import { Controller, Put, Body, Param, UseGuards } from '@nestjs/common';
import { PracticeExerciseService } from './practice-exercise.service';
import { AdminGuard } from './auth/admin.guard';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Admin Practice Exercises')
@Controller('admin/practice-exercises')
@UseGuards(AdminGuard)
export class AdminPracticeExercisesController {
  constructor(private readonly exerciseService: PracticeExerciseService) {}

  @ApiOperation({ summary: 'Update a practice exercise' })
  @ApiResponse({ status: 200, description: 'The updated practice exercise' })
  @Put(':exerciseId')
  async updateExercise(
    @Param('exerciseId') exerciseId: string,
    @Body() exerciseData: any,
  ) {
    return this.exerciseService.updateExercise(exerciseId, exerciseData);
  }
}
