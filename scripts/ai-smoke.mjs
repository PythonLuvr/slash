// One-shot smoke test: does Squire -> claude CLI stream text back?
import { Squire } from '@pythonluvr/squire';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = join(here, '..', '.ai-scratch');
mkdirSync(cwd, { recursive: true });

const squire = new Squire({
  binary: 'claude',
  adapter: 'claude-code',
  args: ['-p', '--output-format', 'stream-json', '--verbose'],
  cwd,
  timeoutMs: 80000,
});

let text = '';
let sawDelta = false;
squire.on('event', (ev) => {
  if (ev.type === 'text_delta') {
    sawDelta = true;
    text += ev.delta;
    process.stdout.write(ev.delta);
  } else if (ev.type === 'error') {
    console.error('\n[event error]', ev.error?.message);
  }
});
squire.on('exit', (code) => {
  console.log('\n---');
  console.log('sawTextDelta:', sawDelta);
  console.log('exitCode:', code);
  console.log('chars:', text.length);
});

await squire.start('Reply with exactly these two words and nothing else: BRIDGE OK');
