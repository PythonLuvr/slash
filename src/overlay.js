const $ = (id) => document.getElementById(id);
const KINDS = ['menu', 'profile', 'downloads', 'history', 'siteinfo', 'shield'];

const hsearch = $('hsearch');

window.overlay.onShow((kind) => {
  for (const k of KINDS) $(k).classList.toggle('hidden', k !== kind);
  if (kind === 'history') {
    if (hsearch) {
      hsearch.value = '';
      setTimeout(() => hsearch.focus(), 0);
    }
    renderHistory();
  }
});

const ACTIONS = {
  newtab: () => window.overlay.newTab(),
  reopen: () => window.overlay.reopenTab(),
  'zoom-in': () => window.overlay.zoom('in'),
  'zoom-out': () => window.overlay.zoom('out'),
  'zoom-reset': () => window.overlay.zoom('reset'),
  ai: () => window.overlay.toggleAI(),
  settings: () => window.overlay.openSettings(),
};

document.querySelectorAll('.pop-item[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const act = btn.dataset.act;
    if (act === 'history') {
      window.overlay.openHistory(); // switches this layer to the history view
      return;
    }
    if (act === 'find') {
      window.overlay.openFind();
      window.overlay.close();
      return;
    }
    (ACTIONS[act] || (() => {}))();
    window.overlay.close();
  });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.overlay.close();
});

// --- Downloads ---
function pct(d) {
  if (!d.total) return 'Downloading';
  return Math.round((d.received / d.total) * 100) + '%';
}
window.overlay.onDownloads((list) => {
  const wrap = $('dl-list');
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = '<div class="dl-empty">No downloads yet</div>';
    return;
  }
  for (const d of list) {
    const row = document.createElement('div');
    row.className = 'dl-row';
    const name = document.createElement('div');
    name.className = 'dl-name';
    name.textContent = d.name;
    name.title = d.name;
    const meta = document.createElement('div');
    meta.className = 'dl-meta';
    meta.textContent =
      d.state === 'completed' ? 'Open' : d.state === 'progressing' ? pct(d) : d.state;
    row.appendChild(name);
    row.appendChild(meta);
    if (d.state === 'completed') {
      row.classList.add('done');
      row.addEventListener('click', () => window.overlay.openDownload(d.id));
    }
    wrap.appendChild(row);
  }
});

// --- History ---
let historyData = [];
function renderHistory() {
  const wrap = $('hlist');
  if (!wrap) return;
  const q = (hsearch && hsearch.value ? hsearch.value : '').toLowerCase();
  const items = historyData.filter(
    (h) =>
      !q ||
      (h.title || '').toLowerCase().includes(q) ||
      (h.url || '').toLowerCase().includes(q),
  );
  wrap.innerHTML = '';
  if (!items.length) {
    wrap.innerHTML = '<div class="h-empty">No history yet</div>';
    return;
  }
  for (const h of items.slice(0, 300)) {
    const row = document.createElement('div');
    row.className = 'hrow';
    row.title = h.url;
    const t = document.createElement('div');
    t.className = 'ht';
    t.textContent = h.title || h.url;
    const u = document.createElement('div');
    u.className = 'hu';
    u.textContent = h.url;
    row.appendChild(t);
    row.appendChild(u);
    row.addEventListener('click', () => {
      window.overlay.openUrl(h.url);
      window.overlay.close();
    });
    wrap.appendChild(row);
  }
}
window.overlay.onHistory((list) => {
  historyData = list || [];
  renderHistory();
});
if (hsearch) hsearch.addEventListener('input', renderHistory);
if ($('hclear')) $('hclear').addEventListener('click', () => window.overlay.clearHistory());

// --- Site info ---
const PERM_NAMES = {
  media: 'Camera & microphone',
  geolocation: 'Location',
  notifications: 'Notifications',
  'clipboard-read': 'Clipboard',
  midi: 'MIDI devices',
  midiSysex: 'MIDI devices',
};
window.overlay.onSiteinfo((data) => {
  const status = $('si-status');
  const secure = data.secure === 'secure';
  status.textContent = secure ? 'Connection is secure' : 'Connection is not secure';
  status.classList.toggle('insecure', !secure);
  $('si-host').textContent = data.host || '';
  const wrap = $('si-perms');
  wrap.innerHTML = '';
  if (!data.permissions || !data.permissions.length) {
    wrap.innerHTML = '<div class="si-empty">This site has not requested any permissions.</div>';
    return;
  }
  for (const p of data.permissions) {
    const row = document.createElement('div');
    row.className = 'si-perm';
    const name = document.createElement('span');
    name.className = 'si-perm-name';
    name.textContent = PERM_NAMES[p.perm] || p.perm;
    const state = document.createElement('span');
    state.className = 'si-perm-state ' + (p.decision === 'allow' ? 'allow' : 'block');
    state.textContent = p.decision === 'allow' ? 'Allowed' : 'Blocked';
    const reset = document.createElement('button');
    reset.className = 'si-perm-reset';
    reset.type = 'button';
    reset.title = 'Reset to ask';
    reset.setAttribute('aria-label', 'Reset ' + (PERM_NAMES[p.perm] || p.perm));
    reset.innerHTML = '&#10005;';
    reset.addEventListener('click', () => window.overlay.clearPermission(data.origin, p.perm));
    row.appendChild(name);
    row.appendChild(state);
    row.appendChild(reset);
    wrap.appendChild(row);
  }
});

// --- Shield (ad/tracker blocking) ---
window.overlay.onShield((data) => {
  $('sh-num').textContent = data.count;
  $('sh-toggle').classList.toggle('on', data.enabled);
});
$('sh-toggle').addEventListener('click', () => window.overlay.toggleBlocker());
