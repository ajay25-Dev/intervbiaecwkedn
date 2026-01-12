export interface BulkUserImportRequest {
  csvFile: Express.Multer.File;
}

export interface BulkUserImportResult {
  totalRows: number;
  successfulImports: number;
  failedImports: number;
  importDetails: BulkUserImportDetail[];
  summary: {
    usersCreated: number;
    courseAssignmentsCreated: number;
    errors: string[];
  };
}

export interface BulkUserImportDetail {
  rowNumber: number;
  email: string;
  status: 'success' | 'failed';
  error?: string;
  userId?: string;
  coursesAssigned?: string[];
}

export interface ParsedUserData {
  name: string;
  number: string;
  email: string;
  password: string;
  assigned_course: string;
  user_type: 'student' | 'teacher' | 'admin';
  rowNumber: number;
}
