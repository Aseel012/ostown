# OSTown v3 — Requirements and Verification

## Functional

| # | Requirement | Test |
|---|-------------|------|
| F1 | Canvas editing: add nodes (palette click + drag), connect port-to-node, move, select, delete (button + Delete key), undo/redo | Automated browser + manual |
| F2 | Scenarios: 11 scenarios each load a valid machine (zero config problems) and run | Automated browser (per-scenario problem count) |
| F3 | Simulation control: play/pause/step, speeds 0.5x-16x, metrics/Gantt/graphs/processes/memory/devices/log update live | vitest + automated browser |
| F4 | Persistence: JSON export/import round trip; Academy progress + UI prefs survive reload (localStorage) | Automated browser |
| F5 | Free-typed sizes with units (B/KB/MB/GB/TB); invalid input shows inline error, never applied | vitest (units.ts) + browser spot check |
| F6 | Engine correctness: memory/MMU/disk/scheduler/containers/Academy engines | 56 vitest unit tests |
| F7 | Academy: 12 lessons open, steps advance, sandboxes respond, completion tracked | Automated browser + screenshots |
| F8 | Exports: setup JSON and metrics CSV download | Automated browser |

## Non-functional

| # | Requirement | Target | Test |
|---|-------------|--------|------|
| N1 | No client-side errors | 0 console errors / page errors across lab, Academy, theme switch, mobile | Puppeteer error capture |
| N2 | Zoom & pan | wheel + trackpad pinch + touch pinch anchored to cursor; animated buttons; 20-200% clamp; fit-to-screen; label in sync; crisp text | 10 automated zoom checks |
| N3 | Responsive | fully usable 390px wide: topbar wraps, HUD visible, panels overlay, dock readable | Screenshots desktop + mobile |
| N4 | Accessibility | aria-labels on icon buttons, focus-visible rings, keyboard ops (Space, Delete, Ctrl+Z), prefers-reduced-motion honored | Code audit + computed-style check |
| N5 | Performance | 8x speed on the 11-node rig scenario stays interactive (>=30 fps render loop) | rAF probe in browser |
| N6 | No leak growth | 30 scenario switches + node add/remove cycles: heap growth < 8 MB | CDP HeapProfiler + gc |
| N7 | Compatibility | standard APIs only (Pointer Events, WheelEvent, DOMMatrix, localStorage); no vendor prefixes; Chromium verified, Safari/Firefox use the same standard paths | Code audit + Chromium run |
| N8 | Error handling | React ErrorBoundary around lab + Academy; corrupt import rejected with toast, state intact | Automated browser (bad import) |
| N9 | Reliability | deterministic: same scenario + fixed ticks => identical metrics; no NaN in metrics | Automated browser (two runs compared) |

## v3.1 - Responsive + UI audit (phone, tablet, desktop)

Fixed after a full audit at 360, 390, 768, 820, 1024, 1180 and 1440 px (real Chrome, both themes):
- Phone/tablet home screen was unusable: topbar stacked 3 rows, inspector + palette covered the whole canvas and overlapped each other, dock took the rest. Now: palette is a bottom-sheet drawer (3-column grid of large tap targets), inspector is a 63vh bottom sheet, dock is a collapsible 54vh bottom sheet, canvas gets the full screen.
- Added floating action buttons: Add (components), Inspector, Telemetry, plus a vertical zoom rail (bottom-left on phones).
- Topbar: two compact rows on small screens, horizontally scrollable controls/stats row, no wrapping or clipped stats at any width; undo/redo moved next to play/step/reset; exports trimmed on small screens; scenario pill ellipsizes instead of overflowing.
- Panel state now defaults by viewport: panels open on desktop, closed (canvas-first) on phone/tablet; drawers close via a dimmed scrim tap; adding a component on phone closes the sheet.
- Touch targets 44px+ for controls, tabs, palette items and buttons; safe-area insets for notched phones (viewport-fit=cover).
- Empty-canvas hint was hard-coded 520px from the left (off-screen on phones); now centered.
- RAM legend "pinned" label was unreadable over its hatched background; redrawn with proper contrast in both themes.
- Undo/redo icons redrawn (were ambiguous half-circles); Help icon changed from a duplicate book to "?"; palette/inspector close buttons now use X.
- Dock tab bar: close button stays pinned (sticky) while tabs scroll.
- Welcome overlay: single-column layout and full-width buttons on phones.
- index.html: lang="hi-Latn" corrected to "en", added theme-color.
- Verified: 56/56 engine tests pass, tsc clean, production build passes, zero console errors at every tested width; Academy, scenario menu, light theme re-checked on phone and desktop.

## v3.2 - QA hardening release

| Area | Fix | Test |
|------|-----|------|
| Import/save safety | sanitizeTopology: schema check, unknown kinds dropped, props defaulted/clamped, dangling+duplicate edges removed, duplicate ids rejected, iterations capped | 9 vitest cases in sanitize.test.ts |
| Crash safety | boot guard in index.html + ErrorBoundary: "Reload with a fresh canvas" always reachable | manual (corrupt localStorage) |
| Custom workloads | burst list, arrival time, page reference string on the Custom Workload | 3 vitest cases |
| Address translation | step-through VA -> page+offset -> TLB -> PTE -> frame -> PA dock tab | 3 vitest cases (sim.translate) |
| Real page size | TLB + page table on real pages, independent of display frame grouping; page table label shows real page size | engine tests + browser |
| Layout | fit measures open panels, spreadNodes separates overlaps, phone layout verified | 1 vitest case + screenshots |
| Keyboard | redo Ctrl+Shift+Z / Ctrl+Y, Space not swallowed on focused controls, first edit always undoable | 1 vitest case + manual |
| Scheduling | SRTF/SJF on total remaining work | 1 vitest case |
| TLB | miss penalty in ns, feeds EAT | 1 vitest case |
| Academy | set-associative cache option | 3 vitest cases |
