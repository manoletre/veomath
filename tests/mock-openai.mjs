// Loaded only into the integration-test server. No real OpenAI calls are made.
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url || input.href);
  if (url.hostname !== 'api.openai.com') return originalFetch(input, init);
  const body = typeof init?.body === 'string' ? init.body : '';
  if (body.includes('__upstream_error__')) {
    return Response.json({ error: { message: process.env.OPENAI_API_KEY } }, { status: 500 });
  }
  if (url.pathname === '/v1/files') {
    return Response.json({ id: `file-${crypto.randomUUID()}`, object: 'file' });
  }
  const result = body.includes('explainer_plan')
    ? { sessionTitle: 'Test plan', items: [{ type: 'text', content: 'Test', title: '', description: '' }] }
    : { explanation: 'A mock visualization.', manimCode: 'scene.add(new Circle());' };
  return Response.json({ id: 'test-completion', choices: [{ message: { role: 'assistant', content: JSON.stringify(result) } }] });
};
