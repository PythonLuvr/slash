// Providers shown in the picker. kind matches the apiKeys / apiModels
// entries in settings (anthropic / google / openai).
const PROVIDERS = [
  { id: 'claude', label: 'Claude', kind: 'anthropic', domain: 'claude.ai' },
  { id: 'gemini', label: 'Gemini', kind: 'google', domain: 'gemini.google.com' },
  { id: 'openai', label: 'ChatGPT', kind: 'openai', domain: 'chatgpt.com' },
];

const $ = (id) => document.getElementById(id);

// A provider logo (favicon), falling back to the spark glyph if it fails.
function providerLogo(p) {
  const img = document.createElement('img');
  img.className = 'pk-logo';
  img.src = `https://icons.duckduckgo.com/ip3/${p.domain}.ico`;
  img.alt = '';
  img.addEventListener('error', () => {
    const sp = document.createElement('span');
    sp.className = 'spark';
    sp.textContent = '✦';
    img.replaceWith(sp);
  });
  return img;
}
const input = $('input');
const thread = $('thread');

let settings = null;
let selection = { provider: 'claude', variant: 'cli' };
const conversationId = 'c' + Date.now() + '-' + Math.floor(Math.random() * 1e6);
let transcript = [];
let current = null; // { el, buf } for the streaming assistant bubble

function providerLabel(id) {
  return (PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]).label;
}

function updatePickerLabel() {
  $('picker-label').textContent =
    providerLabel(selection.provider) + ' · ' + selection.variant.toUpperCase();
  input.placeholder = 'Message ' + providerLabel(selection.provider);
  const p = PROVIDERS.find((x) => x.id === selection.provider) || PROVIDERS[0];
  const logo = $('picker-logo');
  if (logo) logo.src = `https://icons.duckduckgo.com/ip3/${p.domain}.ico`;
}

async function loadSettings() {
  settings = await window.ai.getSettings();
  if (settings.selection) selection = settings.selection;
  updatePickerLabel();
}

// --- Picker menu (provider rows + CLI/API toggle) ---
function buildPickerMenu() {
  const menu = $('picker-menu');
  menu.innerHTML = '';
  for (const p of PROVIDERS) {
    const row = document.createElement('div');
    row.className = 'pk-row';

    const name = document.createElement('span');
    name.className = 'pk-name';
    name.appendChild(providerLogo(p));
    const nameLabel = document.createElement('span');
    nameLabel.textContent = p.label;
    name.appendChild(nameLabel);
    row.appendChild(name);

    const toggle = document.createElement('div');
    toggle.className = 'pk-toggle';
    const hasKey = !!(settings && settings.apiKeys && settings.apiKeys[p.kind]);

    for (const v of ['cli', 'api']) {
      const seg = document.createElement('button');
      seg.type = 'button';
      seg.className = 'pk-seg';
      seg.textContent = v.toUpperCase();
      if (selection.provider === p.id && selection.variant === v) seg.classList.add('active');
      if (v === 'api' && !hasKey) seg.classList.add('needs-key');
      seg.addEventListener('click', (e) => {
        e.stopPropagation();
        // API with no key set: jump straight to Settings instead of failing.
        if (v === 'api' && !hasKey) {
          openSettings();
          closePicker();
          return;
        }
        selection = { provider: p.id, variant: v };
        window.ai.saveSettings({ selection });
        updatePickerLabel();
        buildPickerMenu();
        closePicker();
      });
      toggle.appendChild(seg);
    }
    row.appendChild(toggle);
    menu.appendChild(row);
  }
}

function openPicker() {
  buildPickerMenu();
  $('picker-menu').classList.remove('hidden');
}
function closePicker() {
  $('picker-menu').classList.add('hidden');
}
$('picker').addEventListener('click', (e) => {
  e.stopPropagation();
  $('picker-menu').classList.contains('hidden') ? openPicker() : closePicker();
});
document.addEventListener('click', closePicker);

// --- Settings view (BYOK keys + editable model ids) ---
const ACCENT_PRESETS = ['#e8232e', '#d11f3a', '#f5a623', '#4f8cff', '#41c08a', '#a06cff'];

function applyAccentLive(hex) {
  settings.accent = hex;
  window.ai.saveSettings({ accent: hex });
}

