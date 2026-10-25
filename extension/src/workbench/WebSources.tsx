import {publicWebUri,type WebEvidence} from '../contracts/web';
export function WebSources({evidence}:{evidence?:WebEvidence}) {
  if(!evidence?.sources.length)return null;
  const link=(uri:string,title?:string)=>publicWebUri(uri)?<a href={uri} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" title={uri}>{title||new URL(uri).hostname}</a>:<span>链接不可用</span>;
  return <section className="web-sources" aria-label="网页来源">
    <details><summary>来源（{evidence.sources.length}）</summary><ul>{evidence.sources.map(s=><li key={s.id}>{link(s.uri,s.title)}</li>)}</ul></details>
  </section>;
}
