import type { User } from './types.ts';

type GoogleIdentityResponse = { credential?: string };
type GoogleIdentity = {
  initialize(options: {
    client_id: string;
    callback: (response: GoogleIdentityResponse) => void;
    context: 'signin';
    ux_mode: 'popup';
  }): void;
  renderButton(parent: HTMLElement, options: {
    type: 'standard';
    theme: 'outline_dark';
    size: 'large';
    text: 'continue_with';
    shape: 'rectangular';
    logo_alignment: 'left';
    width: number;
  }): void;
  disableAutoSelect(): void;
};

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleIdentity } };
  }

  interface WindowEventMap {
    'auth-change': CustomEvent<{ user: User | null }>;
  }
}

export {};
