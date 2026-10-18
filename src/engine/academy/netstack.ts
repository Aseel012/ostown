import { Base } from './types';

export interface Layer { name: string; color: string; header: string }
export const LAYERS: Layer[] = [
  { name: 'Application', color: '#9d8cbd', header: 'HTTP GET /index.html' },
  { name: 'TCP', color: '#7aacbf', header: 'sport=51022 dport=443 seq=1001 ack=1' },
  { name: 'IP', color: '#7fb59d', header: 'src=192.168.1.20 dst=93.184.216.34 ttl=64' },
  { name: 'Ethernet', color: '#bfa87a', header: 'src=aa:bb:cc:01 dst=aa:bb:cc:99 type=IPv4' },
];
/** A packet's journey down the sender's stack, across the wire, and up the receiver's stack. */
export class NetStack extends Base {
  pos = -1; // -1: not started, 0..3 descending, 4: wire, 5..8 ascending, 9: delivered
  desc = true; sent = false; retransmits = 0; lossy = false;
  send() { if (this.sent) return; this.sent = true; this.pos = 0; this.desc = true; this.t++; this.say('The browser asks for a page. The application layer hands an HTTP request to the kernel.'); }
  step() {
    if (!this.sent || this.pos >= 9) return; this.t++;
    if (this.lossy && this.pos === 4 && this.retransmits === 0) { this.retransmits++; this.pos = 1; this.say('The frame never arrives (loss on the wire). TCP notices a missing ACK and retransmits the segment.', 'warn'); return; }
    this.pos++;
    if (this.pos <= 3) { const l = LAYERS[this.pos]; this.say(`${l.name} layer wraps the data with its own header: ${l.header}. This is encapsulation.`); }
    else if (this.pos === 4) this.say('On the wire: the NIC turns the frame into signals. Switches forward frames, routers forward packets.');
    else if (this.pos <= 8) { const l = LAYERS[8 - this.pos]; this.say(`Receiver: the ${l.name} layer checks and strips its header, then passes the payload up.`); }
    else { this.say('Delivered: the web server application reads the HTTP request from its socket. Each layer only understood its own header.', 'good'); }
  }
  reset() { this.pos = -1; this.sent = false; this.retransmits = 0; }
}
