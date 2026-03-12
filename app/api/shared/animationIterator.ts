import OpenAI from 'openai';
import { MANIM_SYSTEM_PROMPT } from './systemPrompt';
import { testAnimation, SandboxResult } from './animationSandbox';

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string; detail?: string } };
type MessageContent = string | (TextPart | ImagePart)[];
type ApiMessage = { role: 'system' | 'user' | 'assistant'; content: MessageContent };

const GENERATE_SLIDE_SYSTEM = `You are a mathematics visualization assistant that creates interactive explainer slides using manim-web.

${MANIM_SYSTEM_PROMPT}

Additional rules for this mode:
- Each slide's code is STANDALONE — it gets its own scene. Do not reference variables from other slides.
- Make sure interactive controls (sliders, draggables) visibly change the visualization when used.
- The code must be robust — handle edge cases so it doesn't crash at runtime.`;

const EVALUATE_SYSTEM = `You are an expert evaluator of interactive math visualizations. You will be shown screenshots of two animation candidates (before and after user interaction).

Evaluate each candidate on:
1. Visual quality — is the visualization clear, well-laid-out, and aesthetically pleasing?
2. Correctness — does the math look right? Are labels/axes correct?
3. Interactivity — did the post-interaction screenshot show a meaningful change? (this proves the controls work)
4. No errors — was the animation free of errors?

Pick the best candidate and provide a short critique of what could still be improved.`;

const REFINE_SYSTEM = `You are a mathematics visualization assistant. Improve the given manim-web code based on feedback.

${MANIM_SYSTEM_PROMPT}

The code is STANDALONE — it gets its own scene. Fix any errors and address the critique. Keep all working parts intact while improving the identified issues.`;

export interface SlideSpec {
  topic: string;
  title: string;
  description: string;
  context: string;
}

export interface IterationCandidate {
  code: string;
  sandboxResult: SandboxResult;
  round: number;
  label: string;
}

export interface IterationResult {
  manimCode: string;
  allCandidates: IterationCandidate[];
  totalRounds: number;
}

export type ProgressCallback = (stage: string, message: string) => void;

export async function generateAndIterateSlide(
  openai: OpenAI,
  spec: SlideSpec,
  onProgress?: ProgressCallback,
): Promise<IterationResult> {
  const allCandidates: IterationCandidate[] = [];
  const MAX_REFINE_ROUNDS = 2;

  // --- Round 0: Generate 2 candidates in parallel ---
  onProgress?.('generating', 'Generating 2 animation candidates...');

  const slidePrompt = `Topic: ${spec.topic}
Slide: "${spec.title}" — ${spec.description}
Context in the document: ${spec.context}

Generate manim-web JavaScript code for this interactive slide.`;

  const [res1, res2] = await Promise.all([
    generateCode(openai, slidePrompt),
    generateCode(openai, slidePrompt + '\n\nIMPORTANT: Create a DIFFERENT visual approach than what someone else might do. Use a different layout, different interactive controls, or a different way of illustrating the concept.'),
  ]);

  // --- Test both in sandbox ---
  onProgress?.('testing', 'Testing candidate A in sandbox...');
  const sandbox1 = await testAnimation(res1);
  onProgress?.('testing', 'Testing candidate B in sandbox...');
  const sandbox2 = await testAnimation(res2);

  allCandidates.push(
    { code: res1, sandboxResult: sandbox1, round: 0, label: 'A' },
    { code: res2, sandboxResult: sandbox2, round: 0, label: 'B' },
  );

  // --- Vision evaluation: pick best ---
  onProgress?.('evaluating', 'Evaluating candidates with vision...');
  const evaluation = await evaluateCandidates(openai, allCandidates[0], allCandidates[1], spec);

  let bestCandidate = evaluation.winner === 'B' ? allCandidates[1] : allCandidates[0];
  let critique = evaluation.critique;

  // --- Refinement loop ---
  for (let round = 1; round <= MAX_REFINE_ROUNDS; round++) {
    const hasErrors = bestCandidate.sandboxResult.errors.length > 0;
    const needsImprovement = hasErrors || critique.trim().length > 0;

    if (!needsImprovement) {
      onProgress?.('done', 'Animation looks good — no refinement needed.');
      break;
    }

    onProgress?.('refining', `Refining animation (round ${round}/${MAX_REFINE_ROUNDS})...`);

    const refinedCode = await refineCode(openai, bestCandidate, critique, spec);

    onProgress?.('testing', `Testing refined animation (round ${round})...`);
    const refinedSandbox = await testAnimation(refinedCode);

    const refinedCandidate: IterationCandidate = {
      code: refinedCode,
      sandboxResult: refinedSandbox,
      round,
      label: `R${round}`,
    };
    allCandidates.push(refinedCandidate);

    // Re-evaluate refined vs current best
    onProgress?.('evaluating', `Evaluating refinement (round ${round})...`);
    const reEval = await evaluateCandidates(openai, bestCandidate, refinedCandidate, spec);

    if (reEval.winner === 'B') {
      bestCandidate = refinedCandidate;
    }
    critique = reEval.critique;

    if (refinedSandbox.success && reEval.critique.trim().length === 0) {
      onProgress?.('done', 'Refinement complete — animation is clean.');
      break;
    }
  }

  // --- Final pick: LLM vision picks the single best from ALL candidates ---
  if (allCandidates.length > 2) {
    onProgress?.('evaluating', 'Picking the best from all iterations...');
    bestCandidate = await pickBestFromAll(openai, allCandidates, spec);
  }

  onProgress?.('done', `Selected best animation (${bestCandidate.label}).`);

  return {
    manimCode: bestCandidate.code,
    allCandidates,
    totalRounds: allCandidates.length,
  };
}

