const { Plugin: ObsidianPlugin, PluginSettingTab, Setting, Notice, Modal, getLanguage } = require('obsidian');

const DEFAULTS = { enabled: true, mode: 'page', selectionMode: 'auto', selected: [] };
// Leaf IDs are an internal optimization only. Fall back to session identity if
// Obsidian changes them; never conflate two panes showing the same file.
const sessionKeys = new WeakMap();
let nextSessionKey = 0;
const leafKey = leaf => {
  if (!sessionKeys.has(leaf)) sessionKeys.set(leaf, `session-${++nextSessionKey}`);
  const id = typeof leaf.id === 'string' ? leaf.id : sessionKeys.get(leaf);
  return JSON.stringify([id, leaf.view?.file?.path]);
};
const t = (zh, en) => getLanguage().startsWith('zh') ? zh : en;

function normalizeSettings(data) {
  const value = data && typeof data === 'object' ? data : {};
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULTS.enabled,
    mode: value.mode === 'progress' ? 'progress' : 'page',
    selectionMode: value.selectionMode === 'manual' ? 'manual' : 'auto',
    selected: Array.isArray(value.selected)
      ? [...new Set(value.selected.filter(key => typeof key === 'string'))] : [],
  };
}
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Work only inside a PDF leaf; never bind the outline or thumbnail scroller.
function getScroller(leaf) {
  const root = leaf.view?.contentEl;
  if (!root || !root.isConnected) return null;
  const rect = root.getBoundingClientRect();
  if (rect.width < 20 || rect.height < 20) return null;
  if (root.checkVisibility && !root.checkVisibility()) return null;
  const el = root.querySelector('.pdf-viewer-container');
  if (!el || el.clientHeight <= 0 || !el.ownerDocument?.defaultView || el.ownerDocument.defaultView.closed) return null;
  const viewer = el.querySelector('.pdfViewer');
  // Continuous vertical pages are needed for an unambiguous page position.
  if (!viewer || ['scrollHorizontal', 'scrollWrapped', 'scrollPage', 'spread']
    .some(name => viewer.classList.contains(name))) return null;
  if (viewer.querySelector(':scope > .spread')) return null;
  if (!viewer.querySelector('.page[data-page-number]')) return null;
  return el;
}

function pageGeometry(el) {
  const viewportTop = el.getBoundingClientRect().top + el.clientTop;
  return Array.from(el.querySelectorAll('.pdfViewer .page[data-page-number]'))
    .map(page => {
      const rect = page.getBoundingClientRect();
      return { number: Number(page.dataset.pageNumber),
        top: rect.top - viewportTop + el.scrollTop, height: rect.height };
    })
    .filter(page => page.height > 0 && Number.isInteger(page.number) && page.number > 0 && Number.isFinite(page.top))
    .sort((a, b) => a.number - b.number);
}

function readPosition(el, mode) {
  if (mode === 'progress') {
    return clamp(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight), 0, 1);
  }
  const pages = pageGeometry(el);
  if (!pages.length) return null;
  let index = 0;
  while (index + 1 < pages.length && pages[index + 1].top <= el.scrollTop) index++;
  const page = pages[index];
  const span = pages[index + 1] ? pages[index + 1].top - page.top : page.height;
  return page.number - 1 + clamp((el.scrollTop - page.top) / Math.max(1, span), 0, 0.999999);
}

function positionToTop(el, position, mode) {
  if (!Number.isFinite(position)) return null;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  if (mode === 'progress') return clamp(position, 0, 1) * max;
  const pages = pageGeometry(el);
  if (!pages.length) return null;
  if (position < pages[0].number - 1) return 0;
  if (position >= pages[pages.length - 1].number) return max;
  const pageIndex = Math.floor(position);
  const index = pages.findIndex(page => page.number === pageIndex + 1);
  if (index < 0) return null;
  const page = pages[index];
  const span = pages[index + 1] ? pages[index + 1].top - page.top : page.height;
  return clamp(page.top + (position - pageIndex) * span, 0, max);
}

