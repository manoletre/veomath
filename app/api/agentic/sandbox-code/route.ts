import { NextRequest, NextResponse } from 'next/server';

const codeStore = new Map<string, string>();

export function storeCode(id: string, code: string) {
  codeStore.set(id, code);
  setTimeout(() => codeStore.delete(id), 120_000);
}

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  }

  const code = codeStore.get(id);
  if (!code) {
    return NextResponse.json({ error: 'Code not found or expired' }, { status: 404 });
  }

  return NextResponse.json({ code }, { headers: { 'Cache-Control': 'no-store' } });
}
