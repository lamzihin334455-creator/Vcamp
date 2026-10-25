import { z } from 'zod';
import { bindingSchema } from './video';

export const imageLimits = { count: 10, bytes: 4 * 1024 * 1024, totalBytes: 20 * 1024 * 1024, edge: 1920, pixels: 1920 * 1080 } as const;
export const imageDataSchema = z.string().max(Math.ceil(imageLimits.bytes / 3) * 4 + 22).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/);
export const frameSchema = z.object({ dataUrl: imageDataSchema, width: z.number().int().positive().max(imageLimits.edge), height: z.number().int().positive().max(imageLimits.edge), time: z.number().finite().nonnegative() }).strict();
export type CapturedFrame = z.infer<typeof frameSchema>;
export const attachmentSchema = frameSchema.extend({ id:z.string().uuid(), workspaceId:z.string().min(1), chatId:z.string().min(1), mimeType:z.literal('image/png'), bytes:z.number().int().positive().max(imageLimits.bytes), sha256:z.string().regex(/^[a-f0-9]{64}$/), createdAt:z.number().finite().nonnegative(), uploadName:z.string().trim().min(1).max(500).optional(), source:z.object({platform:z.literal('bilibili'),videoId:z.string().min(1),partId:z.string().min(1)}).strict() }).strict();
export type Attachment = z.infer<typeof attachmentSchema>;
export const attachmentTargetSchema = z.object({workspaceId:z.string().min(1),chatId:z.string().min(1)}).strict();
export const attachmentCommandSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('attachment.capture'),target:attachmentTargetSchema,binding:bindingSchema,expectedRevision:z.number().int().nonnegative(),consent:z.literal('capture-and-send')}).strict(),
  z.object({type:z.literal('attachment.upload'),target:attachmentTargetSchema,binding:bindingSchema,expectedRevision:z.number().int().nonnegative(),consent:z.literal('upload-and-send'),name:z.string().trim().min(1).max(500),frame:frameSchema}).strict(),
  z.object({type:z.literal('attachment.remove'),target:attachmentTargetSchema,expectedRevision:z.number().int().nonnegative(),attachmentId:z.string().uuid()}).strict(),
  z.object({type:z.literal('attachment.read'),target:attachmentTargetSchema,ids:z.array(z.string().uuid()).max(imageLimits.count),historyOnly:z.boolean().optional()}).strict()
]);
export type AttachmentCommand = z.infer<typeof attachmentCommandSchema>;
export const attachmentViewSchema = z.object({images:z.array(attachmentSchema).max(imageLimits.count)}).strict();
export interface AttachmentPort { command(command:AttachmentCommand):Promise<z.infer<typeof attachmentViewSchema>> }
