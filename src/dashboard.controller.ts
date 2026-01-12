import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { ProfilesService } from './profiles.service';
import { GamificationSummaryService } from './gamification-v2/gamification-summary.service';
import { GamificationService } from './gamification.service';
import { LearningPathService } from './learning-path.service';

@Controller('v1')
export class DashboardController {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly gamificationSummary: GamificationSummaryService,
    private readonly gamification: GamificationService,
    private readonly learningPaths: LearningPathService,
  ) {}

  @UseGuards(SupabaseGuard)
  @Get('dashboard')
  async dashboard(@Req() req: any) {
    const token = (req.headers.authorization as string | undefined)?.replace(
      /^Bearer\s+/i,
      '',
    );
    const profile = await this.profiles.ensureProfile(req.user.sub, token);
    const role = profile.role ?? 'student';
    const displayName = req.user.email?.split('@')[0] ?? 'Learner';

    if (role === 'admin') {
      return {
        role,
        user: { id: req.user.sub, displayName },
        panels: ['Org Health', 'User Growth', 'System Metrics'],
      };
    }
    if (role === 'teacher') {
      return {
        role,
        user: { id: req.user.sub, displayName },
        panels: ['Cohorts', 'Assignments', 'Progress'],
      };
    }
    const subjectProgressPromise = token
      ? this.learningPaths.getSubjectProgressOverview(token).catch(() => [])
      : Promise.resolve([]);

    const [
      gamificationStats,
      leaderboardEntries,
      recentActivity,
      subjectProgress,
    ] = await Promise.all([
      this.gamificationSummary.getUserSummary(req.user.sub).catch(() => null),
      this.gamificationSummary.getLeaderboardTop(10).catch(() => []),
      this.gamification
        .getPointsHistory(req.user.sub, 10, token)
        .catch(() => []),
      subjectProgressPromise,
    ]);

    const leaderboardPosition =
      leaderboardEntries.find(
        (entry: { userId: string }) => entry.userId === req.user.sub,
      )?.rank ?? null;

    const completionFromSubjects = Array.isArray(subjectProgress)
      ? subjectProgress
          .map((subject) => {
            const name =
              typeof subject?.subject_title === 'string' &&
              subject.subject_title.trim().length > 0
                ? subject.subject_title.trim()
                : typeof subject?.subject_id === 'string' &&
                    subject.subject_id.trim().length > 0
                  ? subject.subject_id.trim()
                  : 'Subject';
            const rawValue = Number(subject?.average_percentage ?? 0);
            const value = Math.max(0, Math.min(100, rawValue));
            return { name, value };
          })
          .filter(
            (entry) =>
              Number.isFinite(entry.value) &&
              entry.value >= 0 &&
              entry.value <= 100,
          )
      : [];

    return {
      role,
      user: { id: req.user.sub, displayName },
      stats: {
        xp: gamificationStats?.totalXp ?? 0,
        streakDays: gamificationStats?.streakDays ?? 0,
        tier: gamificationStats?.tier ?? 'Bronze',
        level: gamificationStats?.level ?? 1,
        levelProgressPercent: gamificationStats?.levelProgressPercent ?? 0,
      },
      streakCalendar: gamificationStats?.streakCalendar ?? [],
      leaderboardPosition,
      leaderboardEntries,
      nextActions: [
        { label: 'Resume last lesson', href: '/lessons/123' },
        { label: 'Daily review pack', href: '/reviews/today' },
        { label: 'Generate case study', href: '/assignments/new' },
      ],
      badges: [
        { name: '7-Day Streak', earnedAt: new Date().toISOString() },
        { name: 'SQL Novice', earnedAt: new Date().toISOString() },
        { name: 'Quiz Whiz', earnedAt: new Date().toISOString() },
      ],
      history: Array.isArray(recentActivity)
        ? recentActivity.map((entry) => ({
            date: entry.created_at,
            action: entry.reason ?? 'XP Update',
            xp: entry.points_change ?? 0,
          }))
        : [],
      weeklyXp: [
        { week: 'W1', XP: 820 },
        { week: 'W2', XP: 1040 },
        { week: 'W3', XP: 660 },
        { week: 'W4', XP: 900 },
      ],
      completion:
        completionFromSubjects.length > 0
          ? completionFromSubjects
          : [
              { name: 'SQL', value: 65 },
              { name: 'Statistics', value: 40 },
              { name: 'Python', value: 20 },
            ],
      learningProgress: subjectProgress || [],
    };
  }
}
