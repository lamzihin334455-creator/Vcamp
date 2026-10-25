import type { VideoKey } from '../contracts/application';
// Fallback for unsupported/unavailable pages. Production binding comes from S3.
export const getBinding = async (): Promise<VideoKey | null> => null;
