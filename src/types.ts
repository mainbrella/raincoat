export interface User {
  id: string;
  email?: string | null;
  name?: string | null;
}

export interface AdminUser extends User {
  created_at: string;
}

export interface AuthSession {
  user: User;
}
