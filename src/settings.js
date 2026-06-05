const $ = (id) => document.getElementById(id);

// Filled from the shared engine list (search:get) so settings, the start page,
// and the omnibox picker show the same engines.
let ENGINES = [
  { id: 'duckduckgo', label: 'DuckDuckGo', domain: 'duckduckgo.com' },
  { id: 'google', label: 'Google', domain: 'google.com' },
  { id: 'wikipedia', label: 'Wikipedia', domain: 'wikipedia.org' },
];

// Accent presets, all light enough to carry the dark --on-accent text.
const ACCENTS = ['#f1cb53', '#f0976c', '#8fd98a', '#6cc2f0', '#b79bf0', '#f08aa8'];

let current = null;

let heroFavs = [];

async function load(section) {
  current = await window.settings.get();
  try {
    const r = await window.settings.searchGet();
    if (r && Array.isArray(r.list) && r.list.length) ENGINES = r.list;
    if (r && Array.isArray(r.favorites)) heroFavs = r.favorites.slice();
  } catch {
    /* keep defaults */
  }
  renderEngines();
  renderToggles();
  renderAccents();
  renderDefault();
  renderMigrate();
  renderVault();
  renderExtensions();
  scrollToSection(section);
}

// Jump to a section when opened from a shortcut (e.g. the profile menu).
function scrollToSection(section) {
  const el = section ? document.getElementById('sec-' + section) : null;
  // Top of page by default so a plain open always starts clean.
  window.scrollTo({ top: 0 });
  if (el) {
    // After layout settles (dynamic sections render async), bring it into view.
    requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }
}

async function renderDefault() {
  let isDef = false;
  try {
    isDef = await window.settings.defaultStatus();
  } catch {
    /* ignore */
  }
  $('default-desc').textContent = isDef
    ? 'Slash is registered to handle web links on this device.'
    : 'Open web links in Slash. Windows will ask you to confirm in Default Apps.';
  $('set-default').textContent = isDef ? 'Set again' : 'Set as default';
}
$('set-default').addEventListener('click', async () => {
  $('set-default').textContent = 'Opening Default Apps…';
  await window.settings.setDefault();
  setTimeout(renderDefault, 500);
});

function fmt(n) {
  return (n || 0).toLocaleString();
}

