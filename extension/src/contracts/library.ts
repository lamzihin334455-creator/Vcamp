import {documentExportSchema,documentSelectionSchema} from './documents';
import {libraryTargetSchema} from './library-target';
export {libraryTargetSchema} from './library-target';
import { z } from 'zod';
import { cacheSelectionSchema, storageViewSchema } from './cache';
import { backupViewSchema, BACKUP_MAX_BYTES, BACKUP_HEADER_MAX_BYTES, BACKUP_CHUNK_CHARS } from './backup';

export type LibraryTarget = z.infer<typeof libraryTargetSchema>;
export const DEFAULT_LIBRARY_FOLDER_ID = 'vcamp-default-folder';
const entitySchema = libraryTargetSchema.extend({ exportUnavailable:z.string().optional(), title: z.string(), summary:z.string().optional(), language:z.string().optional(), provenance:z.string().optional(), cueCount:z.number().int().nonnegative().optional(), sourceType:z.enum(['native','translate','enhance']).optional(), rawAvailable:z.boolean().optional(), attachmentCount:z.number().int().nonnegative().optional(), sourceChatId: z.string().optional(), time: z.number().finite().nonnegative().optional() });
export type LibraryEntity = z.infer<typeof entitySchema>;
export const folderSchema = z.object({ id: z.string(), name: z.string().trim().min(1).max(100), revision: z.number().int().positive(), color:z.string().regex(/^#[0-9a-f]{6}$/i).optional(), backupOriginalId: z.string().min(1).optional() }).strict();
export type LibraryFolder = z.infer<typeof folderSchema>;
export const favoriteSchema = z.object({ id: z.string(), folderId: z.string(), target: libraryTargetSchema, title: z.string(), videoTitle: z.string(), coverUrl:z.string().optional(), available: z.boolean() }).strict();
export type LibraryFavorite = z.infer<typeof favoriteSchema>;
const partSchema = z.object({ workspaceId: z.string(), partId: z.string(), title: z.string(), pageNumber: z.number().int().positive().optional(), partCount: z.number().int().positive().optional(), position: z.number().finite().nonnegative().optional(), recentAt: z.number() }).strict();
const trashEntrySchema = z.object({ target: libraryTargetSchema, title: z.string(), deletedAt: z.number(), revision: z.number().int().nonnegative(), parentDeleted: z.boolean() }).strict();
const deletePreviewSchema = z.object({ target: libraryTargetSchema, title: z.string(), revision: z.number().int().nonnegative(), activeJobs: z.number().int().nonnegative() }).strict();
export const libraryViewSchema = z.object({
  documents:documentExportSchema.optional(),
  backup: backupViewSchema.optional(),
  storage: storageViewSchema.optional(),
  trash: z.object({ entries: z.array(trashEntrySchema) }).strict().optional(), deletePreview: deletePreviewSchema.optional(),
  folders: z.array(folderSchema).optional(), favorites: z.array(favoriteSchema).optional(),
  videos: z.array(z.object({ platform: z.literal('bilibili'), videoId: z.string(), title: z.string(), coverUrl:z.string().optional(), parts: z.array(partSchema) }).strict()),
  entities: z.array(entitySchema), recentChatId: z.string().optional()
}).strict();
export type LibraryView = z.infer<typeof libraryViewSchema>;
export const libraryCommandSchema = z.discriminatedUnion('type', [
  z.object({type:z.literal('library.export'),selection:z.array(documentSelectionSchema).min(1).max(100)}).strict(),
  z.object({ type: z.literal('library.backup.export'), segmented: z.boolean().optional() }).strict(),
  z.object({ type: z.literal('library.backup.part'), transferId: z.string().uuid(), index: z.number().int().nonnegative().max(8191) }).strict(),
  z.object({ type: z.literal('library.backup.import.begin'), manifest: z.string().max(BACKUP_HEADER_MAX_BYTES) }).strict(),
  z.object({ type: z.literal('library.backup.import.append'), transferId: z.string().uuid(), index: z.number().int().nonnegative().max(8191), data: z.string().max(BACKUP_CHUNK_CHARS) }).strict(),
  z.object({ type: z.literal('library.backup.import.preview'), transferId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('library.backup.release'), transferId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('library.backup.preview'), file: z.string().max(BACKUP_MAX_BYTES) }).strict(),
  z.object({ type: z.literal('library.backup.execute'), planId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ type: z.literal('library.storage.query') }).strict(),
  z.object({ type: z.literal('library.storage.preview'), selection: cacheSelectionSchema }).strict(),
  z.object({ type: z.literal('library.storage.execute'), planId: z.string().uuid() }).strict(),
  z.object({ type: z.literal('library.trash.query') }).strict(),
  z.object({ type: z.literal('library.trash.preview'), target: libraryTargetSchema }).strict(),
  z.object({ type: z.literal('library.trash.move'), target: libraryTargetSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('library.trash.restore'), target: libraryTargetSchema, expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ type: z.literal('library.query'), search: z.string().max(1000).optional(), folderId: z.string().min(1).optional() }).strict(),
  z.object({ type: z.literal('library.folder.create'), name: folderSchema.shape.name, color:folderSchema.shape.color }).strict(),
  z.object({ type: z.literal('library.folder.rename'), folderId: z.string().min(1), expectedRevision: folderSchema.shape.revision, name: folderSchema.shape.name }).strict(),
  z.object({ type: z.literal('library.folder.delete'), folderId: z.string().min(1), expectedRevision: folderSchema.shape.revision }).strict(),
  z.object({ type: z.literal('library.favorite.add'), folderId: z.string().min(1), target: libraryTargetSchema }).strict(),
  z.object({ type: z.literal('library.favorite.remove'), folderId: z.string().min(1), target: libraryTargetSchema }).strict(),
  z.object({ type: z.literal('library.read'), workspaceId: z.string().min(1), scope:z.literal('video').optional() }).strict(),
  z.object({type:z.literal('library.locate'),target:libraryTargetSchema,time:z.number().finite().nonnegative().max(359999)}).strict(),
  z.object({ type: z.literal('library.open'), target: libraryTargetSchema, action: z.enum(['reader', 'video']), time: z.number().finite().nonnegative().optional() }).strict()
]);
export type LibraryCommand = z.infer<typeof libraryCommandSchema>;
export interface LibraryPort { command(command: LibraryCommand, windowId?:number, context?:{readonly:boolean}): Promise<LibraryView> }
