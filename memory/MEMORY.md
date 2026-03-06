# veomath project memory

## Project overview
Split-panel math visualization app: chat on left (GPT-5.4), manim-web animation renderer on right.

## Stack
- Next.js 16 (Turbopack), React 19, TypeScript, Tailwind CSS v4
- pnpm (use `pnpm` not `npm`)
- OpenAI SDK v6 (`openai`)
- `manim-web` v0.3.9

## Key architecture
- `app/api/chat/route.ts` — server API, GPT-5.4, structured JSON outputs (explanation + manimCode)
- `app/components/ManimRenderer.tsx` — client component, dynamically imports manim-web, uses `new AsyncFunction` to execute AI-generated code
- `app/page.tsx` — main split layout (client component)
- `app/stubs/empty.js` — browser stub for manim-web's internal `require('fs')` usage

## Critical config
- `next.config.ts` must have `turbopack.resolveAlias: { fs: './app/stubs/empty.js' }` to stub fs for manim-web
- OpenAI client must be instantiated INSIDE the request handler (not at module level) to avoid build-time errors
- `ManimRenderer` uses `dynamic(() => import(...), { ssr: false })` to avoid SSR issues

## manim-web patterns
- All manim exports are injected into AI code scope via: `const { ...Object.keys(manim) } = __manim`
- AI code is the body of an async function with `scene` (Scene instance) available
- Static scenes end with `await scene.wait(999999)`
- `MathTex`/`Tex` require `await tex.waitForRender()` before use
- Colors: BLACK, WHITE, RED, BLUE, GREEN, YELLOW, ORANGE, PURPLE, GRAY + variants (BLUE_C, RED_D etc.)
- Directions: UP, DOWN, LEFT, RIGHT, UL, UR, DL, DR, ORIGIN

## OpenAI structured outputs
Uses `response_format: { type: 'json_schema', json_schema: { name, strict, schema } }`
Returns `{ explanation: string, manimCode: string }`

## Env
`OPENAI_API_KEY` in `.env.local` (never access this file without asking! never never never!!!)
