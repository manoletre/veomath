import 'server-only';

import { NextRequest } from 'next/server';
import { RequestError } from './server-security';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readBody(request: NextRequest, limit: number): Promise<Uint8Array> {
  if (Number(request.headers.get('content-length')) > limit) throw new RequestError('Request is too large', 413);
  if (!request.body) throw new RequestError('A request body is required');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestError('Request is too large', 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readJson(request: NextRequest, limit: number): Promise<Record<string, unknown>> {
  const bytes = await readBody(request, limit);
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new RequestError('Invalid JSON'); }
  if (!isRecord(value)) throw new RequestError('Expected a JSON object');
  return value;
}

function optionalString(value: unknown, name: string, limit = 10000): void {
  if (value !== undefined && value !== null && (typeof value !== 'string' || value.length > limit)) {
    throw new RequestError(`Invalid ${name}`);
  }
}

function requiredString(value: unknown, name: string): void {
  if (typeof value !== 'string' || !value.trim() || value.length > 10000) throw new RequestError(`Invalid ${name}`);
}

function validateFrame(value: unknown): void {
  optionalString(value, 'frame', 120000);
  if (value && (typeof value !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[a-zA-Z0-9+/=]+$/.test(value))) {
    throw new RequestError('Invalid frame');
  }
}

export type ChatBody = {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  retryContext?: { failedCode: string; error: string };
  currentFrame?: string;
  sessionId?: string;
};

export function validateChat(value: Record<string, unknown>): ChatBody {
  if (!Array.isArray(value.messages) || !value.messages.length || value.messages.length > 40 ||
    !value.messages.every(m => isRecord(m) && (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' && m.content.length <= 30000)) throw new RequestError('Invalid messages');
  if (value.retryContext !== undefined) {
    if (!isRecord(value.retryContext)) throw new RequestError('Invalid retry context');
    requiredString(value.retryContext.error, 'error');
    if (typeof value.retryContext.failedCode !== 'string' || value.retryContext.failedCode.length > 30000) {
      throw new RequestError('Invalid failed code');
    }
  }
  optionalString(value.sessionId, 'session ID', 100);
  validateFrame(value.currentFrame);
  return value as ChatBody;
}

type PlanItem = { type: 'text' | 'slide'; content: string; title: string; description: string };
type LessonItem = { type: 'text' | 'slide'; content?: string; title?: string; description?: string; manimCode?: string; comment?: string };
export type AgenticBody = {
  mode: 'plan' | 'plan-from-pdf' | 'generate' | 'regenerate-slide' | 'regenerate-course';
  topic: string;
  fileId?: string;
  sessionId?: string;
  items: PlanItem[];
  userComments: string;
  userComment: string;
  overallFeedback: string;
  slideComments?: Record<string, string>;
  lessonContext: LessonItem[];
  slideTitle: string;
  slideDescription: string;
  sessionContext: string;
  failedCode?: string;
  currentCode?: string;
  error?: string;
  currentFrame?: string;
};

export function validateAgentic(value: Record<string, unknown>): AgenticBody {
  if (!['plan', 'plan-from-pdf', 'generate', 'regenerate-slide', 'regenerate-course'].includes(String(value.mode))) {
    throw new RequestError('Invalid mode');
  }
  for (const field of ['topic', 'userComments', 'userComment', 'overallFeedback', 'slideTitle', 'slideDescription', 'sessionContext', 'error']) {
    optionalString(value[field], field);
  }
  for (const field of ['failedCode', 'currentCode']) optionalString(value[field], field, 30000);
  optionalString(value.sessionId, 'session ID', 100);
  if (value.fileId !== undefined && (typeof value.fileId !== 'string' || !/^file-[a-zA-Z0-9_-]{1,100}$/.test(value.fileId))) {
    throw new RequestError('Invalid file ID');
  }
  validateFrame(value.currentFrame);
  if (value.mode === 'plan-from-pdf') requiredString(value.fileId, 'file ID');
  else requiredString(value.topic, 'topic');
  if (value.mode === 'regenerate-slide') {
    requiredString(value.slideTitle, 'slide title');
    requiredString(value.slideDescription, 'slide description');
  }
  if (value.mode === 'generate' || value.mode === 'regenerate-course') {
    if (!Array.isArray(value.items) || !value.items.length || value.items.length > 20 || !value.items.every(item =>
      isRecord(item) && (item.type === 'text' || item.type === 'slide') &&
      ['content', 'title', 'description'].every(field => typeof item[field] === 'string' && (item[field] as string).length <= 10000))) {
      throw new RequestError('Invalid plan items');
    }
  }
  if (value.mode === 'regenerate-course') {
    if (!Array.isArray(value.lessonContext) || value.lessonContext.length > 20 || !value.lessonContext.every(item => {
      if (!isRecord(item) || !['text', 'slide'].includes(String(item.type))) return false;
      for (const field of ['content', 'title', 'description', 'comment', 'manimCode']) {
        optionalString(item[field], field, field === 'manimCode' ? 30000 : 10000);
      }
      return true;
    })) throw new RequestError('Invalid lesson context');
  }
  if (value.slideComments !== undefined) {
    if (!isRecord(value.slideComments) || Object.keys(value.slideComments).length > 20) throw new RequestError('Invalid slide comments');
    for (const [index, comment] of Object.entries(value.slideComments)) {
      if (!/^\d{1,2}$/.test(index)) throw new RequestError('Invalid slide index');
      optionalString(comment, 'slide comment');
    }
  }
  return value as AgenticBody;
}
