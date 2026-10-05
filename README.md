# veomath

Math visualizations with Google sign-in, a server-side OpenAI key, and a limit of 10 OpenAI HTTP calls per user per UTC day.

## Local development

Local development uses the real Firebase project, the same as production. Install Node.js 20+, run `pnpm install`, put the values from `.env.example` in `.env.local` (never commit it), and run `pnpm dev`. Add `localhost` to the Firebase Authorized domains so the Google sign-in popup works.

## Production setup

1. Create a Firebase project and enable **Google** under Authentication → Sign-in method. Add your deployed domain to Authorized domains.
2. Copy the values in `.env.example` into your deployment environment. `NEXT_PUBLIC_FIREBASE_*` values are Firebase browser config and are public. `OPENAI_API_KEY` is server-only. Set `FIREBASE_PROJECT_ID` and give the server Firebase Admin credentials: either `FIREBASE_SERVICE_ACCOUNT_KEY` (the service account JSON on one line) or Application Default Credentials. Anyone can sign in with Google; production API access requires a verified Google email, with no email allowlist.
3. Deploy `firestore.rules` with `pnpm exec firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`. These rules let a signed-in Google user read only their own `users/{uid}` data and deny all client writes; only verified server endpoints write to Firestore. Deploying them replaces any open "test mode" rules in the Firebase console.

Every OpenAI network request is counted in a Firestore transaction at `users/{uid}/dailyUsage/{YYYY-MM-DD}`. A multi-slide generation may consume all 10 calls and stop before the document is complete. Prompts are stored in `users/{uid}/prompts`; approximate viewed seconds, pointer actions, and control changes are aggregated in `users/{uid}/animationActivity`. Activity is client reported and is intended for analytics, not security decisions.

## Verification

Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`.
