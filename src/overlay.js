const $ = (id) => document.getElementById(id);
const KINDS = ['menu', 'profile', 'downloads', 'history', 'siteinfo', 'shield', 'setup', 'enginepick', 'tabmenu', 'extensions'];

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
  if (kind === 'menu') renderStats();
  if (kind === 'profile') renderProfile();
  if (kind === 'extensions') renderExtMenu();
});

// --- Extensions dropdown (puzzle button) ---
// Lists installed extensions: each row is the extension's action icon (click
// opens its popup), its name, and a pin toggle. Pinning promotes it to a
// dedicated toolbar button; everything unpinned lives here.
const PIN_ICON =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M9 4h6l-1 7 3 3H7l3-3z"/></svg>';
let extMenuPinned = [];
let extMenuPartition = null;

async function renderExtMenu() {
  const wrap = $('ext-list');
  if (!wrap) return;
  let data = { list: [], pinned: [], partition: null };
  try {
    data = await window.overlay.extMenu();
  } catch {
    /* ignore */
  }
  extMenuPinned = Array.isArray(data.pinned) ? data.pinned : [];
  extMenuPartition = data.partition || null;
  const part = extMenuPartition || '_self';
  let activeTab = -1;
  try {
    if (window.browserAction) {
      const st = await window.browserAction.getState(part);
      if (st && typeof st.activeTabId === 'number') activeTab = st.activeTabId;
    }
  } catch {
    /* ignore */
  }
  wrap.innerHTML = '';
  if (!data.list || !data.list.length) {
    wrap.innerHTML = '<div class="ext-empty">No extensions installed. Add one from Settings.</div>';
    return;
  }
  for (const e of data.list) {
    const row = document.createElement('div');
    row.className = 'ext-row';
    const icon = document.createElement('button', { is: 'browser-action' });
    icon.id = e.id;
    icon.className = 'ext-row-icon';
    if (extMenuPartition) icon.setAttribute('partition', extMenuPartition);
    icon.setAttribute('tab', String(activeTab));
    row.appendChild(icon);
    const name = document.createElement('span');
    name.className = 'ext-row-name';
    name.textContent = e.name || e.id;
    row.appendChild(name);
    const pin = document.createElement('button');
    pin.type = 'button';
    const pinned = extMenuPinned.includes(e.id);
    pin.className = 'ext-pin' + (pinned ? ' on' : '');
    pin.title = pinned ? 'Unpin from toolbar' : 'Pin to toolbar';
    pin.setAttribute('aria-label', pin.title);
    pin.innerHTML = PIN_ICON;
    pin.addEventListener('click', (ev) => {
      ev.stopPropagation();
      togglePin(e.id);
    });
    row.appendChild(pin);
    wrap.appendChild(row);
  }
}

function togglePin(id) {
  const set = new Set(extMenuPinned);
  if (set.has(id)) set.delete(id);
  else set.add(id);
  extMenuPinned = Array.from(set);
  window.overlay.extSetPinned(extMenuPinned);
  renderExtMenu();
}

// The profile is just your computer account: friendly name + account picture
// (or a monogram), read locally with no sign-in.
function renderProfilesList() {
  const wrap = $('pf-list');
  if (!wrap || !window.overlay.profilesList) return;
  window.overlay
    .profilesList()
    .then((list) => {
      wrap.innerHTML = '';
      for (const p of list || []) {
        const b = document.createElement('button');
        b.className = 'pop-item pf-row';
        const dot = document.createElement('span');
        dot.className = 'pf-dot';
        dot.style.background = p.color || '#f1cb53';
        b.appendChild(dot);
        b.appendChild(document.createTextNode(p.name || p.id));
        b.addEventListener('click', () => {
          window.overlay.openProfileWindow(p.id);
          window.overlay.close();
        });
        wrap.appendChild(b);
      }
    })
    .catch(() => {});
}

function renderProfile() {
  renderProfilesList();
  window.overlay
    .profile()
    .then((p) => {
      const name = (p && p.name) || 'You';
      const nameEl = $('pf-name');
      if (nameEl) nameEl.textContent = name;
      const av = $('pf-avatar');
      if (!av) return;
      if (p && p.picture) {
        av.textContent = '';
        const im = document.createElement('img');
        im.className = 'pf-img';
        im.alt = '';
        im.src = p.picture;
        av.appendChild(im);
      } else {
        av.textContent = (name.trim()[0] || '?').toUpperCase();
      }
    })
    .catch(() => {});
}

