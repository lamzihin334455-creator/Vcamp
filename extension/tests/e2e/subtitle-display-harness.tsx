import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {NativeSubtitles} from '../../src/video/NativeSubtitles';
import type {ApplicationClient,WorkspaceView} from '../../src/contracts/application';
import '../../src/app/styles.css';

const binding={platform:'bilibili',videoId:'BVdisplay',partId:'1',tabId:1,documentId:'display',epoch:1} as const;
const tracks=['zh-CN','en'].map(language=>({language,label:language,status:'ready' as const,cues:Array.from({length:100},(_,i)=>({from:i*2,to:i*2+1.9,content:`${language} synthetic subtitle ${i}`}))}));
const sizes={primary:16,auxiliaryFontSize:14,autoReturn:true};
const client={subscribe:()=>()=>{},subtitlePreferences:{async read(){return sizes.primary;},async write(value:number){sizes.primary=value;},async readOptions(){return sizes;},async writeOptions(value:object){Object.assign(sizes,value);}},async command(){return {video:{binding,playback:{time:80,paused:true,duration:200}}};}} as unknown as ApplicationClient;
function Harness(){
 const [time,setTime]=useState(80);
 (window as any).displayFixture={setTime,sizes};
 const view={mode:'interactive',workspaceId:'display',chatId:'display',video:{binding,status:'ready',language:'zh-CN',cues:tracks[0].cues,tracks,playback:{time,paused:true,duration:200}}} as WorkspaceView;
 return <NativeSubtitles client={client} view={view}/>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
