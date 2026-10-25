import { z } from 'zod';
import { portablePreferencesSchema } from './portable-preferences';

// Legacy JSON stays bounded; the new single-file format travels in small parts.
export const BACKUP_MAX_BYTES = 64 * 1024 * 1024;
export const BACKUP_STREAM_MAX_BYTES = 512 * 1024 * 1024;
export const BACKUP_CHUNK_CHARS = 256 * 1024;
export const BACKUP_HEADER_MAX_BYTES = 1024 * 1024;
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
export const backupStreamManifestSchema = z.object({
  format: z.literal('vcamp-backup-stream'), formatVersion: z.literal(1), databaseVersion: z.literal(10),
  createdAt: z.number().finite().nonnegative(), types: z.array(z.string()).max(30),
  parts: z.array(z.object({ bytes: z.number().int().positive().max(BACKUP_CHUNK_CHARS * 4), sha256: checksum }).strict()).max(8192),
  preferences: portablePreferencesSchema.optional(), checksum
}).strict();
export type BackupStreamManifest = z.infer<typeof backupStreamManifestSchema>;
export const backupTransferSchema = z.object({ id: z.string().uuid(), manifest: z.string().max(BACKUP_HEADER_MAX_BYTES).optional(), data: z.string().max(BACKUP_CHUNK_CHARS).optional(), nextIndex: z.number().int().nonnegative().optional() }).strict();
export const backupPlanSchema = z.object({
  planId: z.string().uuid(), checksum: z.string(), expiresAt: z.number(),
  added: z.number().int().nonnegative(), skipped: z.number().int().nonnegative(), conflicts: z.number().int().nonnegative(),
  counts: z.record(z.string(), z.number().int().nonnegative()), warnings: z.array(z.string()),
  mapping: z.array(z.object({ kind: z.string(), from: z.string(), to: z.string() }).strict())
}).strict();
export type BackupPlan = z.infer<typeof backupPlanSchema>;
export const backupViewSchema = z.object({
  file: z.string().max(BACKUP_MAX_BYTES).optional(), plan: backupPlanSchema.optional(),
  transfer: backupTransferSchema.optional(),
  result: z.object({ added: z.number(), skipped: z.number(), conflicts: z.number(),preferencesRestored:z.boolean().optional() }).strict().optional()
}).strict();
