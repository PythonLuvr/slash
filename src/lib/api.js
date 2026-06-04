// Streaming BYOK API clients for the three providers Slash supports.
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

// --- Anthropic agent loop (tool use) ---
// One streaming turn. Accumulates text + tool_use content blocks and the
// stop reason. Text is streamed live through onDelta.
async function anthropicTurn({ apiKey, model, system, messages, tools, onDelta }) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({ model, max_tokens: 2048, stream: true, system, messages, tools }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const blocks = [];
  let cur = null;
  let jsonBuf = '';
  let stopReason = null;
  await readSSE(res, (data) => {
    if (data === '[DONE]') return;
    let evt;
    try {
      evt = JSON.parse(data);
    } catch {
      return;
    }
    if (evt.type === 'content_block_start') {
      cur = { ...evt.content_block };
      if (cur.type === 'text') cur.text = '';
      if (cur.type === 'tool_use') jsonBuf = '';
    } else if (evt.type === 'content_block_delta') {
      if (evt.delta?.type === 'text_delta') {
        cur.text += evt.delta.text;
        onDelta(evt.delta.text);
      } else if (evt.delta?.type === 'input_json_delta') {
        jsonBuf += evt.delta.partial_json || '';
      }
    } else if (evt.type === 'content_block_stop') {
      if (cur) {
        if (cur.type === 'tool_use') {
          try {
            cur.input = jsonBuf ? JSON.parse(jsonBuf) : {};
          } catch {
            cur.input = {};
          }
        }
        blocks.push(cur);
        cur = null;
      }
    } else if (evt.type === 'message_delta') {
      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
    }
  });
  return { blocks, stopReason };
}

// Run a full tool-use conversation: stream a turn, execute any tools the model
// asked for, feed the results back, and repeat until it stops calling tools.
async function runAnthropicAgent({ apiKey, model, system, messages, tools, onDelta, onTool, executeTool }) {
  const convo = messages.slice();
  for (let turn = 0; turn < 8; turn++) {
    const { blocks, stopReason } = await anthropicTurn({ apiKey, model, system, messages: convo, tools, onDelta });
    const content = blocks.map((b) =>
      b.type === 'text'
        ? { type: 'text', text: b.text }
        : { type: 'tool_use', id: b.id, name: b.name, input: b.input },
    );
    convo.push({ role: 'assistant', content: content.length ? content : [{ type: 'text', text: '' }] });
    if (stopReason !== 'tool_use') break;

    const results = [];
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue;
      if (onTool) onTool({ phase: 'start', name: b.name, input: b.input });
      let result;
      try {
        result = await executeTool(b.name, b.input);
      } catch (e) {
        result = 'Tool error: ' + (e && e.message ? e.message : String(e));
      }
      if (onTool) onTool({ phase: 'end', name: b.name, result });
      results.push({ type: 'tool_result', tool_use_id: b.id, content: String(result).slice(0, 12000) });
    }
    convo.push({ role: 'user', content: results });
  }
}

// kind -> streaming function. kind matches the apiKeys / apiModels keys.
const STREAMERS = {
  anthropic: streamAnthropic,
  openai: streamOpenAI,
  google: streamGoogle,
};

module.exports = { STREAMERS, runAnthropicAgent };
