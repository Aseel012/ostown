export type Kind =
  | 'scheduler' | 'cpu' | 'mmu' | 'ram' | 'storage' | 'usb' | 'printer' | 'nic'
  | 'driver' | 'cache' | 'buffer' | 'container' | 'task' | 'gpu';

export type TplId = 'browser' | 'video' | 'copy' | 'zip' | 'photo' | 'print' | 'usbcopy' | 'download' | 'memhog' | 'database' | 'game' | 'ml' | 'custom';

export type Props = Record<string, any>;
export interface NodeDef { id: string; kind: Kind; x: number; y: number; tpl?: TplId; props: Props }
export interface EdgeDef { id: string; a: string; b: string }
export interface Topology { nodes: NodeDef[]; edges: EdgeDef[] }

export type Step =
  | { k: 'cpu'; n: number }
  | { k: 'rd'; n: number }
  | { k: 'wr'; n: number }
  | { k: 'net'; n: number }
  | { k: 'prn'; n: number }
  | { k: 'usb'; n: number }
  | { k: 'gpu'; n: number }
  | { k: 'play'; n: number };

export interface Tpl {
  id: TplId; name: string; blurb: string;
  size: number; ws: number; io: number; // bytes: virtual size, working set, bytes per I/O request
  prio: number; writePct: number; repeat: number; color: string;
  pattern: Step[]; fps?: number; bitrate?: number;
}

export interface Hint { text: string; a?: Kind; b?: Kind; fromId?: string; toId?: string }
