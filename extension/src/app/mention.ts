import PinyinMatch from 'pinyin-match';

/** Caret-local @ range. Composition never opens or consumes a mention. */
export interface Mention { start: number; end: number; query: string;kind?:'tools' }
export function mentionAt(text: string, caret: number, composing = false): Mention | null {
  if (composing) return null;
  const match = /(?:^|\s)([@!！])([^\s@!！]*)$/.exec(text.slice(0, caret));
  return match ? { start: caret - match[2].length - 1, end: caret, query: match[2],...(match[1]==='@'?{}:{kind:'tools' as const}) } : null;
}
export function consumeMention(text: string, mention: Mention | null): string {
  // Ignore a stale range after the user has moved to another draft or edited it.
  if (!mention || ![mention.kind==='tools'?`!${mention.query}`:`@${mention.query}`,...(mention.kind==='tools'?[`！${mention.query}`]:[])].includes(text.slice(mention.start, mention.end))) return text;
  return text.slice(0, mention.start) + text.slice(mention.end);
}

const normalized=(value:string)=>value.normalize('NFKC').toLocaleLowerCase().replace(/[\s._·\-/]+/g,'');
/** Match display names by Chinese text, full pinyin or pinyin initials. */
export function mentionSearchMatches(name:string,query:string){
  const needle=normalized(query);
  if(!needle)return true;
  return normalized(name).includes(needle)||PinyinMatch.match(name,needle)!==false;
}
