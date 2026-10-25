import type {FrozenHistoryEntry} from '../contracts/generation';

export interface HistoryCost { chars:number; images:number; bytes:number }
// Keep a contiguous suffix of whole turns. Never retain an answer after
// discarding its question, and never mutate the saved conversation or retry.
export function recentHistory(history:readonly FrozenHistoryEntry[],budget:HistoryCost,cost:(entry:FrozenHistoryEntry)=>HistoryCost):FrozenHistoryEntry[] {
  const turns:FrozenHistoryEntry[][]=[];
  for(const entry of history){
    if(entry.role==='user'||!turns.length)turns.push([]);
    turns.at(-1)!.push(entry);
  }
  const selected:FrozenHistoryEntry[][]=[];
  let chars=0,images=0,bytes=0;
  for(const turn of turns.reverse()){
    const total=turn.reduce((sum,entry)=>{const value=cost(entry);return {chars:sum.chars+value.chars,images:sum.images+value.images,bytes:sum.bytes+value.bytes};},{chars:0,images:0,bytes:0});
    if(chars+total.chars>budget.chars||images+total.images>budget.images||bytes+total.bytes>budget.bytes)break;
    selected.unshift(turn);chars+=total.chars;images+=total.images;bytes+=total.bytes;
  }
  return selected.flat();
}
