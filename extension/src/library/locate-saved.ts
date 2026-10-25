import {ApplicationError,type ApplicationClient} from '../contracts/application';
import type {LibraryTarget} from '../contracts/library';

// Every module resolves the persisted source via the same command as Chat.
export async function locateSaved(client:ApplicationClient,target:LibraryTarget,time:number,onError:(message:string)=>void){
  try{if(!client.library)throw new ApplicationError('unsupported-capability');await client.library({type:'library.locate',target,time});onError('');}
  catch(error){onError(error instanceof ApplicationError?({'invalid-message':'此时间超出来源视频的有效时长，未定位。','permission-denied':'浏览器未允许访问来源视频，请在扩展管理中恢复 B 站权限。','stale-binding':'来源视频或分 P 已变化，未跳转当前视频，请回源后再试。','not-found':'原资料或来源已删除，无法定位。','read-failed':'来源播放器未完成定位，请等待视频加载后手动再试。'}[error.code as string]??'未能定位来源视频，请回源后再试。'):'未能定位来源视频，请回源后再试。');}
}
