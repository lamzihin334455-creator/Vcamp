import {useEffect,useState} from 'react';
import type {ApplicationClient,Draft} from '../contracts/application';
import type {PromptStyle,StyleFields,StyleRevision} from '../contracts/style';
import {usePromptLeaveGuard,type RegisterPromptLeaveGuard} from './PromptLeaveGuard';
import {nextCopyName} from './prompt-name';
import {Plus} from 'lucide-react';
import {SortablePromptList} from './SortablePromptList';

export function useStyles(client:ApplicationClient,selected?:Draft['htmlStyle'],enabled=true){
 const [styles,setStyles]=useState<PromptStyle[]>([]),[revision,setRevision]=useState<StyleRevision>(),[error,setError]=useState('');
 useEffect(()=>{if(!enabled||!client.styles)return;let alive=true,sequence=0;
  const refresh=async()=>{const token=++sequence;try{const result=await client.styles!({type:'style.query',...(selected?{selected}:{})});if(alive&&token===sequence){setStyles(result.styles);setRevision(result.revisions?.[0]);setError('');}}catch{if(alive&&token===sequence)setError('风格读取失败，请重新选择。');}};
  const dispose=client.subscribe(()=>void refresh(),state=>{if(state==='connected')void refresh();});void refresh();return()=>{alive=false;dispose();};
 },[client,enabled,selected?.styleId,selected?.revisionId]);
 async function reorder(ids:string[]){if(!client.styles)throw new Error('Style service unavailable');const result=await client.styles({type:'style.reorder',ids});setStyles(result.styles);}
 return {styles,revision,error,reorder};
}

const blank:StyleFields={name:'',description:''};
const summaries:Record<string,string>={'builtin-style-apple':'清晰留白','builtin-style-swiss':'网格对比','builtin-style-neumorphic':'柔和光影','builtin-style-editorial':'图文节奏','builtin-style-brutalist':'粗线对比'};
export function StyleManager({client,registerLeaveGuard}:{client:ApplicationClient;registerLeaveGuard?:RegisterPromptLeaveGuard}){
 const {styles,error:loadError,reorder}=useStyles(client);
 const [editing,setEditing]=useState<PromptStyle>(),[fields,setFields]=useState(blank),[saved,setSaved]=useState(blank),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState(''),[confirm,setConfirm]=useState(false);
 const {requestLeave,leaveDialog}=usePromptLeaveGuard(open&&JSON.stringify(fields)!==JSON.stringify(saved),busy,registerLeaveGuard);
 function begin(style?:PromptStyle){const value=style?{name:style.name,description:style.description}:blank;setEditing(style);setFields(value);setSaved(value);setOpen(true);setError('');setStatus('');setConfirm(false);}
 async function save(){if(!client.styles||busy)return;setBusy(true);setError('');try{const result=await client.styles(editing?{type:'style.save',styleId:editing.id,expectedRevision:editing.revision,fields}:{type:'style.create',fields});const row=editing?result.styles.find(row=>row.id===editing.id):result.styles.find(row=>!styles.some(old=>old.id===row.id));if(row){setEditing(row);const value={name:row.name,description:row.description};setFields(value);setSaved(value);}setStatus('风格已保存。重新选择后用于下一次请求。');}catch{setError('保存失败，请检查必填项或重新读取最新版本。输入已保留。');}finally{setBusy(false);}}
 async function remove(){if(!editing||!client.styles||busy)return;setBusy(true);try{await client.styles({type:'style.delete',styleId:editing.id,expectedRevision:editing.revision});setOpen(false);setConfirm(false);setStatus('风格已删除，历史请求保留原版本。');}catch{setError('删除失败，请重新读取后重试。');}finally{setBusy(false);}}
 return <section className="template-manager prompt-manager" aria-label="风格管理"><div className="prompt-heading"><h3>{open?editing?`编辑风格 · ${editing.name}`:'新建风格':<>风格管理 <span className="prompt-count">{styles.length}</span></>}</h3>{open?<button disabled={busy} onClick={async()=>{if(await requestLeave())setOpen(false);}}>返回风格列表</button>:<button className="prompt-create" onClick={()=>begin()}><Plus aria-hidden="true"/>新建风格</button>}</div>
 {loadError&&<p role="alert">{loadError}</p>}
 {!open?<SortablePromptList label="风格" items={styles.map(style=>({id:style.id,name:style.name,detail:style.revision===1?summaries[style.id]??style.description:style.description,description:style.description}))} onOpen={id=>begin(styles.find(row=>row.id===id))} onReorder={reorder}/>:<form className="prompt-editor" onSubmit={event=>{event.preventDefault();void save();}}><div className="prompt-editor-body"><fieldset className="prompt-editor-fields" disabled={busy}>
 {editing&&<div className="prompt-actions"><button type="button" onClick={()=>{setEditing(undefined);setSaved(blank);setFields({...fields,name:nextCopyName(fields.name,styles.map(style=>style.name))});}}>复制风格</button><button type="button" onClick={()=>setConfirm(true)}>删除风格</button></div>}
 {confirm&&<div className="prompt-delete"><p>删除“{editing?.name}”？已有请求保持原风格。</p><button type="button" onClick={()=>void remove()}>确认删除风格</button><button type="button" onClick={()=>setConfirm(false)}>取消</button></div>}
 <label>风格名称<input required maxLength={200} value={fields.name} onChange={event=>setFields({...fields,name:event.target.value})}/></label><label>风格描述<textarea required maxLength={4000} value={fields.description} placeholder="描述配色、排版、材质、交互或表达方式" onChange={event=>setFields({...fields,description:event.target.value})}/></label>
 </fieldset></div><div className="prompt-editor-footer"><button className="prompt-save" disabled={busy}>{busy?'正在保存…':editing?'保存风格':'创建风格'}</button></div></form>}
 {error&&<p role="alert">{error}</p>}{status&&<p role="status">{status}</p>}{leaveDialog}</section>;
}
