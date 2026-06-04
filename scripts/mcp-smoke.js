// Smoke test the local MCP server protocol (initialize -> tools/list ->
// tools/call -> auth reject). Run: node scripts/mcp-smoke.js
const { startMcpServer } = require('../src/lib/mcp-server.js');

(async () => {
  const tools = [
    {
      name: 'echo',
      description: 'Echo back',
      input_schema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
    },
  ];
  const mcp = await startMcpServer({ tools, executeTool: async (n, i) => 'echoed: ' + i.msg });
  const H = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: 'Bearer ' + mcp.token,
  };
  let r = await fetch(mcp.url, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
    }),
  });
  const sid = r.headers.get('mcp-session-id');
  console.log('INIT', r.status, 'session:', sid ? 'yes' : 'NO');
  const H2 = { ...H, 'mcp-session-id': sid };
  await fetch(mcp.url, {
    method: 'POST',
    headers: H2,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  r = await fetch(mcp.url, {
    method: 'POST',
    headers: H2,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  console.log('TOOLS/LIST', r.status, (await r.text()).replace(/\n/g, ' ').slice(0, 220));
  r = await fetch(mcp.url, {
    method: 'POST',
    headers: H2,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo', arguments: { msg: 'hi' } },
    }),
  });
  console.log('TOOLS/CALL', r.status, (await r.text()).replace(/\n/g, ' ').slice(0, 220));
  r = await fetch(mcp.url, { method: 'POST', headers: { ...H, authorization: 'Bearer wrong' }, body: '{}' });
  console.log('AUTH-REJECT', r.status);
  mcp.close();
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e.message);
  process.exit(1);
});
