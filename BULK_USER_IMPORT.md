# Bulk User Import Feature

## Overview

This feature allows administrators to import multiple users and assign courses to them simultaneously using a CSV file. The system processes the CSV file, creates users in the `auth.user` and `public.profiles` tables, and assigns courses in the `user_course_assignments` table.

## CSV Format

The CSV file must have the following header and columns:

```
name,number,email,password,assigned_course,user_type
```

### Column Descriptions:

- **name**: User's full name (required)
- **number**: User's phone number (optional)
- **email**: User's email address (required, must be unique)
- **password**: User's password (required, minimum 6 characters)
- **assigned_course**: Course ID(s) to assign to the user (optional, can be multiple separated by commas)
- **user_type**: User role - must be one of: `student`, `teacher`, or `admin` (required)

### Example CSV:

```csv
name,number,email,password,assigned_course,user_type
John Doe,1234567890,john.doe@example.com,password123,course-123,student
Jane Smith,9876543210,jane.smith@example.com,password456,"course-456,course-789",teacher
Bob Johnson,5551234567,bob.johnson@example.com,password789,,admin
```

## API Endpoint

### POST `/v1/admin/users/bulk-import`

**Authentication**: Requires admin authentication (Supabase JWT with admin role)

**Request**:
- Form-data with field name `csvFile` containing the CSV file

**Response**:
```json
{
  "totalRows": 5,
  "successfulImports": 4,
  "failedImports": 1,
  "importDetails": [
    {
      "rowNumber": 1,
      "email": "john.doe@example.com",
      "status": "success",
      "userId": "user-123",
      "coursesAssigned": ["course-123"]
    },
    {
      "rowNumber": 2,
      "email": "invalid-email.com",
      "status": "failed",
      "error": "Invalid email format"
    }
  ],
  "summary": {
    "usersCreated": 4,
    "courseAssignmentsCreated": 5,
    "errors": ["Row 2 (invalid-email.com): Invalid email format"]
  }
}
```

## Implementation Details

### Services Created:

1. **BulkUserImportService** (`bulk-user-import.service.ts`)
   - Handles CSV parsing and validation
   - Processes user creation and course assignment
   - Provides detailed import reporting

2. **BulkUserImportController** (`bulk-user-import.controller.ts`)
   - REST API endpoint for bulk import
   - File upload handling with Multer
   - Admin authentication

### Data Flow:

1. **CSV Parsing**: Uses `csv-parser` to read and parse the CSV file
2. **Validation**: Validates required fields and data formats
3. **User Creation**: Creates users via `AdminUsersService`
4. **Course Assignment**: Assigns courses via `CourseAssignmentsService`
5. **Error Handling**: Continues processing valid rows even if some fail
6. **Reporting**: Returns detailed import results

### Error Handling:

- **Missing required fields**: Skips row and continues
- **Invalid email format**: Skips row and continues
- **Duplicate email**: Skips row and continues
- **Invalid user_type**: Skips row and continues
- **Course not found**: Skips course assignment but creates user
- **Database errors**: Rolls back user creation if profile creation fails

## Usage Example

### cURL Request:

```bash
curl -X POST \
  -H "Authorization: Bearer YOUR_ADMIN_JWT" \
  -F "csvFile=@users.csv" \
  http://localhost:3000/v1/admin/users/bulk-import
```

### JavaScript Example:

```javascript
const formData = new FormData();
formData.append('csvFile', fileInput.files[0]);

fetch('/v1/admin/users/bulk-import', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_ADMIN_JWT'
  },
  body: formData
})
.then(response => response.json())
.then(data => console.log('Import result:', data))
.catch(error => console.error('Import failed:', error));
```

## Security Considerations

- Requires admin authentication
- Passwords are hashed by Supabase auth service
- File uploads are restricted to CSV format only
- Email confirmation is automatically set to true for imported users
- User metadata includes full name for display purposes

## Performance

- Processes users sequentially to maintain data consistency
- Supports batch processing for large files
- Provides progress reporting via import details

## Troubleshooting

**Common Issues:**

1. **File upload fails**: Ensure file is CSV format and has correct headers
2. **All rows fail**: Check that required fields are present
3. **Course assignment fails**: Verify course IDs exist in the system
4. **Authentication error**: Ensure you have admin privileges

**Debugging Tips:**

- Check the `importDetails` array for specific row errors
- Review the `errors` array in the summary for overall issues
- Verify CSV file encoding (UTF-8 recommended)
- Ensure no trailing commas or special characters in CSV data
