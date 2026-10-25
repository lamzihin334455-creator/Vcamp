export function composerEnterAction(input:{key:string;shiftKey:boolean;composing:boolean;keyCode:number;scribble:boolean}){
  if(input.key!=='Enter'||input.shiftKey||input.composing||input.keyCode===229)return null;
  return input.scribble?'save-scribble' as const:'send' as const;
}
