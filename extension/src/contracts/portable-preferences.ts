import {z} from 'zod';
import {roleSelectionSchema} from './role';
import {styleSelectionSchema} from './style';
export const libraryUiSchema=z.object({scope:z.union([z.object({kind:z.literal('recent')}).strict(),z.object({kind:z.literal('folders')}).strict(),z.object({kind:z.literal('folder'),id:z.string().min(1)}).strict()]),selectedParts:z.record(z.string(),z.string()).refine(value=>Object.keys(value).length<=1000)}).strict();
export const portablePreferencesSchema=z.object({accent:z.string().regex(/^#[0-9a-f]{6}$/i).optional(),activeRole:roleSelectionSchema.nullable().optional(),roleAllOutputs:z.boolean().optional(),webDefault:z.boolean().optional(),htmlStyle:styleSelectionSchema.nullable().optional(),subtitleFontSize:z.number().int().min(14).max(24).optional(),subtitleAuxiliaryFontSize:z.number().int().min(14).max(24).optional(),subtitleAutoReturn:z.boolean().optional(),libraryLayout:z.enum(['list','grid']).optional(),libraryState:libraryUiSchema.optional()}).strict();
export type PortablePreferences=z.infer<typeof portablePreferencesSchema>;
export interface PortablePreferencesPort{read():Promise<PortablePreferences>;write(preferences:PortablePreferences):Promise<void>}
