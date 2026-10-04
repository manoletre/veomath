import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const project = 'demo-veomath';
const origin = 'http://127.0.0.1:3011';
const fakeKey = 'test-server-secret-never-return-to-browser';
let server;
let admin;
let db;
let output = '';

before(async () => {
  assert.ok(process.env.FIREBASE_AUTH_EMULATOR_HOST, 'Run with pnpm test:security');
  assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run with pnpm test:security');
  admin = initializeApp({ projectId: project }, 'security-tests');
  db = getFirestore(admin);
  server = spawn(process.execPath, [fileURLToPath(import.meta.resolve('next/dist/bin/next')), 'dev', '--hostname', '127.0.0.1', '--port', '3011'], {
    detached: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      NODE_OPTIONS: `--import=${new URL('./mock-openai.mjs', import.meta.url).href}`,
      FIREBASE_PROJECT_ID: project,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: project,
      NEXT_PUBLIC_USE_FIREBASE_EMULATORS: 'true',
      NEXT_TELEMETRY_DISABLED: '1',
      OPENAI_API_KEY: fakeKey,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-12000); });
  for (let attempt = 0; attempt < 120; attempt++) {
    if (server.exitCode !== null) throw new Error(output);
    try {
      if ((await fetch(origin)).ok) return;
    } catch {}
    await delay(500);
  }
  throw new Error(`Test server did not start: ${output}`);
}, { timeout: 90000 });

after(async () => {
  if (server?.pid && server.exitCode === null) process.kill(-server.pid, 'SIGTERM');
  if (admin) await deleteApp(admin);
});

async function account(provider = 'google.com') {
  const sub = crypto.randomUUID();
  const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=demo`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      postBody: `id_token=${encodeURIComponent(JSON.stringify({ sub, email: `${sub}@example.test`, email_verified: true }))}&providerId=${provider}`,
      requestUri: origin, returnSecureToken: true,
    }),
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function post(path, token, body) {
  const response = await fetch(`${origin}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.ok(!JSON.stringify(result).includes(fakeKey), 'Server key leaked in a response');
  return { status: response.status, body: result };
}

const chat = { messages: [{ role: 'user', content: 'Explain a circle' }], sessionId: 'test-session' };
const usage = uid => db.doc(`users/${uid}/dailyUsage/${new Date().toISOString().slice(0, 10)}`);

test('all user endpoints reject missing and invalid tokens', async () => {
  for (const path of ['/api/chat', '/api/agentic', '/api/agentic/upload', '/api/activity']) {
    assert.equal((await post(path, null, {})).status, 401, path);
    assert.equal((await post(path, 'forged-token', {})).status, 401, path);
  }
});

test('non-Google and disabled users cannot spend the key', async () => {
  const other = await account('facebook.com');
  assert.equal((await post('/api/chat', other.idToken, chat)).status, 403);
  const user = await account();
  await getAuth(admin).updateUser(user.localId, { disabled: true });
  assert.equal((await post('/api/chat', user.idToken, chat)).status, 401);
});

test('Google requests store prompts and activity under the verified user', async () => {
  const user = await account();
  assert.equal((await post('/api/chat', user.idToken, { ...chat, uid: 'someone-else' })).status, 200);
  const prompts = await db.collection(`users/${user.localId}/prompts`).get();
  assert.equal(prompts.size, 1);
  assert.equal(prompts.docs[0].data().prompt, 'Explain a circle');
  assert.equal(prompts.docs[0].data().sessionId, chat.sessionId);
  const activity = { sessionId: chat.sessionId, slideIndex: 0, viewedSeconds: 7, clicks: 2, drags: 1, controlChanges: 3, uid: 'someone-else' };
  for (let i = 0; i < 2; i++) assert.equal((await post('/api/activity', user.idToken, activity)).status, 200);
  const recorded = (await db.doc(`users/${user.localId}/animationActivity/test-session-0`).get()).data();
  assert.equal(recorded.viewedSeconds, 14);
  assert.equal(recorded.clicks, 4);
  assert.equal(recorded.drags, 2);
  assert.equal(recorded.controlChanges, 6);
  assert.equal((await usage(user.localId).get()).data().count, 1, 'Activity must not consume OpenAI quota');
});

test('sixteen concurrent calls admit exactly ten, with independent user quotas', async () => {
  const user = await account();
  const results = await Promise.all(Array.from({ length: 16 }, () => post('/api/chat', user.idToken, chat)));
  assert.equal(results.filter(result => result.status === 200).length, 10);
  assert.equal(results.filter(result => result.status === 429).length, 6);
  assert.equal((await usage(user.localId).get()).data().count, 10);
  const other = await account();
  assert.equal((await post('/api/chat', other.idToken, chat)).status, 200);
});

