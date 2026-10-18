export type Tone = 'info' | 'good' | 'warn' | 'bad';
export interface ALog { t: number; text: string; tone: Tone }
export class Base {
  t = 0; log: ALog[] = [];
  say(text: string, tone: Tone = 'info') { this.log.push({ t: this.t, text, tone }); if (this.log.length > 300) this.log.splice(0, 100); }
}
export interface LessonStep { title: string; body: string; ask?: string }
export interface Lesson { id: string; section: string; title: string; tagline: string; minutes: number; steps: LessonStep[] }