async function renderMigrate() {
  const wrap = $('migrate-list');
  wrap.innerHTML = '<div class="import-empty">Looking for browsers…</div>';
  let sources = [];
  try {
    sources = await window.settings.migrateSources();
  } catch {
    /* ignore */
  }
  wrap.innerHTML = '';
  if (!sources.length) {
    wrap.innerHTML = '<div class="import-empty">No other browsers found on this computer.</div>';
    return;
  }
  for (const s of sources) {
    const card = document.createElement('div');
    card.className = 'migrate-card';

    const head = document.createElement('div');
    head.className = 'migrate-head';
    head.textContent = s.name;
    card.appendChild(head);

    const opts = document.createElement('div');
    opts.className = 'migrate-opts';
    const checks = {};
    const addOpt = (key, label, enabled) => {
      const lab = document.createElement('label');
      lab.className = 'migrate-opt' + (enabled ? '' : ' off');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = enabled;
      cb.disabled = !enabled;
      checks[key] = cb;
      lab.appendChild(cb);
      const sp = document.createElement('span');
      sp.textContent = label;
      lab.appendChild(sp);
      opts.appendChild(lab);
    };
    addOpt('bookmarks', `Bookmarks (${fmt(s.bookmarks)})`, s.bookmarks > 0);
    addOpt('history', `History (${fmt(s.history)})`, s.history > 0);
    addOpt('cookies', 'Stay signed in (cookies)', !!s.cookies);
    addOpt('passwords', `Passwords (${fmt(s.passwords)})`, s.passwords > 0);
    card.appendChild(opts);

    const foot = document.createElement('div');
    foot.className = 'migrate-foot';
    const status = document.createElement('div');
    status.className = 'migrate-status';
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.type = 'button';
    btn.textContent = 'Import';
    btn.addEventListener('click', async () => {
      const types = Object.keys(checks).filter((k) => checks[k].checked);
      if (!types.length) {
        status.textContent = 'Pick something to import.';
        return;
      }
      btn.disabled = true;
      btn.textContent = 'Importing…';
      status.textContent = '';
      let r = {};
      try {
        r = await window.settings.migrateRun(s.id, types);
      } catch {
        r = { error: 'import failed' };
      }
      btn.textContent = 'Done';
      const parts = [];
      if ('bookmarks' in r) parts.push(`${fmt(r.bookmarks)} bookmarks`);
      if ('history' in r) parts.push(`${fmt(r.history)} history`);
      if (r.cookies) {
        let c = `${fmt(r.cookies.imported)} sessions kept`;
        if (r.cookies.appBound) c += `, ${fmt(r.cookies.appBound)} protected`;
        parts.push(c);
      }
      if (r.passwords) {
        let p = `${fmt(r.passwords.imported)} passwords`;
        if (r.passwords.appBound) p += `, ${fmt(r.passwords.appBound)} protected`;
        parts.push(p);
      }
      const errs = [];
      if (r.cookiesError) errs.push('cookies need the browser closed');
      if (r.historyError) errs.push('history needs the browser closed');
      if (r.passwordsError) errs.push('passwords need the browser closed');
      status.textContent = (parts.join(' · ') || 'Nothing imported') + (errs.length ? ` (${errs.join('; ')})` : '');
      renderVault();
    });
    foot.appendChild(status);
    foot.appendChild(btn);
    card.appendChild(foot);
    wrap.appendChild(card);
  }
}

async function renderVault() {
  const wrap = $('vault-list');
  const desc = $('vault-desc');
  let logins = [];
  try {
    logins = await window.settings.vaultList();
  } catch {
    /* ignore */
  }
  desc.textContent = logins.length
    ? `${logins.length} saved login${logins.length === 1 ? '' : 's'}, encrypted on this device and filled only on the site they belong to.`
    : 'Stored encrypted on this device and filled only on the site they belong to.';
  wrap.innerHTML = '';
  for (const l of logins) {
    const row = document.createElement('div');
    row.className = 'vault-row';
    const info = document.createElement('div');
    info.className = 'vault-info';
    const host = document.createElement('div');
    host.className = 'vault-host';
    host.textContent = l.host;
    const user = document.createElement('div');
    user.className = 'vault-user';
    user.textContent = l.username || '(no username)';
    info.appendChild(host);
    info.appendChild(user);
    const del = document.createElement('button');
    del.className = 'vault-del';
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove login');
    del.innerHTML = '&#10005;';
    del.addEventListener('click', async () => {
      await window.settings.vaultRemove(l.host, l.username);
      renderVault();
    });
    row.appendChild(info);
    row.appendChild(del);
    wrap.appendChild(row);
  }
}

$('import-csv').addEventListener('click', async () => {
  const btn = $('import-csv');
  btn.disabled = true;
  btn.textContent = 'Importing…';
  let r = {};
  try {
    r = await window.settings.vaultImportCsv();
  } catch {
    r = { error: 'import failed' };
  }
  btn.disabled = false;
  if (r.canceled) {
    btn.textContent = 'Import from CSV';
  } else if (r.error) {
    btn.textContent = 'Import from CSV';
    $('vault-desc').textContent = 'Could not read that CSV. Export passwords from your old browser and try again.';
  } else {
    btn.textContent = `Added ${r.added || 0}`;
    setTimeout(() => (btn.textContent = 'Import from CSV'), 2500);
    renderVault();
  }
});

function engineFavicon(img, e) {
  const firstParty = 'https://' + e.domain.replace(/^www\./, '') + '/favicon.ico';
  img.addEventListener('error', () => img.remove(), { once: true });
  window.settings
    .favicon(e.domain)
    .then((d) => {
      img.src = d || firstParty;
    })
    .catch(() => {
      img.src = firstParty;
    });
}

