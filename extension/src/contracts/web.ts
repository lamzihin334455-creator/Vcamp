import {z} from 'zod';
// Literal identity is retained. This function never supplies a normalized URL.
export function publicWebUri(raw:string):boolean {
  if(raw.length>4096||/[\s\u0000-\u001f\u007f\\]/.test(raw))return false;
  let decoded=raw;
  try {
    decoded=decodeURIComponent(decoded);
    try{decoded=decodeURIComponent(decoded);}catch{/* A literal percent after one valid decoding is not malformed URI syntax. */}
    if(/\bsk-[\w-]{8,}|Bearer\s|(?:api[_-]?key|password|secret|token|cookie|authorization|signature|credential)\s*[:=]/i.test(decoded))return false;
    const url=new URL(raw);
    const host=url.hostname.toLowerCase();
    const local=/^(localhost|.*\.localhost|.*\.local|\[.*\]|\d+(?:\.\d+){0,3})$/.test(host);
    return url.protocol==='https:'&&!url.username&&!url.password&&!!host&&!local;
  } catch {return false;}
}
export const webUriSchema=z.string().max(4096).refine(publicWebUri);
export const webOptionsSchema=z.object({providerId:z.literal('deepseek'),modelId:z.literal('deepseek-flash'),route:z.enum(['deepseek-native-v1','deepseek-search-v2']),maxSearches:z.literal(1),maxOutputTokens:z.literal(1024),timeoutMs:z.literal(30000)}).strict();
export type WebOptions=z.infer<typeof webOptionsSchema>;
export const webOptions=():WebOptions=>({providerId:'deepseek',modelId:'deepseek-flash',route:'deepseek-search-v2',maxSearches:1,maxOutputTokens:1024,timeoutMs:30000});
export const webErrors=['web-disabled','web-unsupported','web-tool','web-no-sources','web-protocol'] as const;
export const webEvidenceSchema=z.object({
  version:z.literal(1),status:z.enum(['searching','retrieved','cited','uncited','unmatched','failed']),
  retrievedAt:z.string().datetime(),executionLinked:z.boolean(),
  sources:z.array(z.object({id:z.string().regex(/^s\d{1,2}$/),uri:webUriSchema,title:z.string().max(200).optional()}).strict()).max(20),
  references:z.array(z.object({uri:webUriSchema,sourceId:z.string().nullable()}).strict()).max(40),
  excludedSources:z.number().int().min(0).max(100),
  usage:z.object({inputTokens:z.number().int().nonnegative().optional(),outputTokens:z.number().int().nonnegative().optional(),cacheReadTokens:z.number().int().nonnegative().optional(),searches:z.number().int().nonnegative().max(1).optional()}).strict(),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.sources.map(s=>s.id)).size!==v.sources.length||new Set(v.sources.map(s=>s.uri)).size!==v.sources.length||v.references.some(r=>r.sourceId!==null&&!v.sources.some(s=>s.id===r.sourceId&&s.uri===r.uri))||(['retrieved','cited','uncited','unmatched'].includes(v.status)&&(!v.executionLinked||!v.sources.length))||v.status==='cited'&&(!v.references.length||v.references.some(r=>r.sourceId===null))||v.status==='unmatched'&&!v.references.some(r=>r.sourceId===null))ctx.addIssue({code:'custom',message:'Invalid evidence relation'});
});
export type WebEvidence=z.infer<typeof webEvidenceSchema>;
export function relateWebAnswer(evidence:WebEvidence,text:string):WebEvidence {
  const urls=[...new Set(text.match(/https?:\/\/[^\s<>"'\\)\]]+/gi)??[])];
  if(urls.length>40)throw new Error('web-protocol');
  const references=urls.filter(publicWebUri).map(uri=>({uri,sourceId:evidence.sources.find(s=>s.uri===uri)?.id??null}));
  // Unsafe answer links fail completion rather than silently losing a citation.
  if(references.length!==urls.length)throw new Error('web-protocol');
  const status=references.some(r=>r.sourceId===null)?'unmatched':references.length?'cited':'uncited';
  return webEvidenceSchema.parse({...evidence,status,references});
}
