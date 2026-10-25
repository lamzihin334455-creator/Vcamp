import {afterEach,expect,test,vi} from 'vitest';
import {createSnapshotRefresh} from '../../src/app/snapshot-refresh';

afterEach(()=>vi.useRealTimers());
function fixture(){
  vi.useFakeTimers();
  const releases:Array<()=>void>=[],rejects:Array<(reason:Error)=>void>=[];
  const read=vi.fn(()=>new Promise<void>((resolve,reject)=>{releases.push(resolve);rejects.push(reject);}));
  let poll=true;
  const snapshots=createSnapshotRefresh(read,()=>poll);
  return {snapshots,read,releases,rejects,stopPolling:()=>{poll=false;}};
}
test('a slow read yields to one coalesced recovery read, without unbounded in-flight reads',async()=>{
  const f=fixture();f.snapshots.request();await vi.advanceTimersByTimeAsync(0);
  for(let i=0;i<100;i++)f.snapshots.request();
  expect(f.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999);expect(f.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(f.read).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(12000);expect(f.read).toHaveBeenCalledTimes(2);
  f.releases[1]();await vi.advanceTimersByTimeAsync(0);
  expect(f.read).toHaveBeenCalledTimes(3); // old held read still occupies one slot
  f.snapshots.dispose();f.releases[0]();f.releases[2]();
  await vi.advanceTimersByTimeAsync(10000);expect(f.read).toHaveBeenCalledTimes(3);
});
test('missed invalidations are recovered by read-only polling, which stops when no longer needed',async()=>{
  const f=fixture();f.snapshots.request();await vi.advanceTimersByTimeAsync(0);f.releases[0]();
  await vi.advanceTimersByTimeAsync(1999);expect(f.read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);expect(f.read).toHaveBeenCalledTimes(2);
  f.stopPolling();f.releases[1]();await vi.advanceTimersByTimeAsync(10000);
  expect(f.read).toHaveBeenCalledTimes(2);f.snapshots.dispose();
});
test('a failed read releases its slot and pending invalidations still recover',async()=>{
  const f=fixture();f.snapshots.request();await vi.advanceTimersByTimeAsync(0);f.snapshots.request();
  f.rejects[0](new Error('disconnected'));await vi.advanceTimersByTimeAsync(80);
  expect(f.read).toHaveBeenCalledTimes(2);f.snapshots.dispose();f.releases[1]();
});
test('unmount cancels polling and pending recovery without waiting for old browser requests',async()=>{
  const f=fixture();f.snapshots.request();await vi.advanceTimersByTimeAsync(0);f.snapshots.request();
  f.snapshots.dispose();f.snapshots.request();await vi.advanceTimersByTimeAsync(20000);
  expect(f.read).toHaveBeenCalledTimes(1);f.releases[0]();await vi.advanceTimersByTimeAsync(10000);
  expect(f.read).toHaveBeenCalledTimes(1);expect(vi.getTimerCount()).toBe(0);
});
