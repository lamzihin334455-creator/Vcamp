import { createRoot } from 'react-dom/client';
import { App } from '../../src/app/App';
import { emptyDraft, type ApplicationClient } from '../../src/contracts/application';

const view = { mode: 'interactive' as const, workspaceId: 'test', chatId: 'test', title: '生命周期测试', draft: emptyDraft() };
const client: ApplicationClient = {
  query: async () => view,
  command: async command => ({ ...view, draft: command.type === 'draft.save' ? command.draft : view.draft }),
  subscribe: listener => { queueMicrotask(listener); return () => {}; }
};
let root: ReturnType<typeof createRoot>;
document.getElementById('mount')!.onclick = () => {
  root = createRoot(document.getElementById('root')!);
  root.render(<App client={client} readonly={false}/>);
};
document.getElementById('unmount')!.onclick = () => root.unmount();
document.getElementById('mount')!.click();