function buildSettingsForm() {
  const body = $('settings-body');
  body.innerHTML = '';

  // Appearance: themeable accent
  const appear = document.createElement('div');
  appear.className = 'set-block';
  const aTitle = document.createElement('div');
  aTitle.className = 'set-title';
  aTitle.textContent = 'Appearance';
  appear.appendChild(aTitle);

  const aField = document.createElement('div');
  aField.className = 'set-field';
  const aLabel = document.createElement('span');
  aLabel.textContent = 'accent color';
  aField.appendChild(aLabel);

  const row = document.createElement('div');
  row.className = 'accent-row';
  const color = document.createElement('input');
  color.type = 'color';
  color.value = settings.accent || '#e8232e';
  color.addEventListener('change', () => applyAccentLive(color.value));
  row.appendChild(color);
  for (const p of ACCENT_PRESETS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch';
    sw.style.background = p;
    sw.setAttribute('aria-label', 'Accent ' + p);
    sw.addEventListener('click', () => {
      color.value = p;
      applyAccentLive(p);
    });
    row.appendChild(sw);
  }
  aField.appendChild(row);
  appear.appendChild(aField);
  body.appendChild(appear);

  for (const p of PROVIDERS) {
    const block = document.createElement('div');
    block.className = 'set-block';

    const title = document.createElement('div');
    title.className = 'set-title';
    title.appendChild(providerLogo(p));
    const titleLabel = document.createElement('span');
    titleLabel.textContent = p.label;
    title.appendChild(titleLabel);
    block.appendChild(title);

    const keyField = document.createElement('label');
    keyField.className = 'set-field';
    const keyLabel = document.createElement('span');
    keyLabel.textContent = p.kind + ' API key';
    const key = document.createElement('input');
    key.type = 'password';
    key.placeholder = 'paste your key';
    key.value = settings.apiKeys[p.kind] || '';
    key.dataset.kind = p.kind;
    key.className = 'set-key';
    keyField.appendChild(keyLabel);
    keyField.appendChild(key);
    block.appendChild(keyField);

    const modelField = document.createElement('label');
    modelField.className = 'set-field';
    const modelLabel = document.createElement('span');
    modelLabel.textContent = 'API model';
    const model = document.createElement('input');
    model.type = 'text';
    model.value = settings.apiModels[p.kind] || '';
    model.dataset.kind = p.kind;
    model.className = 'set-model';
    modelField.appendChild(modelLabel);
    modelField.appendChild(model);
    block.appendChild(modelField);

    body.appendChild(block);
  }
}

function openSettings() {
  buildSettingsForm();
  $('chat').classList.add('hidden');
  $('settings').classList.remove('hidden');
}
function closeSettings() {
  $('settings').classList.add('hidden');
  $('chat').classList.remove('hidden');
}
$('gear').addEventListener('click', openSettings);
$('settings-back').addEventListener('click', closeSettings);
$('settings-save').addEventListener('click', async () => {
  const apiKeys = {};
  const apiModels = {};
  for (const el of document.querySelectorAll('.set-key')) apiKeys[el.dataset.kind] = el.value.trim();
  for (const el of document.querySelectorAll('.set-model')) apiModels[el.dataset.kind] = el.value.trim();
  settings = await window.ai.saveSettings({ apiKeys, apiModels });
  buildPickerMenu();
  closeSettings();
});

// --- Chat ---
function appendMessage(role, text) {
  $('empty').classList.add('hidden');
  const wrap = document.createElement('div');
  wrap.className = 'msg ' + role;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  wrap.appendChild(bubble);
  thread.appendChild(wrap);
  thread.scrollTop = thread.scrollHeight;
  return bubble;
}

function sendAI() {
  const text = input.value.trim();
  if (!text) return;
  appendMessage('user', text);
  transcript.push({ role: 'user', text });
  input.value = '';
  autoGrow();

  const el = appendMessage('assistant', '');
  el.classList.add('thinking');
  el.textContent = '…';
  current = { el, buf: '' };

  window.ai.send({
    conversationId,
    provider: selection.provider,
    variant: selection.variant,
    transcript,
  });
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 160) + 'px';
}
input.addEventListener('input', autoGrow);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendAI();
  }
});
$('send').addEventListener('click', sendAI);

// --- Stream wiring ---
window.ai.onDelta((d) => {
  if (d.conversationId !== conversationId || !current) return;
  if (current.el.classList.contains('thinking')) {
    current.el.classList.remove('thinking');
    current.el.textContent = '';
  }
  current.buf += d.delta;
  current.el.textContent = current.buf;
  thread.scrollTop = thread.scrollHeight;
});
window.ai.onError((d) => {
  if (d.conversationId !== conversationId || !current) return;
  current.el.classList.remove('thinking');
  current.el.classList.add('error');
  current.el.textContent = (current.buf ? current.buf + '\n\n' : '') + '[error] ' + d.message;
});
window.ai.onDone((d) => {
  if (d.conversationId !== conversationId || !current) return;
  if (current.el.classList.contains('thinking')) {
    current.el.classList.remove('thinking');
    current.el.textContent = '[no response]';
  }
  transcript.push({ role: 'assistant', text: current.buf });
  current = null;
});

window.ai.onOpenSettings(() => openSettings());

// A prompt handed over from the hero's Ask AI mode: set the chosen model,
// drop the text in, and send.
window.ai.onPrompt((payload) => {
  const text = typeof payload === 'string' ? payload : payload.text;
  const provider = payload && typeof payload === 'object' ? payload.provider : null;
  closeSettings();
  if (provider && PROVIDERS.find((p) => p.id === provider)) {
    selection = { provider, variant: selection.variant };
    window.ai.saveSettings({ selection });
    updatePickerLabel();
  }
  if (text) {
    input.value = text;
    sendAI();
  }
});

loadSettings();
input.focus();
