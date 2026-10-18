# OSTown  - Operating System Systems Lab

A visual, node-based operating system simulator plus a guided, interactive Academy. Wire up a scheduler, CPU (with on-chip caches), MMU, RAM, GPU, caches, buffers, disks, USB, NIC, drivers and containers, run workloads, and watch what happens. No code or assembly is executed; the simulation is behavioural.

## Run

    unzip ostown-v3.zip -d ostown && cd ostown
    npm install
    npm run dev        # http://localhost:5173
    npm test           # 83 tests
    npm run build      # production bundle in dist/

Deploy to Vercel: import the repo, Vite preset, output directory `dist` (vercel.json included).

## Sizing

Every size field takes free text with a unit: `12`, `12 bytes`, `640 KB`, `1.5 GB`, `8gb`. Units B, KB, MB, GB, TB (binary, 1 KB = 1024 B). RAM, page size, kernel reserve, cache, buffers, disk capacity, swap, USB capacity, container limits and task sizes are all editable. Invalid input shows an inline error and is not applied. "Fit workloads" sizes RAM to the current tasks.

## Model

- RAM: size, page size, kernel reserved, fit strategy (first/best/worst/next), OOM policy, display resolution.
- MMU: FIFO, LRU, Clock, LFU, Random; TLB size and miss cost, ASIDs, prefetch.
- CPU: clock, cores; each core can carry an on-chip cache (L1/L2/L3 sizes, on/off). A working set that outgrows cache runs below clock speed - the cache factor is shown live in the inspector.
- GPU: own node behind a GPU driver, frame-rate cap, own queue, frames-served counter. Pair with 3D Game and ML Training task templates (512 MB hot working set).
- Disk: HDD/SSD, seek, transfer rate, scheduler (FCFS, SSTF, SCAN, C-SCAN), swap area.
- Page cache, media buffers, NIC fair share, USB, containers with memory/CPU limits and restart policy.
- Scheduler: policy, quantum, context-switch cost, priority boost.
- Tasks: size, working set, I/O ratio, write ratio, bursts, priority, start delay, loop. The Custom Workload task adds a free-typed burst list (e.g. "cpu 40, rd 2, cpu 25"), an absolute arrival time and an optional page reference string.
- Dock: metrics, Gantt, graphs, processes, memory map, page table, address translation (step through virtual address -> page+offset -> TLB -> PTE -> frame -> physical address), devices, event log, problems. CSV export, undo/redo, save/load JSON, 11 scenarios (incl. "Gaming Rig: CPU Cache and GPU").

## v3.3 hardening

- Imports and saved state are schema-validated and repaired (unknown components dropped, missing props defaulted, numbers clamped, dangling/duplicate connections removed, iteration counts capped). A corrupted save can never blank the page: a boot guard and the error boundary both offer "Reload with a fresh canvas".
- Page size is real: the TLB, page tables and the address-translation view work on actual pages (e.g. 4 KB); the display grouping of frames no longer changes translation accuracy.
- Undo coalesces rapid edits to the same field; redo is Ctrl+Shift+Z or Ctrl+Y; Space no longer fires play/pause while a control is focused; size fields have maximum limits; the kernel reserve is capped below RAM.
- The canvas fit accounts for open panels; nodes can no longer land on top of each other.
- SRTF/SJF compare total remaining work; the TLB miss penalty is in nanoseconds and feeds the effective access time.
- The Academy cache lesson has a direct-mapped / set-associative / fully associative option.

## Academy

The topbar "Academy" button opens 12 guided, interactive lessons in five tracks. Each lesson is a short read plus a live sandbox built on its own deterministic engine (unit-tested):

- Hardware: The Memory Hierarchy (cache hit/miss explorer), Interrupts and DMA (polling vs DMA comparison).
- Booting: From Power Button to Login (boot chain stepper).
- Linux: Processes, fork and Signals (live process tree), System Calls (ring 3 / ring 0 stepper), Files, Inodes and Permissions (a working VFS with users, modes, hard links), Pipes (bounded-buffer producer/consumer), The Network Stack (packet walkthrough), systemd (boot target dependency graph).
- Concurrency: Threads, Locks and Deadlock (dining philosophers, lock ordering).
- Isolation & Security: Containers: Namespaces and cgroups (toggle namespaces, set limits), Rings, Permissions and setuid (privilege verdicts).

Progress is kept per browser (localStorage). Deep links: `?academy&lesson=vfs`.

## v3.3 fixes (from the external review)
- Paging is exact per real page; "Memory map resolution" is display-only. Only RAM above 4096 pages is grouped, and the Inspector says so ("Approximate").
- Shrinking a buffer releases surplus pinned frames. Disk/USB "Used space" edits apply to the live device. Container CPU quota scales with core count.
- Zoom buttons respond to click/tap; welcome scrolls; resize closes incompatible drawers; compact top bar up to 1500 px; short-screen dock no longer covers controls.
- Undo keeps rapid distinct operations. Academy and Welcome are real modals (focus trap, inert background, no editor shortcuts, lab paused). Corrupt Academy/canvas storage self-repairs.
- Import rejects inherited workload names and limits nodes/edges/steps. Escape cancels field edits. Deep links (`?academy&lesson=vfs`, `?s=`, `?theme=`, `?dock=`) are validated; `warm` is capped.
- Tests: `npm test` (126 engine/store/UI-state tests). Real-Chrome suite: `npm i --no-save playwright-core && npm run dev` then `node qa/browser.mjs http://127.0.0.1:5173/` (set CHROME_PATH if needed).
