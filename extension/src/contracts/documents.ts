import {z} from 'zod';
import {libraryTargetSchema} from './library-target';
import {outputLimits} from './output-limits';
import {imageLimits} from './attachment';
// Include provenance headers for maximum-size saved output and base64 PNGs.
export const documentLimits={fileChars:Math.max(outputLimits.textChars,outputLimits.markdownChars,outputLimits.htmlChars)+65536,binaryChars:Math.ceil(imageLimits.bytes/3)*4,batchChars:12*1024*1024} as const;
export const documentFormatSchema=z.enum(['md','txt','html','srt','vtt','json','bili-json']);
export type DocumentFormat=z.infer<typeof documentFormatSchema>;
export const documentSelectionSchema=z.object({target:libraryTargetSchema,format:documentFormatSchema}).strict();
export type DocumentSelection=z.infer<typeof documentSelectionSchema>;
export const documentExportSchema=z.object({files:z.array(z.object({name:z.string().max(240),content:z.string().max(Math.max(documentLimits.fileChars,documentLimits.binaryChars)),type:z.enum(['text','html','binary']),source:z.object({videoId:z.string(),pageNumber:z.number().int().positive().optional()}).strict().optional()}).strict().refine(file=>file.content.length<=(file.type==='binary'?documentLimits.binaryChars:documentLimits.fileChars))).max(200),errors:z.array(z.object({file:z.string(),reason:z.string()}).strict()).max(100)}).strict();
export type DocumentExport=z.infer<typeof documentExportSchema>;
export const formatsFor=(kind:string):DocumentFormat[]=>kind==='html'?['html']:kind==='subtitle'?['srt','vtt','txt','json','bili-json']:['md','txt'];
