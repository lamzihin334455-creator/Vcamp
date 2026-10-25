import {ApplicationError} from './application';
import {outputLimits} from './output-limits';

// Envelope validation only, not an HTML/JS parser. A valid envelope is untrusted.
// Both diagnostics and storage use this result; never repair or execute the page.
function extractHtmlPage(output:string) {
  if(output.length>outputLimits.htmlChars)return {status:'oversize'} as const;
  let source=output.trim();
  if(!/^<!doctype html\s*>\s*<html\b/i.test(source)){
    // Accept one explicit, line-delimited HTML fence with at most 1024 outside
    // characters in total (including whitespace). Extra fences/documents are
    // ambiguous. Conservative refusal also applies to fence-like lines in HTML.
    const fences=[...output.matchAll(/^[\t ]*(?:`{3,}|~{3,})[^\r\n]*/gm)];
    const [open,close]=fences;
    // A valid HTML start inside an unclosed fence is an incomplete envelope,
    // not a missing start. This only improves diagnostics: never accept it or
    // fabricate the closing fence/document.
    if(fences.length===1&&/^\s*```html[\t ]*$/i.test(open[0])){
      const before=output.slice(0,open.index),contents=output.slice(open.index!+open[0].length);
      if(before.length<=1024&&!/```|~~~|<!doctype\b|<\/?html\b/i.test(before)&&/^\r?\n\s*<!doctype html\s*>\s*<html\b/i.test(contents))return {status:'missing-end'} as const;
    }
    if(fences.length!==2||!/^\s*```html[\t ]*$/i.test(open[0])||!/^\s*```[\t ]*$/.test(close[0]))return {status:'missing-start'} as const;
    const before=output.slice(0,open.index),after=output.slice(close.index!+close[0].length);
    if(before.length+after.length>1024)return {status:'oversize'} as const;
    if(/```|~~~|<!doctype\b|<\/?html\b/i.test(before+after))return {status:'missing-start'} as const;
    const contents=output.slice(open.index!+open[0].length,close.index);
    if(!/^\r?\n/.test(contents)||!/\r?\n$/.test(contents))return {status:'missing-start'} as const;
    source=contents.trim();
  }
  if(!/^<!doctype html\s*>\s*<html\b/i.test(source))return {status:'missing-start'} as const;
  // Do not concatenate multiple documents, even in a single fence. This is
  // intentionally conservative for literal document markers inside scripts.
  if((source.match(/<!doctype\b/gi)?.length??0)!==1||(source.match(/<html\b/gi)?.length??0)!==1)return {status:'missing-start'} as const;
  if((source.match(/<\/html\s*>/gi)?.length??0)!==1)return {status:'missing-end'} as const;
  const head=/<head\b[^>]*>([\s\S]*?)<\/head\s*>/i.exec(source);
  if(!head)return {status:'missing-head'} as const;
  const title=/<title\b[^>]*>([^<]{1,1000})<\/title\s*>/i.exec(head[1])?.[1]?.trim();
  if(!title)return {status:'missing-title'} as const;
  if(!/<body\b[^>]*>[\s\S]*<\/body\s*>\s*<\/html\s*>$/i.test(source))return {status:'missing-end'} as const;
  return {status:'complete',source,title} as const;
}
export function htmlEnvelope(output:string) {return extractHtmlPage(output).status;}
export function parseHtmlPage(output:string) {
  const result=extractHtmlPage(output);
  if(result.status!=='complete')throw new ApplicationError('html-format');
  return {source:result.source,title:result.title};
}
export { htmlCapabilities, htmlInstructions } from '../prompts/fixed-rules';
