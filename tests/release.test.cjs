const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('release metadata agrees and declares the verified compatibility baseline', () => {
  const m = JSON.parse(read('manifest.json'));
  const p = JSON.parse(read('package.json'));
  const v = JSON.parse(read('versions.json'));
  assert.equal(m.version, p.version);
  assert.equal(v[m.version], m.minAppVersion);
  assert.equal(m.minAppVersion, '1.14.4');
  assert.equal(m.isDesktopOnly, true);
  assert.match(m.id, /^[a-z]+(?:-[a-z]+)*$/);
  assert.ok(!m.id.includes('obsidian') && !m.id.endsWith('plugin'));
  assert.ok(m.description.length <= 250 && m.description.endsWith('.'));
  assert.ok(!/[\u0080-\uffff]/.test(m.name));
});

test('documentation links and release essentials are complete', () => {
  for (const name of ['LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CONTRIBUTING.md', 'docs/compatibility.md', 'docs/publishing.zh-CN.md', 'docs/release-notes.md']) {
    const text = read(name);
    assert.ok(text.trim().length > 0);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|#)/.test(target)) continue;
      assert.ok(fs.existsSync(path.resolve(root, path.dirname(name), target.split('#')[0])), `${name}: missing ${target}`);
    }
  }
});
