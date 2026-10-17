const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
const context = {
  module: { exports: {} },
  require: () => ({ getLanguage: () => 'en', Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, Notice: class {},
    Modal: class {
      constructor() { this.selection = null; }
      open() { this.selection = { restore: () => {} }; this.onOpen(); }
    } }),
};
vm.runInNewContext(code + '\nmodule.exports.geometry = { readPosition, positionToTop, getScroller, normalizeSettings, leafKey, t }; module.exports.Picker = PDFPicker;', context);
const Plugin = context.module.exports;
const { readPosition, positionToTop } = Plugin.geometry;

let leafSequence = 0;
function fixture(heights = [1000, 1000, 1000], viewport = 400) {
  let nextFrame = 0;
  const frames = new Map();
  const listeners = new Map();
  const win = {
    requestAnimationFrame: fn => { frames.set(++nextFrame, fn); return nextFrame; },
    cancelAnimationFrame: id => frames.delete(id),
  };
  const classes = new Set();
  const el = {
    clientHeight: viewport, clientTop: 0, scrollTop: 0,
    scrollHeight: heights.reduce((a, b) => a + b, 0),
    ownerDocument: { defaultView: win },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 600, height: viewport }),
    classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
    addEventListener: (name, fn) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
    },
    removeEventListener: (name, fn) => listeners.get(name)?.delete(fn),
    emit: name => { for (const fn of listeners.get(name) || []) fn(); },
    flush: () => { const queued = [...frames.values()]; frames.clear(); queued.forEach(fn => fn()); },
    pending: () => frames.size,
    listenerCount: () => [...listeners.values()].reduce((sum, group) => sum + group.size, 0),
  };
  let top = 0;
  const pages = heights.map((height, index) => {
    const pageTop = top;
    top += height;
    return { dataset: { pageNumber: String(index + 1) },
      getBoundingClientRect: () => ({ top: pageTop - el.scrollTop, height }) };
  });
  const viewer = { classList: { contains: () => false }, querySelector: selector => selector === ':scope > .spread' ? null : pages[0] };
  el.querySelector = () => viewer;
  el.querySelectorAll = () => pages;
  const root = { ownerDocument: el.ownerDocument, isConnected: true, getBoundingClientRect: el.getBoundingClientRect,
    querySelector: () => el, checkVisibility: () => true };
  const leaf = { id: String(++leafSequence), view: { contentEl: root, file: { path: Math.random().toString() } } };
  return { el, leaf, root };
}

function pluginFor(left, right) {
  const plugin = new Plugin();
  plugin.settings = { enabled: true, mode: 'page', selectionMode: 'auto', selected: [] };
  plugin.group = [];
  plugin.cleanups = [];
  plugin.frame = null;
  plugin.app = { workspace: { getLeavesOfType: () => [left.leaf, right.leaf], activeLeaf: left.leaf } };
  plugin.saveData = async () => {};
  plugin.refresh();
  left.el.flush();
  return plugin;
}

test('same page and fractional position survive different zoom and page heights', () => {
  const source = fixture([1000, 800, 1200]);
  const target = fixture([700, 1400, 900]);
  source.el.scrollTop = 1400;
  assert.equal(readPosition(source.el, 'page'), 1.5);
  assert.equal(positionToTop(target.el, 1.5, 'page'), 1400);
  assert.equal(positionToTop(target.el, -2, 'page'), 0);
  assert.equal(positionToTop(target.el, 9, 'page'), 2600);
});

test('progress mode maps scrollable range and handles a short PDF', () => {
  const source = fixture();
  source.el.scrollTop = 1300;
  assert.equal(readPosition(source.el, 'progress'), 0.5);
  assert.equal(positionToTop(fixture([2000, 2000]).el, 0.5, 'progress'), 1800);
  assert.equal(positionToTop(fixture([100]).el, 0.5, 'progress'), 0);
});

test('both directions work; generated scroll events do not feed back', () => {
  const left = fixture();
  const right = fixture([2000, 2000, 2000]);
  const plugin = pluginFor(left, right);
  left.el.scrollTop = 1250;
  left.el.emit('scroll'); left.el.flush();
  assert.equal(right.el.scrollTop, 2500);
  right.el.emit('scroll');
  assert.equal(right.el.pending(), 0);
  right.el.emit('wheel');
  right.el.scrollTop = 3200;
  right.el.emit('scroll'); right.el.flush();
  assert.equal(left.el.scrollTop, 1600);
  left.el.emit('scroll');
  assert.equal(left.el.pending(), 0);
  plugin.onunload();
  assert.equal(left.el.listenerCount(), 0);
  assert.equal(right.el.listenerCount(), 0);
});

