# veomath

Math visualizations with Google sign-in, a server-side OpenAI key, and a limit of 10 OpenAI HTTP calls per user per UTC day.

## Local emulators

Install Node.js 20+ and Java 21+ (required by the Firestore emulator), then install dependencies with `pnpm install`. Start two terminals:

```bash
pnpm emulators
pnpm dev:local
```

Open http://localhost:3000. The Google sign-in popup is mocked by Firebase Auth Emulator, so no real Google or Firebase keys are needed locally. Set `OPENAI_API_KEY` in your own `.env.local` if you want to run actual generations; never commit it. The Firebase Emulator UI is at http://127.0.0.1:4000. Local emulator data is temporary unless you export it.

## Production setup

1. Create a Firebase project and enable **Google** under Authentication → Sign-in method. Add your deployed domain to Authorized domains.
2. Copy the values in `.env.example` into your deployment environment. `NEXT_PUBLIC_FIREBASE_*` values are Firebase browser config and are public. `OPENAI_API_KEY` is server-only. Set `FIREBASE_PROJECT_ID` and provide Firebase Admin Application Default Credentials to the server. Anyone can sign in with Google; production API access requires a verified Google email, with no email allowlist. Do not set emulator environment variables in production.
3. Deploy `firestore.rules` with `pnpm exec firebase deploy --only firestore:rules --project YOUR_PROJECT_ID`. These rules let a signed-in Google user read only their own `users/{uid}` data and deny all client writes; only verified server endpoints write to Firestore. Deploying them replaces any open "test mode" rules in the Firebase console.

Every OpenAI network request is counted in a Firestore transaction at `users/{uid}/dailyUsage/{YYYY-MM-DD}`. A multi-slide generation may consume all 10 calls and stop before the document is complete. Prompts are stored in `users/{uid}/prompts`; approximate viewed seconds, pointer actions, and control changes are aggregated in `users/{uid}/animationActivity`. Activity is client reported and is intended for analytics, not security decisions.

## Verification

Run `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm build`. Run `pnpm test:security` with emulator ports free to check Google-only authentication, concurrent quota enforcement, retries, prompt/activity storage, PDF ownership, request limits, and Firestore rules (owner-only reads, no client writes). The tests use a separate local server on port 3011 and mock OpenAI; no OpenAI key or paid calls are needed.
