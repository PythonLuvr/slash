const $ = (id) => document.getElementById(id);
const omnibar = $('omnibar');
const back = $('back');
const forward = $('forward');
const reload = $('reload');
const tabsEl = $('tabs');
const siteinfo = $('siteinfo');
const home = $('home');
home.addEventListener('click', () => window.slash.goHome());

// Reload <-> stop share the button; both are SVG so they match the icon set.
const RELOAD_SVG = '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 1 2.64 6.36M3 18v-4h4" /></svg>';
const STOP_SVG = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>';

const shield = $('shield');
const shieldBadge = $('shield-badge');
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
    tab.className =
      'tab' +
      (t.active ? ' active' : '') +
      (t.suspended ? ' suspended' : '') +
      (t.pinned ? ' pinned' : '') +
      (t.private ? ' private' : '');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', t.active ? 'true' : 'false');
    tab.tabIndex = t.active ? 0 : -1;
    tab.title = t.private ? 'Private tab · ' + t.title : t.title;

    // Private tabs get a small mask glyph so they're unmistakable.
    if (t.private) {
      const m = document.createElement('span');
      m.className = 'tab-mask';
      m.textContent = '🕶';
      m.setAttribute('aria-hidden', 'true');
      tab.appendChild(m);
    }

    // favicon (or a moon when asleep, or a neutral fallback)
    if (t.suspended) {
      const z = document.createElement('span');
      z.className = 'tab-zzz';
      z.setAttribute('aria-hidden', 'true');
      z.title = 'Asleep (click to wake)';
      z.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 0 1 9.5 4 7 7 0 1 0 20 14.5z" /></svg>';
      tab.appendChild(z);
    } else if (t.favicon) {
      const img = document.createElement('img');
      img.className = 'favicon';
      img.src = t.favicon;
      img.alt = '';
      img.addEventListener('error', () => img.replaceWith(fallbackIcon()));
      tab.appendChild(img);
    } else {
      tab.appendChild(fallbackIcon());
    }

    // Pinned tabs are compact: favicon only, no title or close button.
    if (!t.pinned) {
      const title = document.createElement('span');
      title.className = 'title';
      title.textContent = t.title;
      tab.appendChild(title);

      const close = document.createElement('button');
      close.className = 'close';
      close.type = 'button';
      close.setAttribute('aria-label', 'Close tab');
      close.title = 'Close (Ctrl+W)';
      close.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        window.slash.closeTab(t.id);
      });
      tab.appendChild(close);
    }

    tab.addEventListener('click', () => window.slash.activateTab(t.id));
    // middle-click closes (pinned tabs ignore it so they aren't lost by accident)
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1 && !t.pinned) {
        e.preventDefault();
        window.slash.closeTab(t.id);
      }
    });
    // right-click opens the tab menu (pin/unpin/close/...)
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      window.slash.tabMenu(t.id, e.clientX, e.clientY);
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
// Page-load progress bar: ease to ~85% while loading, snap to 100% and fade on done.
let progLoading = false;
function setLoading(loading) {
  if (loading === progLoading) return;
  progLoading = loading;
  const p = $('progress');
  if (!p) return;
  if (loading) {
    p.classList.add('on');
    p.style.width = '8%';
    requestAnimationFrame(() => {
      if (progLoading) p.style.width = '85%';
    });
  } else {
    p.style.width = '100%';
    setTimeout(() => {
      if (!progLoading) {
        p.classList.remove('on');
        p.style.width = '0';
      }
    }, 280);
  }
}

