import { ApplicationError } from '../contracts/application';
import { frameSchema, imageLimits, type CapturedFrame, type Attachment } from '../contracts/attachment';

// PNG only: bounded decode, CRC of every chunk, dimensions and decompressed rows.
// No URL fetches, SVG, executable formats or decompression bombs on import/send.
export async function validateImage(frame: CapturedFrame) {
  const bad = () => { throw new ApplicationError('invalid-message'); };
  if (!frameSchema.safeParse({dataUrl:frame.dataUrl,width:frame.width,height:frame.height,time:frame.time}).success || frame.width * frame.height > imageLimits.pixels) bad();
  let bytes: Uint8Array;
  try { bytes = Uint8Array.from(atob(frame.dataUrl.slice(22)), c => c.charCodeAt(0)); } catch { return bad(); }
  if (bytes.length > imageLimits.bytes) throw new ApplicationError('resource-limit');
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)) bad();
  const view = new DataView(bytes.buffer), compressed: Uint8Array[] = [];
  let offset=8, channels=0, ended=false;
  while (offset+12<=bytes.length) {
    const length=view.getUint32(offset), end=offset+8+length;
    if (end+4>bytes.length) bad();
    const type=String.fromCharCode(...bytes.slice(offset+4,offset+8));
    let crc=0xffffffff;
    for(let i=offset+4;i<end;i++){crc^=bytes[i];for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
    if(((crc^0xffffffff)>>>0)!==view.getUint32(end)) bad();
    if(offset===8){
      if(type!=='IHDR'||length!==13||view.getUint32(16)!==frame.width||view.getUint32(20)!==frame.height||bytes[24]!==8||![2,6].includes(bytes[25])||bytes[26]||bytes[27]||bytes[28])bad();
      channels=bytes[25]===6?4:3;
    } else if(type==='IHDR') bad();
    if(type==='IDAT')compressed.push(bytes.slice(offset+8,end));
    if(type==='IEND'){if(length||end+4!==bytes.length)bad();ended=true;break;}
    offset=end+4;
  }
  if(!ended||!compressed.length)bad();
  const row=frame.width*channels+1, expected=row*frame.height;
  const packed=new Uint8Array(compressed.reduce((n,b)=>n+b.length,0));let pos=0;
  for(const part of compressed){packed.set(part,pos);pos+=part.length;}
  const reader=new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
  let count=0;
  try { while(true){const {value,done}=await reader.read();if(done)break;for(let i=0;i<value.length;i++)if((count+i)%row===0&&value[i]>4)bad();count+=value.length;if(count>expected)bad();} } catch {bad();} finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(count!==expected)bad();
  const hash=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return {bytes:bytes.length,sha256:Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('')};
}
export function imageBudget(images:readonly Attachment[]) {
  if(images.length>imageLimits.count||images.reduce((n,image)=>n+image.bytes,0)>imageLimits.totalBytes)throw new ApplicationError('resource-limit');
}
