import {z} from 'zod';
export const libraryTargetSchema = z.object({ workspaceId: z.string().min(1), entityType: z.enum(['workspace', 'chat', 'html', 'markdown', 'scribble', 'subtitle']), id: z.string().min(1) }).strict();
