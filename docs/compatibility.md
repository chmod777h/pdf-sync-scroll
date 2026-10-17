# Compatibility and verification

Checked on 2026-10-17 for PDF Sync Scroll 1.2.0.

## Support boundary

| Environment | Evidence / status |
| --- | --- |
| macOS, Obsidian 1.14.4 | Actual application tests in a separate, synthetic vault; baseline verified |
| Obsidian before 1.14.4 | Not supported by this release; the former 1.5.0 claim was unverified and has been removed |
| Newer Obsidian versions | Allowed by the manifest, but not verified; PDF DOM changes may need fixes |
| Windows / Linux | No OS-specific runtime dependencies; application testing still pending |
| Mobile / tablet | Excluded using `isDesktopOnly: true` |
| Other themes/plugins | Default theme and only this community plugin were tested; conflicting scroll controllers are not supported |

The minimum is a conservative verified baseline, not a claim that all older versions necessarily fail. `getLanguage()` is public since 1.8.7 and declarative settings since 1.13.0; both exist in the tested 1.14.4 application.

## Automated checks

- 23 behavioral tests cover page geometry, differing page heights, bounded progress, shorter-document endings, two-way scroll feedback suppression, multiwindow selection, identical files in different panes, manual offsets, hidden/closed/replaced files, stale selection, cancellation, observer cleanup, malformed settings, unsupported display modes, closed windows, invalid geometry, fallback pane identity, unload, and language selection.
- 2 release checks validate version metadata and required documentation/local links.
- JavaScript syntax and the official `eslint-plugin-obsidianmd` JavaScript recommended preset pass. The only general-rule overrides allow the host's CommonJS import and module-local top-level declarations. No Obsidian-specific rules are disabled. TypeScript-only semantic API rules are not applicable to this untyped JavaScript source.
- Build stages only `main.js`, `manifest.json`, and `styles.css`; version mapping and hashes are verified.
- GitHub workflows are configured for macOS/Windows/Linux. They have not run on GitHub yet; local test results do not imply remote CI success.

## Actual application checks

A separate Obsidian 1.14.4 instance used an isolated profile and vault. The test documents were generated for this task: eight-page Original and Translation PDFs with different page heights, and a four-page Reference PDF. No personal documents were used.

Verified in the running app:

1. Page alignment across different PDF heights; page-position disagreement under 0.01 page.
2. Reverse-direction scrolling without feedback drift.
3. Capturing manual offsets while paused and preserving them when scrolling resumes.
4. Overall progress mode; disagreement below 0.002 of the scrollable range.
5. Automatic mode suspends when a third compatible PDF is visible.
6. A real popout window drives a three-PDF group across two windows.
7. The pane selector and declarative settings render; the selected-pane description refreshes after selection changes.
8. Disabling releases listeners, observers, pending frames, the status item, and the open selector.
9. Changing zoom through the PDF toolbar and scrolling with native wheel input keeps the two panes within 0.01 page.

The [recorded results](live-results.json) contain quantitative checks. Documentation screenshots were captured from that test vault. Unit-test fixtures simulate window events; only the checks above constitute application testing.

## Compatibility mechanisms and remaining risks

- PDF lookup is scoped to PDF panes, never the thumbnail/outline scroller. Hidden, disconnected, closed-window, unloaded, horizontal, wrapped, non-continuous, or spread viewers are excluded.
- Timers that synchronize scrolling and resize observers use the PDF pane's own window, including popouts. Event listeners, observers, selectors, and frames are cleaned up on unload.
- The PDF viewer's `.pdf-viewer-container`, `.pdfViewer`, `.page[data-page-number]`, and `.spread` structures are internal implementation details, not stable public Obsidian APIs. If those change, the plugin may stop connecting rather than know how to interpret the new layout. Recheck after app upgrades.
- `leaf.id` is an internal persistence aid. When unavailable, a WeakMap provides unique session-only identities. This preserves pane isolation, but users must reselect after restarting. Public `workspace.containerEl.ownerDocument` is used to identify the main window.
- Manual offsets reset when reconnecting. Page matching does not infer semantic correspondence. A shorter PDF stops at its end without moving the source backward.
- No PDF file writes, body-text extraction, network calls, outside-vault reads, telemetry, eval, HTML injection, or bundled runtime dependencies are used by the plugin.

## Manual checklist for a new OS or app version

Use a disposable vault, the default theme, and only this plugin. Record OS, app version and installer version.

- Open two PDFs with different page heights and zoom levels. Scroll both directions, including to document ends.
- Switch to progress mode with unequal page counts; verify progress and short-document clamping.
- Pause, set different positions, capture offsets, and scroll from every member of a three-pane group.
- Open a real popout; verify scroll, resizing, focus changes, and closing the window.
- Select a subset of four PDFs; scroll an unselected pane and verify it stays independent.
- Replace a selected file, hide its tab, restore it, and restart; check that no unrelated pane joins.
- Select horizontal, wrapped, non-continuous, and spread modes; verify they are excluded and reconnect after restoring supported modes.
- Open the selector and disable the plugin; ensure the selector closes and scrolling becomes independent.
- Check English and Chinese UI, keyboard activation, and the settings search.

## Sources checked

- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Submission requirements](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Official API declarations](https://github.com/obsidianmd/obsidian-api/blob/master/obsidian.d.ts)
- [Official JavaScript lint rules](https://github.com/obsidianmd/eslint-plugin)
