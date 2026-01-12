import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { AssessmentService } from './assessment.service';
import { extractUserIdSafely } from './utils/user-id.util';

@Controller('v1/assessments')
export class AssessmentController {
  constructor(private readonly svc: AssessmentService) {}

  @UseGuards(SupabaseGuard)
  @Post('start')
  async start(@Req() req: any) {
    const userId = extractUserIdSafely(req, 'AssessmentController.start');
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const row = await this.svc.start(userId, token);
    const [questions, lockedModules] = await Promise.all([
      this.svc.getQuestionSet(userId, token),
      this.svc.getLockedModules(userId, token),
    ]);
    return { assessment_id: row.id, questions, lockedModules };
  }

  @UseGuards(SupabaseGuard)
  @Post('evaluate')
  async evaluate(
    @Req() req: any,
    @Body()
    body: {
      question_id: string;
      answer: string | null;
      skipped?: boolean;
    },
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    return this.svc.evaluateResponse(
      body.question_id,
      body.answer ?? null,
      body.skipped ?? false,
      token,
    );
  }

  @UseGuards(SupabaseGuard)
  @Post('finish')
  async finish(
    @Req() req: any,
    @Body()
    body: {
      assessment_id: string;
      responses: {
        q_index: number;
        question_id: string;
        answer: string | null;
        skipped?: boolean;
      }[];
    },
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const userId = extractUserIdSafely(req, 'AssessmentController.finish');
    // console.log(body.responses);
    const summary = await this.svc.finish(
      userId,
      body.assessment_id,
      body.responses || [],
      token,
    );
    return summary;
  }

  @UseGuards(SupabaseGuard)
  @Get('latest')
  async latest(@Req() req: any) {
    const userId = extractUserIdSafely(req, 'AssessmentController.latest');
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const row = await this.svc.latest(userId, token);
    return { latest: row };
  }

  @UseGuards(SupabaseGuard)
  @Get('current')
  async current(@Req() req: any) {
    const userId = extractUserIdSafely(req, 'AssessmentController.current');
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const { session, responses } = await this.svc.getCurrentSession(
      userId,
      token,
    );
    return { session, responses };
  }

  @UseGuards(SupabaseGuard)
  @Post('resume')
  async resume(@Req() req: any, @Body() body: { session_id: string }) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const { session, responses } = await this.svc.resumeSession(
      body.session_id,
      token,
    );
    return { session, responses };
  }

  @UseGuards(SupabaseGuard)
  @Post('save-progress')
  async saveProgress(
    @Req() req: any,
    @Body()
    body: {
      session_id: string;
      position: number;
      responses: {
        q_index: number;
        question_id: string;
        answer_text: string | null;
        skipped: boolean;
      }[];
    },
  ) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    await this.svc.saveSessionProgress(
      body.session_id,
      body.position,
      body.responses,
      token,
    );
    return { success: true };
  }

  @UseGuards(SupabaseGuard)
  @Post('abandon')
  async abandon(@Req() req: any, @Body() body: { session_id: string }) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    await this.svc.abandonSession(body.session_id, token);
    return { success: true };
  }

  @UseGuards(SupabaseGuard)
  @Post('start-with-check')
  async startWithCheck(@Req() req: any) {
    const userId = extractUserIdSafely(
      req,
      'AssessmentController.startWithCheck',
    );
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const result = await this.svc.startWithSessionCheck(userId, token);
    return result;
  }
}