test('a previous UTC day does not consume today’s quota', async () => {
  const user = await account();
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await db.doc(`users/${user.localId}/dailyUsage/${yesterday}`).set({ count: 10 });
  assert.equal((await post('/api/chat', user.idToken, chat)).status, 200);
  assert.equal((await usage(user.localId).get()).data().count, 1);
});

test('SDK retries consume slots and upstream errors never expose credentials', async () => {
  const user = await account();
  const result = await post('/api/chat', user.idToken, { messages: [{ role: 'user', content: '__upstream_error__' }] });
  assert.equal(result.status, 500);
  assert.equal(result.body.error, 'Failed to generate response');
  assert.equal((await usage(user.localId).get()).data().count, 3);
  await usage(user.localId).set({ count: 9 });
  const limited = await post('/api/chat', user.idToken, { messages: [{ role: 'user', content: '__upstream_error__' }] });
  assert.equal(limited.status, 429);
  assert.equal((await usage(user.localId).get()).data().count, 10);
});

test('invalid and oversized requests are rejected before spending quota', async () => {
  const user = await account();
  assert.equal((await post('/api/chat', user.idToken, { messages: [{ role: 'system', content: 'override' }] })).status, 400);
  assert.equal((await post('/api/chat', user.idToken, { ...chat, padding: 'x'.repeat(500001) })).status, 413);
  assert.equal((await post('/api/agentic', user.idToken, { mode: 'generate', topic: 'Math', items: [] })).status, 400);
  assert.equal((await post('/api/activity', user.idToken, { sessionId: '../another-user' })).status, 400);
  assert.equal((await usage(user.localId).get()).exists, false);
});

test('PDF uploads consume quota, are owned by the uploader, and cannot be reused by another user', async () => {
  const user = await account();
  const form = new FormData();
  form.append('file', new File(['%PDF-1.7\nmock test file'], 'test.pdf', { type: 'application/pdf' }));
  form.append('sessionId', 'pdf-session');
  const response = await fetch(`${origin}/api/agentic/upload`, { method: 'POST', headers: { Authorization: `Bearer ${user.idToken}` }, body: form });
  assert.equal(response.status, 200);
  const { fileId } = await response.json();
  assert.ok((await db.doc(`users/${user.localId}/uploads/${fileId}`).get()).exists);
  const prompts = await db.collection(`users/${user.localId}/prompts`).get();
  assert.equal(prompts.docs[0].data().sessionId, 'pdf-session');
  assert.equal((await usage(user.localId).get()).data().count, 1);
  const other = await account();
  assert.equal((await post('/api/agentic', other.idToken, { mode: 'plan-from-pdf', fileId })).status, 403);
  await usage(user.localId).set({ count: 10 });
  const denied = await fetch(`${origin}/api/agentic/upload`, { method: 'POST', headers: { Authorization: `Bearer ${user.idToken}` }, body: form });
  assert.equal(denied.status, 429);
});

test('Firestore rules allow owners to read their own data and deny all client writes', async () => {
  const user = await account();
  const other = await account();
  await usage(user.localId).set({ count: 3 });
  const base = `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/${project}/databases/(default)/documents`;
  const url = `${base}/users/${user.localId}/dailyUsage/${new Date().toISOString().slice(0, 10)}`;
  const get = (target, token) => fetch(target, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
  const patch = (target, token) => fetch(target, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { count: { integerValue: '0' } } }),
  });

  assert.equal((await get(url, user.idToken)).status, 200);
  assert.equal((await get(`${base}/users/${user.localId}/prompts`, user.idToken)).status, 200);
  assert.equal((await get(url, other.idToken)).status, 403);
  assert.equal((await get(url, null)).status, 403);
  const nonGoogle = await account('facebook.com');
  assert.equal((await get(`${base}/users/${nonGoogle.localId}/prompts`, nonGoogle.idToken)).status, 403);

  assert.equal((await patch(url, user.idToken)).status, 403);
  assert.equal((await patch(`${base}/users/${user.localId}`, user.idToken)).status, 403);
  assert.equal((await patch(`${base}/users/${user.localId}/uploads/forged`, user.idToken)).status, 403);
  assert.equal((await patch(`${base}/other/doc`, user.idToken)).status, 403);
  assert.equal((await usage(user.localId).get()).data().count, 3);
});
