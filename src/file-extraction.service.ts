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
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Failed to extract text from file: ${error instanceof Error ? error.message : String(error)}`);
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

      const raw = pdfData.text.trim();
      if (raw.length === 0) {
        console.error('[extractPdf] Extracted text is empty');
        throw new BadRequestException('PDF file contains no extractable text');
      }

      return this.cleanExtractedText(raw);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('[extractPdf] Error:', error);
      throw new BadRequestException(`Failed to parse PDF file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Post-processes raw text from pdf-parse / mammoth to restore readable structure.
   * pdf-parse collapses line breaks, merges bullets, and creates run-on paragraphs.
   */
  private cleanExtractedText(raw: string): string {
    let text = raw;

    // Normalize line endings
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Fix hyphenated word-wrap (e.g. "optimiz-\nation" → "optimization")
    text = text.replace(/(\w)-\n(\w)/g, '$1$2');

    // Emoji → replacement box: pdf-parse converts emoji (📍🎯💻🏢 etc.) to □ or similar box chars.
    // Treat inline □ / ■ / ▪ / replacement chars (U+FFFD, U+25A1, U+25AA, U+25AB) as line separators.
    // Pattern: word/punctuation, optional space, box char, optional space → newline
    text = text.replace(/([^\n])\s*[□▪▫◽◾�☐☑☒]\s*/g, '$1\n');

    // Strip any remaining isolated box/replacement characters at start of line
    text = text.replace(/^[□▪▫◽◾�☐☑☒]\s*/gm, '');

    // Restore line break before bullet/list symbols that got concatenated
    // e.g. "some text• next item" → "some text\n• next item"
    text = text.replace(/([^\n])\s*([•●▪▸►◆◉○·])\s*/g, '$1\n$2 ');

    // Restore line break before common section headers that got merged
    // e.g. "...last sentence.About us:" → "...last sentence.\nAbout us:"
    text = text.replace(/([.!?])\s+([A-Z][a-zA-Z &/,-]{2,40}:)/g, '$1\n\n$2');

    // Restore line break before lines that are ALL CAPS (section headings)
    text = text.replace(/([a-z.!?])\s+([A-Z]{4,}[\s:]\w)/g, '$1\n\n$2');

    // Collapse multiple spaces/tabs into a single space (but keep newlines)
    text = text.replace(/[ \t]{2,}/g, ' ');

    // Split into lines, trim each, drop blank-only lines
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    const result: string[] = [];
    const isBulletLine = (l: string) => /^[-•●▪▸►◆◉○·]\s/.test(l);
    const isHeadingLine = (l: string) =>
      /:$/.test(l) ||
      /^[A-Z][A-Z\s&/,.-]{3,60}$/.test(l) ||
      /^(About|Responsibilities|Requirements|Qualifications|Skills|Location|Experience|Role|Benefits|What we|Join us|Why)/i.test(l);

    for (const line of lines) {
      // Normalize all bullet variants to "• "
      const cleanLine = line.replace(/^[●▪▸►◆◉○·]\s*/, '• ');

      const prev = result[result.length - 1];
      if (!prev) {
        result.push(cleanLine);
        continue;
      }

      // Always put bullets, headings, and lines after headings on their own line
      if (isBulletLine(cleanLine) || isHeadingLine(cleanLine) || isHeadingLine(prev)) {
        result.push('');
        result.push(cleanLine);
        continue;
      }

      // If previous line ends with a sentence terminator, start a new paragraph
      if (/[.!?]$/.test(prev)) {
        result.push(cleanLine);
        continue;
      }

      // Otherwise merge continuation lines (PDF wraps long lines)
      result[result.length - 1] = `${prev} ${cleanLine}`;
    }

    // Collapse 3+ consecutive blank lines to 1
    return result.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  private async extractDocx(filePath: string): Promise<string> {
    try {
      const fileBuffer = fs.readFileSync(filePath);
      const result = await mammoth.extractRawText({ buffer: fileBuffer });

      if (!result.value || result.value.trim().length === 0) {
        throw new BadRequestException('DOCX file contains no extractable text');
      }

      return this.cleanExtractedText(result.value.trim());
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Failed to parse DOCX file: ${error instanceof Error ? error.message : String(error)}`);
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
      if (error instanceof BadRequestException) throw error;
      throw new BadRequestException(`Failed to read text file: ${error instanceof Error ? error.message : String(error)}`);
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