class PDFSyncScroll extends ObsidianPlugin {
  async onload() {
    this.settings = normalizeSettings(await this.loadData());
    this.group = [];
    this.cleanups = [];
    this.frame = null;
    this.disposed = false;
    this.pickers = new Set();
    this.status = this.addStatusBarItem();
    this.status.addClass('pdf-sync-scroll-status');
    this.status.setAttribute('role', 'button');
    this.status.setAttribute('tabindex', '0');
    this.registerDomEvent(this.status, 'click', () => this.toggle());
    this.registerDomEvent(this.status, 'contextmenu', event => {
      event.preventDefault();
      this.openPicker();
    });
    this.registerDomEvent(this.status, 'keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.toggle();
      }
    });
    this.ribbon = this.addRibbonIcon('link', t("PDF 同步滚动：开启 / 暂停", "Toggle PDF synchronization"), () => this.toggle());
    this.addRibbonIcon('list-checks', t("选择参与同步的 PDF 窗口", "Select PDF panes"), () => this.openPicker());
    this.addCommand({ id: 'select-pdfs', name: t("选择参与同步的 PDF 窗口", "Select PDF panes"), callback: () => this.openPicker() });
    this.addCommand({ id: 'toggle', name: t("开启 / 暂停 PDF 同步滚动", "Toggle synchronization"), callback: () => this.toggle() });
    this.addCommand({ id: 'align', name: t("以当前各窗口的位置重新对齐", "Align at current positions"), callback: () => this.captureAlignment() });
    this.addCommand({ id: 'reset', name: t("重置对齐（相同页码 / 进度）", "Reset alignment"), callback: () => {
      this.group.forEach(item => { item.offset = 0; });
      if (this.group.length >= 2) this.syncFrom(this.activeIndex());
      new Notice(t("已重置 PDF 对齐", "PDF alignment reset"));
    } });
    this.settingTab = new PDFSyncSettings(this.app, this);
    this.addSettingTab(this.settingTab);
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('window-open', () => this.refresh()));
    this.registerEvent(this.app.workspace.on('window-close', () => this.refresh()));
    // PDF rendering is asynchronous; a leaf can exist before its viewer is ready.
    this.registerInterval(window.setInterval(() => this.refresh(), 1000));
    this.app.workspace.onLayoutReady(() => this.refresh());
    this.updateStatus();
  }

  openPicker() {
    if (this.disposed) return;
    const picker = new PDFPicker(this.app, this);
    this.pickers.add(picker);
    picker.open();
  }

  candidates() {
    const documents = new Map();
    const counts = new Map();
    const mainDoc = this.app.workspace.containerEl?.ownerDocument;
    return this.app.workspace.getLeavesOfType('pdf').map(leaf => {
      const doc = leaf.view.contentEl?.ownerDocument;
      if (!documents.has(doc)) documents.set(doc, documents.size + 1);
      const pane = (counts.get(doc) || 0) + 1;
      counts.set(doc, pane);
      return { leaf, key: leafKey(leaf), el: getScroller(leaf), path: leaf.view.file?.path,
        label: `${doc === mainDoc ? t("主窗口", "Main window") : t(`窗口 ${documents.get(doc)}`, `Window ${documents.get(doc)}`)} · ${t('阅读区', 'Pane')} ${pane}` };
    });
  }

  async selectWindows(keys) {
    if (this.disposed) return false;
    // Revalidate on Apply: files/windows may have changed while the picker was open.
    const current = this.candidates().filter(item => item.el && keys.includes(item.key));
    if (current.length < 2) {
      new Notice(t("请至少选择两个可见的 PDF 阅读区；窗口变化后可刷新列表", "Select at least two visible PDF panes. Refresh the list if windows changed."));
      return false;
    }
    this.settings.selectionMode = 'manual';
    this.settings.selected = current.map(item => item.key);
    this.settings.enabled = true;
    this.refresh();
    await this.saveData(this.settings);
    this.settingTab?.update();
    new Notice(t(`已连接所选的 ${current.length} 个 PDF 阅读区`, `Connected ${current.length} selected PDF panes`));
    return true;
  }

  async useAutomaticSelection() {
    this.settings.selectionMode = 'auto';
    this.settings.selected = [];
    this.refresh();
    await this.saveData(this.settings);
    this.settingTab?.update();
  }

  activeIndex() {
    return Math.max(0, this.group.findIndex(item => item.leaf === this.app.workspace.activeLeaf));
  }

  refresh() {
    if (this.disposed) return;
    if (!this.settings.enabled) {
      this.unbind();
      this.updateStatus();
      return;
    }
    const manual = this.settings.selectionMode === 'manual';
    const selected = new Set(this.settings.selected || []);
    const visible = this.candidates().filter(item => item.el && (!manual || selected.has(item.key)));
    // Automatic mode retains the original two-PDF behavior. Manual mode never
    // substitutes an unselected file when a selected window closes or changes.
    if (visible.length < 2 || (!manual && visible.length > 2)) {
      this.unbind();
      this.updateStatus(manual ? t("等待至少两个所选 PDF", "Waiting for at least two selected PDFs") : visible.length > 2
        ? t("请先选择窗口", "Select PDF panes first") : t("等待两个 PDF（纵向连续、单页）", "Waiting for two PDFs (vertical, continuous, no spreads)"));
      return;
    }
    if (this.group.length === visible.length && visible.every((item, i) =>
      item.el === this.group[i].el && item.key === this.group[i].key)) return;
    this.unbind();
    this.group = visible.map(item => ({ ...item, offset: 0 }));
    for (const [index, item] of this.group.entries()) {
      const listen = (type, fn) => {
        item.el.addEventListener(type, fn, { passive: true });
        this.cleanups.push(() => item.el.removeEventListener(type, fn));
      };
      listen('scroll', () => {
        if (item.expectedTop != null && Math.abs(item.el.scrollTop - item.expectedTop) < 2) return;
        item.expectedTop = null;
        this.queueSync(index);
      });
      const takeControl = () => {
        this.cancelFrame();
        item.expectedTop = null;
        this.lastSource = index;
      };
      listen('wheel', takeControl);
      listen('touchstart', takeControl);
      listen('pointerdown', takeControl);
      listen('keydown', takeControl);
      item.el.classList.add('pdf-sync-scroll-linked');
      this.cleanups.push(() => item.el.classList.remove('pdf-sync-scroll-linked'));
      const win = item.el.ownerDocument.defaultView;
      if (win.ResizeObserver) {
        const observer = new win.ResizeObserver(() => this.queueSync(this.lastSource ?? this.activeIndex()));
        observer.observe(item.el);
        const viewer = item.el.querySelector('.pdfViewer');
        if (viewer) observer.observe(viewer);
        this.cleanups.push(() => observer.disconnect());
      }
    }
    this.lastSource = this.activeIndex();
    this.queueSync(this.lastSource);
    this.updateStatus();
  }

  cancelFrame() {
    if (this.frame) this.frame.win.cancelAnimationFrame(this.frame.id);
    this.frame = null;
  }

  queueSync(index) {
    this.cancelFrame();
    if (this.group.length < 2 || !this.group[index]) return;
    this.lastSource = index;
    const win = this.group[index].el.ownerDocument.defaultView;
    this.frame = { win, id: win.requestAnimationFrame(() => {
      this.frame = null;
      this.syncFrom(index);
    }) };
  }

  syncFrom(index) {
    if (this.group.length < 2 || !this.settings.enabled || !this.group[index]) return;
    const source = this.group[index];
    if (this.group.some(item => getScroller(item.leaf) !== item.el || leafKey(item.leaf) !== item.key)) {
      this.refresh();
      return;
    }
    const position = readPosition(source.el, this.settings.mode);
    if (position == null) return;
    for (const target of this.group) {
      if (target === source) continue;
      const top = positionToTop(target.el, position - source.offset + target.offset, this.settings.mode);
      if (top == null || Math.abs(target.el.scrollTop - top) < 0.5) continue;
      // Suppress feedback independently for every recipient, including events
      // delivered later by a different popout window's event loop.
      target.expectedTop = top;
      target.el.scrollTop = top;
      target.expectedTop = target.el.scrollTop;
    }
  }

  unbind() {
    this.cancelFrame();
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.group = [];
  }

  async toggle() {
    this.settings.enabled = !this.settings.enabled;
    this.refresh();
    await this.saveData(this.settings);
    this.settingTab?.update();
    new Notice(this.settings.enabled ? t("PDF 同步已开启", "PDF synchronization enabled") : t("PDF 同步已暂停，可分别调整各窗口位置", "PDF synchronization paused. Adjust each pane independently."));
  }

  captureAlignment() {
    // Enable and bind without the scheduled initial alignment changing positions.
    this.settings.enabled = true;
    this.refresh();
    this.cancelFrame();
    if (this.group.length < 2) {
      new Notice(t("请先选择至少两个可见 PDF，使用纵向连续、单页显示", "Select at least two visible PDFs with vertical, continuous scrolling and no spreads."));
      void this.saveData(this.settings);
      return;
    }
    const positions = this.group.map(item => readPosition(item.el, this.settings.mode));
    if (positions.some(position => position == null)) return;
    this.group.forEach((item, i) => { item.offset = positions[i] - positions[0]; });
    void this.saveData(this.settings);
    this.settingTab?.update();
    this.updateStatus();
    new Notice(t("已将当前各窗口的位置设为对应位置，并恢复同步", "Current positions aligned. Synchronization resumed."));
  }

  updateStatus(message) {
    if (!this.status) return;
    const label = !this.settings.enabled ? t("PDF 同步：暂停", "PDF sync: paused") : this.group.length >= 2
      ? `${t('PDF 同步', 'PDF sync')}: ${this.group.length} · ${this.settings.mode === 'page' ? t("按页", "page") : t("按进度", "progress")}`
      : `${t('PDF 同步', 'PDF sync')}: ${message || t("等待两个 PDF", "Waiting for two PDFs")}`;
    this.status.setText(label);
    this.status.setAttribute('aria-label', `${label}. ${t('点击开启或暂停', 'Click to toggle')}`);
    this.status.setAttribute('title', t("点击开启 / 暂停；右键选择窗口。命令面板可重新对齐。", "Click to toggle; right-click to select panes. Use the command palette to realign."));
    this.ribbon?.classList.toggle('is-active', this.settings.enabled && this.group.length >= 2);
  }

  onunload() {
    this.disposed = true;
    for (const picker of this.pickers || []) picker.close();
    this.pickers?.clear();
    this.unbind();
  }
}

