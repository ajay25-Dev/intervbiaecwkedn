import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { constants } from 'fs';

@Injectable()
export class UploadsMiddleware implements NestMiddleware {
  async use(req: Request, res: Response, next: NextFunction) {
    const urlPath = req.path;

    // Check if this is a request for an uploaded file
    if (urlPath.startsWith('/uploads/assessments/')) {
      const fileName = urlPath.split('/').pop();
      if (!fileName) {
        res.status(400).json({ error: 'Invalid file name' });
        return;
      }

      const filePath = join(process.cwd(), 'uploads', 'assessments', fileName);

      try {
        // Check if file exists before trying to read it
        await access(filePath, constants.F_OK);
        const fileBuffer = await readFile(filePath);

        // Set appropriate content type based on file extension
        const extension = fileName.split('.').pop()?.toLowerCase();
        const contentType = this.getContentType(extension || 'bin');

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
        res.send(fileBuffer);
      } catch (error) {
        console.warn(`File not found: ${filePath}`, error);
        res.status(404).json({
          error: 'File not found',
          message:
            'Uploaded files may not persist in serverless environments like Vercel or Railway. Consider using cloud storage.',
        });
      }
    } else {
      next();
    }
  }

  private getContentType(extension: string): string {
    const mimeTypes: { [key: string]: string } = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      svg: 'image/svg+xml',
      bin: 'application/octet-stream',
    };

    return mimeTypes[extension] || 'application/octet-stream';
  }
}
