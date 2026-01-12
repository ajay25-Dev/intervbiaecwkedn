import { BadRequestException, Logger } from '@nestjs/common';

/**
 * Safely extracts user ID from request object with comprehensive error handling
 * @param request - Express request object with user attached by authentication guard
 * @param context - Context string for logging (e.g., controller name, method name)
 * @returns User ID string
 * @throws BadRequestException if user ID cannot be extracted
 */
export function extractUserIdSafely(
  request: any,
  context: string = 'Unknown',
): string {
  const logger = new Logger('UserIdExtractor');

  try {
    // Log the extraction attempt
    logger.log({
      message: `Attempting to extract user ID`,
      context,
      timestamp: new Date().toISOString(),
      hasUser: !!request.user,
      userKeys: request.user ? Object.keys(request.user) : [],
    });

    // Check if user object exists
    if (!request.user) {
      logger.error({
        message: 'No user object found in request',
        context,
        requestHeaders: request.headers ? Object.keys(request.headers) : [],
        authHeader: request.headers?.authorization ? 'Present' : 'Missing',
      });

      throw new BadRequestException({
        message: 'User authentication failed',
        details: 'No user object found in request',
        context,
        timestamp: new Date().toISOString(),
      });
    }

    // Try multiple extraction methods
    // Method 1: Try user.sub (most common for JWT tokens)
    if (request.user.sub && typeof request.user.sub === 'string') {
      const extractedUserId = request.user.sub;
      logger.log({
        message: 'User ID extracted via user.sub',
        context,
        userId: extractedUserId.substring(0, 8) + '...',
      });
      return extractedUserId;
    }

    // Method 2: Try user.id (alternative property)
    if (request.user.id && typeof request.user.id === 'string') {
      const extractedUserId = request.user.id;
      logger.log({
        message: 'User ID extracted via user.id',
        context,
        userId: extractedUserId.substring(0, 8) + '...',
      });
      return extractedUserId;
    }

    // Method 3: Try user.user_id (another alternative)
    if (request.user.user_id && typeof request.user.user_id === 'string') {
      const extractedUserId = request.user.user_id;
      logger.log({
        message: 'User ID extracted via user.user_id',
        context,
        userId: extractedUserId.substring(0, 8) + '...',
      });
      return extractedUserId;
    }

    // If all methods fail, log detailed information and throw error
    logger.error({
      message: 'Failed to extract user ID using all methods',
      context,
      userObject: JSON.stringify(request.user, null, 2),
      userKeys: Object.keys(request.user),
      userSubType: typeof request.user.sub,
      userIdType: typeof request.user.id,
      userSubValue: request.user.sub,
      userIdValue: request.user.id,
    });

    throw new BadRequestException({
      message: 'User ID not found in request',
      details:
        'Authentication passed but user ID could not be extracted from user object',
      context,
      userObject: request.user,
      availableProperties: Object.keys(request.user),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // If it's already a BadRequestException, re-throw it
    if (error instanceof BadRequestException) {
      throw error;
    }

    // For any other error, wrap it
    logger.error({
      message: 'Unexpected error during user ID extraction',
      context,
      error: error.message,
      stack: error.stack,
    });

    throw new BadRequestException({
      message: 'Failed to extract user ID',
      details: 'Unexpected error during user ID extraction',
      context,
      originalError: error.message,
      timestamp: new Date().toISOString(),
    });
  }
}

/**
 * Safely extracts user ID with fallback to a default value
 * @param request - Express request object
 * @param context - Context string for logging
 * @param defaultValue - Default value to return if extraction fails
 * @returns User ID string or default value
 */
export function extractUserIdWithFallback(
  request: any,
  context: string = 'Unknown',
  defaultValue: string | null = null,
): string | null {
  try {
    return extractUserIdSafely(request, context);
  } catch (error) {
    const logger = new Logger('UserIdExtractor');
    logger.warn({
      message: 'User ID extraction failed, using fallback',
      context,
      defaultValue,
      error: error.message,
    });
    return defaultValue;
  }
}