test('reaching the shorter document end does not pull the source backwards', () => {
  const left = fixture([1000, 1000, 1000, 1000, 1000]);
  const right = fixture([1000, 1000]);
  pluginFor(left, right);
  left.el.scrollTop = 4200;
  left.el.emit('scroll'); left.el.flush();
  assert.equal(right.el.scrollTop, 1600);
  right.el.emit('scroll'); right.el.flush();
  assert.equal(left.el.scrollTop, 4200);
});

test('paused manual alignment retains the offset in both directions', async () => {
  const left = fixture([1000, 1000, 1000, 1000]);
  const right = fixture([1000, 1000, 1000, 1000]);
  const plugin = pluginFor(left, right);
  await plugin.toggle();
  left.el.scrollTop = 500; right.el.scrollTop = 1750;
  plugin.captureAlignment();
  assert.equal(plugin.group[1].offset, 1.25);
  assert.equal(left.el.scrollTop, 500);
  assert.equal(right.el.scrollTop, 1750);
  left.el.scrollTop = 1000; plugin.syncFrom(0);
  assert.equal(right.el.scrollTop, 2250);
  right.el.scrollTop = 2750; plugin.syncFrom(1);
  assert.equal(left.el.scrollTop, 1500);
});

test('hidden tabs, replaced PDF files and unload release bindings and frames', () => {
  const left = fixture(); const right = fixture();
  const plugin = pluginFor(left, right);
  plugin.group[1].offset = 0.7;
  right.leaf.view.file.path = 'replacement.pdf';
  plugin.refresh();
  assert.equal(plugin.group[1].offset, 0);
  assert.equal(left.el.listenerCount(), 5);
  right.root.checkVisibility = () => false;
  plugin.refresh();
  assert.equal(plugin.group.length, 0);
  assert.equal(left.el.listenerCount(), 0);
  assert.equal(left.el.pending(), 0);
  plugin.onunload();
  right.root.checkVisibility = () => true;
  plugin.refresh();
  assert.equal(plugin.group.length, 0);
});

test('a third visible PDF suspends automatic pairing', () => {
  const left = fixture(); const right = fixture();
  const plugin = pluginFor(left, right);
  plugin.app.workspace.getLeavesOfType = () => [left.leaf, right.leaf, fixture().leaf];
  plugin.refresh();
  assert.equal(plugin.group.length, 0);
  assert.equal(left.el.listenerCount(), 0);
});

const key = item => JSON.stringify([item.leaf.id, item.leaf.view.file.path]);

test('picker keeps its selected keys separate from Modal saved text selection', () => {
  const a = fixture(); const b = fixture();
  const plugin = pluginFor(a, b);
  const picker = new Plugin.Picker(plugin.app, plugin);
  picker.render = () => assert.deepEqual([...picker.selectedKeys], [key(a), key(b)]);
  picker.open();
});

test('manual selection links three of four independent windows bidirectionally', async () => {
  const items = [fixture(), fixture([2000, 2000, 2000]), fixture(), fixture()];
  const plugin = pluginFor(items[0], items[1]);
  plugin.app.workspace.getLeavesOfType = () => items.map(item => item.leaf);
  assert.equal(await plugin.selectWindows(items.slice(0, 3).map(key)), true);
  items[0].el.flush();
  assert.equal(plugin.group.length, 3);
  assert.equal(items[3].el.listenerCount(), 0);
  items[2].el.scrollTop = 1200;
  items[2].el.emit('scroll'); items[2].el.flush();
  assert.equal(items[0].el.scrollTop, 1200);
  assert.equal(items[1].el.scrollTop, 2400);
  assert.equal(items[3].el.scrollTop, 0);
  items[0].el.emit('scroll'); items[1].el.emit('scroll');
  assert.equal(items[0].el.pending() + items[1].el.pending(), 0);
  items[1].el.emit('wheel');
  items[1].el.scrollTop = 3200;
  items[1].el.emit('scroll'); items[1].el.flush();
  assert.equal(items[0].el.scrollTop, 1600);
  assert.equal(items[2].el.scrollTop, 1600);
});

