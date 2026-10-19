# Pocket — MERN expense and savings tracker

React + Vite frontend, Express + Node.js API, and MongoDB via Mongoose. The interface retains Pocket's typography, INR formatting, month navigation, expenses, investments, salary dates, and CSV export.

## Vacation and trip savings

The dashboard includes travel goals with a name, total budget, amount already saved, and optional travel date. Each card shows savings progress, the amount still needed, and a fully funded state. Add savings as you set money aside, edit a goal to correct its saved total or budget, and remove goals with confirmation. Goals persist across months and are private to the signed-in account.

Travel savings are a separate earmarking tracker: they do not automatically deduct from the monthly balance. Adding savings records money already set aside; it does not transfer money. Pending totals are calculated for each trip separately, so an overfunded trip does not hide another trip's shortfall. Contributions use atomic MongoDB increments stored in integer cents.

## Run locally

Requires Node.js 22.12+ and MongoDB (local installation, Docker, or Atlas).

```powershell
npm install
Copy-Item .env.example .env
# Edit .env: set a random SESSION_SECRET and your MongoDB connection string.
docker compose up -d
npm run dev
```

Docker is optional; skip `docker compose` when using Atlas or an existing MongoDB server. Open http://localhost:5173 and create an account. The API listens on port 3001; Vite proxies `/api` so cookies and requests use the same browser origin.

Generate a session secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"` and copy the output into your local `.env`. Never commit `.env` or put the database connection string in frontend environment variables.

## MongoDB Atlas setup

1. Create an Atlas Free cluster and a database user restricted to the `pocket` database.
2. Add the development machine's IP, then the production host's outbound IP addresses, to the Atlas network access list.
3. Choose **Connect → Drivers**, copy the connection URI into `MONGODB_URI`, replace placeholders, and specify `/pocket` before the query string. URL-encode special characters in the database password.
4. Keep credentials in `.env` locally and in the host's environment settings for production.

## Deploy to a Node.js host

The MERN runtime cannot run on the existing static Sites deployment. Deploy this `pocket` directory to a service that supports a persistent Node.js process and outbound MongoDB connections.

- Install/build command: `npm ci --include=dev && npm run build`
- Start command: `npm start`
- Health check: `/api/health`
- Environment: `NODE_ENV=production`, `MONGODB_URI`, a random `SESSION_SECRET`, and `APP_ORIGIN=https://your-app.example` (no trailing slash).
- Use the host's `PORT`. Set `TRUST_PROXY=1` only if the host uses exactly one trusted reverse proxy. Production requires HTTPS for secure session cookies.

Express serves the React build and API on the same origin. Do not deploy the frontend alone: it needs the API and database. The `.openai/hosting.json` and root `dist/` belong to the earlier static Sites version and are retained for its existing deployment; the MERN build is `client/dist/`.

## Move your existing browser data

On the original tracker, open the browser developer console and run this snippet to download a JSON backup (it includes your personal financial records):

```js
const raw = localStorage.getItem('pocket-v1');
if (!raw) throw new Error('No Pocket records found in this browser.');
const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
const link = document.createElement('a');
link.href = url;
link.download = 'pocket-backup.json';
link.click();
setTimeout(() => URL.revokeObjectURL(url), 1000);
```

Sign in to the MERN app and choose **Import backup**. If the app is on the same origin as the old tracker, **Import browser records** is also available. Different domains cannot read each other's browser storage. Imports create missing months only; existing cloud months are skipped. Repeating an import is safe. Local data is not deleted. Legacy CSV exports are not import files.

## Security and behavior

- Passwords use bcrypt; MongoDB stores hashes, never plaintext passwords.
- Opaque session IDs live in HttpOnly, SameSite cookies; server sessions expire after 7 days and persist in MongoDB. Production cookies require HTTPS.
- Every month lookup and mutation includes the authenticated user's ID.
- Writes check the browser Origin; login and API requests have rate limits.
- The API validates calendar dates, month membership, category, bounded amounts, and two decimal places. Totals are calculated using integer cents.
- Salary and transaction edits update individual MongoDB fields; users do not submit entire month snapshots.
- Import is atomic per month, not for the whole file. If interrupted, re-run the file to import remaining months.
- This version has email/password registration and login. Email verification and password recovery are not implemented.
- Rate limits use per-process memory; a multi-instance deployment needs a shared rate-limit store and a correctly configured proxy.

## Checks

```powershell
npm test
npm run build
```

`npm test` first builds the frontend, then uses a temporary real MongoDB process from `mongodb-memory-server`. The first run needs network access to download the MongoDB test binary. Tests cover authentication, logout, user isolation, CRUD, dates, monetary precision, persistence across sessions, import idempotency, preservation of existing data, and production frontend serving.
