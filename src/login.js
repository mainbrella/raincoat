import { createAuthClient, GOOGLE_CLIENT_ID, API_ORIGIN } from './auth.js';

const auth = createAuthClient();
const page = document.querySelector('.login-content');
const status = document.querySelector('.login-status');
const error = document.querySelector('.login-error');
const provider = document.querySelector('.login-provider');
const googleHost = document.querySelector('.google-button-host');
const googleLoading = document.querySelector('.google-loading');
const googleRetry = document.querySelector('.google-retry');
const account = document.querySelector('.account');
const identity = document.querySelector('.login-identity');
const signOutButton = document.querySelector('.login-sign-out');
const loginTitle = document.querySelector('#login-title');
const emailForm = document.querySelector('.email-login-form');
const emailInput = document.querySelector('#login-email');
const passwordInput = document.querySelector('#login-password');
const emailSubmit = document.querySelector('.email-login-submit');
const usersPage = document.querySelector('.users-content');
const usersStatus = document.querySelector('.users-status');
const usersError = document.querySelector('.users-error');
const usersTable = document.querySelector('.users-table-wrap');
const usersRows = document.querySelector('.users-rows');
const usersRefresh = document.querySelector('.users-refresh');
const ADMIN_EMAIL = 'oneone@gmail.com';
const signInPrompt = 'Continue with Google or email and password.';

let user = null;
let signingIn = false;
let signingOut = false;
let usersRequest = 0;

function isAdmin() {
  return user?.email?.trim().toLowerCase() === ADMIN_EMAIL;
}

start();

async function start() {
  page.setAttribute('aria-busy', 'true');
  status.textContent = 'Checking your session…';
  try {
    const session = await auth.readSession();
    user = session?.user || null;
    await showCurrentState();
  } catch (cause) {
    showError(cause);
    provider.hidden = false;
    status.textContent = 'Could not check your session.';
    loadGoogleButton();
  } finally {
    page.setAttribute('aria-busy', 'false');
  }
}

async function showCurrentState() {
  usersRequest++;
  usersRows.replaceChildren();
  usersTable.hidden = true;
  usersError.hidden = true;
  usersPage.hidden = true;
  page.hidden = false;
  loginTitle.textContent = 'Log in';
  clearError();
  account.hidden = !user;
  identity.textContent = user?.email || '';
  provider.hidden = Boolean(user);
  if (isAdmin()) {
    page.hidden = true;
    usersPage.hidden = false;
    document.querySelector('#users-title').focus({ preventScroll: true });
    await loadUsers();
  } else if (user) {
    showAccessDenied();
  } else {
    status.textContent = signInPrompt;
    loadGoogleButton();
  }
}

function showAccessDenied() {
  usersPage.hidden = true;
  usersRows.replaceChildren();
  usersTable.hidden = true;
  page.hidden = false;
  page.setAttribute('aria-busy', 'false');
  provider.hidden = true;
  loginTitle.textContent = 'Access denied';
  status.textContent = `Admin access is limited to ${ADMIN_EMAIL}. Sign out to use that account.`;
}

async function loadUsers() {
  if (!isAdmin() || signingOut) return;
  const requestID = ++usersRequest;
  usersRefresh.disabled = true;
  usersPage.setAttribute('aria-busy', 'true');
  usersStatus.textContent = 'Loading users…';
  usersError.hidden = true;
  usersRows.replaceChildren();
  usersTable.hidden = true;
  try {
    const response = await fetch(`${API_ORIGIN}/admin/users`, {
      credentials: 'include', headers: { accept: 'application/json' },
    });
    if (requestID !== usersRequest) return;
    if (response.status === 401) {
      user = null;
      await showCurrentState();
      status.textContent = 'Your session expired. Sign in again.';
      return;
    }
    if (response.status === 403) {
      showAccessDenied();
      return;
    }
    const result = await response.json().catch(() => null);
    if (requestID !== usersRequest) return;
    if (!response.ok || !Array.isArray(result?.users)) throw new Error('users_unavailable');
    const rows = document.createDocumentFragment();
    for (const item of result.users) {
      const row = document.createElement('tr');
      const created = new Date(item.created_at);
      const values = [item.name || '—', item.email || '—',
        Number.isFinite(created.getTime()) ? created.toLocaleString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        }) : item.created_at || '—', item.id];
      for (const [index, value] of values.entries()) {
        const cell = document.createElement('td');
        if (index === 2 && Number.isFinite(created.getTime())) {
          const time = document.createElement('time');
          time.dateTime = item.created_at;
          time.title = item.created_at;
          time.textContent = value;
          cell.append(time);
        } else cell.textContent = value;
        row.append(cell);
      }
      rows.append(row);
    }
    usersRows.replaceChildren(rows);
    usersTable.hidden = result.users.length === 0;
    usersStatus.textContent = result.users.length
      ? `${result.users.length.toLocaleString()} ${result.users.length === 1 ? 'user' : 'users'} · Newest first`
      : 'No users found.';
  } catch {
    if (requestID !== usersRequest) return;
    usersStatus.textContent = 'Could not load users.';
    usersError.textContent = 'Check your connection and use Refresh to try again.';
    usersError.hidden = false;
  } finally {
    if (requestID === usersRequest) {
      usersRefresh.disabled = false;
      usersPage.setAttribute('aria-busy', 'false');
    }
  }
}