function renderEngines() {
  const wrap = $('engines');
  wrap.innerHTML = '';
  for (const e of ENGINES) {
    const row = document.createElement('div');
    row.className = 'engine-row';

    const img = document.createElement('img');
    img.className = 'erow-fav';
    img.alt = '';
    engineFavicon(img, e);
    row.appendChild(img);

    const name = document.createElement('div');
    name.className = 'erow-name';
    name.textContent = e.label;
    row.appendChild(name);

    // Default selector.
    const isDefault = e.id === current.searchEngine;
    const def = document.createElement('button');
    def.type = 'button';
    def.className = 'erow-default' + (isDefault ? ' on' : '');
    def.textContent = isDefault ? 'Default' : 'Set default';
    def.addEventListener('click', async () => {
      current = await window.settings.set({ searchEngine: e.id });
      renderEngines();
    });
    row.appendChild(def);

    // Start-page (quick-pick) star toggle.
    const onHero = heroFavs.includes(e.id);
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'erow-star' + (onHero ? ' on' : '');
    star.title = onHero ? 'Showing on the start page' : 'Add to the start page';
    star.setAttribute('aria-label', star.title);
    star.innerHTML = onHero ? '&#9733;' : '&#9734;';
    star.addEventListener('click', () => {
      if (onHero) {
        if (heroFavs.length > 1) heroFavs = heroFavs.filter((x) => x !== e.id);
      } else {
        heroFavs = [...heroFavs, e.id];
      }
      window.settings.setHeroEngines(heroFavs);
      renderEngines();
    });
    row.appendChild(star);

    // Custom engines can be deleted.
    if (e.custom) {
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'erow-del';
      del.title = 'Delete engine';
      del.setAttribute('aria-label', 'Delete ' + e.label);
      del.innerHTML = '&#10005;';
      del.addEventListener('click', async () => {
        await window.settings.removeEngine(e.id);
        await refreshEngines();
      });
      row.appendChild(del);
    }

    wrap.appendChild(row);
  }
}

// Re-pull the engine list + favorites after add/remove, without scrolling.
async function refreshEngines() {
  try {
    const r = await window.settings.searchGet();
    if (r && Array.isArray(r.list)) ENGINES = r.list;
    if (r && Array.isArray(r.favorites)) heroFavs = r.favorites.slice();
    current = await window.settings.get();
  } catch {
    /* ignore */
  }
  renderEngines();
}

async function addCustomEngine() {
  const msg = $('ce-msg');
  const label = $('ce-name').value.trim();
  const url = $('ce-url').value.trim();
  const r = await window.settings.addEngine(label, url);
  if (r && r.error) {
    msg.textContent = r.error;
    msg.classList.add('err');
    return;
  }
  msg.textContent = '';
  msg.classList.remove('err');
  $('ce-name').value = '';
  $('ce-url').value = '';
  await refreshEngines();
}
$('ce-add').addEventListener('click', addCustomEngine);
$('ce-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addCustomEngine();
});

