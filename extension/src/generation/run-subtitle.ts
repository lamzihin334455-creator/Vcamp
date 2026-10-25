import {subtitleProcessingLimits} from '../contracts/subtitle-limits';
import {prepareSubtitleGlossary,reconcileSubtitleTerms,applyTerminology,type SubtitleQualityPort} from './subtitle-quality';
import { z } from 'zod';
import { ApplicationError } from '../contracts/application';
import type { Coverage, SubtitleRequestSnapshot } from '../contracts/generation';
import { cueSchema, type Cue } from '../contracts/video';
import { ProviderError, type ProviderPort } from './provider-port';
import { fixedPrompt } from '../prompts/fixed-rules';
import {subtitleResponse} from './subtitle-response';

export const subtitleBatchLimits = { cues: subtitleProcessingLimits.batchCues, chars: subtitleProcessingLimits.batchChars, segments: subtitleProcessingLimits.segments, outputChars:100000 } as const;
export function subtitleBatches(cues: readonly Cue[],legacy=false) {
  if (!cues.length || cues.length > subtitleProcessingLimits.cueCount) throw new ApplicationError('context-limit');
  const batchCues=legacy?40:subtitleBatchLimits.cues,batchChars=legacy?4000:subtitleBatchLimits.chars;
  const batches: { cues: (Cue & { index: number })[]; firstCue: number; lastCue: number }[] = [];
  let batch: (Cue & { index: number })[] = [], size = 0;
  cues.forEach((cue, index) => {
    if (!cueSchema.safeParse(cue).success || cue.to <= cue.from || (index && cue.from < cues[index - 1].from)) throw new ApplicationError('invalid-message');
    const row = { index, ...cue }, chars = JSON.stringify(row).length + 1;
    if (chars > batchChars) throw new ApplicationError('context-limit');
    if (batch.length && (batch.length === batchCues || size + chars > batchChars)) {
      batches.push({ cues: batch, firstCue: batch[0].index, lastCue: batch.at(-1)!.index }); batch = []; size = 0;
    }
    batch.push(row); size += chars;
  });
  batches.push({ cues: batch, firstCue: batch[0].index, lastCue: batch.at(-1)!.index });
  if (batches.length > subtitleBatchLimits.segments) throw new ApplicationError('context-limit');
  return batches;
}
const translatedResponseSchema = z.object({ cues: z.array(cueSchema.extend({ index: z.number().int().nonnegative(), content: z.string().min(1).max(10000).refine(text => !!text.trim()) }).strict()).min(1).max(subtitleBatchLimits.cues) }).strict();
const correctedResponseSchema = z.object({ changes: z.array(z.object({ index: z.number().int().nonnegative(), content: z.string().min(1).max(10000).refine(text => !!text.trim()) }).strict()).max(subtitleBatchLimits.cues) }).strict();
const languageNames: Record<string, string> = { en: '英语', zh: '简体中文', ja: '日语', ko: '韩语', fr: '法语', de: '德语' };

function formattingOnly(before: string, after: string) {
  if (before === after) return true;
  const semanticText = (text: string) => text.normalize('NFKC').replace(/[\p{P}\s]/gu, '').toLocaleLowerCase();
  return semanticText(before) === semanticText(after);
}

// Raw source and temporary outputs stay only in this trusted executor's memory.
export async function runSubtitle(snapshot: SubtitleRequestSnapshot, cues: readonly Cue[], provider: ProviderPort, signal: AbortSignal,
  checkpoint: (text: string, coverage: Coverage) => Promise<void>,quality:SubtitleQualityPort={}): Promise<Cue[]> {
  signal.throwIfAborted();
  subtitleBatches(cues,snapshot.subtitleWorkflow!==2);
  const glossary=snapshot.subtitleWorkflow===2?await prepareSubtitleGlossary(snapshot,cues,provider,signal,quality):{terms:[],webMaterial:''};
  const corrected=cues.map(cue=>({...cue,content:snapshot.target.operation==='enhance'?cue.content:applyTerminology(cue.content,glossary.terms)}));
  const batches = subtitleBatches(corrected,snapshot.subtitleWorkflow!==2), result: Cue[] = [];
  await quality.phase?.('processing');
  const coverage: Coverage = { total: batches.length, covered: 0, ranges: [] };
  await checkpoint('', coverage);
  let size = 0;
  for (const batch of batches) {
    signal.throwIfAborted();
    const correction = snapshot.target.operation === 'enhance';
    const output = await subtitleResponse(provider,snapshot.modelId, [
      { role: 'system', content: fixedPrompt({ kind: correction ? 'subtitle-enhance' : 'subtitle-translate' }) },
      { role: 'user', content: JSON.stringify({
        ...(correction ? {} : { targetLanguage: languageNames[snapshot.targetLanguage ?? ''] ?? snapshot.targetLanguage }),
        ...(snapshot.subtitleWorkflow===2?{videoTitle:snapshot.videoTitle??'',glossary:glossary.terms,requirements:snapshot.requirements,contextBefore:corrected.slice(Math.max(0,batch.firstCue-3),batch.firstCue),contextAfter:corrected.slice(batch.lastCue+1,batch.lastCue+4)}:{}),
        cues: batch.cues
      }) }
    ], signal, value=>{
      if (correction) {
        const changes = correctedResponseSchema.parse(value).changes;
        const indexes = new Set<number>();
        for (const change of changes) {
          if (indexes.has(change.index) || !batch.cues.some(cue => cue.index === change.index)) throw new Error('invalid changes');
          indexes.add(change.index);
        }
        const byIndex = new Map(changes.flatMap(change => {
          const source = batch.cues.find(cue => cue.index === change.index)!;
          return formattingOnly(source.content, change.content) ? [] : [[change.index, change.content] as const];
        }));
        return batch.cues.map(cue => ({ from: cue.from, to: cue.to, content: byIndex.get(cue.index) ?? cue.content }));
      } else {
        const rows = translatedResponseSchema.parse(value).cues;
        if (rows.length !== batch.cues.length || rows.some((row, i) => row.index !== batch.cues[i].index || Math.abs(row.from - batch.cues[i].from) > .001 || Math.abs(row.to - batch.cues[i].to) > .001)) throw new Error('invalid translation');
        return rows.map((row, i) => ({ from: batch.cues[i].from, to: batch.cues[i].to, content: row.content }));
      }
    },snapshot.subtitleWorkflow===2);
    result.push(...output);
    size += output.reduce((length, row) => length + row.content.length, 0);
    if (size > subtitleProcessingLimits.savedChars) throw new ProviderError('output-limit');
    coverage.covered++; coverage.ranges.push({ firstCue: batch.firstCue, lastCue: batch.lastCue });
    await checkpoint('', coverage);
  }
  const final=snapshot.subtitleWorkflow===2?await reconcileSubtitleTerms(snapshot,cues,result,glossary.terms,provider,signal,quality,glossary.webMaterial):result;
  if(final.reduce((size,cue)=>size+cue.content.length,0)>subtitleProcessingLimits.savedChars)throw new ProviderError('output-limit');
  return final;
}