// Tab context menu: show pin or unpin depending on the tab's current state.
window.overlay.onTabmenu(({ pinned }) => {
  const pinBtn = document.querySelector('#tabmenu [data-tab="pin"]');
  const unpinBtn = document.querySelector('#tabmenu [data-tab="unpin"]');
  if (pinBtn) pinBtn.classList.toggle('hidden', !!pinned);
  if (unpinBtn) unpinBtn.classList.toggle('hidden', !pinned);
});
document.querySelectorAll('#tabmenu .pop-item[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => window.overlay.tabAction(btn.dataset.tab));
});

// Search-engine picker (opened from the omnibox button). Sets the one default.
window.overlay.onEnginepick(({ current, list }) => {
  const wrap = $('ep-list');
  if (!wrap) return;
  wrap.innerHTML = '';
  for (const e of list || []) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ep-row' + (e.id === current ? ' active' : '');
    const img = document.createElement('img');
    img.className = 'ep-fav';
    img.alt = '';
    const firstParty = 'https://' + e.domain.replace(/^www\./, '') + '/favicon.ico';
    window.overlay
      .favicon(e.domain)
      .then((d) => {
        img.src = d || firstParty;
      })
      .catch(() => {
        img.src = firstParty;
      });
    row.appendChild(img);
    const label = document.createElement('span');
    label.className = 'ep-label';
    label.textContent = e.label;
    row.appendChild(label);
    if (e.id === current) {
      const chk = document.createElement('span');
      chk.className = 'ep-check';
      chk.innerHTML = '&#10003;';
      row.appendChild(chk);
    }
    row.addEventListener('click', () => window.overlay.setSearchEngine(e.id));
    wrap.appendChild(row);
  }
  // Footer: open the full manager (all engines + add your own).
  const sep = document.createElement('div');
  sep.className = 'ep-sep';
  wrap.appendChild(sep);
  const manage = document.createElement('button');
  manage.type = 'button';
  manage.className = 'ep-row ep-manage';
  manage.textContent = 'Add or manage engines';
  manage.addEventListener('click', () => window.overlay.openSettingsPage('search'));
  wrap.appendChild(manage);
});

// Memory + tab readout in the menu footer (efficiency you can see).
function renderStats() {
  const el = $('menu-stats');
  if (!el) return;
  window.overlay
    .stats()
    .then((s) => {
      const tabs = `${s.tabs} tab${s.tabs === 1 ? '' : 's'}`;
      const asleep = s.asleep ? `, ${s.asleep} asleep` : '';
      el.textContent = `${s.memMB} MB · ${tabs}${asleep}`;
      const sel = $('menu-ram');
      if (sel) sel.value = String(typeof s.ramLimitMB === 'number' ? s.ramLimitMB : 500);
    })
    .catch(() => {
      el.textContent = '';
    });
}

// Quick memory-limit picker in the menu (mirrors Settings -> Performance).
{
  const ramSel = $('menu-ram');
  if (ramSel) {
    ramSel.addEventListener('change', () => {
      window.overlay.setRamLimit(parseInt(ramSel.value, 10) || 0);
    });
    // Clicking the select shouldn't bubble up and close the menu.
    ramSel.addEventListener('click', (e) => e.stopPropagation());
  }
}