class PDFPicker extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.selectedKeys = new Set(plugin.settings.selectionMode === 'manual'
      ? plugin.settings.selected : plugin.group.map(item => item.key));
  }

  onOpen() { this.render(); }

  render() {
    const { contentEl } = this;
    const plugin = this.plugin;
    contentEl.empty();
    contentEl.addClass('pdf-sync-picker');
    contentEl.createEl('h2', { text: t("选择参与同步的 PDF 窗口", "Select PDF panes") });
    contentEl.createEl('p', { text: t("勾选至少两个阅读区，可跨主窗口和独立弹出窗口同步。未选中的 PDF 不受影响。", "Select at least two panes across the main window and popout windows. Other PDFs stay independent.") });
    const candidates = plugin.candidates();
    const available = new Set(candidates.filter(item => item.el).map(item => item.key));
    this.selectedKeys = new Set([...this.selectedKeys].filter(key => available.has(key)));
    const count = contentEl.createEl('p');
    let applyButton;
    const updateCount = () => {
      count.setText(t(`已选择 ${this.selectedKeys.size} 个 PDF 阅读区`, `${this.selectedKeys.size} PDF panes selected`));
      applyButton?.setDisabled(this.selectedKeys.size < 2);
    };
    new Setting(contentEl).setName(t("快速选择", "Quick selection"))
      .addButton(button => button.setButtonText(t("全选可用", "Select all available")).onClick(() => {
        this.selectedKeys = new Set(available); this.render();
      }))
      .addButton(button => button.setButtonText(t("清空", "Clear")).onClick(() => {
        this.selectedKeys.clear(); this.render();
      }))
      .addButton(button => button.setButtonText(t("刷新列表", "Refresh list")).onClick(() => this.render()));
    const list = contentEl.createDiv('pdf-sync-picker-list');
    if (!candidates.length) list.createEl('p', { text: t("还没有打开 PDF。请先在分栏或独立窗口中打开文件。", "No PDFs are open. Open files in split panes or popout windows first.") });
    for (const item of candidates) {
      new Setting(list).setName(`${item.label} · ${item.leaf.view.file?.name || 'PDF'}`)
        .setDesc(`${item.path || ''}${item.el ? '' : t(" · 当前不可用：请显示该标签，并使用纵向连续、单页显示", " \u00b7 Unavailable: show this tab and use vertical, continuous scrolling with no spreads")}`)
        .addToggle(toggle => toggle.setValue(this.selectedKeys.has(item.key)).setDisabled(!item.el)
          .onChange(value => {
            if (value) this.selectedKeys.add(item.key); else this.selectedKeys.delete(item.key);
            updateCount();
          }));
    }
    new Setting(contentEl)
      .addButton(button => button.setButtonText(t("恢复自动选择", "Use automatic selection")).onClick(async () => {
        await plugin.useAutomaticSelection(); this.close();
      }))
      .addButton(button => button.setButtonText(t("取消", "Cancel")).onClick(() => this.close()))
      .addButton(button => {
        applyButton = button;
        button.setButtonText(t("同步所选窗口", "Sync selected panes")).setCta().onClick(async () => {
          if (await plugin.selectWindows([...this.selectedKeys])) this.close();
          else this.render();
        });
      });
    updateCount();
  }

  onClose() { this.plugin.pickers?.delete(this); this.contentEl.empty(); }
}

