// Sanity-checks the deterministic checks against hand-written fixtures.
// Each fixture declares its expected outcomes in a first-line comment:
//   // expect: runs=true inFrame=false
// The complete examples in the system prompt are checked too: models copy them, so they must work.
//
//   pnpm eval:selftest [--frames <dir>] [--base-url http://localhost:3000]

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { MANIM_SYSTEM_PROMPT } from '../app/api/shared/systemPrompt';
import { computeChecks, launchBrowser, renderAndAnalyze } from './sandbox';
import type { CheckId } from './types';

const FIXTURES_DIR = path.resolve('evals/fixtures');
const PROMPT_EXAMPLE_EXPECT = 'runs=true completes=true inFrame=true noTextOverlap=true respondsToInteraction=true canvasInteraction=true stableUnderInteraction=true';

/** Complete programs in the system prompt's code blocks (the ones that end in the idle wait). */
function promptExamples(): { name: string; code: string }[] {
  const blocks = [...MANIM_SYSTEM_PROMPT.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks
    .filter((code) => code.includes('await scene.wait(999999)'))
    .map((code, i) => ({ name: `system-prompt-example-${i + 1}`, code: `// expect: ${PROMPT_EXAMPLE_EXPECT}\n${code}` }));
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (f: string) => (argv.includes(f) ? argv[argv.indexOf(f) + 1] : undefined);
  const baseUrl = flag('--base-url') ?? process.env.SANDBOX_URL ?? 'http://localhost:3000';
  const framesDir = flag('--frames');
  if (framesDir) await mkdir(framesDir, { recursive: true });

  const files = (await readdir(FIXTURES_DIR)).filter((f) => f.endsWith('.js')).sort();
  const cases = [
    ...await Promise.all(files.map(async (file) => ({ name: file.replace('.js', ''), code: await readFile(path.join(FIXTURES_DIR, file), 'utf8') }))),
    ...promptExamples(),
  ];
  const browser = await launchBrowser();
  let failures = 0;

  await Promise.all(cases.map(async ({ name, code }) => {
    const expectLine = code.split('\n')[0].match(/^\/\/\s*expect:\s*(.*)$/)?.[1] ?? '';
    const expected = Object.fromEntries(expectLine.split(/\s+/).filter(Boolean).map((kv) => {
      const [k, v] = kv.split('=');
      return [k, v === 'true'];
    })) as Partial<Record<CheckId, boolean>>;

    const render = await renderAndAnalyze(browser, baseUrl, code);
    const checks = computeChecks(code, render);
    if (framesDir && render.finalJpeg) await writeFile(path.join(framesDir, `${name}.jpg`), render.finalJpeg);

    const lines = Object.entries(expected).map(([id, want]) => {
      const got = checks[id as CheckId].pass;
      const ok = got === want;
      if (!ok) failures++;
      const detail = checks[id as CheckId].detail;
      return `  ${ok ? '✓' : '✗'} ${id}: expected ${want}, got ${got}${!ok && detail ? ` — ${detail.split('\n')[0]}` : ''}`;
    });
    console.log(`${name}\n${lines.join('\n')}`);
  }));

  await browser.close();
  console.log(failures ? `\n${failures} expectation(s) failed` : '\nAll expectations met');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
