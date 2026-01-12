import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import type { Session as SupabaseSession } from '@supabase/supabase-js';

export class UserLoginDto {
  @ApiProperty({
    example: 'user@example.com',
    description: 'The email address',
  })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'password123', description: 'The password' })
  @IsString()
  @MinLength(6)
  password: string;
}

export class UserLoginResponseDto {
  @ApiProperty()
  access_token: string;

  @ApiProperty()
  token_type: string;

  @ApiProperty()
  expires_in: number;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    role: 'admin' | 'student';
  };

  @ApiProperty({
    type: Object,
    description: 'Supabase auth session payload',
    required: false,
  })
  supabase_session?: SupabaseSession | null;
}