const ACTIONS = {
  newtab: () => window.overlay.newTab(),
  private: () => window.overlay.newPrivateTab(),
  reopen: () => window.overlay.reopenTab(),
  'zoom-in': () => window.overlay.zoom('in'),
  'zoom-out': () => window.overlay.zoom('out'),
  'zoom-reset': () => window.overlay.zoom('reset'),
  ai: () => window.overlay.toggleAI(),
  settings: () => window.overlay.openSettingsPage(),
  // Profile menu: passwords and privacy jump to their settings section.
  passwords: () => window.overlay.openSettingsPage('passwords'),
  privacy: () => window.overlay.openSettingsPage('privacy'),
  'new-profile': () => window.overlay.createProfile && window.overlay.createProfile(),
  'manage-profiles': () => window.overlay.openSettingsPage('profiles'),
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
    if (act === 'import') {
      window.overlay.openSetup(); // switches this layer to the import picker
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

// --- First-run setup picker (make default + import) ---
function fmt(n) {
  return (n || 0).toLocaleString();
}
function availableTypes(s) {
  const t = [];
  if (s.bookmarks > 0) t.push('bookmarks');
  if (s.history > 0) t.push('history');
  if (s.cookies) t.push('cookies');
  if (s.passwords > 0) t.push('passwords');
  return t;
}
function typeSummary(s) {
  const parts = [];
  if (s.bookmarks > 0) parts.push(`${fmt(s.bookmarks)} bookmarks`);
  if (s.history > 0) parts.push(`${fmt(s.history)} history`);
  if (s.cookies) parts.push('sessions');
  if (s.passwords > 0) parts.push(`${fmt(s.passwords)} passwords`);
  return parts.join(' · ') || 'nothing to import';
}

let setupSources = [];
window.overlay.onSetupDefault((isDef) => {
  $('setup-default-sub').textContent = isDef
    ? 'Slash handles web links on this device.'
    : 'Open web links in Slash. Windows will ask you to confirm.';
  $('setup-default-btn').textContent = isDef ? 'Set again' : 'Set as default';
});
window.overlay.onSetupSources((list) => {
  setupSources = Array.isArray(list) ? list : [];
  // Fresh state each time the picker opens.
  importDone = false;
  const ib = $('setup-import');
  ib.disabled = false;
  ib.textContent = 'Import selected';
  $('setup-status').textContent = '';
  const wrap = $('setup-sources');
  wrap.innerHTML = '';
  const importable = setupSources.filter((s) => availableTypes(s).length);
  if (!importable.length) {
    wrap.innerHTML = '<div class="setup-empty">No other browsers found on this computer.</div>';
    return;
  }
  for (const s of importable) {
    const row = document.createElement('label');
    row.className = 'setup-src';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.id = s.id;
    const txt = document.createElement('div');
    txt.className = 'setup-src-txt';
    const nm = document.createElement('div');
    nm.className = 'setup-src-name';
    nm.textContent = s.name;
    const sub = document.createElement('div');
    sub.className = 'setup-src-sub';
    sub.textContent = typeSummary(s);
    txt.appendChild(nm);
    txt.appendChild(sub);
    row.appendChild(cb);
    row.appendChild(txt);
    wrap.appendChild(row);
  }
});

$('setup-default-btn').addEventListener('click', async () => {
  $('setup-default-btn').textContent = 'Opening Default Apps…';
  try {
    await window.overlay.setDefault();
  } catch {
    /* ignore */
  }
});

$('setup-skip').addEventListener('click', () => window.overlay.close());

let importDone = false;
$('setup-import').addEventListener('click', async () => {
  const btn = $('setup-import');
  // After a finished import the primary button reads "Done" and just closes.
  if (importDone) {
    window.overlay.close();
    return;
  }
  const checked = [...document.querySelectorAll('#setup-sources input:checked')];
  const status = $('setup-status');
  if (!checked.length) {
    status.textContent = 'Pick at least one browser.';
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Importing…';
  let totalMarks = 0;
  let totalHist = 0;
  let totalSessions = 0;
  let totalPwds = 0;
  for (const cb of checked) {
    const s = setupSources.find((x) => x.id === cb.dataset.id);
    if (!s) continue;
    const types = availableTypes(s);
    let r = {};
    try {
      r = await window.overlay.migrateRun(s.id, types);
    } catch {
      r = {};
    }
    totalMarks += r.bookmarks || 0;
    totalHist += r.history || 0;
    if (r.cookies) totalSessions += r.cookies.imported || 0;
    if (r.passwords) totalPwds += r.passwords.imported || 0;
  }
  const parts = [];
  if (totalMarks) parts.push(`${fmt(totalMarks)} bookmarks`);
  if (totalHist) parts.push(`${fmt(totalHist)} history`);
  if (totalSessions) parts.push(`${fmt(totalSessions)} sessions`);
  if (totalPwds) parts.push(`${fmt(totalPwds)} passwords`);
  status.textContent = parts.length ? `Imported ${parts.join(' · ')}.` : 'Imported. Some items may need the browser closed.';
  // Re-enable as a working "Done" that closes the picker.
  importDone = true;
  btn.disabled = false;
  btn.textContent = 'Done';
});
