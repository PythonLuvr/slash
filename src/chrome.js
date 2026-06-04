const $ = (id) => document.getElementById(id);
const omnibar = $('omnibar');
const back = $('back');
const forward = $('forward');
const reload = $('reload');
const tabsEl = $('tabs');
const siteinfo = $('siteinfo');
const home = $('home');

home.innerHTML =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v9h5v-5h4v5h5v-9"/></svg>';
home.addEventListener('click', () => window.slash.goHome());

const shield = $('shield');
const shieldBadge = $('shield-badge');
shield.querySelector('.sh-ico').innerHTML =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/></svg>';
shield.addEventListener('click', () => window.slash.togglePop('shield'));

// Blocked-count badge for the active tab.
window.slash.onBlocked(({ count, enabled }) => {
  shield.classList.toggle('off', !enabled);
  if (enabled && count > 0) {
    shieldBadge.textContent = count > 999 ? '999+' : String(count);
    shieldBadge.classList.remove('hidden');
  } else {
    shieldBadge.classList.add('hidden');
  }
});

// Neutral site-info icon (sliders / "tune", not a trust-implying padlock) for
// secure pages; a warning triangle for plain HTTP.
const ICON_SECURE =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="8" x2="20" y2="8"/><line x1="4" y1="16" x2="20" y2="16"/><circle cx="9" cy="8" r="2.6" fill="var(--paper)"/><circle cx="15" cy="16" r="2.6" fill="var(--paper)"/></svg>';
const ICON_INSECURE =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5l8.5 15h-17z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><circle cx="12" cy="16.5" r="0.6" fill="currentColor"/></svg>';

// --- Toolbar ---
let omnibarFocused = false;
omnibar.addEventListener('focus', () => {
  omnibarFocused = true;
  omnibar.select();
});
omnibar.addEventListener('blur', () => {
  omnibarFocused = false;
});
omnibar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    window.slash.navigate(omnibar.value);
    omnibar.blur();
  }
});

back.addEventListener('click', () => window.slash.back());
forward.addEventListener('click', () => window.slash.forward());
reload.addEventListener('click', () => {
  if (reload.dataset.loading === '1') window.slash.stop();
  else window.slash.reload();
});
// --- Tab strip ---
$('tab-new').addEventListener('click', () => window.slash.newTab());

function renderTabs(list) {
  tabsEl.innerHTML = '';
  for (const t of list) {
    const tab = document.createElement('div');
    tab.className = 'tab' + (t.active ? ' active' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', t.active ? 'true' : 'false');
    tab.tabIndex = t.active ? 0 : -1;
    tab.title = t.title;

    // favicon (or a neutral fallback)
    if (t.favicon) {
      const img = document.createElement('img');
      img.className = 'favicon';
      img.src = t.favicon;
      img.alt = '';
      img.addEventListener('error', () => img.replaceWith(fallbackIcon()));
      tab.appendChild(img);
    } else {
      tab.appendChild(fallbackIcon());
    }

    const title = document.createElement('span');
    title.className = 'title';
    title.textContent = t.title;
    tab.appendChild(title);

    const close = document.createElement('button');
    close.className = 'close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Close tab');
    close.title = 'Close (Ctrl+W)';
    close.innerHTML = '&#10005;';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      window.slash.closeTab(t.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => window.slash.activateTab(t.id));
    // middle-click closes
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.slash.closeTab(t.id);
      }
    });
    tabsEl.appendChild(tab);
  }
}

function fallbackIcon() {
  const span = document.createElement('span');
  span.className = 'favicon fallback';
  return span;
}

