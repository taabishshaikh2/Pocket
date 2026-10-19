# Safari sign-in fix: first-party sessions

The old Static Site makes cross-site requests to pocketbackend.onrender.com. Safari can block its session cookie even when CORS and SameSite=None are correct. The new frontend gateway serves React and forwards /api to the fixed backend origin, so the browser only communicates with the frontend site. MongoDB and the API remain separate. HttpOnly/Secure cookies stay in use; no tokens are put in localStorage.

## Recommended: keep separate services

1. Push this code to GitHub.
2. Create a **new Render Web Service** for the frontend. A Static Site cannot run this gateway. Use the same repository, branch main, and a blank Root Directory when package.json is at the repo root.
3. Frontend build command: `npm ci --include=dev && npm run build`. Start command: `npm run start:client`. Health check: `/healthz`.
4. Frontend environment:

```env
NODE_ENV=production
API_PROXY_TARGET=https://pocketbackend.onrender.com
TRUST_PROXY=1
MONGOMS_DISABLE_POSTINSTALL=1
VITE_API_URL=
```

VITE_API_URL must be empty or absent when building this frontend. Otherwise the browser bypasses the gateway. Do not add database credentials to the frontend.

5. After Render assigns the new frontend URL, update the existing API service:

```env
APP_ORIGIN=https://YOUR-NEW-FRONTEND.onrender.com
CROSS_SITE_COOKIES=false
SERVE_CLIENT=false
TRUST_PROXY=1
```

Keep the API's MONGODB_URI, SESSION_SECRET, NODE_ENV=production, and ADMIN_EMAIL unchanged. Save and deploy the API.

6. Open the new frontend URL in Safari. Sign in, refresh, open another screen, and sign out. Use this URL going forward. Keep the old Static Site until the new site works; optionally replace it with a redirect afterwards. Browser cookies from the old domains will not carry over, so sign in again.

The frontend and API remain independently deployed. Free web services can both sleep, so the first load may take longer. The browser must allow ordinary first-party cookies; no changes to Prevent Cross-Site Tracking are required.

## Simpler alternative: one service

The existing API can already serve the React build. On pocketbackend change the build command to `npm ci --include=dev && npm run build`; keep `npm start`. Set SERVE_CLIENT=true, CROSS_SITE_COOKIES=false, APP_ORIGIN=https://pocketbackend.onrender.com, MONGOMS_DISABLE_POSTINSTALL=1, and remove VITE_API_URL from its build environment. Deploy and use https://pocketbackend.onrender.com as the app URL. No proxy service is needed for this option.

## Verification scope

Automated tests exercise first-party cookie issuance, session reuse through the gateway, API body/path forwarding, logout, and rejection of foreign-Origin writes. The login form now confirms /api/auth/me before showing the dashboard. Physical Safari confirmation must happen after deploying the same-origin setup.

References: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ and https://render.com/docs/web-services
