import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';
import { throwError } from 'rxjs';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const { method, url, headers, body, user } = request;

    const startTime = Date.now();
    const requestId = this.generateRequestId();

    // Log incoming request with detailed information
    // this.logger.log(
    //   `[${requestId}] ${method} ${url} - Request started`,
    //   {
    //     method,
    //     url,
    //     userAgent: headers['user-agent'],
    //     contentType: headers['content-type'],
    //     authorization: headers.authorization ? 'Bearer [REDACTED]' : 'None',
    //     hasUser: !!user,
    //     userId: user?.id || user?.sub || 'Not found',
    //     userRole: user?.role || 'Not specified',
    //     bodyKeys: body ? Object.keys(body) : [],
    //     timestamp: new Date().toISOString(),
    //   }
    // );

    return next.handle().pipe(
      tap((data) => {
        const duration = Date.now() - startTime;
        // this.logger.log(
        //   `[${requestId}] ${method} ${url} - ${response.statusCode} - ${duration}ms`,
        //   {
        //     statusCode: response.statusCode,
        //     duration,
        //     responseDataType: typeof data,
        //     hasResponseData: !!data,
        //   }
        // );
      }),
      catchError((error) => {
        const duration = Date.now() - startTime;
        // this.logger.error(
        //   `[${requestId}] ${method} ${url} - ERROR - ${duration}ms`,
        //   {
        //     error: error.message,
        //     stack: error.stack,
        //     statusCode: error.status || 500,
        //     duration,
        //     userId: user?.id || user?.sub || 'Not found',
        //     userObject: user ? JSON.stringify(user, null, 2) : 'No user object',
        //     requestBody: body ? JSON.stringify(body, null, 2) : 'No body',
        //     timestamp: new Date().toISOString(),
        //   }
        // );
        return throwError(() => error);
      }),
    );
  }

  private generateRequestId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}
