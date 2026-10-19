# Deploy Pocket as separate Render services

Code is configured. You create GitHub and Render resources yourself. Replace example URLs with the actual URLs Render assigns. No real secrets belong in this file.

## 1. Push to GitHub

Your local pocket repository already has origin set to https://github.com/taabishshaikh2/Pocket.git and uses main. Run:

```powershell
cd "D:\Work\Expense Tracker\pocket"
git status
git add .env.example README.md RENDER.md client/src/main.jsx client/src/api.js package.json package-lock.json server/app.js server/index.js server/app.test.js server/api-client.test.js vite.config.js
git commit -m "Configure separate Render frontend and API hosting"
git push origin main
```

Review git status before committing. Keep .env, node_modules/, .test-runtime/, and client/dist/ out of GitHub. The existing .gitignore excludes these. Never put Atlas credentials in VITE_ variables.

For this repository, package.json is at the repository root: leave Render Root Directory blank for both services. Do not enter the local Windows path.

## 2. Create the client first

Render → New → Static Site → connect your GitHub repository.

| Setting | Value |
| --- | --- |
| Root Directory | Blank when package.json is at the repo root; pocket when the repo contains a pocket folder |
| Build Command | npm ci --include=dev && npm run build |
| Publish Directory | client/dist |

Set MONGOMS_DISABLE_POSTINSTALL=1 to skip downloading the MongoDB test binary. Initially leave VITE_API_URL unset. Deploy to obtain the actual client URL. The initial client will show a connection error until step 5; that is expected.

## 3. Create the server

Render → New → Web Service → same GitHub repository → Node runtime.

| Setting | Value |
| --- | --- |
| Root Directory | Same choice as the client; do not select server/ |
| Build Command | npm ci --omit=dev |
| Start Command | npm start |
| Health Check Path | /api/health |

Choose a supported Node version >=22.12.0 (Node 22 LTS is suitable). Keep Render's supplied PORT. Select Free if its limits meet your needs.

Server environment variables:

```env
NODE_ENV=production
MONGODB_URI=mongodb+srv://YOUR_DB_USER:YOUR_ENCODED_PASSWORD@YOUR_CLUSTER.mongodb.net/pocket?retryWrites=true&w=majority
SESSION_SECRET=GENERATE_A_RANDOM_SECRET
APP_ORIGIN=https://YOUR-ACTUAL-CLIENT.onrender.com
TRUST_PROXY=1
CROSS_SITE_COOKIES=true
SERVE_CLIENT=false
```

APP_ORIGIN is the client's HTTPS origin, without a trailing slash or path. SESSION_SECRET must be a random value of at least 32 characters. Use this locally to generate one, then paste its output directly into Render:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
```

TRUST_PROXY=1 assumes one trusted reverse proxy and is used for Render HTTPS session cookies. Keep the secret stable between deploys; rotating it signs everyone out.

## 4. Allow Atlas access

In the Render API service, choose Connect → Outbound. Add every listed CIDR/IP range to Atlas Network Access. Use the Atlas database user's password in MONGODB_URI, not the Atlas website password. Percent-encode reserved password characters. Specify the pocket database.

If the initial deploy fails because Atlas access was not ready, redeploy after setting the allowlist. The API URL followed by /api/health should return {"status":"ok"} once startup succeeds.

## 5. Connect and rebuild the client

In the Static Site environment settings:

```env
VITE_API_URL=https://YOUR-ACTUAL-API.onrender.com
MONGOMS_DISABLE_POSTINSTALL=1
```

Use the API origin without /api. Save, rebuild, and deploy. VITE_API_URL is public and embedded at build time. Add a static-site Rewrite: source /*, destination /index.html, action Rewrite.

## 6. Check the app

Open the client URL. Register, add salary and a transaction, create a trip, add savings, refresh, then sign out and sign in again. Financial records and sessions persist in Atlas. Check API logs if the service cannot connect to Atlas.

## Cookies and custom domains

Two separate onrender.com sites use cross-site cookies. The app sends credentialed requests with exact-origin CORS and Secure, HttpOnly, SameSite=None session cookies. Some browsers still block third-party cookies. This cannot be fixed by enabling more CORS origins.

For reliable cookie authentication, use HTTPS sibling custom domains such as app.yourdomain.com and api.yourdomain.com, then update APP_ORIGIN and VITE_API_URL and set CROSS_SITE_COOKIES=false. They remain separate services but are same-site. Alternatively retain the original single-origin deployment.

## Common problems

| Symptom | Check |
| --- | --- |
| CORS or Origin error | APP_ORIGIN matches the exact client origin; rebuild after URL changes |
| Cannot connect on the client | VITE_API_URL is the public API origin and client was rebuilt |
| Login does not persist | Secure/SameSite settings, HTTPS, TRUST_PROXY, and browser third-party cookie policy |
| MongoDB startup failure | URI password, database user permissions, and Atlas network allowlist |
| Build cannot find package.json | Root Directory must contain the shared package.json |
| Slow first request | Free Render web services sleep after inactivity |

Local development is unchanged: npm run dev, root .env from .env.example, CROSS_SITE_COOKIES=false, and VITE_API_URL blank (Vite proxies /api).

References: https://render.com/docs/web-services · https://render.com/docs/static-sites · https://render.com/docs/outbound-ip-addresses · https://render.com/docs/redirects-rewrites

## Administrator account

Set ADMIN_EMAIL=taabishshaikh2@gmail.com on the Render API service (this requested address is also the server default). The existing account is promoted to administrator at server startup. Deploy/restart the backend, then sign out and sign in or reload the app. The client shows Admin settings based on the server-returned role. If the account does not exist yet, create it normally and restart the server. No password is changed.

Admin can add/rename/archive/restore expense and investment categories, pause/reopen new signups, and disable/restore non-admin accounts. Financial records stay scoped to their owners. Changes are recorded in a short audit feed. Other remains protected. Rent and Home are separate categories; old Rent & home remains archived for historical entries.
