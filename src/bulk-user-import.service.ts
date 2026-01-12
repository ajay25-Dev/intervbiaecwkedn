import {
  Injectable,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { createReadStream } from 'fs';
import csv from 'csv-parser';
import { AdminUsersService } from './admin-users.service';
import { CourseAssignmentsService } from './course-assignments.service';
import {
  BulkUserImportResult,
  BulkUserImportDetail,
  ParsedUserData,
} from './bulk-user-import.types';
import { CreateUserRequest } from './admin-users.types';

@Injectable()
export class BulkUserImportService {
  constructor(
    private readonly adminUsersService: AdminUsersService,
    private readonly courseAssignmentsService: CourseAssignmentsService,
  ) {}

  async importUsersFromCsv(
    filePath: string,
    assignedBy: string,
  ): Promise<BulkUserImportResult> {
    const importDetails: BulkUserImportDetail[] = [];
    let totalRows = 0;
    let successfulImports = 0;
    let failedImports = 0;
    const errors: string[] = [];
    let usersCreated = 0;
    let courseAssignmentsCreated = 0;

    try {
      // Parse CSV file
      const parsedData: ParsedUserData[] = await new Promise(
        (resolve, reject) => {
          const results: ParsedUserData[] = [];
          createReadStream(filePath)
            .pipe(csv())
            .on('data', (row) => {
              totalRows++;
              try {
                // Validate required fields
                if (
                  !row.name ||
                  !row.email ||
                  !row.password ||
                  !row.user_type
                ) {
                  throw new Error('Missing required fields');
                }

                // Validate user_type
                const userType = row.user_type.toLowerCase();
                if (!['student', 'teacher', 'admin'].includes(userType)) {
                  throw new Error(`Invalid user_type: ${row.user_type}`);
                }

                results.push({
                  name: row.name,
                  number: row.number || '',
                  email: row.email,
                  password: row.password,
                  assigned_course: row.assigned_course || '',
                  user_type: userType as 'student' | 'teacher' | 'admin',
                  rowNumber: totalRows,
                });
              } catch (error) {
                importDetails.push({
                  rowNumber: totalRows,
                  email: row.email || 'unknown',
                  status: 'failed',
                  error: error.message,
                });
              }
            })
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
        },
      );

      // Process each user
      for (const userData of parsedData) {
        try {
          // Create user
          const createUserRequest: CreateUserRequest = {
            email: userData.email,
            password: userData.password,
            full_name: userData.name,
            role:
              userData.user_type === 'admin' ? 'teacher' : userData.user_type, // Map admin to teacher for now
            mobile: userData.number || undefined,
          };

          const createdUser =
            await this.adminUsersService.createUser(createUserRequest);
          usersCreated++;

          // Assign courses if specified
          const coursesAssigned: string[] = [];
          if (userData.assigned_course) {
            const courseIds = userData.assigned_course
              .split(',')
              .map((c) => c.trim())
              .filter((c) => c);
            if (courseIds.length > 0) {
              const assignments =
                await this.courseAssignmentsService.assignCourse(
                  {
                    user_id: createdUser.id,
                    course_ids: courseIds,
                    notes: 'Bulk import assignment',
                  },
                  assignedBy,
                );
              coursesAssigned.push(...assignments.map((a) => a.course_id));
              courseAssignmentsCreated += assignments.length;
            }
          }

          importDetails.push({
            rowNumber: userData.rowNumber,
            email: userData.email,
            status: 'success',
            userId: createdUser.id,
            coursesAssigned,
          });
          successfulImports++;
        } catch (error) {
          importDetails.push({
            rowNumber: userData.rowNumber,
            email: userData.email,
            status: 'failed',
            error: error.message,
          });
          failedImports++;
          errors.push(
            `Row ${userData.rowNumber} (${userData.email}): ${error.message}`,
          );
        }
      }

      return {
        totalRows,
        successfulImports,
        failedImports,
        importDetails,
        summary: {
          usersCreated,
          courseAssignmentsCreated,
          errors,
        },
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `Bulk import failed: ${error.message}`,
      );
    }
  }
}
