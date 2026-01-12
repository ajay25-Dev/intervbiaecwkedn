import {
  Controller,
  Post,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { SupabaseGuard } from './auth/supabase.guard';
import { AdminGuard } from './auth/admin.guard';
import { BulkUserImportService } from './bulk-user-import.service';
import { BulkUserImportResult } from './bulk-user-import.types';
import { extractUserIdSafely } from './utils/user-id.util';

@Controller('v1/admin/users')
@UseGuards(SupabaseGuard, AdminGuard)
export class BulkUserImportController {
  constructor(private readonly bulkUserImportService: BulkUserImportService) {}

  @Post('bulk-import')
  @UseInterceptors(
    FileInterceptor('csvFile', {
      storage: diskStorage({
        destination: './uploads/users',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `user-import-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.originalname.match(/\.(csv)$/)) {
          return cb(
            new BadRequestException('Only CSV files are allowed!'),
            false,
          );
        }
        cb(null, true);
      },
    }),
  )
  async bulkImportUsers(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: any,
  ): Promise<BulkUserImportResult> {
    if (!file) {
      throw new BadRequestException('No CSV file uploaded');
    }

    try {
      // Create uploads/users directory if it doesn't exist
      const fs = require('fs');
      const uploadDir = './uploads/users';
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }

      const assignedBy = extractUserIdSafely(req);

      return await this.bulkUserImportService.importUsersFromCsv(
        file.path,
        assignedBy,
      );
    } catch (error) {
      throw new BadRequestException(
        `Failed to process bulk import: ${error.message}`,
      );
    }
  }
}
