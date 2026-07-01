import { Injectable, InternalServerErrorException } from '@nestjs/common';

export type Judge0ExecutionResult = {
  stdout: string;
  stderr: string;
  compileOutput: string;
  message: string;
  executionTimeMs: number;
  memoryKb: number;
  exitCode: number;
  statusId: number;
  statusDescription: string;
  verdict:
    | 'accepted'
    | 'wrong_answer'
    | 'time_limit'
    | 'compile_error'
    | 'runtime_error'
    | 'internal_error';
};

type PistonRunResult = {
  stdout: string;
  stderr: string;
  output: string;
  code: number | null;
  signal: string | null;
};

type PistonResponse = {
  language: string;
  version: string;
  run: PistonRunResult;
  compile?: PistonRunResult;
};

type Judge0Status = { id: number; description: string };
type Judge0ResultResponse = {
  stdout?: string | null;
  stderr?: string | null;
  compile_output?: string | null;
  message?: string | null;
  time?: string | number | null;
  memory?: number | null;
  status?: Judge0Status | null;
  exit_code?: number | null;
};

@Injectable()
export class Judge0Service {
  private readonly executor: 'piston' | 'judge0';
  private readonly judge0BaseUrl: string;
  private readonly judge0AuthToken: string;
  private readonly pistonUrl = 'https://emkc.org/api/v2/piston/execute';

  private readonly judge0LanguageMap: Record<string, number> = {
    python: 71,
    java: 62,
    c: 50,
    cpp: 54,
    javascript: 63,
    sql: 82,
  };

  private readonly judge0Policy: Record<
    string,
    { cpuTimeLimitSeconds: number; wallTimeLimitSeconds: number; memoryLimitKb: number }
  > = {
    python: { cpuTimeLimitSeconds: 3, wallTimeLimitSeconds: 5, memoryLimitKb: 256000 },
    javascript: { cpuTimeLimitSeconds: 3, wallTimeLimitSeconds: 5, memoryLimitKb: 256000 },
    c: { cpuTimeLimitSeconds: 2, wallTimeLimitSeconds: 4, memoryLimitKb: 192000 },
    cpp: { cpuTimeLimitSeconds: 2, wallTimeLimitSeconds: 4, memoryLimitKb: 192000 },
    java: { cpuTimeLimitSeconds: 4, wallTimeLimitSeconds: 7, memoryLimitKb: 384000 },
    sql: { cpuTimeLimitSeconds: 3, wallTimeLimitSeconds: 5, memoryLimitKb: 256000 },
  };

  private readonly pistonLanguageMap: Record<string, { language: string; extension: string }> = {
    python: { language: 'python', extension: 'py' },
    javascript: { language: 'javascript', extension: 'js' },
    java: { language: 'java', extension: 'java' },
    c: { language: 'c', extension: 'c' },
    cpp: { language: 'c++', extension: 'cpp' },
  };

  constructor() {
    const rawExecutor = (process.env.EXECUTOR || 'judge0').trim().toLowerCase();
    this.executor = rawExecutor === 'piston' ? 'piston' : 'judge0';
    this.judge0BaseUrl = process.env.JUDGE0_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:2358';
    this.judge0AuthToken = process.env.JUDGE0_AUTH_TOKEN || '';
    console.log(`[Judge0Service] executor=${this.executor}`);
  }

  async execute(language: string, sourceCode: string, stdin: string): Promise<Judge0ExecutionResult> {
    const normalized = this.normalizeLanguage(language);
    return this.executor === 'piston'
      ? this.executeWithPiston(normalized, sourceCode, stdin)
      : this.executeWithJudge0(normalized, sourceCode, stdin);
  }

