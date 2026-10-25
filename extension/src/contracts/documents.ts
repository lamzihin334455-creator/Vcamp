import {z} from 'zod';
import {libraryTargetSchema} from './library-target';
export const documentFormatSchema=z.enum(['md','txt','html','srt','vtt','json','bili-json']);
export type DocumentFormat=z.infer<typeof documentFormatSchema>;
export const documentSelectionSchema=z.object({target:libraryTargetSchema,format:documentFormatSchema}).strict();
export type DocumentSelection=z.infer<typeof documentSelectionSchema>;
export const documentExportSchema=z.object({files:z.array(z.object({name:z.string().max(240),content:z.string().max(2000000),type:z.enum(['text','html','binary']),source:z.object({videoId:z.string(),pageNumber:z.number().int().positive().optional()}).strict().optional()}).strict()).max(200),errors:z.array(z.object({file:z.string(),reason:z.string()}).strict()).max(100)}).strict();
export type DocumentExport=z.infer<typeof documentExportSchema>;
export const formatsFor=(kind:string):DocumentFormat[]=>kind==='html'?['html']:kind==='subtitle'?['srt','vtt','txt','json','bili-json']:['md','txt'];
