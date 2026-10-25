import {afterEach,expect,test,vi} from 'vitest';
import {currentMediaControl} from '../../src/video/current-media-control';

afterEach(()=>vi.unstubAllGlobals());
function fixture(paused=true){
  class Video extends EventTarget{
    paused=paused;currentSrc='fixture.mp4';readyState=4;duration=100;position=10;
    get currentTime(){return this.position;}
    set currentTime(value:number){this.position=value;this.dispatchEvent(new Event('seeking'));queueMicrotask(()=>this.dispatchEvent(new Event('seeked')));}
    pause(){this.paused=true;queueMicrotask(()=>this.dispatchEvent(new Event('pause')));}
    async play(){this.paused=false;this.dispatchEvent(new Event('play'));}
  }
  const video=new Video(),scope=Object.assign(new EventTarget(),{navigation:new EventTarget(),__vcampSeekGuard:{revision:0}});
  const doc=Object.assign(new EventTarget(),{hidden:false,querySelector:()=>video});
  doc.addEventListener('proof',e=>e.preventDefault());
  vi.stubGlobal('window',scope);vi.stubGlobal('document',doc);vi.stubGlobal('location',{href:'https://www.bilibili.com/video/BVtest/'});
  const act=(action:Parameters<typeof currentMediaControl>[0],time?:number)=>currentMediaControl(action,'token','proof',time,0);
  return {video,scope,doc,act};
}
test('one generation restores playback between batches and resumes without another grant',async()=>{
  const f=fixture();expect(await f.act('start')).toEqual({duration:100});
  await f.act('seek',30);await f.act('suspend');expect(f.video.currentTime).toBe(10);expect(f.video.paused).toBe(true);
  expect(await f.act('seek',40)).toEqual({error:'user-or-media-changed'});
  expect(await f.act('resume')).toEqual({valid:true});await f.act('seek',40);await f.act('release');
  expect(f.video.currentTime).toBe(10);expect((f.scope as any).__vcampCurrentMedia).toBeUndefined();
});
test('normal playing progress is retained when the automatic batch finishes',async()=>{
  const f=fixture(false);await f.act('start');await f.act('seek',30);await f.act('suspend');
  expect(f.video.currentTime).toBe(10);expect(f.video.paused).toBe(false);
  f.video.position=12;await f.act('resume');await f.act('seek',40);await f.act('release');
  expect(f.video.currentTime).toBe(12);expect(f.video.paused).toBe(false);
});
test('a new authorized task supersedes an idle continuation without taking over active capture',async()=>{
  const f=fixture();await f.act('start');
  expect(await currentMediaControl('start','later','proof',null,0)).toEqual({error:'capture-busy'});
  await f.act('seek',30);await f.act('suspend');
  expect(await currentMediaControl('start','later','proof',null,0)).toEqual({duration:100});
  expect(await f.act('resume')).toEqual({error:'capture-not-owned'});
  await f.act('cancel');
  expect((f.scope as any).__vcampCurrentMedia.token).toBe('later');
  await currentMediaControl('release','later','proof',null,0);expect(f.video.currentTime).toBe(10);
});
for(const change of ['seek','play','hidden','source','navigation'] as const)test(`a ${change} during the model wait prevents automatic resumption`,async()=>{
  const f=fixture();await f.act('start');await f.act('seek',30);await f.act('suspend');
  if(change==='seek')f.video.currentTime=12;
  if(change==='play')await f.video.play();
  if(change==='hidden'){f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));}
  if(change==='source')f.video.currentSrc='another.mp4';
  if(change==='navigation')f.scope.navigation.dispatchEvent(new Event('currententrychange'));
  expect(await f.act('resume')).toEqual({error:'user-or-media-changed'});
  await f.act('release');expect(f.video.currentTime).toBe(change==='seek'?12:10);
  expect((f.scope as any).__vcampCurrentMedia).toBeUndefined();
});
