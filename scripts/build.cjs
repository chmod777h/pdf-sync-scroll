// There is no transpilation: main.js is both source and shipped runtime.
// Stage exactly the three files Obsidian installs; never copy vault data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
const versions = JSON.parse(fs.readFileSync(path.join(root, 'versions.json')));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version) || pkg.version !== manifest.version ||
    versions[manifest.version] !== manifest.minAppVersion) throw Error('Version metadata is inconsistent');
if (!/^[a-z]+(?:-[a-z]+)*$/.test(manifest.id) || manifest.id.includes('obsidian') || manifest.id.endsWith('plugin')) throw Error('Invalid plugin ID');
if (manifest.description.length > 250 || !manifest.description.endsWith('.')) throw Error('Invalid description');
const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
const files = ['main.js', 'manifest.json', 'styles.css'];
for (const name of fs.readdirSync(out)) {
  if (!files.includes(name)) throw Error(`Unexpected file in dist: ${name}. Remove it before packaging.`);
}
const sums = files.map(name => {
  const data = fs.readFileSync(path.join(root, name));
  fs.writeFileSync(path.join(out, name), data);
  return `${crypto.createHash('sha256').update(data).digest('hex')}  ${name}`;
});
fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts', 'SHA256SUMS.txt'), sums.join('\n') + '\n');
console.log(`Staged ${manifest.id} ${manifest.version}: ${files.join(', ')}`);
