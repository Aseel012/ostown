import { Base } from './types';

export interface Stage { id: string; name: string; desc: string; dur: number; state: 'pending' | 'active' | 'done' | 'fail'; lines: string[] }
const mk = (id: string, name: string, desc: string, dur: number, lines: string[]): Stage => ({ id, name, desc, dur, state: 'pending', lines });

/** The boot chain from power button to login prompt. */
export class BootSim extends Base {
  stages: Stage[]; running = false; done = false; failed = '';
  ok = { disk: true, boot: true, kernel: true };
  constructor() {
    super();
    this.stages = [
      mk('psu', 'Power supply', 'You press the power button. The PSU stabilises voltages and raises the POWER GOOD signal, releasing the CPU from reset.', 40, ['PSU rails stable: +12V, +5V, +3.3V', 'POWER GOOD asserted']),
      mk('post', 'POST', 'Power-on self test. Firmware checks the CPU, RAM and keyboard controller. Beeps mean hardware trouble.', 60, ['CPU: OK', 'Memory test: 16384 MB OK', 'Keyboard controller: OK']),
      mk('bios', 'BIOS / UEFI firmware', 'Firmware initialises devices, then walks the boot order looking for a disk with a valid boot signature.', 50, ['Enumerating PCI devices', 'SATA port 0: ST1000DM010', 'Boot order: disk, USB, network']),
      mk('loader', 'Bootloader (GRUB)', 'The first-stage loader finds GRUB on disk. GRUB shows its menu, then loads the kernel image and initramfs into RAM.', 50, ['GRUB loading', 'menu entry: Linux 6.11', 'loading vmlinuz... loading initramfs...']),
      mk('kernel', 'Kernel decompression and start', 'The kernel unpacks itself, sets up memory management, the scheduler and interrupt tables, and detects hardware.', 70, ['Linux version 6.11.0', 'Memory: 16384MB available', 'APIC, timers, scheduler initialised', 'probing devices: SATA, USB, NIC']),
      mk('initrd', 'initramfs and real root', 'A temporary root filesystem in RAM provides the drivers needed to mount the real root filesystem, then hands over with switch_root.', 40, ['unpacking initramfs', 'mounting /dev/sda2 on /newroot (ext4)', 'switch_root to the real root']),
      mk('systemd', 'systemd (PID 1)', 'The first user-space process. systemd starts units in parallel, honouring dependencies: network, logging, cron, the display manager.', 60, ['systemd 256 running as PID 1', 'Reached target network.target', 'Reached target multi-user.target']),
      mk('login', 'Session / login', 'The display manager (or a getty on a server) presents a login prompt. The machine is ready.', 30, ['Started Display Manager', 'login: _']),
    ];
  }
  power() {
    if (this.running || this.done || this.failed) return;
    this.running = true; this.t = 0; this.say('Power button pressed.');
  }
  setFault(k: 'disk' | 'boot' | 'kernel', okv: boolean) { this.ok[k] = okv; this.say(okv ? `${k} repaired.` : `${k} fault injected. Boot again to see the failure.`, okv ? 'good' : 'warn'); }
  tick() {
    if (!this.running || this.done || this.failed) return;
    this.t++;
    const s = this.stages.find(x => x.state === 'pending' || x.state === 'active');
    if (!s) { this.done = true; this.say('Boot complete. The OS is up.', 'good'); return; }
    if (s.state === 'pending') { s.state = 'active'; this.say(`Stage: ${s.name}`); }
    if (this.t % s.dur === 0) {
      // fail at the right stage
      const failMap: Record<string, [keyof BootSim['ok'], string]> = {
        bios: ['disk', 'No bootable device found. Insert boot media and press a key.'],
        loader: ['boot', 'error: no such partition. Entering rescue mode.'],
        kernel: ['kernel', 'Kernel panic - not syncing: Unable to mount root fs.'],
      };
      const f = failMap[s.id];
      if (f && !this.ok[f[0]]) { s.state = 'fail'; this.failed = s.id; this.say(f[1], 'bad'); this.running = false; return; }
      s.state = 'done'; for (const l of s.lines) this.say(l, 'info');
    }
  }
  get progress() { const d = this.stages.filter(s => s.state === 'done').length; return d / this.stages.length; }
  reset() { const ok = this.ok; Object.assign(this, new BootSim()); this.ok = ok; }
}
