import { BadRequestException, Injectable } from '@nestjs/common';

const blockedPatterns = [
  /\bdrop\b/i,
  /\balter\s+(database|role|user|system|extension|schema)\b/i,
  /\bcreate\b/i,
  /\btruncate\b/i,
  /\bcopy\b/i,
  /\bgrant\b/i,
  /\brevoke\b/i,
  /\bexecute\b/i,
  /\bcall\b/i,
  /\bdo\b/i,
  /\bmerge\b/i,
  /\breset\b/i,
  /\bprepare\b/i,
  /\bdeallocate\b/i,
  /\bnotify\b/i,
  /\blisten\b/i,
  /\bunlisten\b/i,
  /\bvacuum\b/i,
  /\banalyze\b/i,
  /\bexplain\s+analyze\b/i,
];

@Injectable()
export class InterviewSqlSafetyService {
  assertSafeQuery(query: string): string {
    const normalized = query.trim();

    if (!normalized) throw new BadRequestException('SQL query is required');
    if (normalized.length > 20000) {
      throw new BadRequestException('SQL query is too large (max 20KB)');
    }

    const sanitized = this.stripCommentsAndStrings(normalized);

    if (!/^(select|with|insert|update|delete|alter)\b/i.test(sanitized.trim())) {
      throw new BadRequestException(
        'Only SELECT/WITH/INSERT/UPDATE/DELETE/ALTER queries are allowed',
      );
    }

    if (this.hasMultipleStatements(sanitized)) {
      throw new BadRequestException('Multiple SQL statements are not allowed');
    }

    const blocked = blockedPatterns.find((pattern) => pattern.test(sanitized));
    if (blocked) {
      throw new BadRequestException('This SQL operation is not allowed');
    }

    return normalized.replace(/;+\s*$/g, '');
  }

  shouldApplyRowLimit(query: string): boolean {
    const sanitized = this.stripCommentsAndStrings(query).trim();
    return /^select\b/i.test(sanitized);
  }

  private hasMultipleStatements(query: string): boolean {
    const parts = query
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean);
    return parts.length > 1;
  }

  private stripCommentsAndStrings(query: string): string {
    return query
      .replace(/--.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\$\$[\s\S]*?\$\$/g, '$$')
      .replace(/'([^']|'')*'/g, "''")
      .replace(/"([^"]|"")*"/g, '""');
  }
}
