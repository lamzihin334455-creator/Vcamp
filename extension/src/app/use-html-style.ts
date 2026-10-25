import {useCallback,useEffect,useRef,useState} from 'react';
import type {ApplicationClient,Draft} from '../contracts/application';

export function useHtmlStyleMemory(client:ApplicationClient,enabled:boolean){
 const [selection,setSelection]=useState<Draft['htmlStyle']|null>(null),[ready,setReady]=useState(false),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const sequence=useRef(0),mounted=useRef(true);
 useEffect(()=>{
  mounted.current=true;let alive=true;
  const read=async()=>{const token=++sequence.current;try{const value=await client.htmlStylePreferences?.read()??null;if(alive&&token===sequence.current){setSelection(value);setReady(true);setError('');}}catch{if(alive&&token===sequence.current)setError('风格偏好读取失败，请重新选择。');}};
  if(enabled)void read();else setReady(true);
  const dispose=enabled?client.subscribePreferences?.(keys=>{if(keys.includes('vcamp.htmlStyle'))void read();}):undefined;
  return()=>{alive=false;mounted.current=false;++sequence.current;dispose?.();};
 },[client,enabled]);
 const choose=useCallback(async(value:Draft['htmlStyle']|null)=>{
  ++sequence.current;setSelection(value);setReady(true);setBusy(true);setError('');
  try{await client.htmlStylePreferences?.write(value??null);}catch{if(mounted.current)setError('风格偏好未保存，当前选择仍可使用。');}finally{if(mounted.current)setBusy(false);}
 },[client]);
 return {selection,ready,error,busy,choose};
}
