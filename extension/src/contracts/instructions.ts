import { z } from 'zod';
import { roleRevisionSchema } from './role';
import { templateRevisionSchema } from './template';
import {imageLimits} from './attachment';

export const instructionRuleSchema = z.object({
  id: z.string(), version: z.string(), priority: z.enum(['P0', 'P1']), editable: z.literal(false),
  title: z.string(), why: z.string(), appliesWhen: z.string(), text: z.string()
}).strict();
export const instructionCallSchema = z.object({
  id: z.string().uuid(), traceId: z.string(), jobId: z.string().optional(), attemptId: z.string().optional(),
  capturedAt: z.number(), stage: z.string(), modelId: z.string(),
  status: z.enum(['dispatching', 'http-response', 'network-error']), httpStatus: z.number().optional(),
  rules: z.array(instructionRuleSchema), body: z.string().max(2000000),
  images: z.array(z.object({ sha256: z.string(), bytes: z.number() }).strict()).max(imageLimits.count),
  redacted: z.boolean(),
  // Session trace only; never copied into jobs, backups or failure feedback.
  failedPlanResponse: z.string().min(1).max(8000).optional(),
  failedReviewResponse: z.string().min(1).max(8000).optional()
}).strict();
export type InstructionCall = z.infer<typeof instructionCallSchema>;
export const instructionViewSchema = z.object({
  calls: z.array(instructionCallSchema).max(60),
  attempts: z.array(z.object({ attemptId: z.string(), state: z.string() }).strict()),
  request: z.object({ input: z.string(), modelId: z.string(), role: roleRevisionSchema.optional(), template: templateRevisionSchema.optional() }).strict(),
  images: z.array(z.object({ id: z.string(), sha256: z.string(), time: z.number() }).strict()).max(100),
  note: z.string()
}).strict();
export type InstructionView = z.infer<typeof instructionViewSchema>;
export const instructionCommandSchema = z.object({ type: z.literal('instructions.query'), jobId: z.string().uuid(),
  workspaceId: z.string().min(1), chatId: z.string().min(1).optional()
}).strict();
export type InstructionCommand = z.infer<typeof instructionCommandSchema>;
export interface InstructionPort { command(command: InstructionCommand): Promise<InstructionView> }