test('same file in different panes is independently selectable and saved', async () => {
  const a = fixture(); const b = fixture(); const c = fixture();
  b.leaf.view.file.path = a.leaf.view.file.path;
  const plugin = pluginFor(a, c);
  plugin.app.workspace.getLeavesOfType = () => [a.leaf, b.leaf, c.leaf];
  await plugin.selectWindows([key(b), key(c)]);
  assert.equal(a.el.listenerCount(), 0);
  assert.equal(b.el.listenerCount(), 5);
  const saved = JSON.parse(JSON.stringify(plugin.settings));
  plugin.onunload();
  const restarted = pluginFor(a, c);
  restarted.settings = saved;
  restarted.app.workspace.getLeavesOfType = () => [a.leaf, b.leaf, c.leaf];
  restarted.refresh();
  assert.equal(restarted.group[0].leaf, b.leaf);
  assert.equal(a.el.listenerCount(), 0);
});

test('closed or replaced selected files never pull unselected windows into the group', async () => {
  const a = fixture(); const b = fixture(); const c = fixture();
  const plugin = pluginFor(a, b);
  plugin.app.workspace.getLeavesOfType = () => [a.leaf, b.leaf, c.leaf];
  await plugin.selectWindows([key(a), key(b)]);
  b.leaf.view.file.path = 'unselected-replacement.pdf';
  a.el.scrollTop = 800;
  plugin.syncFrom(0);
  assert.equal(plugin.group.length, 0);
  assert.equal(b.el.scrollTop, 0);
  assert.equal(c.el.listenerCount(), 0);
  plugin.app.workspace.getLeavesOfType = () => [a.leaf, c.leaf];
  plugin.refresh();
  assert.equal(plugin.group.length, 0);
});

test('multiwindow manual alignment preserves each offset, and active third pane can drive', async () => {
  const items = [fixture(), fixture(), fixture()];
  const plugin = pluginFor(items[0], items[1]);
  plugin.app.workspace.getLeavesOfType = () => items.map(item => item.leaf);
  await plugin.selectWindows(items.map(key));
  await plugin.toggle();
  items.forEach((item, i) => { item.el.scrollTop = 200 + i * 500; });
  plugin.captureAlignment();
  plugin.app.workspace.activeLeaf = items[2].leaf;
  assert.equal(plugin.activeIndex(), 2);
  items[2].el.scrollTop = 1500;
  plugin.syncFrom(2);
  assert.equal(items[0].el.scrollTop, 500);
  assert.equal(items[1].el.scrollTop, 1000);
});

test('selection is revalidated on Apply and changing selection cancels old queued work', async () => {
  const a = fixture(); const b = fixture(); const c = fixture();
  const plugin = pluginFor(a, b);
  plugin.app.workspace.getLeavesOfType = () => [a.leaf, b.leaf, c.leaf];
  assert.equal(await plugin.selectWindows([key(a)]), false);
  assert.equal(plugin.settings.selectionMode, 'auto');
  const staleKey = key(b);
  b.leaf.view.file.path = 'changed.pdf';
  assert.equal(await plugin.selectWindows([key(a), staleKey]), false);
  await plugin.selectWindows([key(a), key(b)]);
  a.el.scrollTop = 1200; a.el.emit('scroll');
  await plugin.selectWindows([key(b), key(c)]);
  a.el.flush(); b.el.flush();
  assert.equal(c.el.scrollTop, 0);
  assert.equal(a.el.listenerCount(), 0);
});

test('hiding a selected pane leaves the other selected panes linked; reopening rejoins', async () => {
  const items = [fixture(), fixture(), fixture()];
  const plugin = pluginFor(items[0], items[1]);
  plugin.app.workspace.getLeavesOfType = () => items.map(item => item.leaf);
  await plugin.selectWindows(items.map(key));
  items[2].root.checkVisibility = () => false;
  plugin.refresh();
  assert.equal(plugin.group.length, 2);
  assert.equal(items[2].el.listenerCount(), 0);
  items[2].root.checkVisibility = () => true;
  plugin.refresh();
  assert.equal(plugin.group.length, 3);
  plugin.onunload();
  items.forEach(item => assert.equal(item.el.listenerCount(), 0));
});

