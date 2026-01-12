import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Headers,
  HttpStatus,
  HttpException,
  Patch,
} from '@nestjs/common';
import { GamificationService, ScopeXpContext } from './gamification.service';

@Controller('v1/gamification')
export class GamificationController {
  constructor(private readonly gamificationService: GamificationService) {}

  // Get user's gamification stats overview
  @Get('stats/:userId')
  async getUserStats(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getUserStats(userId, userToken);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get user's level progression information
  @Get('level-progression/:userId')
  async getLevelProgression(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getLevelProgression(
        userId,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get user's achievements
  @Get('achievements/:userId')
  async getUserAchievements(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getUserAchievements(
        userId,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get user's points history
  @Get('points/:userId')
  async getPointsHistory(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const pointsLimit = limit ? parseInt(limit) : 50;
      return await this.gamificationService.getPointsHistory(
        userId,
        pointsLimit,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Award points to user
  @Post('points/:userId')
  async awardPoints(
    @Param('userId') userId: string,
    @Body()
    body: {
      points: number;
      reason: string;
      referenceId?: string;
      referenceType?: string;
      scopes?: ScopeXpContext;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const result = await this.gamificationService.awardPoints(
        userId,
        body.points,
        body.reason,
        body.referenceId,
        body.referenceType,
        userToken,
        body.scopes,
      );

      return {
        success: true,
        message: 'Points awarded successfully',
        levelProgression: result,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Award achievement to user
  @Post('achievements/:userId')
  async awardAchievement(
    @Param('userId') userId: string,
    @Body() body: { achievementName: string; metadata?: any },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      await this.gamificationService.awardAchievement(
        userId,
        body.achievementName,
        body.metadata || {},
        userToken,
      );
      return { success: true, message: 'Achievement awarded successfully' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get daily challenges for user
  @Get('challenges/:userId')
  async getDailyChallenges(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getDailyChallenges(
        userId,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Update challenge progress
  @Post('challenges/:userId/:challengeId')
  async updateChallengeProgress(
    @Param('userId') userId: string,
    @Param('challengeId') challengeId: string,
    @Body() body: { progressIncrement: number },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      await this.gamificationService.updateChallengeProgress(
        userId,
        challengeId,
        body.progressIncrement,
        userToken,
      );
      return { success: true, message: 'Challenge progress updated' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get leaderboard
  @Get('leaderboard/:leaderboardName')
  async getLeaderboard(
    @Param('leaderboardName') leaderboardName: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const leaderboardLimit = limit ? parseInt(limit) : 100;
      return await this.gamificationService.getLeaderboard(
        leaderboardName,
        leaderboardLimit,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get user badges
  @Get('badges/:userId')
  async getUserBadges(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getUserBadges(userId, userToken);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('badge-catalog')
  async getBadgeCatalog(@Headers('authorization') authHeader?: string) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.getBadgeCatalog(userToken);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('badges/:userId')
  async awardBadgeToUser(
    @Param('userId') userId: string,
    @Body()
    body: {
      badgeCode: string;
      reason?: string;
      referenceId?: string;
      referenceType?: string;
      metadata?: any;
      allowRepeat?: boolean;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      return await this.gamificationService.awardBadge(
        userId,
        body.badgeCode,
        userToken,
        {
          reason: body.reason,
          referenceId: body.referenceId,
          referenceType: body.referenceType,
          metadata: body.metadata,
          allowRepeat: body.allowRepeat,
        },
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Record user activity
  @Post('activity/:userId')
  async recordActivity(
    @Param('userId') userId: string,
    @Body()
    body: {
      activityType: string;
      referenceId?: string;
      referenceType?: string;
      durationMinutes?: number;
    },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const activityResult = await this.gamificationService.recordActivity(
        userId,
        body.activityType,
        body.referenceId,
        body.referenceType,
        body.durationMinutes,
        userToken,
      );
      return {
        ...activityResult,
        message: 'Activity recorded successfully',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Update learning streak
  @Post('streak/:userId')
  async updateLearningStreak(
    @Param('userId') userId: string,
    @Body() body: { streakType?: string },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const streakResult =
        await this.gamificationService.updateDailyLoginStreakSimple(
          userId,
          userToken,
        );
      return {
        success: true,
        streak: streakResult,
        message: streakResult?.updated_today
          ? 'Learning streak updated'
          : 'Streak already counted for today',
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Get user notifications
  @Get('notifications/:userId')
  async getNotifications(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const notificationLimit = limit ? parseInt(limit) : 50;
      return await this.gamificationService.getNotifications(
        userId,
        notificationLimit,
        userToken,
      );
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Mark notifications as read
  @Patch('notifications/:userId/read')
  async markNotificationsRead(
    @Param('userId') userId: string,
    @Body() body: { notificationIds: string[] },
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      await this.gamificationService.markNotificationsRead(
        userId,
        body.notificationIds,
        userToken,
      );
      return { success: true, message: 'Notifications marked as read' };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Gamification dashboard data (combines multiple endpoints)
  @Get('dashboard/:userId')
  async getGamificationDashboard(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');

      // Fetch multiple data points in parallel
      const [
        stats,
        achievements,
        dailyChallenges,
        badges,
        notifications,
        pointsHistory,
        insights,
      ] = await Promise.all([
        this.gamificationService.getUserStats(userId, userToken),
        this.gamificationService.getUserAchievements(userId, userToken),
        this.gamificationService.getDailyChallenges(userId, userToken),
        this.gamificationService.getUserBadges(userId, userToken),
        this.gamificationService.getNotifications(userId, 10, userToken),
        this.gamificationService.getPointsHistory(userId, 10, userToken),
        this.gamificationService.generateUserInsights(userId, userToken),
      ]);

      return {
        stats,
        recent_achievements: achievements.slice(0, 5),
        daily_challenges: dailyChallenges,
        recent_badges: badges.slice(0, 5),
        unread_notifications: notifications.filter((n: any) => !n.is_read),
        recent_points: pointsHistory,
        insights,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Generate fresh daily challenges for a user
  @Post('challenges/refresh/:userId')
  async refreshDailyChallenges(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const refreshedChallenges =
        await this.gamificationService.refreshDailyChallenges(
          userId,
          userToken,
        );
      return {
        success: true,
        message: 'Daily challenges refreshed',
        challenges: refreshedChallenges,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  // Manually trigger level progression check (for admin/debugging)
  @Post('levels/check/:userId')
  async checkLevelProgression(
    @Param('userId') userId: string,
    @Headers('authorization') authHeader?: string,
  ) {
    try {
      const userToken = authHeader?.replace('Bearer ', '');
      const stats = await this.gamificationService.getUserStats(
        userId,
        userToken,
      );
      const result =
        await this.gamificationService.checkAndUpdateLevelProgression(
          userId,
          stats.total_points,
          stats.current_level,
          userToken,
        );
      return {
        success: true,
        message: 'Level progression checked',
        result,
      };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
