import type { PanelVideo } from '../app/message-router';
import type { VideoView } from '../contracts/video';
// Production always uses S3; no fixtures or arbitrary source injection.
export async function getGenerationVideo(): Promise<VideoView> { return { binding: null, status: 'unsupported', cues: [], language: null }; }

export const testPanelVideo: PanelVideo | undefined = undefined;
