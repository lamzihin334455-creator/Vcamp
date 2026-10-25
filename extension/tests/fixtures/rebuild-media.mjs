// Create equivalent synthetic media in a separate output directory.
// Existing fixture bytes are never overwritten by this script.
import {spawnSync} from 'node:child_process';
import {access,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
await mkdir(join(root,'.tmp'),{recursive:true});
const output=process.argv[2]?resolve(process.argv[2]):await mkdtemp(join(root,'.tmp/fixture-media-'));
await mkdir(output,{recursive:true});
const specs=[
  ['t02-synthetic.mp4','color=c=red:s=160x90:r=10:d=8',false],
  ['t16-original.mp4',
    'color=c=red:s=320x180:r=10:d=2[a];color=c=green:s=320x180:r=10:d=2[b];color=c=blue:s=320x180:r=10:d=2[c];color=c=yellow:s=320x180:r=10:d=2[d];[a][b][c][d]concat=n=4:v=1:a=0',true],
  ['t16-other.mp4','color=c=gray:s=320x180:r=10:d=8',true],
  ['two-settings-quality.mp4',
    'color=c=0x203c52:s=640x360:r=10:d=4,drawgrid=w=100:h=24:t=1:c=0xb8d5e5,drawbox=x=20:y=70:w=160:h=18:c=white:t=fill[a];color=c=0x205245:s=640x360:r=10:d=4,drawgrid=w=80:h=36:t=1:c=0xb8d5e5,drawbox=x=20:y=140:w=200:h=18:c=white:t=fill[b];[a][b]concat=n=2:v=1:a=0',false],
  ['visual-proposals.mp4','testsrc2=s=320x180:r=10:d=4',false],
];
for(const [name,filter,fragmented] of specs){
  const target=join(output,name);
  if(await access(target).then(()=>true,()=>false))throw Error('Refusing to overwrite '+target);
  const args=['-hide_banner','-loglevel','error','-n','-f','lavfi','-i',filter,'-an','-c:v','libx264','-profile:v','baseline','-level:v','1.1','-pix_fmt','yuv420p','-g','10','-keyint_min','10','-sc_threshold','0'];
  args.push('-movflags',fragmented?'frag_keyframe+empty_moov+default_base_moof':'+faststart',target);
  const result=spawnSync(process.env.FFMPEG??'ffmpeg',args,{stdio:'inherit'});
  if(result.error)throw result.error;
  if(result.status!==0)throw Error('FFmpeg failed for '+name);
}
// Packet offsets belong to the newly encoded fragmented MP4, not the originals.
const bytes=await readFile(join(output,'t16-original.mp4')),fragments=[];
for(let offset=0;offset+8<=bytes.length;){
  const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
  if(size<8||offset+size>bytes.length)throw Error('Unexpected MP4 box layout');
  if(type==='moof')fragments.push(offset);
  offset+=size;
}
const avc=bytes.indexOf(Buffer.from('avcC'));
if(avc<0)throw Error('Missing AVC configuration');
await writeFile(join(output,'t16-packets.json'),JSON.stringify({fragments,codec:'avc1.'+bytes.subarray(avc+5,avc+8).toString('hex'),duration:8},null,2)+'\n');
console.log(output);
