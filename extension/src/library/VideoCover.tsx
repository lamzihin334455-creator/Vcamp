import { useState } from 'react';
import { Image, Play } from 'lucide-react';

/** Presentation seam for 06: supply a resolved cover URL, never infer one here. */
export function VideoCover({ imageUrl, title, disabled, open }: { imageUrl?: string; title: string; disabled?: boolean; open: () => void }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  return <button className="library-cover" aria-label={`打开视频 ${title}`} title={`打开视频：${title}`} disabled={disabled} onClick={open}>
    {imageUrl && failedUrl !== imageUrl ? <img loading="lazy" referrerPolicy="no-referrer" src={imageUrl} alt="" onError={() => setFailedUrl(imageUrl)}/> : <span className="cover-placeholder" aria-hidden="true"><Image/></span>}
    <span className="cover-play" aria-hidden="true"><Play fill="currentColor"/></span>
  </button>;
}