// --- Chrome extensions ---
async function renderExtensions() {
  const wrap = $('ext-list');
  if (!wrap) return;
  let list = [];
  try {
    list = await window.settings.extList();
  } catch {
    /* ignore */
  }
  wrap.innerHTML = '';
  if (!list.length) {
    wrap.innerHTML = '<div class="import-empty">No extensions loaded.</div>';
    return;
  }
  for (const e of list) {
    const row = document.createElement('div');
    row.className = 'vault-row';
    const info = document.createElement('div');
    info.className = 'vault-info';
    const name = document.createElement('div');
    name.className = 'vault-host';
    name.textContent = e.name || e.id;
    const ver = document.createElement('div');
    ver.className = 'vault-user';
    ver.textContent = e.version ? 'v' + e.version : '';
    info.appendChild(name);
    info.appendChild(ver);
    const del = document.createElement('button');
    del.className = 'vault-del';
    del.type = 'button';
    del.setAttribute('aria-label', 'Remove extension');
    del.innerHTML = '&#10005;';
    del.addEventListener('click', async () => {
      await window.settings.extRemove(e.id);
      renderExtensions();
    });
    row.appendChild(info);
    row.appendChild(del);
    wrap.appendChild(row);
  }
}
$('ext-load').addEventListener('click', async () => {
  const btn = $('ext-load');
  const msg = $('ext-msg');
  btn.disabled = true;
  btn.textContent = 'Loading…';
  let r = {};
  try {
    r = await window.settings.extLoad();
  } catch {
    r = { error: 'load failed' };
  }
  btn.disabled = false;
  btn.textContent = 'Load unpacked extension';
  if (r.canceled) {
    msg.textContent = '';
  } else if (r.error) {
    msg.textContent = r.error;
    msg.classList.add('err');
  } else {
    msg.textContent = 'Loaded ' + (r.ext ? r.ext.name : 'extension') + '.';
    msg.classList.remove('err');
    setTimeout(() => (msg.textContent = ''), 3000);
    renderExtensions();
  }
});

// --- Clear browsing data ---
$('cd-clear').addEventListener('click', async () => {
  const opts = {
    history: $('cd-history').checked,
    cache: $('cd-cache').checked,
    cookies: $('cd-cookies').checked,
  };
  const msg = $('cd-msg');
  if (!opts.history && !opts.cache && !opts.cookies) {
    msg.textContent = 'Pick something to clear.';
    return;
  }
  const btn = $('cd-clear');
  btn.disabled = true;
  btn.textContent = 'Clearing…';
  let r = {};
  try {
    r = await window.settings.clearData(opts);
  } catch {
    /* ignore */
  }
  btn.disabled = false;
  btn.textContent = 'Clear now';
  const parts = [];
  if (r.history) parts.push('history');
  if (r.cache) parts.push('cache');
  if (r.cookies) parts.push('cookies');
  msg.textContent = parts.length ? 'Cleared ' + parts.join(', ') + '.' : 'Nothing cleared.';
  setTimeout(() => (msg.textContent = ''), 3000);
});

function renderToggles() {
  for (const row of document.querySelectorAll('.toggle-row')) {
    const key = row.dataset.key;
    row.classList.toggle('on', !!current[key]);
    const sw = row.querySelector('.sw');
    sw.setAttribute('aria-checked', current[key] ? 'true' : 'false');
    const flip = async () => {
      current = await window.settings.set({ [key]: !current[key] });
      row.classList.toggle('on', !!current[key]);
      sw.setAttribute('aria-checked', current[key] ? 'true' : 'false');
    };
    sw.onclick = flip;
    sw.onkeydown = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        flip();
      }
    };
  }
}

function renderAccents() {
  const wrap = $('accents');
  wrap.innerHTML = '';
  const cur = (current.accent || '').toLowerCase();
  for (const hex of ACCENTS) {
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'swatch' + (hex.toLowerCase() === cur ? ' active' : '');
    sw.style.background = hex;
    sw.setAttribute('aria-label', 'Accent ' + hex);
    sw.addEventListener('click', async () => {
      current = await window.settings.set({ accent: hex });
      renderAccents();
    });
    wrap.appendChild(sw);
  }
  // Custom color picker.
  const custom = document.createElement('label');
  custom.className = 'swatch custom' + (ACCENTS.includes(cur) ? '' : ' active');
  custom.title = 'Custom color';
  const input = document.createElement('input');
  input.type = 'color';
  input.value = current.accent || '#f1cb53';
  input.addEventListener('input', async (e) => {
    current = await window.settings.set({ accent: e.target.value });
    renderAccents();
  });
  custom.appendChild(input);
  wrap.appendChild(custom);
}

$('close').addEventListener('click', () => window.settings.close());
$('open-ai').addEventListener('click', () => window.settings.openAI());
window.settings.onShow(load);

load();
