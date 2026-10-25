// Site metadata is untrusted; no guessed ID-to-image mapping or URL parameters.
export function coverUrl(value:unknown):string|undefined {
  try{const u=new URL(String(value).startsWith('//')?'https:'+value:String(value));
    if(!/^https?:$/.test(u.protocol)||u.username||u.password||u.port||!/^i[0-2]\.hdslb\.com$/.test(u.hostname)||!/^\/bfs\//.test(u.pathname))return;
    return 'https://'+u.hostname+u.pathname;
  }catch{return;}
}