class PDFSyncSettings extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }

  getSettingDefinitions() {
    const plugin = this.plugin;
    return [
      {
        name: t('参与同步的窗口', 'Selected panes'),
        desc: plugin.settings.selectionMode === 'manual'
          ? t(`已手动选择 ${plugin.settings.selected.length} 个 PDF 阅读区。`, `${plugin.settings.selected.length} PDF panes selected manually.`)
          : t('自动模式：恰好两个 PDF 可见时连接；更多窗口请手动选择。', 'Automatic mode links exactly two visible PDFs. Select panes manually for larger groups.'),
        render: setting => { setting.addButton(button => button
          .setButtonText(t('选择窗口…', 'Select panes…')).onClick(() => plugin.openPicker())); },
      },
      {
        name: t('同步滚动', 'Synchronize scrolling'),
        desc: t('任意一个已选窗口滚动，都能带动其余已选窗口。', 'Scrolling any selected pane moves the other selected panes.'),
        render: setting => { setting.addToggle(toggle => toggle.setValue(plugin.settings.enabled).onChange(async enabled => {
          plugin.settings.enabled = enabled;
          plugin.refresh();
          await plugin.saveData(plugin.settings);
        })); },
      },
      {
        name: t('对齐方式', 'Alignment mode'),
        desc: t('原文与译文页码对应时选「按页」；页数不同时可选「按整体进度」。', 'Use page alignment for matching page numbers, or overall progress for different page counts.'),
        render: setting => { setting.addDropdown(dropdown => dropdown
          .addOption('page', t('按页码和页内位置', 'Page number and position'))
          .addOption('progress', t('按整体阅读进度', 'Overall reading progress'))
          .setValue(plugin.settings.mode).onChange(async mode => {
            plugin.settings.mode = mode;
            plugin.group.forEach(item => { item.offset = 0; });
            if (plugin.group.length >= 2) plugin.queueSync(plugin.activeIndex());
            plugin.updateStatus();
            await plugin.saveData(plugin.settings);
          })); },
      },
      {
        name: t('手动对齐', 'Manual alignment'),
        desc: t('先暂停同步，分别把所选 PDF 滚动到对应内容，再点此按钮。此对齐在更换 PDF 或重启后重置。', 'Pause, scroll each PDF to corresponding content, then align. Changing files or restarting resets the offsets.'),
        render: setting => { setting.addButton(button => button
          .setButtonText(t('以当前位置对齐并开启', 'Align here and enable')).onClick(() => {
            plugin.captureAlignment();
            this.update();
          })); },
      },
      {
        name: t('支持的阅读模式', 'Supported reading modes'),
        desc: t('使用纵向连续滚动、单页显示。隐藏或关闭的阅读区不参与同步；所选 PDF 少于两个时等待。插件不修改 PDF 文件。', 'Use vertical, continuous scrolling with no page spreads. Hidden or closed panes do not participate. Sync waits for at least two selected PDFs. PDF files are never modified.'),
      },
    ];
  }
}

module.exports = PDFSyncScroll;