  private async executeWithPiston(
    language: string,
    sourceCode: string,
    stdin: string,
  ): Promise<Judge0ExecutionResult> {
    const mapping = this.pistonLanguageMap[language];
    if (!mapping) {
      throw new InternalServerErrorException(`Unsupported language for Piston: ${language}`);
    }

    let response: Response;
    try {
      response = await fetch(this.pistonUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          language: mapping.language,
          version: '*',
          files: [{ name: `main.${mapping.extension}`, content: sourceCode }],
          stdin: stdin ?? '',
        }),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      throw new InternalServerErrorException(`Piston request failed: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new InternalServerErrorException(`Piston returned ${response.status}: ${text}`);
    }

    const data = (await response.json()) as PistonResponse;
    const run = data.run;
    const compile = data.compile;
    const compileOutput = compile && compile.code !== 0 ? compile.stderr || compile.output || '' : '';
    const stdout = run?.stdout ?? '';
    const stderr = run?.stderr ?? '';
    const exitCode = run?.code ?? 0;
    const verdict = this.pistonVerdict(exitCode, run?.signal, compileOutput, stderr);

    return {
      stdout,
      stderr,
      compileOutput,
      message: run?.signal ?? '',
      executionTimeMs: 0,
      memoryKb: 0,
      exitCode,
      statusId: verdict === 'accepted' ? 3 : 0,
      statusDescription: verdict,
      verdict,
    };
  }

  private async executeWithJudge0(
    language: string,
    sourceCode: string,
    stdin: string,
  ): Promise<Judge0ExecutionResult> {
    const languageId = this.judge0LanguageMap[language];
    if (!languageId) {
      throw new InternalServerErrorException(`Unsupported language for Judge0: ${language}`);
    }

    const policy = this.judge0Policy[language] ?? this.judge0Policy.python;
    const data = await this.judge0RunSync({
      language_id: languageId,
      source_code: sourceCode,
      stdin,
      cpu_time_limit: policy.cpuTimeLimitSeconds,
      wall_time_limit: policy.wallTimeLimitSeconds,
      memory_limit: policy.memoryLimitKb,
    });
    const statusId = data?.status?.id ?? 0;

    return {
      stdout: data.stdout ?? '',
      stderr: data.stderr ?? '',
      compileOutput: data.compile_output ?? '',
      message: data.message ?? '',
      executionTimeMs: this.parseTimeToMs(data.time),
      memoryKb: data.memory ?? 0,
      exitCode: data.exit_code ?? 0,
      statusId,
      statusDescription: data?.status?.description ?? 'Unknown',
      verdict: this.judge0Verdict(statusId),
    };
  }

  private async judge0RunSync(payload: {
    language_id: number;
    source_code: string;
    stdin: string;
    cpu_time_limit: number;
    wall_time_limit: number;
    memory_limit: number;
  }): Promise<Judge0ResultResponse> {
    const response = await fetch(`${this.judge0BaseUrl}/submissions?base64_encoded=false&wait=true`, {
      method: 'POST',
      headers: this.judge0Headers(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new InternalServerErrorException(`Judge0 execute failed: ${response.status} ${text}`);
    }

    return (await response.json()) as Judge0ResultResponse;
  }

  private pistonVerdict(
    exitCode: number,
    signal: string | null | undefined,
    compileOutput: string,
    stderr: string,
  ): Judge0ExecutionResult['verdict'] {
    if (compileOutput) return 'compile_error';
    if (signal === 'SIGKILL') return 'time_limit';
    if (exitCode !== 0 && stderr) return 'runtime_error';
    if (exitCode !== 0) return 'runtime_error';
    return 'accepted';
  }

  private judge0Verdict(statusId: number): Judge0ExecutionResult['verdict'] {
    switch (statusId) {
      case 3:
        return 'accepted';
      case 4:
        return 'wrong_answer';
      case 5:
        return 'time_limit';
      case 6:
        return 'compile_error';
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 14:
        return 'runtime_error';
      default:
        return 'internal_error';
    }
  }

  private judge0Headers(): Record<string, string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.judge0AuthToken) {
      headers['X-Auth-Token'] = this.judge0AuthToken;
    }
    return headers;
  }

  private normalizeLanguage(language: string): string {
    const value = String(language || '').trim().toLowerCase();
    if (value === 'py' || value === 'python3') return 'python';
    if (value === 'c++') return 'cpp';
    if (value === 'js' || value === 'node' || value === 'nodejs') return 'javascript';
    return value;
  }

  private parseTimeToMs(value: string | number | null | undefined): number {
    if (typeof value === 'number') return Math.round(value * 1000);
    if (typeof value === 'string') {
      const numeric = Number(value);
      if (!Number.isNaN(numeric)) return Math.round(numeric * 1000);
    }
    return 0;
  }
}
