import { Injectable, BadRequestException } from '@nestjs/common';
import * as fs from 'fs';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

@Injectable()
export class FileExtractionService {
  async extractTextFromFile(
    filePath: string,
    fileName: string,
  ): Promise<string> {
    try {
      const fileExt = this.getFileExtension(fileName);

      switch (fileExt) {
        case '.pdf':
          return await this.extractPdf(filePath);
        case '.docx':
          return await this.extractDocx(filePath);
        case '.txt':
          return await this.extractText(filePath);
        default:
          throw new BadRequestException(
            `Unsupported file format: ${fileExt}. Supported formats: PDF, DOCX, TXT`,
          );
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to extract text from file: ${error.message}`,
      );
    }
  }

  private async extractPdf(filePath: string): Promise<string> {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(fileBuffer, {});

      if (!pdfData || !pdfData.text) {
        console.error('[extractPdf] No text extracted from PDF:', { pdfData });
        throw new BadRequestException('PDF file contains no extractable text');
      }

      const extractedText = pdfData.text.trim();
      if (extractedText.length === 0) {
        console.error('[extractPdf] Extracted text is empty');
        throw new BadRequestException('PDF file contains no extractable text');
      }

      return extractedText;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('[extractPdf] Error:', error);
      throw new BadRequestException(
        `Failed to parse PDF file: ${error.message}`,
      );
    }
  }

  private async extractDocx(filePath: string): Promise<string> {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: fileBuffer });

      if (!result.value || result.value.trim().length === 0) {
        throw new BadRequestException('DOCX file contains no extractable text');
      }

      return result.value.trim();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to parse DOCX file: ${error.message}`,
      );
    }
  }

  private async extractText(filePath: string): Promise<string> {
    try {
      const text = fs.readFileSync(filePath, 'utf-8');

      if (!text || text.trim().length === 0) {
        throw new BadRequestException('Text file is empty');
      }

      return text.trim();
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Failed to read text file: ${error.message}`,
      );
    }
  }

  private getFileExtension(fileName: string): string {
    const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
    if (!ext) {
      throw new BadRequestException('File has no extension');
    }
    return ext;
  }

  cleanupFile(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      console.error(`Failed to cleanup file ${filePath}:`, error);
    }
  }
}
