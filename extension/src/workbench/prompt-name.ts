export function nextCopyName(name:string,existing:readonly string[]):string{
  const base=name.trim().replace(/\s+V\d+$/i,'').slice(0,195)||'未命名';
  const used=new Set(existing.map(value=>value.trim().toLowerCase()));
  let version=2;
  while(used.has(`${base} V${version}`.toLowerCase()))version++;
  return `${base} V${version}`;
}
