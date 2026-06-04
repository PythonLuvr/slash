// Local data store for bookmarks and history. Lives in the OS app-data
// directory (never the repo). Plain JSON, no external deps.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const HISTORY_CAP = 2000;

function storePath() {
  return path.join(app.getPath('userData'), 'slash-data.json');
}

function read() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    return {
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { bookmarks: [], history: [] };
  }
}

function write(data) {
  fs.mkdirSync(path.dirname(storePath()), { recursive: true });
  fs.writeFileSync(storePath(), JSON.stringify(data, null, 2), 'utf8');
}

// --- Bookmarks ---
function getBookmarks() {
  return read().bookmarks;
}
function isBookmarked(url) {
  return read().bookmarks.some((b) => b.url === url);
}
function addBookmark({ url, title }) {
  const data = read();
  if (!url || data.bookmarks.some((b) => b.url === url)) return data.bookmarks;
  data.bookmarks.push({ url, title: title || url });
  write(data);
  return data.bookmarks;
}
function removeBookmark(url) {
  const data = read();
  data.bookmarks = data.bookmarks.filter((b) => b.url !== url);
  write(data);
  return data.bookmarks;
}

// --- History ---
function getHistory() {
  return read().history;
}
function addHistory({ url, title }) {
  if (!url || !/^https?:\/\//i.test(url)) return;
  const data = read();
  // Drop an immediately-preceding duplicate so reloads do not stack.
  if (data.history[0] && data.history[0].url === url) {
    data.history[0].title = title || data.history[0].title;
  } else {
    data.history.unshift({ url, title: title || url, time: Date.now() });
  }
  if (data.history.length > HISTORY_CAP) data.history.length = HISTORY_CAP;
  write(data);
}
function clearHistory() {
  const data = read();
  data.history = [];
  write(data);
}

module.exports = {
  getBookmarks,
  isBookmarked,
  addBookmark,
  removeBookmark,
  getHistory,
  addHistory,
  clearHistory,
};
