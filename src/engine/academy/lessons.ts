import type { Lesson } from './types';

export const SECTIONS = ['Hardware', 'Booting', 'Linux', 'Concurrency', 'Isolation & security'] as const;

export const LESSONS: Lesson[] = [
  { id: 'cachehw', section: 'Hardware', title: 'The Memory Hierarchy', tagline: 'Why a 3 GHz CPU is not waiting on RAM all day', minutes: 6, steps: [
    { title: 'Registers are not enough', body: 'A CPU core wants one value every cycle. RAM needs ~200 cycles to answer. Between them sit three small, fast caches: L1 (~32 KB, 1 cycle), L2 (~256 KB, ~12 cycles), L3 (~8 MB, ~40 cycles). Each access checks L1 first, then L2, then L3, then RAM.', ask: 'Press "Run 1000 accesses" and watch the average cycles per access.' },
    { title: 'Locality is everything', body: 'Caches work because programs reuse data (temporal locality) and touch neighbours (spatial locality: one miss fetches a whole 64-byte line). A tight loop fits in L1 and flies. A random walk over a huge array misses all the way to RAM.', ask: 'Switch the access pattern between loop, sequential and random and compare the hit rates.' },
    { title: 'Size vs speed', body: 'Bigger caches are slower to search, so the hierarchy trades size for speed at each level. Try shrinking L1 or growing L3 and watch the average access time move.', ask: 'Set L1 to 8 KB. What happens to its hit rate? Now grow L3 to 32 MB.' },
    { title: 'Associativity: where a line may live', body: 'A direct-mapped cache gives every memory line exactly one slot, so lines that map to the same slot evict each other constantly (conflict misses). A set-associative cache offers a few slots per set; fully associative caches allow any slot. More ways mean fewer conflict misses but more hardware to search.', ask: 'Switch the mapping between direct, 2-way, 4-way and fully associative on the random pattern and compare L1 misses.' },
  ] },
  { id: 'boot', section: 'Booting', title: 'From Power Button to Login', tagline: 'PSU, POST, BIOS/UEFI, GRUB, kernel, initramfs, systemd', minutes: 7, steps: [
    { title: 'Firmware first', body: 'When voltages stabilise, the CPU starts executing firmware from flash. POST checks the hardware, then the BIOS/UEFI walks its boot order looking for a bootable disk.', ask: 'Press the power button and watch the first stages.' },
    { title: 'The handoff chain', body: 'The bootloader (GRUB) loads the kernel and an initramfs into RAM. The kernel unpacks, initialises memory management, the scheduler and drivers, mounts the real root filesystem, and starts PID 1.', ask: 'Follow the stage timeline. Each stage logs what it really prints.' },
    { title: 'When boot breaks', body: 'Every stage can fail, and the error tells you which stage died. No bootable device? BIOS. GRUB rescue shell? Bootloader. Kernel panic? The kernel could not mount root.', ask: 'Inject a fault (disk, bootloader or kernel), reboot, and read the failure.' },
  ] },
  { id: 'irq', section: 'Hardware', title: 'Interrupts and DMA', tagline: 'How the CPU avoids waiting on slow devices', minutes: 6, steps: [
    { title: 'Programmed I/O wastes the CPU', body: 'The simplest way to talk to a device is to poll it: read the status register in a loop until it says "ready". Simple, and the CPU burns every cycle the device needs.', ask: 'Run a transfer in Programmed I/O mode and look at the wasted cycles.' },
    { title: 'Interrupts give the time back', body: 'With interrupts, the CPU issues the request and goes back to useful work. When the device finishes, it raises an interrupt line; the CPU parks what it was doing, runs a short handler, then resumes.', ask: 'Switch to Interrupt mode and compare the CPU lane.' },
    { title: 'DMA removes the CPU entirely', body: 'For bulk copies even the "move each byte" part wastes the CPU. A DMA controller does the copy device-to-RAM itself and raises one interrupt at the end.', ask: 'Switch to DMA. The CPU is almost free the whole time.' },
  ] },
  { id: 'proctree', section: 'Linux', title: 'Processes, fork and Signals', tagline: 'PID 1, cloning, exec, zombies and orphans', minutes: 8, steps: [
    { title: 'Every process has one parent', body: 'On Linux a new process is born by fork(): an exact copy of its parent, sharing memory copy-on-write, with a fresh PID. PID 1 (systemd) is the ancestor of everything.', ask: 'Select a process and fork it a few times to grow the tree.' },
    { title: 'fork then exec', body: 'A shell runs your command by forking, then calling execve in the child to replace the copy with the new program. Same PID, new brain. This fork+exec pair is how every program starts.', ask: 'Fork, then exec "nginx" in the child.' },
    { title: 'Death has paperwork', body: 'exit() does not remove a process: it becomes a zombie holding its exit code until the parent calls wait(). If the parent dies first, the child is re-parented to PID 1, which reaps it.', ask: 'Exit a child while its parent lives (zombie!), then wait() in the parent. Then kill -9 something.' },
  ] },
  { id: 'syscall', section: 'Linux', title: 'System Calls: Crossing into the Kernel', tagline: 'Ring 3 meets ring 0 through a controlled gate', minutes: 5, steps: [
    { title: 'User mode cannot do much', body: 'Ordinary instructions run at ring 3 with no access to hardware or other processes. Anything interesting (files, network, processes, memory) needs the kernel, which runs at ring 0.', ask: 'Step the program. Plain arithmetic stays in user mode.' },
    { title: 'The syscall instruction is the gate', body: 'A system call puts a number in a register and executes syscall: the CPU traps to ring 0 and jumps to the kernel entry. The kernel checks arguments, does the privileged work, and iret returns to user mode with a result.', ask: 'Step through open, read and fork and watch the mode flip.' },
    { title: 'Everything else is a library', body: 'printf, malloc, fopen are library functions in user mode. Only when they need the kernel (write, brk, open) do they trap. The syscall surface is the whole contract between programs and the OS.', ask: 'Count how few lines of the trace actually enter the kernel.' },
  ] },
  { id: 'vfs', section: 'Linux', title: 'Files, Inodes and Permissions', tagline: 'Everything is a file, and every file has an owner and a mode', minutes: 8, steps: [
    { title: 'Names point to inodes', body: 'A directory maps names to inode numbers. The inode holds the metadata: owner, group, permissions, size, and where the data blocks live. Two names can point to one inode (hard links); deleting a name just drops its link count.', ask: 'Create a hard link and watch the link count. Then remove a name.' },
    { title: 'rwx for user, group, other', body: 'Every open is checked: if you are the owner, the first triplet applies; else if you are in the group, the second; else the third. r = read, w = write, x = execute (or "enter" for a directory). root skips the check.', ask: 'As alice, open /etc/shadow (denied). Switch to root and retry.' },
    { title: 'Creating needs the directory', body: 'To create or delete a file you need write permission on its directory, not on the file. Try touch as alice in /etc (denied) and in /home/alice (allowed).', ask: 'Try both, then chmod one of alice\'s files and re-check.' },
  ] },
  { id: 'pipes', section: 'Linux', title: 'Pipes: Streaming Between Processes', tagline: 'A bounded kernel buffer with blocking reads and writes', minutes: 5, steps: [
    { title: 'A pipe is a queue in the kernel', body: 'cmd1 | cmd2 creates a bounded buffer (64 KB on Linux). The producer\'s write() copies bytes in; the consumer\'s read() takes them out. No temporary file, no disk.', ask: 'Step time and watch bytes flow.' },
    { title: 'Blocking is the flow control', body: 'Buffer full? write() sleeps until space. Buffer empty? read() sleeps until data. The processes pace each other without any code for it.', ask: 'Make the producer 4x faster than the consumer and watch it block on a full pipe.' },
    { title: 'EOF ends it', body: 'When the last writer closes, a read on an empty pipe returns 0: end of file. The consumer finishes cleanly.', ask: 'Let the producer finish and watch the consumer exit at EOF.' },
  ] },
  { id: 'netstack', section: 'Linux', title: 'The Network Stack', tagline: 'Encapsulation from HTTP down to the wire and back', minutes: 6, steps: [
    { title: 'Each layer adds an envelope', body: 'Your HTTP request is put in a TCP segment (ports, sequence numbers), then an IP packet (addresses), then an Ethernet frame (MACs). Each layer only talks to the matching layer on the other side.', ask: 'Send a request and step it down the stack.' },
    { title: 'TCP makes it reliable', body: 'IP can lose packets. TCP numbers every byte, expects acknowledgements, and retransmits what got lost. Enable packet loss and watch the retransmit.', ask: 'Turn on loss, send again, and watch TCP recover.' },
    { title: 'The kernel owns the stack', body: 'Applications see only sockets (a fd, like a file). The whole TCP/IP machinery lives in the kernel, which is why a browser and a terminal share the network sanely.', ask: 'Follow the packet up the receiver\'s stack to the server application.' },
  ] },
  { id: 'systemd', section: 'Linux', title: 'systemd: Booting User Space', tagline: 'Units, dependencies and parallel startup', minutes: 5, steps: [
    { title: 'PID 1 with a to-do graph', body: 'systemd starts services as soon as their "After=" dependencies are done, not one by one in a fixed script order. Independent units start in parallel.', ask: 'Start the boot and watch which units start together.' },
    { title: 'Targets group units', body: 'network.target, multi-user.target: targets are synchronisation points. "Reached target multi-user" means everything it groups is up.', ask: 'Compare the total time with the sequential sum shown at the end.' },
  ] },
  { id: 'threads', section: 'Concurrency', title: 'Threads, Locks and Deadlock', tagline: 'Shared memory is fast, until two threads want two locks', minutes: 7, steps: [
    { title: 'A mutex serialises a section', body: 'Threads share one address space, so they protect shared data with mutexes: only the holder may enter the critical section. Everyone else blocks in the kernel.', ask: 'Step the scheduler and watch T1 and T2 take turns holding locks.' },
    { title: 'The deadly embrace', body: 'T1 holds A and wants B; T2 holds B and wants A. The wait-for graph has a cycle, so both sleep forever. Four conditions together make deadlock possible; a cycle makes it certain.', ask: 'Step until both threads block. Read the cycle in the wait-for graph.' },
    { title: 'Lock ordering prevents it', body: 'The standard fix: every thread takes locks in the same global order. Then no cycle can exist, by construction.', ask: 'Set both threads to A then B and re-run: no deadlock.' },
  ] },
  { id: 'namespaces', section: 'Isolation & security', title: 'Containers: Namespaces and cgroups', tagline: 'Not a VM: one kernel, boxed views', minutes: 6, steps: [
    { title: 'Namespaces limit what you see', body: 'Each namespace hides one kind of resource: PIDs, network, mounts, hostname, IPC, users. A container is a process tree that sees a private slice of one shared kernel.', ask: 'Toggle the PID namespace off: the container can now see host processes.' },
    { title: 'cgroups limit what you use', body: 'Namespaces are about visibility; cgroups are about quantity: CPU quota, memory limit, I/O bandwidth. Cross the memory limit and the container\'s own OOM killer fires, the host keeps running.', ask: 'Set the memory limit and watch it next to the host total.' },
  ] },
  { id: 'security', section: 'Isolation & security', title: 'Rings, Permissions and setuid', tagline: 'Why user code must ask politely', minutes: 6, steps: [
    { title: 'The CPU itself enforces the border', body: 'Ring 0 (kernel) may execute privileged instructions; ring 3 (user) may not. An app that touches an I/O port or another process\'s memory is stopped by the CPU/MMU, not by politeness.', ask: 'Run each attempt and read the verdict.' },
    { title: 'setuid: a careful, temporary crown', body: 'passwd must edit /etc/shadow, which only root may write. It carries the setuid bit: while it runs, the effective UID is 0. Powerful, so such programs are audited hard.', ask: 'Compare the /etc/shadow attempts for alice and for setuid passwd.' },
  ] },
];

export const lessonById = (id: string) => LESSONS.find(l => l.id === id)!;
