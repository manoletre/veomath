import { NextRequest, NextResponse } from 'next/server';
import { requestVisualization } from '../shared/visualization';
import { PRODUCTION_MODEL } from '../shared/model';
import { meteredOpenAI, recordPrompt, requireUser, securityError } from '../../lib/server-security';
import { readJson, validateChat } from '../../lib/request-validation';

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const { messages, retryContext, currentFrame, sessionId } = validateChat(await readJson(request, 500000));
    const latestPrompt = [...messages].reverse().find(m => m.role === 'user')?.content;
    if (!latestPrompt) return NextResponse.json({ error: 'A prompt is required' }, { status: 400 });
    await recordPrompt(user.uid, retryContext ? 'chat-retry' : 'chat', latestPrompt, sessionId);

    const openai = meteredOpenAI(user.uid);

    const { visualization } = await requestVisualization(openai, PRODUCTION_MODEL, { messages, retryContext, currentFrame });
    return NextResponse.json(visualization);
  } catch (error) {
    return securityError(error, 'Failed to generate response');
  }
}
