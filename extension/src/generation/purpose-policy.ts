import type { GenerationPurpose } from '../contracts/generation-diagnostic';
import {outputLimits} from '../contracts/output-limits';

// Explicit non-thinking tasks. Limits are per request, never permission
// to continue a truncated response or silently issue another request.
export const purposePolicy = {
  answer: { maxTokens: 393216, outputChars: outputLimits.textChars, json: false },
  markdown: { maxTokens: 393216, outputChars: outputLimits.markdownChars, json: false },
  // A self-contained page includes executable source as well as prose. Give
  // one complete document room to finish; do not scale by video duration or
  // issue continuation requests. Storage uses the same expanded output bound.
  'html-page': { maxTokens: 393216, outputChars: outputLimits.htmlChars, json: false },
  knowledge: { maxTokens: 8192, outputChars: 60000, json: true },
  subtitle: { maxTokens: 16384, outputChars: 100000, json: true },
  summary: { maxTokens: 1024, outputChars: 1800, json: false },
  'vision-plan': { maxTokens: 8192, outputChars: 32000, json: true },
  'vision-review': { maxTokens: 16384, outputChars: 60000, json: true },
  'requirements-plan': { maxTokens: 768, outputChars: 4000, json: true },
  'web-search': { maxTokens: 1024, outputChars: 8000, json: false },
  'web-query': { maxTokens: 512, outputChars: 1024, json: true }
} satisfies Record<GenerationPurpose, { maxTokens: number; outputChars: number; json: boolean }>;

// Larger complete documents also need room for SSE framing/usage overhead.
// Other small tasks retain their existing defensive transport limits.
export function purposeTransportPolicy(purpose:GenerationPurpose){
  if(purpose==='answer'||purpose==='markdown'||purpose==='html-page')return {responseBytes:256*1024*1024,eventChars:8*1024*1024};
  return purpose==='vision-plan'||purpose==='vision-review'
    ?{responseBytes:8*1024*1024,eventChars:512*1024}
    :{responseBytes:1024*1024,eventChars:65536};
}