usersRefresh.addEventListener('click', () => loadUsers());

async function loadGoogleButton() {
  googleHost.replaceChildren();
  googleRetry.hidden = true;
  googleLoading.hidden = false;
  googleLoading.textContent = 'Loading Google sign-in…';
  googleHost.setAttribute('aria-busy', 'true');
  try {
    await loadGoogleIdentityScript();
    if (provider.hidden) return;
    if (!window.google?.accounts?.id) throw new Error('Google sign-in is unavailable. Please retry.');
    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response) => handleCredential(response?.credential),
      context: 'signin',
      ux_mode: 'popup',
    });
    window.google.accounts.id.renderButton(googleHost, {
      type: 'standard',
      theme: 'outline_dark',
      size: 'large',
      text: 'continue_with',
      shape: 'rectangular',
      logo_alignment: 'left',
      width: Math.min(360, googleHost.clientWidth || 360),
    });
    googleLoading.hidden = true;
  } catch {
    googleLoading.hidden = false;
    googleRetry.hidden = false;
    googleLoading.textContent = 'Google sign-in could not load. You can use email below or retry Google.';
  } finally {
    googleHost.setAttribute('aria-busy', 'false');
  }
}

async function handleCredential(credential) {
  await signIn(() => auth.signInWithGoogle(credential));
}

emailForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!emailForm.reportValidity()) return;
  if (emailInput.value.trim().toLowerCase() !== ADMIN_EMAIL) {
    showError(new Error(`Admin access is limited to ${ADMIN_EMAIL}.`));
    return;
  }
  await signIn(() => auth.signInWithEmail(emailInput.value, passwordInput.value));
});

async function signIn(authenticate) {
  if (signingIn || signingOut || user) return;
  signingIn = true;
  clearError();
  status.textContent = 'Signing in…';
  page.setAttribute('aria-busy', 'true');
  provider.classList.add('is-disabled');
  for (const control of [emailInput, passwordInput, emailSubmit]) {
    if (control) control.disabled = true;
  }
  if (emailSubmit) emailSubmit.textContent = 'Continuing…';
  try {
    const session = await authenticate();
    user = session.user;
    if (passwordInput) passwordInput.value = '';
    await showCurrentState();
  } catch (cause) {
    status.textContent = signInPrompt;
    showError(cause);
  } finally {
    signingIn = false;
    page.setAttribute('aria-busy', 'false');
    provider.classList.remove('is-disabled');
    for (const control of [emailInput, passwordInput, emailSubmit]) {
      if (control) control.disabled = false;
    }
    if (emailSubmit) emailSubmit.textContent = 'Continue with email';
  }
}

signOutButton.addEventListener('click', async () => {
  if (signingOut || signingIn || !user) return;
  signingOut = true;
  signOutButton.disabled = true;
  page.setAttribute('aria-busy', 'true');
  const currentStatus = page.hidden ? usersStatus : status;
  currentStatus.textContent = 'Signing out…';
  clearError();
  try {
    await auth.signOut();
    user = null;
    await showCurrentState();
    emailInput.focus();
  } catch (cause) {
    currentStatus.textContent = 'You’re still signed in.';
    showError(cause);
  } finally {
    signingOut = false;
    signOutButton.disabled = false;
    page.setAttribute('aria-busy', 'false');
  }
});

googleRetry.addEventListener('click', () => {
  clearError();
  loadGoogleButton();
});

window.addEventListener('auth-change', (event) => {
  if (event.detail?.user !== null || !user || signingOut) return;
  user = null;
  showCurrentState();
});

function showError(cause) {
  const target = page.hidden ? usersError : error;
  target.textContent = cause instanceof Error ? cause.message : 'Something went wrong. Please try again.';
  target.hidden = false;
}

function clearError() {
  error.textContent = '';
  error.hidden = true;
  usersError.textContent = '';
  usersError.hidden = true;
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) return Promise.resolve();
  const existingScript = document.querySelector('script[data-google-identity]');
  const script = existingScript || document.createElement('script');
  if (!existingScript) {
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
  }

  return new Promise((resolve, reject) => {
    let timeout;
    const finish = (failure) => {
      clearTimeout(timeout);
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
      if (failure) {
        script.remove();
        reject(failure);
      } else resolve();
    };
    const onLoad = () => finish();
    const onError = () => finish(new Error('Google sign-in could not load.'));
    script.addEventListener('load', onLoad, { once: true });
    script.addEventListener('error', onError, { once: true });
    timeout = setTimeout(() => finish(new Error('Google sign-in took too long to load.')), 12000);
    if (!existingScript) document.head.appendChild(script);
  });
}
