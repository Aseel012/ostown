import { Base } from './types';

export type Mode = { r: boolean; w: boolean; x: boolean };
export interface Perms { u: Mode; g: Mode; o: Mode }
export interface INode { ino: number; name: string; dir: boolean; owner: string; group: string; perms: Perms; linkTo?: string; links: number; children?: INode[]; size: number }

export const USERS: Record<string, { groups: string[] }> = { root: { groups: ['root'] }, alice: { groups: ['alice', 'staff'] }, bob: { groups: ['bob'] } };
const pm = (r: boolean, w: boolean, x: boolean): Mode => ({ r, w, x });
const dirP = (): Perms => ({ u: pm(1 as any, 1 as any, 1 as any), g: pm(true, false, true), o: pm(true, false, true) });
const fileP = (): Perms => ({ u: pm(true, true, false), g: pm(true, false, false), o: pm(true, false, false) });
export const permStr = (p: Perms, dir: boolean) => (dir ? 'd' : '-') + [p.u, p.g, p.o].map(m => `${m.r ? 'r' : '-'}${m.w ? 'w' : '-'}${m.x ? 'x' : '-'}`).join('');

/** A small virtual filesystem with inodes, ownership, permission checks and links. */
export class Vfs extends Base {
  root: INode; nextIno = 12; uid = 'alice';
  constructor() {
    super();
    const f = (name: string, owner: string, group: string, perms: Perms, size = 4096): INode => ({ ino: this.nextIno++, name, dir: false, owner, group, perms, links: 1, size });
    const d = (name: string, owner: string, group: string, children: INode[] = []): INode => ({ ino: this.nextIno++, name, dir: true, owner, group, perms: dirP(), links: 2, children, size: 0 });
    this.root = d('/', 'root', 'root', [
      d('home', 'root', 'root', [
        d('alice', 'alice', 'alice', [f('notes.txt', 'alice', 'alice', fileP(), 231), f('report.pdf', 'alice', 'staff', fileP(), 90012)]),
        d('bob', 'bob', 'bob', [f('todo.txt', 'bob', 'bob', fileP(), 55)]),
      ]),
      d('etc', 'root', 'root', [f('passwd', 'root', 'root', { u: pm(true, true, false), g: pm(true, false, false), o: pm(true, false, false) }, 1480), f('shadow', 'root', 'root', { u: pm(true, false, false), g: pm(false, false, false), o: pm(false, false, false) }, 930)]),
      f('welcome.txt', 'root', 'root', { u: pm(true, true, false), g: pm(true, false, false), o: pm(true, false, false) }, 128),
    ]);
    this.say('A small filesystem is mounted. You are alice. Try opening files you own and files you do not.');
  }
  private kids(n: INode) { return n.children ?? []; }
  resolve(path: string): INode | null {
    let cur = this.root; if (path === '/') return cur;
    for (const part of path.split('/').filter(Boolean)) {
      const nx = this.kids(cur).find(k => k.name === part); if (!nx) return null;
      cur = nx.linkTo ? this.resolve(nx.linkTo) ?? nx : nx;
    }
    return cur;
  }
  parentOf(path: string): INode | null { const parts = path.split('/').filter(Boolean); parts.pop(); return this.resolve('/' + parts.join('/')); }
  can(n: INode, op: 'r' | 'w' | 'x', uid = this.uid): boolean {
    if (uid === 'root') return true;
    const u = USERS[uid]; const m = n.owner === uid ? n.perms.u : u.groups.includes(n.group) ? n.perms.g : n.perms.o;
    return m[op];
  }
  who(u: string) { this.uid = u; this.say(`su ${u}: you now act as ${u} (groups: ${USERS[u].groups.join(', ')}).`); }
  open(path: string, how: 'read' | 'write' = 'read'): boolean {
    this.t++; const n = this.resolve(path);
    if (!n) { this.say(`open("${path}"): ENOENT - no such file or directory.`, 'bad'); return false; }
    const op = how === 'read' ? 'r' : 'w';
    if (n.dir) { this.say(`open("${path}"): EISDIR - this is a directory. Use ls to list it.`, 'bad'); return false; }
    if (!this.can(n, op)) { this.say(`open("${path}") as ${this.uid}: EACCES - permission denied. Check ${permStr(n.perms, n.dir)} owner ${n.owner}:${n.group}.`, 'bad'); return false; }
    this.say(`open("${path}") as ${this.uid}: OK, fd = 3. inode ${n.ino}, ${n.size} bytes.`, 'good'); return true;
  }
  ls(path = '/'): INode[] { const n = this.resolve(path); if (!n?.dir) { this.say(`ls: cannot access ${path}`, 'bad'); return []; } this.t++; this.say(`ls ${path}: ${this.kids(n).length} entries.`); return this.kids(n); }
  chmod(path: string, patch: Partial<Perms>) {
    const n = this.resolve(path); if (!n) return;
    if (n.owner !== this.uid && this.uid !== 'root') { this.say(`chmod "${path}" as ${this.uid}: only the owner (${n.owner}) or root may change permissions.`, 'bad'); return; }
    n.perms = { ...n.perms, ...patch }; this.t++;
    this.say(`chmod ${permStr(n.perms, n.dir)} "${path}"`, 'good');
  }
  mkfile(dirPath: string, name: string) {
    const d = this.resolve(dirPath); if (!d?.dir) return;
    if (!this.can(d, 'w')) { this.say(`touch ${dirPath}/${name}: EACCES - you need write permission on the directory.`, 'bad'); return; }
    d.children!.push({ ino: this.nextIno++, name, dir: false, owner: this.uid, group: this.uid, perms: fileP(), links: 1, size: 0 }); this.t++;
    this.say(`Created ${dirPath === '/' ? '' : dirPath}/${name}, owned by ${this.uid}.`, 'good');
  }
  link(path: string) { const n = this.resolve(path); if (!n || n.dir) return; n.links++; this.t++; this.say(`Hard link to "${path}" created. inode ${n.ino} now has link count ${n.links}. Both names point to the same inode and the same bytes.`, 'good'); }
  unlink(path: string) { const n = this.resolve(path); if (!n || n.dir) return; n.links = Math.max(0, n.links - 1); this.t++; this.say(`rm "${path}": one name removed. inode ${n.ino} link count ${n.links}. ${n.links === 0 ? 'No names left: the data blocks are freed once open handles close.' : 'The data survives through the remaining name(s).'}`, n.links === 0 ? 'warn' : 'info'); }
}
