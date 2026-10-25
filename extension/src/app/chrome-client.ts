import {libraryUiSchema} from '../contracts/portable-preferences';
import { ApplicationError, responseSchema, type ApplicationClient, type ApplicationCommand } from '../contracts/application';
import { playbackSchema, sameBinding } from '../contracts/video';
import { roleSelectionSchema } from '../contracts/role';
import {styleSelectionSchema} from '../contracts/style';
import {retiredStyleIds} from '../workbench/style-presets';
import { visionPreferenceKey } from './vision-preference';
import { accentColors, resolveAccent } from './appearance';

export function createChromeClient(readonly: boolean): ApplicationClient {
  let target: { workspaceId: string; chatId: string } | undefined;
  let selectionSequence = 0;
  async function request(operation: { type: 'workspace.query'; target?: typeof target } | ApplicationCommand) {
    const selects = operation.type === 'workspace.query' || operation.type === 'chat.create' || operation.type === 'chat.select';
    const sequence = selects ? ++selectionSequence : 0;
    const requestId = crypto.randomUUID();
    let response: unknown;
    let deadline:ReturnType<typeof setTimeout>|undefined;
    try {
      const read=async()=>{const windowId=(await chrome.windows.getCurrent()).id;return chrome.runtime.sendMessage({version:1,requestId,windowId,operation});};
      // A missing response must not own a snapshot refresh slot forever. Only
      // these idempotent reads have a deadline; sends/saves/stops never retry.
      response=operation.type==='workspace.query'||operation.type==='generation.query'
        ? await Promise.race([read(),new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new ApplicationError('disconnected')),8000);})])
        : await read();
    }
    catch { throw new ApplicationError('disconnected'); }
    finally {clearTimeout(deadline);}
    const parsed = responseSchema.safeParse(response);
    if (!parsed.success || parsed.data.requestId !== requestId) throw new ApplicationError('invalid-message');
    if (!parsed.data.ok) throw new ApplicationError(parsed.data.code);
    if (selects && sequence === selectionSequence) {
      const view = parsed.data.view;
      target = view.workspaceId && view.chatId ? { workspaceId: view.workspaceId, chatId: view.chatId } : undefined;
    }
    return parsed.data.view;
  }
  return {
    appearancePreferences: {
      async read() { return resolveAccent((await chrome.storage.local.get('vcamp.accent'))['vcamp.accent']).value; },
      async write(color) { if (!readonly && accentColors.some(item => item.value === color)) await chrome.storage.local.set({ 'vcamp.accent': color }); }
    },
    rolePreferences: {
      async read() { const parsed = roleSelectionSchema.safeParse((await chrome.storage.local.get('vcamp.activeRole'))['vcamp.activeRole']); return parsed.success ? parsed.data : null; },
      async write(role) { if (readonly) throw new ApplicationError('forbidden'); if (role) await chrome.storage.local.set({ 'vcamp.activeRole': roleSelectionSchema.parse(role) }); else await chrome.storage.local.remove('vcamp.activeRole'); }
    },
    roleOutputPreferences:{async read(){return (await chrome.storage.local.get('vcamp.roleAllOutputs'))['vcamp.roleAllOutputs']===true;},async write(enabled){if(readonly)throw new ApplicationError('forbidden');await chrome.storage.local.set({'vcamp.roleAllOutputs':enabled});}},
    webPreferences:{async read(){return (await chrome.storage.local.get('vcamp.webDefault'))['vcamp.webDefault']===true;},async write(enabled){if(!readonly)await chrome.storage.local.set({'vcamp.webDefault':enabled});}},
    autoVisionPreferences: {
      async read(target) { const key = visionPreferenceKey(target); return (await chrome.storage.local.get(key))[key] === true; },
      async write(enabled, target) { if (readonly) throw new ApplicationError('forbidden'); await chrome.storage.local.set({ [visionPreferenceKey(target)]: enabled }); }
    },
    attachment: async command => { if(readonly && (command.type!=='attachment.read'||!command.historyOnly))throw new ApplicationError('forbidden');const view=await request(command);if(!view.attachment)throw new ApplicationError('invalid-message');return view.attachment; },
    libraryPreferences: {
      async read() { return (await chrome.storage.local.get('vcamp.libraryLayout'))['vcamp.libraryLayout'] === 'grid' ? 'grid' : 'list'; },
      async write(layout) { if (!readonly) await chrome.storage.local.set({ 'vcamp.libraryLayout': layout }); }
    },
    libraryUiPreferences:{async read(){const value=libraryUiSchema.safeParse((await chrome.storage.local.get('vcamp.libraryState'))['vcamp.libraryState']);return value.success?value.data:undefined;},async write(value){if(!readonly)await chrome.storage.local.set({'vcamp.libraryState':libraryUiSchema.parse(value)});}},
    library: async command => {
      if (readonly && !['library.read','library.locate','library.export'].includes(command.type)) throw new ApplicationError('forbidden');
      const view = await request(command);
      if (command.type === 'library.open' && command.action === 'video' || command.type === 'library.trash.move' && ['workspace', 'chat'].includes(command.target.entityType)) target = undefined;
      if (!view.library) throw new ApplicationError('invalid-message');
      return view.library;
    },
    knowledge: async command => { const view=await request(command); if(!view.knowledge) throw new ApplicationError('invalid-message'); return view.knowledge; },
    htmlStylePreferences:{
      async read(){const parsed=styleSelectionSchema.safeParse((await chrome.storage.local.get('vcamp.htmlStyle'))['vcamp.htmlStyle']);return parsed.success&&!retiredStyleIds.has(parsed.data.styleId)?parsed.data:null;},
      async write(style){if(readonly)throw new ApplicationError('forbidden');if(style&&!styleSelectionSchema.safeParse(style).success)throw new ApplicationError('invalid-message');await chrome.storage.local.set({'vcamp.htmlStyle':style});}
    },
    subtitlePreferences: {
      async read() { const value = (await chrome.storage.local.get('vcamp.subtitleFontSize'))['vcamp.subtitleFontSize']; return typeof value === 'number' && value >= 14 && value <= 24 ? value : 16; },
      async write(fontSize) { if (!readonly && Number.isInteger(fontSize) && fontSize >= 14 && fontSize <= 24) await chrome.storage.local.set({ 'vcamp.subtitleFontSize': fontSize }); },
      async readOptions(){const raw=await chrome.storage.local.get(['vcamp.subtitleAuxiliaryFontSize','vcamp.subtitleAutoReturn']);const size=raw['vcamp.subtitleAuxiliaryFontSize'];return {auxiliaryFontSize:Number.isInteger(size)&&size>=14&&size<=24?size:14,autoReturn:typeof raw['vcamp.subtitleAutoReturn']==='boolean'?raw['vcamp.subtitleAutoReturn']:true};},
      async writeOptions(options){if(readonly)throw new ApplicationError('forbidden');const values:Record<string,number|boolean>={};if(options.auxiliaryFontSize!==undefined){if(!Number.isInteger(options.auxiliaryFontSize)||options.auxiliaryFontSize<14||options.auxiliaryFontSize>24)throw new ApplicationError('invalid-message');values['vcamp.subtitleAuxiliaryFontSize']=options.auxiliaryFontSize;}if(options.autoReturn!==undefined){if(typeof options.autoReturn!=='boolean')throw new ApplicationError('invalid-message');values['vcamp.subtitleAutoReturn']=options.autoReturn;}await chrome.storage.local.set(values);}
    },
    subscribePlayback(binding, listener) {
      if (readonly) return () => {};
      let disposed = false, port: chrome.runtime.Port | undefined, timer: ReturnType<typeof setTimeout>;
      const connect = () => {
        if (disposed) return;
        port = chrome.runtime.connect({ name: 'vcamp-playback-v1' }); const current = port;
        current.onMessage.addListener(message => {
          if (disposed || current !== port || !sameBinding(message?.binding ?? null, binding)) return;
          const parsed = playbackSchema.safeParse(message.playback); listener(parsed.success ? parsed.data : null);
        });
        current.onDisconnect.addListener(() => { void chrome.runtime.lastError; if (!disposed && current === port) { listener(null); timer = setTimeout(connect, 1000); } });
        current.postMessage({ binding });
      };
      connect(); return () => { disposed = true; clearTimeout(timer); port?.disconnect(); };
    },
    subtitles: async command => {
      if (readonly && command.type !== 'subtitles.query') throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.subtitles) throw new ApplicationError('invalid-message');
      return view.subtitles;
    },
    scribbles: async command => {
      if (readonly && command.type !== 'scribble.query') throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.scribbles) throw new ApplicationError('invalid-message');
      return view.scribbles;
    },
    instructions: async command => {
      if (readonly) throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.instructions) throw new ApplicationError('invalid-message');
      return view.instructions;
    },
    styles:async command=>{if(readonly)throw new ApplicationError('forbidden');const view=await request(command);if(!view.styles)throw new ApplicationError('invalid-message');return view.styles;},
    roles: async command => {
      if (readonly) throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.roles) throw new ApplicationError('invalid-message');
      return view.roles;
    },
    templates: async command => {
      if (readonly) throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.templates) throw new ApplicationError('invalid-message');
      return view.templates;
    },
    artifacts: async command => {
      if (readonly && command.type !== 'artifact.query') throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.artifacts) throw new ApplicationError('invalid-message');
      return view.artifacts;
    },
    generation: async command => {
      if (readonly && command.type !== 'generation.query') throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.generation) throw new ApplicationError('invalid-message');
      return view.generation;
    },
    provider: async command => {
      if (readonly) throw new ApplicationError('forbidden');
      const view = await request(command);
      if (!view.provider) throw new ApplicationError('invalid-message');
      return view.provider;
    },
    query: () => request({ type: 'workspace.query', ...(!readonly && target ? { target } : {}) }),
    command: command => readonly ? Promise.reject(new ApplicationError('forbidden')) : request(command),
    subscribePreferences(listener){
      const changed=(changes:Record<string,chrome.storage.StorageChange>,area:string)=>{if(area==='local'){const keys=Object.keys(changes).filter(key=>key.startsWith('vcamp.'));if(keys.length)listener(keys);}};
      chrome.storage.onChanged.addListener(changed);return()=>chrome.storage.onChanged.removeListener(changed);
    },
    subscribe(listener, connection) {
      let disposed = false;
      let current: chrome.runtime.Port | undefined;
      let timer: ReturnType<typeof setTimeout>;
      const connect = () => {
        if (disposed) return;
        connection('connecting');
        const port = chrome.runtime.connect({ name: 'vcamp-v1' });
        current = port;
        port.onMessage.addListener(message => {
          if (disposed || port !== current || message?.version !== 1) return;
          if (message.type === 'ready') { connection('connected'); listener(); }
          if (message.type === 'invalidate') listener();
        });
        port.onDisconnect.addListener(() => {
          void chrome.runtime.lastError;
          if (disposed || port !== current) return;
          connection('disconnected');
          timer = setTimeout(connect, 1000);
        });
      };
      connect();
      return () => { disposed = true; clearTimeout(timer); current?.disconnect(); };
    }
  };
}
