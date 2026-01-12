export interface CreateUserRequest {
  email: string;
  password: string;
  full_name: string;
  role: 'student' | 'teacher';
  mobile?: string;
  // Optional profile fields
  education?: string;
  graduation_year?: number;
  domain?: string;
  profession?: string;
  location?: string;
  current_institute?: string;
}

export interface UpdateUserRequest {
  full_name?: string;
  role?: 'student' | 'teacher' | 'admin';
  mobile?: string;
  education?: string;
  graduation_year?: number;
  domain?: string;
  profession?: string;
  location?: string;
  current_institute?: string;
  onboarding_completed?: boolean;
}
