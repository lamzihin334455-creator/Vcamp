export const queryResponse=(query='视频概念')=>new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:JSON.stringify({query})},finish_reason:'stop'}],usage:{prompt_tokens:4,completion_tokens:3,total_tokens:7,prompt_cache_hit_tokens:1,completion_tokens_details:{reasoning_tokens:0}}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
export const searchReply=(url='https://example.test/source',summary='网页补充资料')=>({results:[{url,title:'概念来源',summary,snippet:'资料摘要',content:''}]});
/** A query model response and a separate raw search response, never a tool loop. */
export function webTransport(search:()=>Response|Promise<Response>,capture?:(url:string,body:any)=>void):typeof fetch{
  return async(url,init)=>{
    const body=JSON.parse(String(init?.body));capture?.(String(url),body);
    return String(url).endsWith('/chat/completions')?queryResponse():search();
  };
}
