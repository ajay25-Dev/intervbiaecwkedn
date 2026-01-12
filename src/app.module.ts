import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DashboardController } from './dashboard.controller';
import { ProfilesService } from './profiles.service';
import { ProfileController } from './profile.controller';
import { ProfileApiController } from './profile.api.controller';
import { DebugController } from './debug.controller';
import { AssessmentController } from './assessment.controller';
import { AssessmentService } from './assessment.service';
import { AdminAssessmentController } from './admin-assessment.controller';
import { AdminAssessmentService } from './admin-assessment.service';
import { StudentAssessmentController } from './student-assessment.controller';
import { StudentAssessmentService } from './student-assessment.service';
import { SeedController } from './seed.controller';
import { AssessmentDataSeeder } from './seed-assessment-data';
import { CurriculumController } from './curriculum.controller';
import { CourseController } from './course.controller';
import { CourseService } from './course.service';
import { LearningPathController } from './learning-path.controller';
import { LearningPathService } from './learning-path.service';
import { GamificationController } from './gamification.controller';
import { GamificationService } from './gamification.service';
import { AdminUsersController } from './admin-users.controller';
import { AdminUsersService } from './admin-users.service';
import { AdminModulesController } from './admin-modules.controller';
import { BulkUserImportController } from './bulk-user-import.controller';
import { BulkUserImportService } from './bulk-user-import.service';
import { SectionExercisesController } from './section-exercises.controller';
import { SectionExercisesService } from './section-exercises.service';
import { LecturesController } from './lectures.controller';
import { LecturesService } from './lectures.service';
import { ExercisesUploadController } from './exercises-upload.controller';
import { ExercisesUploadService } from './exercises-upload.service';
import { QuizUploadController } from './quiz-upload.controller';
import { QuizUploadService } from './quiz-upload.service';
import { QuizGenerationService } from './quiz-generation.service';
import { PracticeExercisesGenerationService } from './practice-exercises-generation.service';

import {
  CourseAssignmentsController,
  StudentCourseAssignmentsController,
} from './course-assignments.controller';
import { CourseAssignmentsService } from './course-assignments.service';
import { SubjectSelectionController } from './subject-selection.controller';
import { SubjectSelectionService } from './subject-selection.service';
import { PracticeCodingController } from './practice-coding.controller';
import { PracticeCodingService } from './practice-coding.service';
import { PracticeExerciseController } from './practice-exercise.controller';
import { PracticeExerciseService } from './practice-exercise.service';
import { AdminPracticeExercisesController } from './admin-practice-exercises.controller';
import { AuthModule } from './auth/auth.module';
import { QuizModule } from './quiz.module';
import { UploadsMiddleware } from './uploads.middleware';
import { StudentQuizController } from './student-quiz.controller';
import { QuizAnswersController } from './quiz-answers.controller';
import { SectionPracticeController } from './section-practice.controller';
import { SectionQuizController } from './section-quiz.controller';
import { StudentSectionExercisesController } from './student-section-exercises.controller';
import { SqlExecutionController } from './sql-execution.controller';
import { SqlExecutionService } from './sql-execution.service';
import { DatasetExecutionService } from './dataset-execution.service';
import { AdaptiveQuizController } from './adaptive-quiz.controller';
import { AdaptiveQuizService } from './adaptive-quiz.service';
import { InterviewPrepController } from './interview-prep.controller';
import { InterviewPrepService } from './interview-prep.service';
import { InterviewPracticeExercisesController } from './interview-practice-exercises.controller';
import { InterviewPracticeExercisesService } from './interview-practice-exercises.service';
import { FileExtractionService } from './file-extraction.service';
import { LoggingInterceptor } from './logging.interceptor';
import { GamificationV2Module } from './gamification-v2/gamification.module';
import { DatabaseInitController } from './database-init.controller';

@Module({
  imports: [QuizModule, AuthModule, GamificationV2Module],
  controllers: [
    AppController,
    DashboardController,
    ProfileController,
    ProfileApiController,
    DebugController,
    AssessmentController,
    AdminAssessmentController,
    StudentAssessmentController,
    SeedController,
    CurriculumController,
    CourseController,
    LearningPathController,
    GamificationController,
    AdminUsersController,
    AdminModulesController,
    BulkUserImportController,
    SectionExercisesController,
    LecturesController,
    ExercisesUploadController,
    QuizUploadController,
    CourseAssignmentsController,
    StudentCourseAssignmentsController,
    SubjectSelectionController,
    PracticeCodingController,
    PracticeExerciseController,
    AdminPracticeExercisesController,
    StudentQuizController,
    QuizAnswersController,
    SectionPracticeController,
    SectionQuizController,
    StudentSectionExercisesController,
    SqlExecutionController,
    AdaptiveQuizController,
    InterviewPrepController,
    InterviewPracticeExercisesController,
    DatabaseInitController,
  ],
  providers: [
    AppService,
    ProfilesService,
    AssessmentService,
    AdminAssessmentService,
    StudentAssessmentService,
    AssessmentDataSeeder,
    CourseService,
    LearningPathService,
    GamificationService,
    AdminUsersService,
    BulkUserImportService,
    SectionExercisesService,
    LecturesService,
    ExercisesUploadService,
    QuizUploadService,
    QuizGenerationService,
    PracticeExercisesGenerationService,
    CourseAssignmentsService,
    SubjectSelectionService,
    PracticeCodingService,
    PracticeExerciseService,
    SqlExecutionService,
    DatasetExecutionService,
    AdaptiveQuizService,
    InterviewPrepService,
    InterviewPracticeExercisesService,
    FileExtractionService,
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(UploadsMiddleware).forRoutes('uploads');
  }
}
