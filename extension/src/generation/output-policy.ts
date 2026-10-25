import {nativeDeepSeek, providerBaseUrl, type ProviderConnection} from '../contracts/provider-config';
import type {GenerationPurpose} from '../contracts/generation-diagnostic';
import {purposePolicy} from './purpose-policy';

export type OutputConnection = ProviderConnection & {
  models?: readonly {id:string;maxOutputTokens?:number}[];
  catalog?: readonly {id:string;maxOutputTokens?:number}[];
};
export const isFinalOutput = (purpose:GenerationPurpose) => purpose==='answer'||purpose==='markdown'||purpose==='html-page';
const v4 = (id:string) => /^deepseek-v4(?:\.1)?-(?:flash|pro)(?:-\d{4})?$/.test(id);

function bailianQwenFlash(connection:ProviderConnection,modelId:string) {
  if(modelId!=='qwen3.8-flash')return false;
  try {
    const url=new URL(providerBaseUrl(connection));
    const official=['dashscope.aliyuncs.com','dashscope-intl.aliyuncs.com','dashscope-us.aliyuncs.com'].includes(url.hostname)
      || /^[a-z0-9-]+\.(?:cn-beijing|ap-southeast-1|us-east-1|eu-central-1|ap-northeast-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(url.hostname);
    return url.protocol==='https:'&&official&&url.pathname.replace(/\/+$/,'')==='/compatible-mode/v1';
  }catch{return false;}
}

// Unknown compatible models choose their own default, rather than inheriting
// an arbitrary 8K clamp or a maximum they may reject. No probing/extra POSTs.
export function outputOptions(connection:OutputConnection,modelId:string,purpose:GenerationPurpose){
  const native=nativeDeepSeek(connection),qwenFlash=bailianQwenFlash(connection,modelId);
  const declared=connection.catalog?.find(m=>m.id===modelId)?.maxOutputTokens??connection.models?.find(m=>m.id===modelId)?.maxOutputTokens;
  // The documented limit for this exact Bailian model is 128K. A stale 8K
  // catalogue entry must not silently reintroduce the old final-output clamp.
  // https://help.aliyun.com/zh/model-studio/qwen3-8-flash
  const capacity=qwenFlash?131072:declared??(native||connection.providerId==='bailian'&&v4(modelId)?393216:undefined);
  const maxTokens=isFinalOutput(purpose)?capacity:native?purposePolicy[purpose].maxTokens:Math.min(8192,purposePolicy[purpose].maxTokens);
  const hybrid=connection.providerId==='bailian'&&v4(modelId)||connection.providerId==='siliconflow'&&/(?:^|\/)DeepSeek-V4(?:\.1)?(?:-Flash|-Pro)?$/i.test(modelId);
  const thinking=native?{thinking:{type:'disabled'}}:hybrid||qwenFlash?{enable_thinking:false}:{};
  return {maxTokens,thinking,includeUsage:native||qwenFlash};
}
