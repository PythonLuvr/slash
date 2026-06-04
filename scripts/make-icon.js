// Generate the packaging icons (build/icon.ico for Windows, build/icon.png for
// mac/linux) from the app logo at src/icon.png. Run: npm run icon
const fs = require('fs');
const path = require('path');
const pngToIco = require('png-to-ico');

const src = path.join(__dirname, '..', 'src', 'icon.png');
const outDir = path.join(__dirname, '..', 'build');
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(src, path.join(outDir, 'icon.png'));

pngToIco(src)
  .then((buf) => {
    fs.writeFileSync(path.join(outDir, 'icon.ico'), buf);
    console.log('Wrote build/icon.ico and build/icon.png from src/icon.png');
  })
  .catch((e) => {
    console.error('icon generation failed:', e.message);
    process.exit(1);
  });
