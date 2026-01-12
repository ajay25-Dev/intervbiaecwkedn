import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SupabaseGuard } from './auth/supabase.guard';
import { LecturesService } from './lectures.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiConsumes,
} from '@nestjs/swagger';
import { diskStorage } from 'multer';
import { extname } from 'path';

export interface CreateLectureDto {
  title: string;
  content?: string;
  video_url?: string;
  duration_minutes?: number;
  order_index?: number;
  status?: 'draft' | 'published' | 'archived';
  attachments?: Array<{
    name: string;
    url: string;
    type: 'pdf' | 'video' | 'audio' | 'image' | 'document';
    size?: number;
  }>;
  learning_objectives?: string[];
  prerequisites?: string[];
  tags?: string[];
}

export interface UpdateLectureDto {
  title?: string;
  content?: string;
  video_url?: string;
  duration_minutes?: number;
  order_index?: number;
  status?: 'draft' | 'published' | 'archived';
  attachments?: Array<{
    name: string;
    url: string;
    type: 'pdf' | 'video' | 'audio' | 'image' | 'document';
    size?: number;
  }>;
  learning_objectives?: string[];
  prerequisites?: string[];
  tags?: string[];
}

@ApiTags('Lectures')
@Controller('v1/admin/lectures')
@UseGuards(SupabaseGuard)
export class LecturesController {
  constructor(private readonly lecturesService: LecturesService) {}

  @ApiOperation({ summary: 'Get all lectures for a section' })
  @ApiResponse({
    status: 200,
    description: 'List of lectures retrieved successfully',
  })
  @Get('section/:sectionId')
  async getLecturesBySection(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
  ) {
    await this.ensureAdmin(req);
    return this.lecturesService.getLecturesBySection(sectionId);
  }

  @ApiOperation({ summary: 'Create a new lecture for a section' })
  @ApiResponse({ status: 201, description: 'Lecture created successfully' })
  @Post('section/:sectionId')
  async createLecture(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() createLectureDto: CreateLectureDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.createLecture(
      sectionId,
      createLectureDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Upload lecture video file' })
  @ApiConsumes('multipart/form-data')
  @Post('section/:sectionId/upload-video')
  @UseInterceptors(
    FileInterceptor('video', {
      storage: diskStorage({
        destination: './uploads/lectures/videos',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            `lecture-video-${uniqueSuffix}${extname(file.originalname)}`,
          );
        },
      }),
      fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('video/')) {
          cb(null, true);
        } else {
          cb(new Error('Only video files are allowed'), false);
        }
      },
      limits: {
        fileSize: 500 * 1024 * 1024, // 500MB limit
      },
    }),
  )
  async uploadLectureVideo(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { title: string; description?: string },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    const lectureData: CreateLectureDto = {
      title: body.title,
      content: body.description,
      video_url: `/uploads/lectures/videos/${file.filename}`,
      attachments: [
        {
          name: file.originalname,
          url: `/uploads/lectures/videos/${file.filename}`,
          type: 'video',
          size: file.size,
        },
      ],
    };

    return this.lecturesService.createLecture(sectionId, lectureData, token);
  }

  @ApiOperation({ summary: 'Upload lecture attachment' })
  @ApiConsumes('multipart/form-data')
  @Post(':lectureId/upload-attachment')
  @UseInterceptors(
    FileInterceptor('attachment', {
      storage: diskStorage({
        destination: './uploads/lectures/attachments',
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(
            null,
            `lecture-attachment-${uniqueSuffix}${extname(file.originalname)}`,
          );
        },
      }),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
      },
    }),
  )
  async uploadLectureAttachment(
    @Req() req: any,
    @Param('lectureId') lectureId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { type?: string },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');

    const attachment = {
      name: file.originalname,
      url: `/uploads/lectures/attachments/${file.filename}`,
      type: body.type || this.getFileType(file.mimetype),
      size: file.size,
    };

    return this.lecturesService.addAttachment(lectureId, attachment, token);
  }

  @ApiOperation({ summary: 'Get lecture by ID' })
  @ApiResponse({ status: 200, description: 'Lecture retrieved successfully' })
  @Get(':lectureId')
  async getLecture(@Req() req: any, @Param('lectureId') lectureId: string) {
    await this.ensureAdmin(req);
    return this.lecturesService.getLecture(lectureId);
  }

  @ApiOperation({ summary: 'Update lecture' })
  @ApiResponse({ status: 200, description: 'Lecture updated successfully' })
  @Put(':lectureId')
  async updateLecture(
    @Req() req: any,
    @Param('lectureId') lectureId: string,
    @Body() updateLectureDto: UpdateLectureDto,
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.updateLecture(
      lectureId,
      updateLectureDto,
      token,
    );
  }

  @ApiOperation({ summary: 'Delete lecture' })
  @ApiResponse({ status: 200, description: 'Lecture deleted successfully' })
  @Delete(':lectureId')
  async deleteLecture(@Req() req: any, @Param('lectureId') lectureId: string) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.deleteLecture(lectureId, token);
  }

  @ApiOperation({ summary: 'Reorder lectures in section' })
  @Put('section/:sectionId/reorder')
  async reorderLectures(
    @Req() req: any,
    @Param('sectionId') sectionId: string,
    @Body() body: { lectureIds: string[] },
  ) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.reorderLectures(
      sectionId,
      body.lectureIds,
      token,
    );
  }

  @ApiOperation({ summary: 'Publish lecture' })
  @Post(':lectureId/publish')
  async publishLecture(@Req() req: any, @Param('lectureId') lectureId: string) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.updateLecture(
      lectureId,
      { status: 'published' },
      token,
    );
  }

  @ApiOperation({ summary: 'Archive lecture' })
  @Post(':lectureId/archive')
  async archiveLecture(@Req() req: any, @Param('lectureId') lectureId: string) {
    await this.ensureAdmin(req);
    const token = req.headers.authorization?.replace('Bearer ', '');
    return this.lecturesService.updateLecture(
      lectureId,
      { status: 'archived' },
      token,
    );
  }

  private async ensureAdmin(req: any): Promise<void> {
    const user = req.user;
    if (!user || user.role !== 'admin') {
      throw new Error('Admin access required');
    }
  }

  private getFileType(
    mimetype: string,
  ): 'pdf' | 'video' | 'audio' | 'image' | 'document' {
    if (mimetype.startsWith('video/')) return 'video';
    if (mimetype.startsWith('audio/')) return 'audio';
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype === 'application/pdf') return 'pdf';
    return 'document';
  }
}