test('malformed saved settings recover without selecting unrelated panes', () => {
  const normalize = Plugin.geometry.normalizeSettings;
  for (const value of [null, false, 'broken', 42]) {
    assert.deepEqual(JSON.parse(JSON.stringify(normalize(value))), {
      enabled: true, mode: 'page', selectionMode: 'auto', selected: [],
    });
  }
  const settings = normalize({ enabled: 'false', mode: 'bad', selectionMode: 'manual', selected: [false, 'pane', 'pane', null] });
  assert.equal(settings.enabled, true);
  assert.equal(settings.mode, 'page');
  assert.equal(settings.selectionMode, 'manual');
  assert.deepEqual([...settings.selected], ['pane']);
  assert.equal(normalize({ selectionMode: 'manual', selected: {} }).selected.length, 0);
});

test('PDF.js spread containers and nonvertical modes are rejected', () => {
  for (const mode of ['scrollHorizontal', 'scrollWrapped', 'scrollPage', 'spread']) {
    const item = fixture();
    item.el.querySelector().classList.contains = value => value === mode;
    assert.equal(Plugin.geometry.getScroller(item.leaf), null);
  }
  const item = fixture();
  item.el.querySelector().querySelector = () => ({});
  assert.equal(Plugin.geometry.getScroller(item.leaf), null);
});

test('detached roots and closed popout windows do not participate', () => {
  const item = fixture();
  item.root.isConnected = false;
  assert.equal(Plugin.geometry.getScroller(item.leaf), null);
  item.root.isConnected = true;
  item.el.ownerDocument.defaultView.closed = true;
  assert.equal(Plugin.geometry.getScroller(item.leaf), null);
  item.el.ownerDocument.defaultView = null;
  assert.equal(Plugin.geometry.getScroller(item.leaf), null);
});

test('invalid page geometry and nonfinite positions never produce a scroll target', () => {
  const item = fixture();
  const pages = item.el.querySelectorAll();
  pages[0].dataset.pageNumber = 'not a page';
  pages[1].dataset.pageNumber = '-3';
  pages[2].getBoundingClientRect = () => ({ top: NaN, height: 1000 });
  assert.equal(readPosition(item.el, 'page'), null);
  for (const value of [NaN, Infinity, -Infinity]) {
    assert.equal(positionToTop(fixture().el, value, 'page'), null);
    assert.equal(positionToTop(fixture().el, value, 'progress'), null);
  }
});

test('progress is bounded during overscroll', () => {
  const item = fixture();
  item.el.scrollTop = -100;
  assert.equal(readPosition(item.el, 'progress'), 0);
  item.el.scrollTop = 1e6;
  assert.equal(readPosition(item.el, 'progress'), 1);
});

test('pane identity remains unique when internal leaf IDs are unavailable', () => {
  const a = fixture(); const b = fixture();
  delete a.leaf.id; delete b.leaf.id;
  b.leaf.view.file.path = a.leaf.view.file.path;
  const getKey = Plugin.geometry.leafKey;
  assert.notEqual(getKey(a.leaf), getKey(b.leaf));
  assert.equal(getKey(a.leaf), getKey(a.leaf));
});

test('unload closes pickers and stale Apply cannot restart synchronization', async () => {
  const a = fixture(); const b = fixture();
  const plugin = pluginFor(a, b);
  let closed = 0;
  plugin.pickers = new Set([{ close: () => closed++ }]);
  plugin.onunload();
  assert.equal(closed, 1);
  assert.equal(plugin.pickers.size, 0);
  assert.equal(await plugin.selectWindows([key(a), key(b)]), false);
  assert.equal(plugin.group.length, 0);
});

test('resize observers are released together with scroll listeners', () => {
  const a = fixture(); const b = fixture();
  let disconnected = 0;
  for (const item of [a, b]) item.el.ownerDocument.defaultView.ResizeObserver = class {
    observe() {}
    disconnect() { disconnected++; }
  };
  const plugin = pluginFor(a, b);
  plugin.onunload();
  assert.equal(disconnected, 2);
  assert.equal(a.el.listenerCount() + b.el.listenerCount(), 0);
});

test('English and Chinese UI follow the Obsidian language', () => {
  const loadLanguage = language => {
    const ctx = { module: { exports: {} }, require: () => ({ ...context.require(), getLanguage: () => language }) };
    vm.runInNewContext(code + '\nmodule.exports.translate = t;', ctx);
    return ctx.module.exports.translate('中文', 'English');
  };
  assert.equal(loadLanguage('en'), 'English');
  assert.equal(loadLanguage('fr'), 'English');
  assert.equal(loadLanguage('zh'), '中文');
  assert.equal(loadLanguage('zh-TW'), '中文');
});
