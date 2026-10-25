import { deflateSync } from 'node:zlib';
export function png() {
  const crc = (bytes: Uint8Array) => { let n = 0xffffffff; for (const b of bytes) { n ^= b; for (let i=0;i<8;i++) n=(n>>>1)^((n&1)?0xedb88320:0); } return (n ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(type), data]), head = Buffer.alloc(4), tail = Buffer.alloc(4); head.writeUInt32BE(data.length); tail.writeUInt32BE(crc(body)); return Buffer.concat([head, body, tail]); };
  const header = Buffer.from([0,0,0,2,0,0,0,2,8,6,0,0,0]);
  return 'data:image/png;base64,' + Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',deflateSync(Buffer.from([0,0,0,0,255,0,0,0,255,0,0,0,0,255,0,0,0,255]))), chunk('IEND',Buffer.alloc(0))]).toString('base64');
}