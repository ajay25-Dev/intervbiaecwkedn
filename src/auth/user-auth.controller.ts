import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { UserAuthService } from './user-auth.service';
import { UserLoginDto, UserLoginResponseDto } from './user-auth.dto';

@ApiTags('User Authentication')
@Controller('v1/auth')
@UsePipes(new ValidationPipe({ transform: true }))
export class UserAuthController {
  constructor(private readonly userAuthService: UserAuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'User login',
    description: 'Authenticate user and return bearer token',
  })
  @ApiBody({
    type: UserLoginDto,
    examples: {
      example1: {
        summary: 'User login example',
        value: {
          email: 'user@example.com',
          password: 'password123',
        },
      },
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful',
    type: UserLoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials',
    schema: {
      example: {
        message: 'Invalid credentials',
      },
    },
  })
  async login(
    @Body() userLoginDto: UserLoginDto,
  ): Promise<UserLoginResponseDto> {
    return await this.userAuthService.login(userLoginDto);
  }
}
