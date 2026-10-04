import type OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { MANIM_SYSTEM_PROMPT } from './systemPrompt';

// Shared by /api/chat and the eval runner (evals/run.ts) so the eval sends exactly what the app sends.

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type MessageContent = string | (TextPart | ImagePart)[];
export type ApiMessage = { role: 'system' | 'user' | 'assistant'; content: MessageContent };

export interface ChatRequest {
  messages: ApiMessage[];
  retryContext?: { failedCode: string; error: string } | null;
  currentFrame?: string | null;
}

export interface Visualization {
  explanation: string;
  manimCode: string;
}

export const VISUALIZATION_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'visualization_response',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        explanation: {
          type: 'string',
          description: 'Clear, conversational explanation of the mathematical concept (2-4 sentences)',
        },
        manimCode: {
          type: 'string',
          description: 'Plain JavaScript code (body of async function, scene variable available, no imports) that creates the manim-web visualization',
        },
      },
      required: ['explanation', 'manimCode'],
      additionalProperties: false,
    },
  },
} as const;

export function buildChatMessages({ messages, retryContext, currentFrame }: ChatRequest): ApiMessage[] {
  const apiMessages: ApiMessage[] = [
    { role: 'system', content: MANIM_SYSTEM_PROMPT },
    ...messages,
  ];

  if (retryContext) {
    apiMessages.push({
      role: 'user',
      content: `The code you generated failed to run in the browser. Please fix it.\n\nError:\n${retryContext.error}\n\nFailed code:\n\`\`\`javascript\n${retryContext.failedCode}\n\`\`\``,
    });
  }

  // Attach the current animation frame to the last user message so the model can see what's on screen
  if (currentFrame) {
    const lastUserIdx = apiMessages.reduce((last, m, i) => m.role === 'user' ? i : last, -1);
    if (lastUserIdx >= 0) {
      const msg = apiMessages[lastUserIdx];
      const text = typeof msg.content === 'string' ? msg.content : '';
      apiMessages[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: currentFrame } },
        ],
      };
    }
  }

  return apiMessages;
}

/** Throws if the request fails or the response is not valid JSON. */
export async function requestVisualization(client: OpenAI, model: string, request: ChatRequest) {
  const response = await client.chat.completions.create({
    model,
    messages: buildChatMessages(request) as ChatCompletionMessageParam[],
    response_format: VISUALIZATION_RESPONSE_FORMAT,
  });

  const raw = response.choices[0]?.message?.content ?? '';
  let visualization: Visualization;
  try {
    visualization = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Model returned invalid JSON: ${err}`, { cause: raw });
  }
  return { visualization, raw, usage: response.usage };
}
