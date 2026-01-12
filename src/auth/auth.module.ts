import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SupabaseGuard } from './supabase.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';
import { UserAuthController } from './user-auth.controller';
import { UserAuthService } from './user-auth.service';
import { GamificationService } from '../gamification.service';

@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET,
      signOptions: { expiresIn: '24h' },
    }),
  ],
  controllers: [AdminAuthController, UserAuthController],
  providers: [
    SupabaseGuard,
    AdminAuthService,
    UserAuthService,
    GamificationService,
  ],
  exports: [SupabaseGuard, AdminAuthService, UserAuthService, JwtModule],
})
export class AuthModule {}
