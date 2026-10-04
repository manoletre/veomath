# Evals

25 grade 10–12 prompts (`dataset.json`), browsable at `/eval`. The runner makes exactly the request the
app makes (`app/api/shared/visualization.ts`: same system prompt, same JSON schema), renders the code in
`/sandbox` with headless Chromium, and scores it with deterministic checks (no LLM judge yet). Like the
app, if the code throws it retries once with the error; both attempts are stored.

```bash
pnpm dev                                    # the runner renders through /sandbox
pnpm eval                                   # default models (models.json) × all items
pnpm eval --models anthropic/claude-sonnet-5.5,openai/gpt-6.1-sol --items alg-vertex-form,trig-radian
pnpm eval --run <runId>                     # resume (fills in skipped items), or add models to a run
pnpm eval:selftest                          # verify the checks against fixtures/*.js
```

## Interaction checks

After the scene settles, the harness uses every control one at a time — each slider and checkbox in the
Controls panel, then a real pointer hover, drag (retried in the opposite direction if the handle is at a
limit) and click on each mobject passed to `makeHoverable` / `makeDraggable` / `makeClickable`, then each
button — and diffs full-resolution screenshots before and
after each one, with the Controls panel masked out (otherwise a moving slider thumb would count as the
scene responding). Results are stored per control in `render.interactions`.

- `respondsToInteraction` — every slider, checkbox, hover, click and drag visibly changes the canvas.
  Buttons are listed but not required (a "Reset" can be a no-op).
- `canvasInteraction` — at least one drag or click on the scene itself does something. Sliders alone fail.

The sandbox and the app share `app/components/manimRuntime.ts`, which works around manim-web bugs that
otherwise make interactions silently dead (no repaint without an updater, stale text after `setText`,
Polygons jumping when dragged or hovered, overlapping handles merging). `evals/fixtures/` guards these.
`pnpm eval:selftest` also runs the complete examples in the system prompt, since models copy them.

Each model in `models.json` has a backend (`via`):

- `claude` — `claude -p` headless, on your Claude subscription (run `claude` once to log in)
- `codex` — `codex exec`, on your ChatGPT subscription (run `codex login`)
- `gateway` — Vercel AI Gateway; needs `AI_GATEWAY_API_KEY` in `.env.local`

All three get the app's system prompt and JSON schema. The CLIs run in an empty temp dir with tools,
MCP, settings and project instructions disabled, and API keys are stripped from their environment so
they bill the subscription. Differences from the app's API call: the CLI harness adds some context
(~1k tokens for Claude, ~5k for Codex), and a retry's two user messages are joined into one prompt.
CLI costs are API-equivalent estimates, not charges. API/CLI failures (no credits, rate limits,
unsupported model) are skipped rather than scored 0; rerun with `--run <runId>` to fill them in. `--cli-concurrency` (default 3) limits parallel CLI
calls per backend. Set `AI_GATEWAY_URL` to use any other OpenAI-compatible endpoint. Use `--base-url` if
the dev server isn't on :3000.

## Results layout

```
results/<runId>/run.json                   # RunMeta: models, dataset/prompt hashes, per-model summaries
results/<runId>/<provider__model>/<item>.json                 # ItemResult: attempts (initial + auto-retry), checks, code, tokens, cost
results/<runId>/<provider__model>/<item>.<n>.final.jpg        # 640×360 frame after attempt n settles
results/<runId>/<provider__model>/<item>.<n>.interacted.jpg   # frame after using every control
```

Types are in `types.ts`. Runs are only comparable when `datasetHash` and `promptHash` match.

## Reviewing in the app

Open `/eval` after a run. The page shows model-level automatic scores and lets you inspect each
response's saved attempts, raw model output, generated code, checks, render diagnostics, final and
interacted frames, and a live replay of the generated animation. The runner does not save private
model reasoning; the raw response is the complete model output available for review.

Choose **Manually evaluate 30** to create one random 30-response queue for the selected run. The
sample is spread across models and covers all 25 prompts before repeating a prompt. Rate each
response from 1 (broken) to 5 (excellent), add optional notes, and use **Save rating & next**.
The queue and ratings persist in `results/<runId>/manual-review.json`. Revisiting `/eval` resumes
the same queue. The manual comparison uses only responses you have rated, so its sample counts
remain visible next to each model.
