// Standalone read-only smoke test for the migration engine. No injection,
// just proves discovery + SQLite reads + cookie decryption work on this PC.
const migrate = require('../src/lib/migrate');

(async () => {
  const sources = migrate.discoverSources();
  console.log('SOURCES:', sources.length);
  for (const s of sources) {
    console.log(' -', s.id, '=>', s.name);
  }
  if (!sources.length) return console.log('No browsers found.');

  for (const s of sources) {
    console.log('\n=== ' + s.name + ' ===');
    try {
      const info = await migrate.describe(s);
      console.log('describe:', info);
    } catch (e) {
      console.log('describe FAILED:', e.message);
    }
    try {
      const h = await migrate.readHistory(s, 3);
      console.log('history sample:', h.length, h[0] ? h[0].title : '(none)');
    } catch (e) {
      console.log('history FAILED:', e.message);
    }
    try {
      const c = await migrate.readCookies(s);
      console.log('cookies:', c.cookies.length, 'decrypted,', c.appBound, 'app-bound,', c.failed, 'failed');
      if (c.cookies[0]) {
        const sample = c.cookies[0];
        console.log('  sample cookie:', sample.name, '@', sample.domain, 'val.len=', (sample.value || '').length);
      }
    } catch (e) {
      console.log('cookies FAILED:', e.message);
    }
  }
})();
