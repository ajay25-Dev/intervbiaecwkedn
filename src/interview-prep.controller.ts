import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Param,
  Request,
  BadRequestException,
  UnauthorizedException,
  ParseIntPipe,
  UseInterceptors,
  UploadedFile,
  UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { InterviewPrepService } from './interview-prep.service';
import { SupabaseGuard } from './auth/supabase.guard';
import {
  CreateInterviewProfileDto,
  UpdateInterviewProfileDto,
  UploadJDDto,
  GenerateInterviewPlanDto,
  GenerateInterviewQuestionsDto,
  ExtractJDDto,
  DomainKPIDto,
  GeneratePracticeExercisesDto,
  MigratePlanDataDto,
} from './interview-prep.dto';

type AuthenticatedRequest = {
  user?: {
    sub?: string;
    id?: string;
    email?: string;
  };
};

@Controller('interview-prep')
@UseGuards(SupabaseGuard)
export class InterviewPrepController {
  constructor(private readonly service: InterviewPrepService) {}

  private getUserId(req: AuthenticatedRequest): string {
    const userId = req?.user?.sub || req?.user?.id;
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedException('User not authenticated');
    }
    return userId;
  }

  private getAuthenticatedEmail(req: AuthenticatedRequest): string | undefined {
    const email = req.user?.email;
    return typeof email === 'string' && email.trim() ? email.trim() : undefined;
  }

  // Profile endpoints
  @Post('profile')
  async createProfile(
    @Request() req: AuthenticatedRequest,
    @Body() dto: CreateInterviewProfileDto,
  ) {
    const userId = this.getUserId(req);
    const email = dto.email || this.getAuthenticatedEmail(req);
    if (!email) {
      throw new BadRequestException('Authenticated email is required');
    }
    return this.service.createOrUpdateProfile(userId, {
      ...dto,
      email,
    });
  }

  @Get('profile')
  async getProfile(@Request() req) {
    const userId = this.getUserId(req);
    return this.service.getProfile(userId);
  }

  @Put('profile')
  async updateProfile(@Request() req, @Body() dto: UpdateInterviewProfileDto) {
    const userId = this.getUserId(req);
    return this.service.createOrUpdateProfile(userId, dto);
  }

  // Job Description endpoints
  @Post('jd/upload')
  async uploadJobDescription(@Request() req, @Body() dto: UploadJDDto) {
    if (!dto.job_description) {
      throw new BadRequestException('Job description is required');
    }
    const userId = this.getUserId(req);
    return this.service.uploadJobDescription(userId, dto);
  }

  @Post('jd/upload-file')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadDir = join(tmpdir(), 'interview-prep-uploads');
          if (!existsSync(uploadDir)) {
            mkdirSync(uploadDir, { recursive: true });
          }
          cb(null, uploadDir);
        },
        filename: (req, file, cb) => {
          const timestamp = Date.now();
          const random = Math.round(Math.random() * 1e9);
          const ext = extname(file.originalname);
          const name = file.originalname
            .replace(ext, '')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase();
          cb(null, `${name}-${timestamp}-${random}${ext}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        const allowedMimes = [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ];
        if (allowedMimes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(
            new BadRequestException(`Unsupported file type: ${file.mimetype}`),
            false,
          );
        }
      },
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
  )
  async uploadJobDescriptionFile(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }
    const userId = this.getUserId(req);
    return this.service.uploadJobDescriptionFile(userId, file);
  }

  @Get('jd/:jdId')
  async getJobDescription(
    @Request() req,
    @Param('jdId', ParseIntPipe) jdId: number,
  ) {
    const userId = this.getUserId(req);
    return this.service.getJobDescription(jdId, userId);
  }

  @Get('jd')
  async getAllJDs(@Request() req) {
    const userId = this.getUserId(req);
    return this.service.getAllUserJDs(userId);
  }

  @Post('jd/:jdId/analyze')
  async analyzeJobDescription(
    @Request() req,
    @Param('jdId', ParseIntPipe) jdId: number,
  ) {
    const userId = this.getUserId(req);
    const jdData = await this.service.getJobDescription(jdId, userId);
    return this.service.analyzeJobDescription(jdId, jdData.job_description);
  }

  // Interview Plan endpoints
  @Post('plan/generate')
  async generatePlan(@Request() req, @Body() dto: GenerateInterviewPlanDto) {
    const userId = this.getUserId(req);
    return this.service.generateInterviewPlan(userId, dto);
  }

  @Get('plan/:planId')
  async getPlan(@Request() req, @Param('planId', ParseIntPipe) planId: number) {
    const userId = this.getUserId(req);
    return this.service.getInterviewPlan(planId, userId);
  }

  @Get('plan/:planId/progress')
  async getPlanProgress(
    @Request() req,
    @Param('planId', ParseIntPipe) planId: number,
  ) {
    const userId = this.getUserId(req);
    return this.service.getPlanProgress(userId, planId);
  }

  @Get('plan/latest/:profileId')
  async getLatestPlan(
    @Request() req,
    @Param('profileId', ParseIntPipe) profileId: number,
  ) {
    const userId = this.getUserId(req);
    return this.service.getLatestPlan(userId, profileId);
  }

  @Get('plan')
  async getLatestPlanDefault(@Request() req) {
    const userId = this.getUserId(req);
    return this.service.getLatestPlan(userId);
  }

  @Post('questions/generate')
  async generateInterviewQuestions(
    @Request() req,
    @Body() dto: GenerateInterviewQuestionsDto,
  ) {
    const userId = this.getUserId(req);
    return this.service.generateInterviewQuestions(userId, dto);
  }

  @Post('extract-jd')
  async extractJDInfo(@Request() req, @Body() dto: ExtractJDDto) {
    if (!dto.job_description) {
      throw new BadRequestException('Job description is required');
    }
    const userId = this.getUserId(req);
    return this.service.extractJDInfo(dto, userId);
  }

  @Post('domain-kpi')
  async generateDomainKPI(@Body() dto: DomainKPIDto) {
    if (!dto.company_name) {
      throw new BadRequestException('Company name is required');
    }
    return this.service.generateDomainKPI(dto);
  }

  @Post('practice-exercises/generate')
  async generatePracticeExercises(
    @Request() req,
    @Body() dto: GeneratePracticeExercisesDto,
  ) {
    const userId = this.getUserId(req);
    return this.service.generatePracticeExercises(userId, dto);
  }

  @Post('plan/:planId/subjects/:subject/retry')
  async retryPlanSubject(
    @Request() req,
    @Param('planId', ParseIntPipe) planId: number,
    @Param('subject') subject: string,
  ) {
    const userId = this.getUserId(req);
    return this.service.regeneratePlanSubjectExercises(
      userId,
      planId,
      subject,
    );
  }

  // Migration endpoints
  @Post('plan/:planId/migrate')
  async migratePlanData(
    @Request() req,
    @Param('planId', ParseIntPipe) planId: number,
    @Body() dto: MigratePlanDataDto,
  ) {
    const userId = this.getUserId(req);

    // Ensure the plan_id in DTO matches the URL parameter
    dto.plan_id = planId;

    return this.service.migratePlanDataToTables(userId, dto);
  }
}
