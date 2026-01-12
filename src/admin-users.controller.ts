import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdminGuard } from './auth/admin.guard';
import { AdminUsersService } from './admin-users.service';
import type { CreateUserRequest, UpdateUserRequest } from './admin-users.types';
// console.log('imported admin user types');
@Controller('v1/admin/users')
@UseGuards(SupabaseGuard, AdminGuard)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  async getUsers(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '20',
    @Query('search') search?: string,
    @Query('role') role?: 'student' | 'teacher' | 'admin',
  ) {
    return this.adminUsersService.getUsers({
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      search,
      role,
    });
  }

  @Get('stats')
  async getUserStats() {
    return this.adminUsersService.getUserStats();
  }

  @Get(':id')
  async getUser(@Param('id') id: string) {
    return this.adminUsersService.getUser(id);
  }

  @Post()
  async createUser(@Body() createUserRequest: CreateUserRequest) {
    // console.log('create user admin controller');
    // console.log(createUserRequest);
    return this.adminUsersService.createUser(createUserRequest);
  }

  @Put(':id')
  async updateUser(
    @Param('id') id: string,
    @Body() updateUserRequest: UpdateUserRequest,
  ) {
    return this.adminUsersService.updateUser(id, updateUserRequest);
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return this.adminUsersService.deleteUser(id);
  }
}
