// Dependency-free Render build: copy the PWA shell and stamp every deployment
// with a content hash so installed phones can notice updates while online.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = __dirname;
const out = path.join(root, 'dist');
const assets = ['index.html', 'manifest.json', 'sw.js', 'icon.svg', 'icon.png'];
const hash = crypto.createHash('sha256');
for (const file of assets) hash.update(file).update(fs.readFileSync(path.join(root, file)));
const version = hash.digest('hex').slice(0, 16);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
for (const file of assets) {
  let contents = fs.readFileSync(path.join(root, file));
  if (file === 'index.html') {
    contents = Buffer.from(contents.toString('utf8').replace(
      '<meta name="app-version" content="dev">',
      `<meta name="app-version" content="${version}">`
    ));
  }
  fs.writeFileSync(path.join(out, file), contents);
}
fs.writeFileSync(path.join(out, 'version.json'), JSON.stringify({ version }) + '\n');
console.log(`Built HYROX 40 ${version} → dist/`);
