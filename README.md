# Raincoat

Mainbrella user administration. `/` shows the login form, then the users table
for the authenticated account `oneone@gmail.com`. Both the UI and backend
enforce the email restriction. Users are listed by `created_at DESC, id DESC`.

The Google and email/password authentication client is copied from `../web`.
Sign-in uses the backend's HttpOnly session cookie; this admin app does not load
the public site's advertising scripts or cookie consent UI.

```sh
npm ci
npm run dev       # Vite development server at http://localhost:5174
npm run build     # Build the static site into dist/
npm run preview   # Preview the built site with Wrangler
npm run deploy    # Build, then deploy dist/ with Wrangler
```

Run `npm run dev` in `../backend` for local authentication and `GET /admin/users`.
The backend must have its database migrations and auth configuration in place.
Local requests default to `http://localhost:8787`; production requests default
to `https://api.mainbrella.com`.

Override these defaults with `VITE_API_URL` and `VITE_GOOGLE_CLIENT_ID` if needed.
Google sign-in also requires the admin origin (`https://raincoat.mainbrella.com`,
or `http://localhost:5174` for development) in the existing Google OAuth client's
authorized JavaScript origins. The backend allows credentialed requests from
these origins. Deploy both repositories to make the new endpoint available.