async function generateCode(openai: OpenAI, prompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: GENERATE_SLIDE_SYSTEM },
      { role: 'user', content: prompt },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'slide_code',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            manimCode: { type: 'string', description: 'The manim-web JS code for this slide' },
          },
          required: ['manimCode'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  return content.manimCode;
}

async function evaluateCandidates(
  openai: OpenAI,
  candidateA: IterationCandidate,
  candidateB: IterationCandidate,
  spec: SlideSpec,
): Promise<{ winner: 'A' | 'B'; critique: string }> {
  const parts: (TextPart | ImagePart)[] = [
    {
      type: 'text',
      text: `Topic: ${spec.topic}\nSlide: "${spec.title}" — ${spec.description}\n\nCandidate A (${candidateA.label}):\n- Errors: ${candidateA.sandboxResult.errors.length > 0 ? candidateA.sandboxResult.errors.join('; ') : 'None'}\n- Screenshots follow (initial, then post-interaction):`,
    },
  ];

  for (const shot of candidateA.sandboxResult.screenshots) {
    parts.push({ type: 'image_url', image_url: { url: shot, detail: 'low' } });
  }

  parts.push({
    type: 'text',
    text: `\nCandidate B (${candidateB.label}):\n- Errors: ${candidateB.sandboxResult.errors.length > 0 ? candidateB.sandboxResult.errors.join('; ') : 'None'}\n- Screenshots follow (initial, then post-interaction):`,
  });

  for (const shot of candidateB.sandboxResult.screenshots) {
    parts.push({ type: 'image_url', image_url: { url: shot, detail: 'low' } });
  }

  const messages: ApiMessage[] = [
    { role: 'system', content: EVALUATE_SYSTEM },
    { role: 'user', content: parts },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: messages as import('openai/resources/chat/completions').ChatCompletionMessageParam[],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'evaluation',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            winner: { type: 'string', enum: ['A', 'B'], description: 'Which candidate is better' },
            critique: { type: 'string', description: 'What could still be improved on the winner. Empty string if it looks great.' },
          },
          required: ['winner', 'critique'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  return { winner: content.winner, critique: content.critique };
}

async function refineCode(
  openai: OpenAI,
  candidate: IterationCandidate,
  critique: string,
  spec: SlideSpec,
): Promise<string> {
  const parts: (TextPart | ImagePart)[] = [
    {
      type: 'text',
      text: `Topic: ${spec.topic}\nSlide: "${spec.title}" — ${spec.description}\n\nCurrent code:\n\`\`\`javascript\n${candidate.code}\n\`\`\`\n\n${candidate.sandboxResult.errors.length > 0 ? `Errors encountered:\n${candidate.sandboxResult.errors.join('\n')}\n\n` : ''}Critique to address:\n${critique}\n\nFix the issues and improve the visualization. The post-interaction screenshot is attached to verify the current state.`,
    },
  ];

  // Attach the latest screenshot if available
  if (candidate.sandboxResult.screenshots.length > 0) {
    const lastShot = candidate.sandboxResult.screenshots[candidate.sandboxResult.screenshots.length - 1];
    parts.push({ type: 'image_url', image_url: { url: lastShot, detail: 'low' } });
  }

  const messages: ApiMessage[] = [
    { role: 'system', content: REFINE_SYSTEM },
    { role: 'user', content: parts },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: messages as import('openai/resources/chat/completions').ChatCompletionMessageParam[],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'refined_code',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            manimCode: { type: 'string', description: 'The improved manim-web JS code' },
          },
          required: ['manimCode'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  return content.manimCode;
}

async function pickBestFromAll(
  openai: OpenAI,
  candidates: IterationCandidate[],
  spec: SlideSpec,
): Promise<IterationCandidate> {
  const parts: (TextPart | ImagePart)[] = [
    {
      type: 'text',
      text: `Topic: ${spec.topic}\nSlide: "${spec.title}" — ${spec.description}\n\nPick the single best animation from the following ${candidates.length} candidates. Each has an initial screenshot and a post-interaction screenshot.\n`,
    },
  ];

  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    parts.push({
      type: 'text',
      text: `\n--- Candidate ${i} (${c.label}, round ${c.round}) ---\nErrors: ${c.sandboxResult.errors.length > 0 ? c.sandboxResult.errors.join('; ') : 'None'}`,
    });
    for (const shot of c.sandboxResult.screenshots) {
      parts.push({ type: 'image_url', image_url: { url: shot, detail: 'low' } });
    }
  }

  const messages: ApiMessage[] = [
    { role: 'system', content: EVALUATE_SYSTEM },
    { role: 'user', content: parts },
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: messages as import('openai/resources/chat/completions').ChatCompletionMessageParam[],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'final_pick',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            bestIndex: { type: 'number', description: 'Zero-based index of the best candidate' },
            reason: { type: 'string', description: 'Brief reason for the choice' },
          },
          required: ['bestIndex', 'reason'],
          additionalProperties: false,
        },
      },
    },
  });

  const content = JSON.parse(response.choices[0].message.content!);
  const idx = Math.max(0, Math.min(content.bestIndex, candidates.length - 1));
  return candidates[idx];
}
