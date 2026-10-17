# Contributing

Use Node.js 22+ and pnpm 11.25.0. Run `pnpm install --frozen-lockfile` and `pnpm verify` before proposing changes. The plugin is readable CommonJS; `main.js` is the source of truth and the release asset. Keep runtime code free of network calls and third-party runtime dependencies.

For synchronization changes, add behavioral regression tests and exercise the real PDF viewer in an isolated vault. Check both scrolling directions, different zoom/page sizes, short documents, offsets, manual selection, hidden/replaced panes, popout windows, and disabling the plugin. See [compatibility](docs/compatibility.md).

All UI strings use `t(Chinese, English)` and must include both languages. Keep styles scoped to plugin classes. Keep callbacks, animation frames, observers, and selectors tied to the owning window and release them on unload. Treat PDF viewer structure and pane IDs as compatibility risks; changes must fail safely without controlling unrelated panes.

Do not add personal PDFs, settings, credentials, or absolute machine paths. Synthetic fixtures are welcome. Contributions are provided under the project's MIT license.
