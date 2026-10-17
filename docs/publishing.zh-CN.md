# 社区发布操作指南

整理日期：2026-10-17。此目录是独立源码仓库的内容，不是整个笔记库。源码仓库：[chmod777h/pdf-sync-scroll](https://github.com/chmod777h/pdf-sync-scroll)。Release 和社区收录状态以对应网站显示为准。

## 已准备的内容

- `main.js`：可读、可直接运行的完整源码。
- `manifest.json`：英文名称 PDF Sync Scroll；标识 `pdf-sync-scroll`；版本 `1.2.0`；最低版本 `1.14.4`；仅桌面。
- `styles.css`：仅作用于插件自身元素的样式。
- 中英文 README、MIT 许可证、更新日志、兼容性报告和演示截图。
- `versions.json`、锁定依赖、自动检查与草稿发布流程。
- `dist/` 中的三个安装文件；`artifacts/SHA256SUMS.txt` 中的校验值。

## 1. 确定公开署名并建立仓库

已确认使用 GitHub 账号 `chmod777h`；插件作者、作者网址和 MIT 许可证署名已对应此账号。源码中不包含个人邮箱。

在自己的 GitHub 账号下创建公开仓库，推荐仓库名 `pdf-sync-scroll`。上传本目录的源码内容，保留 `.github` 隐藏目录。不要上传 `node_modules`、`dist`、`artifacts`、`data.json`、`.obsidian`、测试应用配置、笔记或个人 PDF。源码 ZIP 已按白名单排除这些内容。

标识和名称需在提交时再次确认可用。2026-10-17 检查官方公开插件列表时，未发现与 `pdf-sync-scroll` 或 `PDF Sync Scroll` 完全相同的条目；这不是社区目录的名称预留，也不能排除正在审核的条目。

## 2. 验证并制作发布版本

安装 Node.js 22+ 和 pnpm 11.25.0，在仓库内执行：

```sh
pnpm install --frozen-lockfile
pnpm verify
```

如需重新生成安装包和源码包，验证完成后运行 `python3 scripts/package.py`（需要 Python 3.9+，无需额外库）。文件将写入 `artifacts/`。

检查 `manifest.json`、`package.json` 的版本一致，`versions.json` 包含对应的最低应用版本。当前应为 `1.2.0`。

GitHub Release 的标签必须为 **`1.2.0`，不要加 `v`**，并把以下文件分别作为附件上传：

- `main.js`
- `manifest.json`
- `styles.css`

可以额外附上校验值和安装 ZIP，但 ZIP 不能替代上述三个独立附件。发布说明可直接使用 `docs/release-notes.md`。

如果使用本仓库的自动流程，推送相同版本标签后会运行检查并创建**草稿 Release**。在 GitHub 查看附件与说明后，点击发布，社区安装程序才能下载该版本。默认分支上的 `manifest.json` 也必须更新并提交。

## 3. 提交 Obsidian 社区目录

1. 使用 Obsidian 账号登录 [community.obsidian.md](https://community.obsidian.md)。
2. 在个人资料页关联 GitHub 账号。
3. 进入 Plugins，选择 New plugin，填写你自己的公开仓库地址和维护者信息。
4. 查看自动检查结果，按要求修正并发布递增版本。
5. 没有检查错误且完成目录发布后，用户才能从 Obsidian 内安装。

当前流程以官方社区目录为准，不需要照旧教程向 `community-plugins.json` 提交新增插件的 PR。审核通过与否以官方结果为准，本地检查不能保证通过。

## 4. 后续更新

改动后运行检查并验证实际 PDF 阅读器行为，更新三个版本文件、更新日志和发布说明，发布同名版本标签及附件。不要将最低支持版本降低到没有验证过的版本。

需要扩展 Windows/Linux 支持证据时，按照 `docs/compatibility.md` 的清单进行应用实测。CI 的跨平台 Node 测试不能替代 Obsidian 桌面界面测试。

## 官方参考

- [提交插件](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)
- [Manifest 格式](https://docs.obsidian.md/Reference/Manifest)
- [插件提交要求](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [开发者政策](https://docs.obsidian.md/community-directory/developer-policies)
- [自动检查与 FAQ](https://docs.obsidian.md/community-directory/faq)
- [官方 ESLint 检查工具](https://github.com/obsidianmd/eslint-plugin)
