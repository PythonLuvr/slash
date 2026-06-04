// Streaming BYOK API clients for the three providers Loom supports.
// Each function streams assistant text back through an onDelta callback,
// using the user's own API key. No keys, endpoints, or models are baked
// in beyond public, editable defaults.

// Read a fetch Response body as Server-Sent Events, calling onData with
// each "data:" payload string.
async function readSSE(res, onData) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.startsWith('data:')) onData(line.slice(5).trim());
    }
  }
}

async function streamAnthropic({ apiKey, model, messages, onDelta }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 2048, stream: true, messages }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  await readSSE(res, (data) => {
    if (data === '[DONE]') return;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      onDelta(evt.delta.text);
    }
  });
}

async function streamOpenAI({ apiKey, model, messages, onDelta }) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + apiKey,
    },
    body: JSON.stringify({ model, stream: true, messages }),
  });
  if (!res.ok) throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
  await readSSE(res, (data) => {
    if (data === '[DONE]') return;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    const delta = evt.choices?.[0]?.delta?.content;
    if (delta) onDelta(delta);
  });
}

async function streamGoogle({ apiKey, model, messages, onDelta }) {
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}` +
    `:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`;
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents }),
  });
  if (!res.ok) throw new Error(`Google API ${res.status}: ${await res.text()}`);
  await readSSE(res, (data) => {
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    const parts = evt.candidates?.[0]?.content?.parts;
    if (parts) for (const p of parts) if (p.text) onDelta(p.text);
  });
}

// kind -> streaming function. kind matches the apiKeys / apiModels keys.
const STREAMERS = {
  anthropic: streamAnthropic,
  openai: streamOpenAI,
  google: streamGoogle,
};

module.exports = { STREAMERS };