// --- State ---
window.slash.onState((s) => {
  if (!omnibarFocused) omnibar.value = s.url || '';
  if (s.mode === 'hero') {
    omnibar.placeholder = 'Search or enter address';
    back.disabled = true;
    forward.disabled = true;
    reload.dataset.loading = '0';
    reload.innerHTML = '&#10227;';
  } else {
    back.disabled = !s.canGoBack;
    forward.disabled = !s.canGoForward;
    reload.dataset.loading = s.loading ? '1' : '0';
    reload.innerHTML = s.loading ? '&#10005;' : '&#10227;';
  }
  $('ai').classList.toggle('active', !!s.aiOpen);
  const star = $('star');
  star.innerHTML = s.bookmarked ? '&#9733;' : '&#9734;';
  star.classList.toggle('on', !!s.bookmarked);
  star.disabled = s.mode !== 'page';
  home.classList.toggle('active', s.mode === 'hero');

  // Site-info button: hidden on the start page, sliders icon on https, warning
  // triangle on plain http.
  if (s.security === 'internal' || !s.security) {
    siteinfo.classList.add('hidden');
  } else {
    siteinfo.classList.remove('hidden');
    const insecure = s.security === 'insecure';
    siteinfo.innerHTML = insecure ? ICON_INSECURE : ICON_SECURE;
    siteinfo.classList.toggle('insecure', insecure);
    siteinfo.title = insecure ? 'Connection is not secure' : 'Site information';
  }

  document.title = s.title || 'Slash';
});

function bmDomain(u) {
  try {
    return new URL(u).hostname;
  } catch {
    return '';
  }
}
function renderBookmarks(list) {
  const bar = $('bookmarks');
  bar.innerHTML = '';
  if (!list.length) {
    const e = document.createElement('span');
    e.className = 'bm-empty';
    e.textContent = 'Bookmark pages with the star to pin them here';
    bar.appendChild(e);
    return;
  }
  for (const b of list) {
    const item = document.createElement('div');
    item.className = 'bm';
    item.title = b.url;
    const dom = bmDomain(b.url);
    if (dom) {
      const img = document.createElement('img');
      img.src = 'https://icons.duckduckgo.com/ip3/' + dom + '.ico';
      img.alt = '';
      item.appendChild(img);
    }
    const t = document.createElement('span');
    t.textContent = b.title || dom || b.url;
    item.appendChild(t);
    item.addEventListener('click', () => window.slash.openUrl(b.url));
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.slash.removeBookmark(b.url);
      }
    });
    bar.appendChild(item);
  }
}
window.slash.onBookmarks(renderBookmarks);

window.slash.onTabs(renderTabs);
window.slash.onFocusOmnibox(() => {
  omnibar.focus();
  omnibar.select();
});

// --- Top-right cluster ---
siteinfo.addEventListener('click', () => window.slash.togglePop('siteinfo'));
$('star').addEventListener('click', () => window.slash.toggleBookmark());
$('ai').addEventListener('click', () => window.slash.toggleAI());
$('menu-btn').addEventListener('click', () => window.slash.togglePop('menu'));
$('profile').addEventListener('click', () => window.slash.togglePop('profile'));
$('downloads').addEventListener('click', () => window.slash.togglePop('downloads'));

// Generic infobar strip (main controls the chrome height so it pushes content
// down rather than overlapping it). Used by the first-run default-browser
// prompt and update notifications.
const infobar = $('infobar');
window.slash.onInfobar((payload) => {
  $('ib-text').textContent = payload.text || '';
  const actions = $('ib-actions');
  actions.innerHTML = '';
  for (const a of payload.actions || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    if (a.close) {
      btn.className = 'ib-close';
      btn.setAttribute('aria-label', a.label || 'Dismiss');
      btn.innerHTML = '&#10005;';
    } else {
      if (a.primary) btn.className = 'ib-primary';
      btn.textContent = a.label;
    }
    btn.addEventListener('click', () => window.slash.infobarAction(payload.id, a.key));
    actions.appendChild(btn);
  }
  infobar.classList.remove('hidden');
});
window.slash.onInfobarHide(() => infobar.classList.add('hidden'));

window.slash.ready();
