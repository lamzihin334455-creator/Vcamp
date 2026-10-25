import { createRoot } from 'react-dom/client';
import { App } from '../../src/app/App';
import { MarkdownWorkbench } from '../../src/workbench/Markdown';
import { ScribbleWorkbench } from '../../src/workbench/Scribbles';
import { SubtitleWorkbench } from '../../src/workbench/Subtitles';
import { KnowledgeWorkbench } from '../../src/workbench/Knowledge';
import { previewClient } from './client';
import { DesignPreview } from './DesignPreview';
import { LibraryWorkbench } from '../../src/library/Library';
const root = createRoot(document.getElementById('root')!);
if (new URLSearchParams(location.search).has('design')) root.render(<DesignPreview/>);
else void previewClient().then(client => root.render(<><output id="preview-action" className="sr-only" aria-live="polite"/><App client={client} readonly={false} registrations={[
  { id: 'library', title: '资料库', empty: '', View: LibraryWorkbench },
  { id: 'markdown', title: '笔记', empty: '', View: MarkdownWorkbench },
  { id: 'scribble', title: '随笔', empty: '', View: ScribbleWorkbench },
  { id: 'subtitle', title: '字幕', empty: '', View: SubtitleWorkbench },
  { id: 'html', title: '交互知识', empty: '', View: KnowledgeWorkbench }
]}/></>));
