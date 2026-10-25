/** Read-only snapshot invalidations normally share one read and one trailing
 * read. A slow read may yield to one recovery read. Never queue an unlimited
 * number of browser/storage requests, and never use this for mutations.
 * The reader must fence late responses (workspace revision / target epoch).
 */
export function createSnapshotRefresh(refresh:()=>Promise<void>, shouldPoll:()=>boolean=()=>true, options:{slowMs?:number;pollMs?:number;minIntervalMs?:number}={}) {
  const slowMs=options.slowMs??1000,pollMs=options.pollMs??2000,minIntervalMs=options.minIntervalMs??80;
  let disposed=false,started=false,pending=false,sequence=0,lastStarted=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,poll:ReturnType<typeof setInterval>|undefined;
  const flights=new Map<number,number>();
  function pump(){
    clearTimeout(timer);timer=undefined;
    if(disposed||!pending||flights.size>=2)return;
    const now=Date.now(),current=flights.get(sequence);
    const wait=Math.max(0,minIntervalMs-(now-lastStarted),current===undefined?0:slowMs-(now-current));
    if(wait>0){timer=setTimeout(pump,wait);return;}
    const token=++sequence;pending=false;lastStarted=now;flights.set(token,now);
    // The caller handles the visible read error. A rejected read must still
    // release its slot so reconnects and later invalidations can recover.
    void Promise.resolve().then(refresh).catch(()=>{}).finally(()=>{flights.delete(token);pump();});
  }
  function request(){
    if(disposed)return;
    if(!started){started=true;poll=setInterval(()=>{if(shouldPoll())request();},pollMs);}
    pending=true;pump();
  }
  return {request,dispose(){disposed=true;pending=false;clearTimeout(timer);clearInterval(poll);}};
}
