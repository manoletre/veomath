import { NextRequest, NextResponse } from 'next/server';
import { meteredOpenAI, recordPrompt, requireUser, securityError } from '../../../lib/server-security';
import { getDb } from '../../../lib/firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { readBody } from '../../../lib/request-validation';

export async function POST(request: NextRequest) {
  const user = await requireUser(request);
  if (user instanceof NextResponse) return user;
  try {
    const bytes = await readBody(request, 10 * 1024 * 1024 + 16384);
    const formData = await new Response(bytes as BodyInit, {
      headers: { 'Content-Type': request.headers.get('content-type') || '' },
    }).formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (file.type !== 'application/pdf' || new TextDecoder().decode(await file.slice(0, 5).arrayBuffer()) !== '%PDF-') {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
    }
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'PDF must be 10 MB or smaller' }, { status: 413 });
    }

    const sessionId = formData.get('sessionId');
    await recordPrompt(user.uid, 'pdf-upload', file.name, typeof sessionId === 'string' ? sessionId : undefined);
    const openai = meteredOpenAI(user.uid);

    const uploaded = await openai.files.create({
      file,
      purpose: 'user_data' as 'assistants',
    });

    await getDb().doc(`users/${user.uid}/uploads/${uploaded.id}`).set({
      fileId: uploaded.id, name: file.name, createdAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ fileId: uploaded.id });
  } catch (error) {
    return securityError(error, 'Failed to upload file');
  }
}