window.slash.onState((s) => {
  if (!omnibarFocused) omnibar.value = s.url || '';
  if (s.mode === 'hero') {
    omnibar.placeholder = 'Search or enter address';
    back.disabled = true;
    forward.disabled = true;
    reload.dataset.loading = '0';
    reload.innerHTML = RELOAD_SVG;
  } else {
    back.disabled = !s.canGoBack;
    forward.disabled = !s.canGoForward;
    reload.dataset.loading = s.loading ? '1' : '0';
    reload.innerHTML = s.loading ? STOP_SVG : RELOAD_SVG;
  }
  setLoading(s.mode !== 'hero' && !!s.loading);
  $('ai').classList.toggle('active', !!s.aiOpen);
  $('perf').classList.toggle('active', !!s.perfOpen);
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
      img.alt = '';
      item.appendChild(img);
      // Local cache when warm; otherwise the site's own favicon (first-party),
      // never a third-party aggregator.
      const firstParty = 'https://' + dom.replace(/^www\./, '') + '/favicon.ico';
      img.addEventListener('error', () => img.remove(), { once: true });
      window.slash
        .favicon(dom)
        .then((d) => {
          img.src = d || firstParty;
        })
        .catch(() => {
          img.src = firstParty;
        });
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
$('perf').addEventListener('click', () => window.slash.togglePerf());
$('menu-btn').addEventListener('click', () => window.slash.togglePop('menu'));
$('profile').addEventListener('click', () => window.slash.togglePop('profile'));
$('downloads').addEventListener('click', () => window.slash.togglePop('downloads'));

// Omnibox search-engine picker: shows the current default, click to change it.
let omniEngines = [];
function setOmniEngine(id) {
  const e = omniEngines.find((x) => x.id === id) || omniEngines[0];
  const img = document.querySelector('#omni-engine .oe-fav');
  if (!e || !img) return;
  const firstParty = 'https://' + e.domain.replace(/^www\./, '') + '/favicon.ico';
  window.slash
    .favicon(e.domain)
    .then((d) => {
      img.src = d || firstParty;
    })
    .catch(() => {
      img.src = firstParty;
    });
}
window.slash
  .searchGet()
  .then(({ current, list }) => {
    omniEngines = list || [];
    setOmniEngine(current);
  })
  .catch(() => {});
window.slash.onSearchEngine((id) => setOmniEngine(id));
window.slash.onSearchList((list) => {
  if (Array.isArray(list)) omniEngines = list;
});
$('omni-engine').addEventListener('click', () => window.slash.togglePop('enginepick'));

// "Add this site to search engines" button (OpenSearch auto-detect).
const addEngineBtn = $('add-engine');
window.slash.onAddEngine((info) => {
  if (info && info.name) {
    addEngineBtn.classList.remove('hidden');
    addEngineBtn.title = 'Add ' + info.name + ' to your search engines';
  } else {
    addEngineBtn.classList.add('hidden');
  }
});
addEngineBtn.addEventListener('click', async () => {
  addEngineBtn.classList.add('hidden'); // optimistic
  try {
    await window.slash.addCurrentEngine();
  } catch {
    /* ignore */
  }
});

// Toolbar avatar reflects the computer account (initial, or account picture).
window.slash
  .profile()
  .then((p) => {
    const av = document.querySelector('#profile .avatar');
    if (!av || !p) return;
    if (p.picture) {
      av.textContent = '';
      const im = document.createElement('img');
      im.className = 'avatar-img';
      im.alt = '';
      im.src = p.picture;
      av.appendChild(im);
    } else {
      av.textContent = ((p.name || 'You').trim()[0] || '?').toUpperCase();
    }
  })
  .catch(() => {});

// Profile cue: non-default profiles show a colored name pill and tint the avatar
// ring, so you can tell which profile a window belongs to.
window.slash.onProfileWindow((p) => {
  // Point the extensions toolbar at this window's profile session.
  const ext = $('ext-actions');
  if (ext && p) {
    if (p.partition) ext.setAttribute('partition', p.partition);
    else ext.removeAttribute('partition');
  }
  const badge = $('profile-badge');
  const av = document.querySelector('#profile .avatar');
  if (p && !p.isDefault) {
    if (badge) {
      badge.textContent = p.name || 'Profile';
      badge.style.background = p.color || '#f1cb53';
      badge.classList.remove('hidden');
    }
    if (av) av.style.boxShadow = '0 0 0 2px ' + (p.color || '#f1cb53');
  } else {
    if (badge) badge.classList.add('hidden');
    if (av) av.style.boxShadow = '';
  }
});

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
