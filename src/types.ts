export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface AdminUser extends User {
  created_at: string;
  plan: 'none' | 'builder' | 'pro' | 'scale';
}

export interface AuthSession {
  user: User;
}
