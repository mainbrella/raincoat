import type { AuthSession, User } from './types.ts';

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
  || '854186419005-l0u2olqlqe40qmgin0q8tjpvftooi6ac.apps.googleusercontent.com';
export const API_ORIGIN = import.meta.env.VITE_API_URL
  || (['localhost', '127.0.0.1'].includes(location.hostname)
    ? 'http://localhost:8787' : 'https://api.mainbrella.com');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUser(value: unknown): value is User {
  return isRecord(value)
    && typeof value.id === 'string'
    && (value.email === undefined || value.email === null || typeof value.email === 'string')
    && (!('name' in value) || value.name === null || typeof value.name === 'string');
}

function isSession(value: unknown): value is AuthSession {
  return isRecord(value) && isUser(value.user);
}

function errorCode(value: unknown): string | undefined {
  return isRecord(value) && typeof value.error === 'string' ? value.error : undefined;
}

export function createAuthClient() {
  async function request(path: string, options: RequestInit = {}) {
    let response: Response;
    try {
      response = await fetch(`${API_ORIGIN}${path}`, {
        credentials: 'include',
        headers: { accept: 'application/json', ...(options.body ? { 'content-type': 'application/json' } : {}) },
        ...options,
      });
    } catch {
      throw new Error('Could not reach Mainbrella sign-in. Check your connection and try again.');
    }
    const result: unknown = await response.json().catch(() => null);
    return { response, result };
  }

  return {
    async readSession(): Promise<AuthSession | null> {
      const { response, result } = await request('/auth/me');
      if (response.status === 401) return null;
      if (!response.ok || !isRecord(result) || !('user' in result)) {
        throw new Error('Could not check your sign-in. Please try again.');
      }
      if (result.user === null) return null;
      if (!isSession(result)) throw new Error('Could not check your sign-in. Please try again.');
      return result;
    },
    async signInWithGoogle(credential?: string): Promise<AuthSession> {
      if (!credential) throw new Error('Google sign-in could not be completed. Please try again.');
      const { response, result } = await request('/auth/google', {
        method: 'POST', body: JSON.stringify({ credential }),
      });
      if (!response.ok || !isSession(result)) {
        const code = errorCode(result);
        throw new Error(code === 'identity_conflict'
          ? 'This email already has a password account. Continue with email and password.'
          : code === 'invalid_google_credential'
            ? 'Google could not verify that sign-in. Please try again.'
            : 'Could not finish signing you in. Please try again.');
      }
      return result;
    },
    async signInWithEmail(email: string, password: string): Promise<AuthSession> {
      const { response, result } = await request('/auth/email', {
        method: 'POST', body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      if (!response.ok || !isSession(result)) {
        const messages: Record<string, string> = {
          invalid_request: 'Enter a valid email and a password of no more than 128 characters.',
          weak_password: 'Use at least 8 characters for a new password.',
          invalid_credentials: 'Email or password is incorrect. If you signed up with Google, continue with Google.',
          rate_limited: 'Too many attempts. Please wait a minute and try again.',
        };
        throw new Error(messages[errorCode(result) ?? ''] || 'Could not finish signing you in. Please try again.');
      }
      return result;
    },
    async signOut(): Promise<void> {
      const { response, result } = await request('/auth/logout', { method: 'POST' });
      if (!response.ok || !isRecord(result) || result.ok !== true) {
        throw new Error('Could not sign you out. Please try again.');
      }
      window.google?.accounts?.id?.disableAutoSelect();
      window.dispatchEvent(new CustomEvent('auth-change', { detail: { user: null } }));
    },
  };
}
