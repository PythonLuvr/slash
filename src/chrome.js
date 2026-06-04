const $ = (id) => document.getElementById(id);
const omnibar = $('omnibar');
const back = $('back');
const forward = $('forward');
const reload = $('reload');
const tabsEl = $('tabs');

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
    window.loom.navigate(omnibar.value);
    omnibar.blur();
  }
});

back.addEventListener('click', () => window.loom.back());
forward.addEventListener('click', () => window.loom.forward());
reload.addEventListener('click', () => {
  if (reload.dataset.loading === '1') window.loom.stop();
  else window.loom.reload();
});
// --- Tab strip ---
$('tab-new').addEventListener('click', () => window.loom.newTab());

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
      window.loom.closeTab(t.id);
    });
    tab.appendChild(close);

    tab.addEventListener('click', () => window.loom.activateTab(t.id));
    // middle-click closes
    tab.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.loom.closeTab(t.id);
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
window.loom.onState((s) => {
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
  star.disabled = s.mode === 'hero';
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
    item.addEventListener('click', () => window.loom.openUrl(b.url));
    item.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        e.preventDefault();
        window.loom.removeBookmark(b.url);
      }
    });
    bar.appendChild(item);
  }
}
window.loom.onBookmarks(renderBookmarks);

window.loom.onTabs(renderTabs);
window.loom.onFocusOmnibox(() => {
  omnibar.focus();
  omnibar.select();
});

// --- Top-right cluster ---
$('star').addEventListener('click', () => window.loom.toggleBookmark());
$('ai').addEventListener('click', () => window.loom.toggleAI());
$('menu-btn').addEventListener('click', () => window.loom.togglePop('menu'));
$('profile').addEventListener('click', () => window.loom.togglePop('profile'));
$('downloads').addEventListener('click', () => window.loom.togglePop('downloads'));

window.loom.ready();
