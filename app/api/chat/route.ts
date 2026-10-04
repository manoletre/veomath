import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { NextRequest, NextResponse } from 'next/server';
import { MANIM_SYSTEM_PROMPT } from '../shared/systemPrompt';
import { meteredOpenAI, recordPrompt, requireUser, securityError } from '../../lib/server-security';
import { readJson, validateChat } from '../../lib/request-validation';

const SYSTEM_PROMPT = MANIM_SYSTEM_PROMPT;

type TextPart = { type: 'text'; text: string };
type ImagePart = { type: 'image_url'; image_url: { url: string } };
type MessageContent = string | (TextPart | ImagePart)[];
type ApiMessage = { role: 'system' | 'user' | 'assistant'; content: MessageContent };

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const { messages, retryContext, currentFrame, sessionId } = validateChat(await readJson(request, 500000));
    const latestPrompt = [...messages].reverse().find(m => m.role === 'user')?.content;
    if (!latestPrompt) return NextResponse.json({ error: 'A prompt is required' }, { status: 400 });
    await recordPrompt(user.uid, retryContext ? 'chat-retry' : 'chat', latestPrompt, sessionId);

    const openai = meteredOpenAI(user.uid);

    const apiMessages: ApiMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
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

    const response = await openai.chat.completions.create({
      model: 'gpt-5.4',
      messages: apiMessages as ChatCompletionMessageParam[],
      response_format: {
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
      },
    });

    const content = JSON.parse(response.choices[0].message.content!);
    return NextResponse.json(content);
  } catch (error) {
    return securityError(error, 'Failed to generate response');
  }
}
