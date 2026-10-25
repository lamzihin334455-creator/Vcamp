import {createRoot} from 'react-dom/client';
import {useSubtitles} from '../../src/workbench/Subtitles';
import type {ApplicationClient} from '../../src/contracts/application';
import type {SubtitlesView} from '../../src/contracts/subtitles';

const pending: {resolve:(value:SubtitlesView)=>void;reject:()=>void}[]=[];
let invalidate=()=>{};
const snapshot=(revision:number):SubtitlesView=>({versions:[],analysisSource:{kind:'native',language:revision?'en':'zh-CN'},sourceRevision:revision,sourceValid:true});
const client={subtitles:()=>new Promise<SubtitlesView>((resolve,reject)=>pending.push({resolve,reject:()=>reject(new Error('old query failed'))})),subscribe:(listener:()=>void)=>{invalidate=listener;return ()=>{};}} as unknown as ApplicationClient;
function Harness(){
  const subtitles=useSubtitles(client,'workspace');
  return <><output id="revision">{subtitles.view?.sourceRevision??'none'}</output><output id="error">{subtitles.error}</output><button onClick={()=>subtitles.accept(snapshot(2))}>选择新轨道</button></>;
}
(window as any).subtitleTest={invalidate:()=>invalidate(),resolve:(index:number,revision:number)=>pending[index].resolve(snapshot(revision)),reject:(index:number)=>pending[index].reject(),count:()=>pending.length};
createRoot(document.getElementById('root')!).render(<Harness/>);
