import { nativeDeepSeek } from '../contracts/provider-config';
import {DocumentExportDialog} from '../library/DocumentExport';
import {formatTime} from '../shared/time';
import { PickerPopover, SoftText, focusPicker } from './PickerMotion';
import { ContextHeader, SettingsMenu } from './WorkbenchChrome';
import { defaultAccent, resolveAccent } from './appearance';
import {useStyles} from '../workbench/Styles';
import {useHtmlStyleMemory} from './use-html-style';
import {useComposerSize} from './use-composer-size';
import { mentionAt, type Mention } from './mention';
import { isRetiredGenerationTemplate } from '../contracts/template';
import { useKnowledge } from '../workbench/Knowledge';
import type { KnowledgeArtifact, KnowledgeEntry } from '../contracts/knowledge';
import { AttachmentImages } from '../workbench/Attachments';
import { DeleteButton } from '../library/Management';
import { ChatMessages } from '../workbench/ChatMessages';
import { useSubtitles } from '../workbench/Subtitles';
import { RoleManager, useRoles } from '../workbench/Roles';
import type { PromptRole, RoleSelection } from '../contracts/role';
import { PromptManager, useTemplates } from '../workbench/Templates';
import { ProviderSettings, QuickProviderSwitcher, useProvider } from './ProviderSettings';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApplicationError, type ApplicationClient, type Draft } from '../contracts/application';
import { modules, type ModuleId, type ModuleRegistration, type ModuleChrome } from './modules';
import { Icon } from './Icons';
import { useWorkspace } from './use-workspace';
import { useModuleMotion } from './use-module-motion';
import './styles.css';
import { videoStatusLabel, sendConditions } from '../contracts/video';
import { VideoActions } from '../video/NativeSubtitles';
import { useGeneration } from './use-generation';
import { ReferencePicker } from '../workbench/References';
import {composerEnterAction} from './composer-policy';
import { imageLimits, type CapturedFrame } from '../contracts/attachment';
import { videoOrigins } from '../video/chrome-video';

const imageLimitSummary=`最多 ${imageLimits.count} 张，单张 ${imageLimits.bytes/1024/1024} MiB、合计 ${imageLimits.totalBytes/1024/1024} MiB`;

export function App({ client, readonly, registrations = [] }: { client: ApplicationClient; readonly: boolean; registrations?: readonly ModuleRegistration[] }) {
  const workspace = useWorkspace(client);
  const [settings, setSettings] = useState(false);
  const [roleAllOutputs,setRoleAllOutputs]=useState(false);
  useEffect(()=>{void client.roleOutputPreferences?.read().then(setRoleAllOutputs).catch(()=>{});},[client]);
  const [webDefault,setWebDefault]=useState(false);
  const [webPreferenceBusy,setWebPreferenceBusy]=useState(false);
  useEffect(()=>{void client.webPreferences?.read().then(setWebDefault).catch(()=>{});},[client]);
  const [rolePreference,setRolePreference]=useState<RoleSelection|null>(null),[rolePreferenceReady,setRolePreferenceReady]=useState(readonly),[roleBusy,setRoleBusy]=useState(false);
  useEffect(()=>{let alive=true;if(readonly||!client.rolePreferences){setRolePreferenceReady(true);return()=>{alive=false;};}setRolePreferenceReady(false);void client.rolePreferences.read().then(role=>{if(alive){setRolePreference(role);setRolePreferenceReady(true);}},()=>{if(alive)setRolePreferenceReady(true);});return()=>{alive=false;};},[client,readonly]);

  const [dropActive,setDropActive]=useState(false),[uploadBusy,setUploadBusy]=useState(false),[uploadError,setUploadError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  async function uploadImages(files:readonly File[]){
    if (!nativeDeepSeek(provider.view)) { setUploadError('当前服务暂不支持图片输入，请使用 DeepSeek 视觉模型。'); return; }
    if(readonly||uploadBusy||!client.attachment||!workspace.view?.workspaceId||!workspace.view.chatId||!workspace.view.video?.binding||!workspace.draft)return;
    const images=files.filter(file=>file.type.startsWith('image/'));
    if(!images.length){setUploadError('只能拖入图片文件。');return;}
    setUploadBusy(true);setUploadError('');
    try{
      for(const file of images){
        if(!await workspace.flush())throw new Error('草稿尚未保存，请稍后重试。');
        const saved=await client.query();
        if(!saved.workspaceId||!saved.chatId||!saved.draft||!saved.video?.binding)throw new Error('当前视频或对话已变化，请重新拖入图片。');
        const frame=await imageFileFrame(file,saved.video.playback?.time??0);
        await client.attachment({type:'attachment.upload',target:{workspaceId:saved.workspaceId,chatId:saved.chatId},binding:saved.video.binding,expectedRevision:saved.draft.revision,consent:'upload-and-send',name:file.name||'用户图片',frame});
      }
      await workspace.refresh();
    }catch(error){setUploadError(error instanceof Error?error.message:'图片添加失败，请重试。');}
    finally{setUploadBusy(false);setDropActive(false);}
  }
  async function captureCurrentFrame(){
    if (!nativeDeepSeek(provider.view)) { setUploadError('当前服务暂不支持视觉识别。'); return; }
    if(readonly||uploadBusy||!client.attachment||!workspace.view?.workspaceId||!workspace.view.chatId||!workspace.view.video?.binding||!workspace.draft)return;
    const target={workspaceId:workspace.view.workspaceId,chatId:workspace.view.chatId},binding=workspace.view.video.binding;
    setUploadBusy(true);setUploadError('');
    try{
      if(!await globalThis.chrome.permissions.contains({origins:videoOrigins}))throw new ApplicationError('permission-denied');
      if(!await workspace.flush())throw new ApplicationError('revision-conflict');
      const saved=await client.query();
      if(saved.workspaceId!==target.workspaceId||saved.chatId!==target.chatId||!saved.draft||!saved.video?.binding)throw new ApplicationError('stale-binding');
      await client.attachment({type:'attachment.capture',target,binding,expectedRevision:saved.draft.revision,consent:'capture-and-send'});
      await workspace.refresh();
    }catch(error){
      const messages:Record<string,string>={'permission-denied':'当前页面没有视频读取权限，未添加截图。','stale-binding':'视频或对话已变化，请重新截图。','revision-conflict':'草稿正在保存，请稍后重试。','capture-empty':'画面尚未解码，请稍后重试。','capture-tainted':'站点禁止读取此视频像素，无法截图。','resource-limit':`图片未添加：本次草稿图片${imageLimitSummary}。`,'not-found':'原对话已删除，未保存图片。'};
      setUploadError(error instanceof ApplicationError?messages[error.code]??'截图失败，请确认视频仍可播放后重试。':'截图失败，请重试。');
    }finally{setUploadBusy(false);}
  }
  async function removeDraftImage(attachmentId:string){
    if(readonly||uploadBusy||!client.attachment||!workspace.view?.workspaceId||!workspace.view.chatId||!workspace.draft)return;
    const target={workspaceId:workspace.view.workspaceId,chatId:workspace.view.chatId};
    setUploadBusy(true);setUploadError('');
    try{
      if(!await workspace.flush())throw new ApplicationError('revision-conflict');
      const saved=await client.query();
      if(saved.workspaceId!==target.workspaceId||saved.chatId!==target.chatId||!saved.draft)throw new ApplicationError('stale-binding');
      await client.attachment({type:'attachment.remove',target,expectedRevision:saved.draft.revision,attachmentId});
      await workspace.reload();
    }catch(error){
      const messages:Record<string,string>={'revision-conflict':'草稿正在保存，请稍后重试。','stale-binding':'视频或对话已变化，请重新操作。','not-found':'原对话已删除。','forbidden':'这张图片已经不在当前草稿中。'};
      setUploadError(error instanceof ApplicationError?messages[error.code]??'图片移除失败，请重试。':'图片移除失败，请重试。');
    }finally{setUploadBusy(false);}
  }
  async function toggleWebPreference(){
    if(readonly||webPreferenceBusy||!client.webPreferences)return;
    const value=!webDefault;setWebPreferenceBusy(true);
    try{await workspace.setWebPreference(value,client.webPreferences);setWebDefault(value);setAppearanceError('');}catch{setAppearanceError('联网偏好未保存，当前输入仍保留，请重试。');}finally{setWebPreferenceBusy(false);}
  }
  const subtitles = useSubtitles(client, !readonly ? workspace.view?.workspaceId ?? null : null);
  const [knowledgeId,setKnowledgeId]=useState<string|undefined>(()=>readonly?new URLSearchParams(location.search).get('knowledgeId')??undefined:undefined);
  const followup=workspace.draft?.knowledgeFollowup;
  const followupQuery=useKnowledge(client,followup?workspace.view?.workspaceId??null:null,followup?.artifactId);
  const followupEntry=followupQuery.artifacts.find(a=>a.id===followup?.artifactId)?.document;
  const [followupError,setFollowupError]=useState('');
  const [artifactId, setArtifactId] = useState<string | undefined>(() => readonly ? new URLSearchParams(location.search).get('artifactId') ?? undefined : undefined);
  const [scribbleId, setScribbleId] = useState<string | undefined>(() => readonly ? new URLSearchParams(location.search).get('scribbleId') ?? undefined : undefined);
  const [scribbleError, setScribbleError] = useState('');
  const generation = useGeneration(client, !(readonly && (artifactId || scribbleId || knowledgeId)) && workspace.view?.workspaceId && workspace.view.chatId ? { kind: 'chat', workspaceId: workspace.view.workspaceId, chatId: workspace.view.chatId } : null, workspace.flush);
  const [pendingSend,setPendingSend]=useState<{text:string;messageIds:string[]}|null>(null);
  const sending=useRef(false);
  const pendingVisible=!!pendingSend&&!generation.view?.messages.some(message=>message.role==='user'&&!pendingSend.messageIds.includes(message.messageId));
  const templates = useTemplates(client, workspace.draft?.template, !readonly);
  const styles=useStyles(client,workspace.draft?.htmlStyle,!readonly);
  const styleMemory=useHtmlStyleMemory(client,!readonly);
  useEffect(()=>{if(readonly||!client.htmlStylePreferences||!styleMemory.ready||!workspace.draft||workspace.switching)return;if(JSON.stringify(workspace.draft.htmlStyle??null)!==JSON.stringify(styleMemory.selection))workspace.change({...workspace.draft,htmlStyle:styleMemory.selection??undefined});},[client,readonly,styleMemory.ready,styleMemory.selection?.styleId,styleMemory.selection?.revisionId,workspace.view?.workspaceId,workspace.view?.chatId,workspace.draft?.revision,workspace.switching]);
  const selectedRole = rolePreferenceReady ? rolePreference ?? undefined : workspace.draft?.role ?? undefined;
  const roles = useRoles(client, selectedRole, !readonly);
  const provider = useProvider(client, !readonly);
  const nativeProvider = nativeDeepSeek(provider.view);
  useEffect(() => {
    if (!readonly && !workspace.switching && provider.view && !nativeProvider && workspace.draft && (workspace.draft.webEnabled || workspace.draft.visionEnabled)) {
      workspace.change({ ...workspace.draft, webEnabled: false, visionEnabled: false });
    }
  }, [provider.view?.providerId, provider.view?.baseUrl, workspace.draft?.revision, workspace.draft?.webEnabled, workspace.draft?.visionEnabled, workspace.view?.workspaceId, workspace.view?.chatId, workspace.switching]);
  useEffect(()=>{if(readonly||!rolePreferenceReady||!workspace.draft||workspace.switching)return;const current=workspace.draft.role??null;if(JSON.stringify(current)!==JSON.stringify(rolePreference))workspace.change({...workspace.draft,role:rolePreference});},[readonly,rolePreferenceReady,rolePreference?.roleId,rolePreference?.revisionId,workspace.view?.workspaceId,workspace.view?.chatId,workspace.draft?.revision,workspace.switching]);
  async function chooseRole(role:PromptRole|null){if(readonly||roleBusy||!client.rolePreferences)return;const selection=role?{roleId:role.id,revisionId:role.revisionId}:null;setRoleBusy(true);setRolePreference(selection);if(workspace.draft)workspace.change({...workspace.draft,role:selection});try{await client.rolePreferences.write(selection);}finally{setRoleBusy(false);}}
  useEffect(() => {
    const draft = workspace.draft, modelId = templates.revision?.defaultModelId??provider.view?.defaultModelId;
    if (draft && !draft.scribble && (!draft.template||!!templates.revision) && draft.modelId !== modelId && modelId && provider.view?.hasKey
      && provider.view.models.some(model => model.id === modelId&&model.text!=='unsupported') && !workspace.switching) {
      workspace.change({ ...draft, modelId });
    }
  }, [workspace.draft?.modelId, workspace.draft?.template?.templateId, !!workspace.draft?.scribble, workspace.view?.chatId, workspace.switching, provider.view,templates.revision]);
  const [pinned, setPinned] = useState(true);
  const [peek, setPeek] = useState(false);
  const leaveGuards = useRef<Partial<Record<ModuleId, (() => Promise<boolean>) | null>>>({});
  const motion = useModuleMotion(workspace.flush, readonly && knowledgeId ? 'html' : readonly && new URLSearchParams(location.search).has('subtitleVersionId') ? 'subtitle' : readonly && scribbleId ? 'scribble' : readonly && artifactId ? 'markdown' : 'chat');
  const active = motion.active;
  const previousSpace = useRef<string | null>(null);
  useEffect(() => {
    const id = workspace.view?.workspaceId;
    if (!id) return;
    if (previousSpace.current && previousSpace.current !== id && active !== 'markdown' && active !== 'scribble') void motion.navigate('chat');
    previousSpace.current = id;
  }, [workspace.view?.workspaceId]);
  const [menu, setMenu] = useState(false);
  const [styleMenu,setStyleMenu]=useState(false);
  const [settingsPage, setSettingsPage] = useState<'api' | 'templates' | 'roles' | null>(null);
  const settingsLeaveGuard = useRef<(() => Promise<boolean>) | null>(null);
  const registerSettingsLeaveGuard = useCallback((guard: (() => Promise<boolean>) | null) => { settingsLeaveGuard.current = guard; }, []);
  async function openSettingsPage(page: 'api' | 'templates' | 'roles' | null) {
    setSettings(false);
    if (page === settingsPage) return;
    if (!await (settingsLeaveGuard.current?.() ?? Promise.resolve(true))) return;
    setSettingsPage(page);
  }
  const [collapsed, setCollapsed] = useState(false);
  const [accent, setAccent] = useState<string>(defaultAccent.value), [appearanceError, setAppearanceError] = useState('');
  const themeEdited = useRef(false);
  useEffect(() => { let alive = true; void client.appearancePreferences?.read().then(value => { if (alive && !themeEdited.current) setAccent(resolveAccent(value).value); }).catch(() => {}); return () => { alive = false; }; }, [client]);
  useEffect(()=>{let alive=true;const dispose=client.subscribePreferences?.(keys=>{
    if(keys.includes('vcamp.roleAllOutputs'))void client.roleOutputPreferences?.read().then(value=>{if(alive)setRoleAllOutputs(value);}).catch(()=>{});
    if(keys.includes('vcamp.activeRole'))void client.rolePreferences?.read().then(value=>{if(alive){setRolePreference(value);setRolePreferenceReady(true);}}).catch(()=>{});
    if(keys.includes('vcamp.webDefault'))void client.webPreferences?.read().then(value=>{if(alive)setWebDefault(value);}).catch(()=>{});
    if(keys.includes('vcamp.accent'))void client.appearancePreferences?.read().then(value=>{if(alive)setAccent(resolveAccent(value).value);}).catch(()=>{});
  });return()=>{alive=false;dispose?.();};},[client]);
  useEffect(() => { const theme = resolveAccent(accent); document.documentElement.style.setProperty('--accent', theme.value); document.documentElement.style.setProperty('--accent-strong', theme.text); }, [accent]);
  async function chooseAccent(color: string) { themeEdited.current = true; setAccent(color); setAppearanceError(''); try { await client.appearancePreferences?.write(color); } catch { setAppearanceError('主题色未保存，本次显示仍有效。'); } }
  const [chrome, setChrome] = useState<Partial<Record<ModuleId, ModuleChrome>>>({});
  const markdownChrome = useCallback((value: ModuleChrome) => setChrome(c => ({ ...c, markdown: value })), []);
  const scribbleChrome = useCallback((value: ModuleChrome) => setChrome(c => ({ ...c, scribble: value })), []);
  const knowledgeChrome = useCallback((value: ModuleChrome) => setChrome(c => ({ ...c, html: value })), []);
  const subtitleChrome = useCallback((value: ModuleChrome) => setChrome(c => ({ ...c, subtitle: value })), []);
  const [mention, setMention] = useState<Mention | 'more' | null>(null);
  const closeMention = useCallback(() => setMention(null), []);
  const restoreEditor = useCallback(() => editor.current?.focus(), []);
  const [exportError, setExportError] = useState('');
  useEffect(() => { setMention(null); }, [workspace.view?.workspaceId, workspace.view?.chatId, active]);
  function trackMention(element: HTMLTextAreaElement, isComposing = composing) { if (!workspace.draft?.scribble && !followup) setMention(mentionAt(element.value, element.selectionStart, isComposing)); }
  const [exportOpen,setExportOpen]=useState(false);
  function exportChat(){setExportOpen(true);}
  const [confirmReload, setConfirmReload] = useState(false);
  const [composing, setComposing] = useState(false);
  const peekTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const rail = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const inputText=pendingSend?'':followup?.question??workspace.draft?.scribble?.text??workspace.draft?.text??'';
  useComposerSize(editor,inputText,!readonly&&active==='chat');
  const thread = useRef<HTMLDivElement>(null), follow = useRef(true);
  useEffect(() => { follow.current = true; }, [workspace.view?.workspaceId, workspace.view?.chatId]);
  useEffect(() => { if (follow.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [generation.view?.messages.at(-1)?.contentVersionId, generation.view?.messages.length,pendingSend]);
  useEffect(() => {
    const leaveWindow = () => scheduleClosePeek(true);
    window.addEventListener('blur', leaveWindow);
    document.documentElement.addEventListener('mouseleave', leaveWindow);
    return () => {
      clearTimeout(peekTimer.current);
      window.removeEventListener('blur', leaveWindow);
      document.documentElement.removeEventListener('mouseleave', leaveWindow);
    };
  }, [pinned]);
  function openPeek() {
    clearTimeout(peekTimer.current);
    if (!pinned) setPeek(true);
  }
  function scheduleClosePeek(leftWindow = false) {
    clearTimeout(peekTimer.current);
    if (pinned) return;
    peekTimer.current = setTimeout(() => {
      if (!leftWindow && rail.current?.contains(document.activeElement)) return;
      setPeek(false);
    }, 240);
  }
  function togglePinned() {
    clearTimeout(peekTimer.current);
    setPinned(!pinned); setPeek(false);
  }
  useEffect(() => {
    const close = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenu(false); if(!(event.target as Element).closest('.html-style-control,.html-style-menu'))setStyleMenu(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  async function navigate(id: ModuleId) {
    if (composing) return;
    if (!await (settingsLeaveGuard.current?.() ?? Promise.resolve(true))) return;
    if (!await (leaveGuards.current[active]?.() ?? Promise.resolve(true))) return;
    if (id === 'chat' && !readonly) { setArtifactId(undefined); setScribbleId(undefined); setKnowledgeId(undefined); }
    setMenu(false);
    setSettingsPage(null); setSettings(false);
    await motion.navigate(id);
  }
  async function prepareKnowledge(artifact:KnowledgeArtifact,entry:KnowledgeEntry,question:string){
    if(composing||workspace.switching||artifact.workspaceId!==workspace.view?.workspaceId||workspace.draft?.scribble||followup)return false;
    if(!await workspace.selectChat(artifact.sourceChatId))return false;
    try {const source=await client.query();if(source.workspaceId!==artifact.workspaceId||source.chatId!==artifact.sourceChatId||!source.draft||source.draft.scribble||source.draft.knowledgeFollowup)return false;
      await client.command({type:'draft.save',target:{workspaceId:artifact.workspaceId,chatId:artifact.sourceChatId},expectedRevision:source.draft.revision,draft:{...source.draft,knowledgeFollowup:{artifactId:artifact.id,revisionId:artifact.revisionId,entryId:entry.id,question}}});
      await workspace.reload();await motion.navigate('chat');setTimeout(()=>editor.current?.focus(),0);return true;
    } catch {return false;}
  }
  useEffect(()=>{if(readonly||!workspace.view?.workspaceId)return;const params=new URLSearchParams(location.search),ws=params.get('sourceWorkspaceId'),chat=params.get('sourceChatId');if(!ws||!chat)return;
    if(ws!==workspace.view.workspaceId){setFollowupError('请返回来源视频分 P 后重新打开来源对话。');return;}
    void workspace.selectChat(chat).then(ok=>{if(!ok)setFollowupError('来源对话不可用。');});history.replaceState(null,'',location.pathname);
  },[workspace.view?.workspaceId]);
  function update(patch: Partial<Draft>) { if (workspace.draft) workspace.change({ ...workspace.draft, ...patch }); }
  function chooseStyle(style:Draft['htmlStyle']|null){update({htmlStyle:style??undefined});void styleMemory.choose(style);setStyleMenu(false);editor.current?.focus();}
  function cancelScribble(){const draft=workspace.draft;if(!draft?.scribble)return;const text=[draft.text,draft.scribble.text].filter((part,index,all)=>part&&all.indexOf(part)===index).join('\n');update({scribble:undefined,text});editor.current?.focus();}
  const current = modules.find(module => module.id === active)!;
  const RegisteredView = registrations.find(module => module.id === active)?.View;
  const MarkdownView = registrations.find(module => module.id === 'markdown')?.View;
  const ScribbleView = registrations.find(module => module.id === 'scribble')?.View;
  const unbound = !workspace.view?.workspaceId;
  const video = workspace.view?.video;
  const conditions = sendConditions(video);
  const mainSubtitle = subtitles.view?.analysisSource;
  const selectedModel=provider.view?.models.find(model=>model.id===workspace.draft?.modelId);
  const autoVision=!!workspace.draft?.visionEnabled;
  const visionOnlyReady=autoVision&&video?.status==='no-subtitles'&&!!video.binding&&selectedModel?.vision==='declared';
  const sourceReady = mainSubtitle && mainSubtitle.kind !== 'native' ? subtitles.view!.sourceValid && !!video?.binding : conditions.subtitleReady||visionOnlyReady;
  const unsupported = !followup && isRetiredGenerationTemplate(templates.revision);
  const hasImages=(!followup&&!!workspace.draft?.attachmentIds.length)||!!generation.view?.messages.some(m=>m.attachmentIds.length);
  const visionReady=(!autoVision || nativeProvider && selectedModel?.vision==='declared') && (!hasImages||nativeProvider && provider.view?.models.some(m=>m.id===workspace.draft?.modelId&&m.vision==='declared'));
  const webReady=!workspace.draft?.webEnabled||nativeProvider && provider.view?.models.some(m=>m.id==='deepseek-flash'&&m.text!=='unsupported');
  const outputLabel = followup ? 'Chat 追问' : workspace.draft?.outputType === 'markdown' ? '笔记' : workspace.draft?.outputType === 'html' ? templates.revision?.outputProtocol==='knowledge-json-v1'?'旧知识':'HTML' : 'Chat';
  const styleReady=styleMemory.ready&&(!client.htmlStylePreferences||workspace.draft?.htmlStyle?.styleId===styleMemory.selection?.styleId&&workspace.draft?.htmlStyle?.revisionId===styleMemory.selection?.revisionId);
  const canSend = !uploadBusy && webReady && visionReady && !!client.generation && sourceReady && (followup ? !!followup.question.trim() : !!(workspace.draft?.text.trim() || workspace.draft?.template || workspace.draft?.attachmentIds.length)) && !!provider.view?.hasKey && provider.view.models.some(model => model.id === workspace.draft?.modelId && model.text !== 'unsupported') && (workspace.draft?.outputType!=='chat'&&!roleAllOutputs || !workspace.draft?.role || !roles.error && roles.revision?.revisionId === workspace.draft.role.revisionId) && !generation.active && !generation.busy && (workspace.draft?.outputType!=='html'||styleReady) && !(workspace.draft?.outputType==='html'&&workspace.draft.htmlStyle&&(styles.revision?.revisionId!==workspace.draft.htmlStyle.revisionId||!!styles.error)) && !workspace.switching && !composing && !workspace.draft?.scribble && !unsupported && (followup || !templates.error) && (followup || !workspace.draft?.template || templates.revision?.revisionId === workspace.draft.template.revisionId);
  async function send() {
    if (!canSend||sending.current) return;
    sending.current=true;
    follow.current = true;
    setPendingSend({text:followup?.question??(workspace.draft?.text.trim()|| (templates.revision?`使用模板「${templates.revision.name}」生成 ${outputLabel}`:`使用 ${workspace.draft?.attachmentIds.length??0} 个附件发起请求`)),messageIds:(generation.view?.messages??[]).map(message=>message.messageId)});
    try { await workspace.submit(async saved => saved.workspaceId && saved.chatId && saved.draft ? generation.command({ type: 'generation.send', target: { kind: 'chat', workspaceId: saved.workspaceId, chatId: saved.chatId }, expectedRevision: saved.draft.revision, ...(saved.draft.visionEnabled ? { preauthorize:true as const } : {}), ...(saved.video?.binding ? { binding: saved.video.binding } : {}) }) : false); } finally {sending.current=false;setPendingSend(null);}
  }
  function startScribble(patch: Partial<Draft> = {}) {
    if (!workspace.draft || workspace.draft.scribble || followup) return;
    setScribbleError(''); setMenu(false); update({ ...patch, scribble: { text: '', time: video?.playback?.time ?? null } });
    editor.current?.focus();
  }
  function editInput(text: string) {
    if (followup) update({knowledgeFollowup:{...followup,question:text}});
    else if (workspace.draft?.scribble) update({ scribble: { ...workspace.draft.scribble, text } });
    else update({ text });
  }
  async function saveScribble() {
    if (composing || workspace.switching || !workspace.draft?.scribble?.text.trim() || !client.scribbles) return;
    setScribbleError('');
    await workspace.submit(async saved => {
      if (!saved.workspaceId || !saved.chatId || !saved.draft?.scribble) return false;
      try { await client.scribbles!({ type: 'scribble.create', workspaceId: saved.workspaceId, text: saved.draft.scribble.text, time: saved.draft.scribble.time, origin: { chatId: saved.chatId, expectedRevision: saved.draft.revision } }); return true; }
      catch { setScribbleError('随笔保存失败，当前输入仍保留。请重试。'); return false; }
    }, 'scribble');
  }
  async function selectChat(chatId?: string) {
    if (composing) return;
    if (!await (leaveGuards.current[active]?.() ?? Promise.resolve(true))) return;
    if (await workspace.selectChat(chatId)) { setArtifactId(undefined); setScribbleId(undefined); setKnowledgeId(undefined); await motion.navigate('chat'); }
  }
  const context = chrome[active];
  const contextStatus = context?.status ?? (pendingSend||generation.busy ? '正在生成' : workspace.switching ? '正在切换内容' : workspace.error ? '草稿保存异常' : generation.active ? '正在生成' : readonly ? '只读资料' : video ? videoStatusLabel(video) : '尚未绑定视频');
  const contextItems = active === 'chat' ? (workspace.view?.chats ?? []).map(chat => ({ id: chat.id, title: chat.title, select: () => void selectChat(chat.id) })) : context?.items ?? [];
  const moduleActions = active === 'chat' && !readonly ? [
    { label: '联网', tooltip: !nativeProvider ? '当前服务暂不支持联网检索' : undefined, active: workspace.draft?.webEnabled===true, disabled: !workspace.draft || webPreferenceBusy || (!nativeProvider && !workspace.draft.webEnabled), run: () => update({ webEnabled: !workspace.draft?.webEnabled }) },
    { label: '导出', disabled: !generation.view?.messages.length, run: exportChat }
  ] : context?.actions ?? [];
  const contextActions = ['subtitle','markdown','html','scribble'].includes(active) ? moduleActions.filter(action=>action.label!=='导出') : readonly ? moduleActions : [...moduleActions.filter(action=>action.label!=='导出'),{label:'导出',disabled:!workspace.view?.workspaceId,run:()=>setExportOpen(true)}];
  return <div className={`app-shell ${pinned ? 'pinned' : ''} ${peek ? 'rail-peek' : ''} ${collapsed ? 'header-collapsed' : ''}`}>
    {exportOpen&&workspace.view?.workspaceId&&<DocumentExportDialog client={client} {...(readonly?{entities:workspace.view.chatId?[{workspaceId:workspace.view.workspaceId,entityType:'chat' as const,id:workspace.view.chatId,title:'当前对话'}]:[]}:{workspaceId:workspace.view.workspaceId})} close={()=>setExportOpen(false)}/>}
    <div className="workspace">
      {!settingsPage && <ContextHeader module={active} title={context?.title ?? workspace.view?.title ?? 'Vcamp'} subtitle={active === 'chat' ? workspace.view?.chats?.find(chat => chat.id === workspace.view?.chatId)?.title ?? 'Chat' : current.title} status={contextStatus} items={contextItems} actions={contextActions} disabled={workspace.switching || composing} readonly={readonly} collapsed={collapsed} collapse={setCollapsed} newChat={active === 'chat' && !readonly && !unbound ? () => void selectChat() : undefined} extra={active === 'chat' && !readonly && workspace.view?.workspaceId && workspace.view.chatId ? <DeleteButton client={client} target={{ workspaceId: workspace.view.workspaceId, entityType: 'chat', id: workspace.view.chatId }} label="删除对话" beforeDelete={workspace.flush}/> : undefined}/>}
      {settingsPage && <header className="settings-page-header"><button onClick={() => void openSettingsPage(null)}><Icon name="arrow"/>返回{current.title}</button><strong>{settingsPage === 'api' ? 'API 设置' : settingsPage === 'roles' ? '角色设置' : '模板工作流'}</strong></header>}
      {settingsPage && <section className="settings-page" aria-label={settingsPage === 'api' ? 'API 设置' : settingsPage === 'roles' ? '角色设置' : '模板工作流'}>{readonly ? <p>只读资料不提供配置。</p> : settingsPage === 'api' ? <ProviderSettings provider={provider}/> : settingsPage === 'roles' ? <RoleManager client={client} registerLeaveGuard={registerSettingsLeaveGuard}/> : <PromptManager client={client} models={provider.view?.models ?? []} registerLeaveGuard={registerSettingsLeaveGuard}/>}</section>}
      {workspace.view?.deletedWorkspace && <div className="error-banner" role="status">此分 P 工作空间已删除。<button onClick={() => void navigate('library')}>打开资料库</button></div>}
      <main hidden={!!settingsPage} ref={motion.element} className="module-content" data-module={active} aria-label={current.title}>
        {MarkdownView && workspace.view && <div hidden={active !== 'markdown'} className="note-module"><MarkdownView onChromeChange={markdownChrome} client={client} view={workspace.view} artifactId={artifactId} registerLeaveGuard={guard => { leaveGuards.current.markdown = guard; }} onSourceChat={readonly ? undefined : chatId => void selectChat(chatId)}/></div>}
        {ScribbleView && workspace.view && <div hidden={active !== 'scribble'} className="note-module"><ScribbleView onChromeChange={scribbleChrome} client={client} view={workspace.view} scribbleId={scribbleId} registerLeaveGuard={guard => { leaveGuards.current.scribble = guard; }}/></div>}
        {(active === 'markdown' && MarkdownView) || (active === 'scribble' && ScribbleView) ? null : RegisteredView && workspace.view ? <RegisteredView onChromeChange={active === 'subtitle' ? subtitleChrome : active === 'html' ? knowledgeChrome : undefined} key={active === 'library' ? 'library' : `${active}-${workspace.view.workspaceId}-${video?.binding?.documentId}-${video?.binding?.epoch}`} client={client} view={workspace.view} artifactId={active==='html'?knowledgeId:undefined} onKnowledgeFollowup={prepareKnowledge} onSourceChat={readonly?undefined:chatId=>void selectChat(chatId)} onVideoOpen={() => void navigate('chat')}/> : active === 'chat' ? <>
          {generation.view?.messages.length||pendingVisible ? <div ref={thread} onScroll={() => { const el = thread.current; if (el) follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }} className="chat-thread" aria-label="问答记录"><ChatMessages mediaDuration={!readonly?video?.playback?.duration??undefined:undefined} jobs={generation.view?.jobs??[]} taskCommand={generation.command} readonly={readonly} busy={generation.busy} active={generation.active} onSeek={workspace.view?.workspaceId&&workspace.view.chatId?time=>{void client.library?.({type:'library.locate',target:{workspaceId:workspace.view!.workspaceId!,entityType:'chat',id:workspace.view!.chatId!},time}).catch(()=>setExportError('无法定位此时间，请确认来源视频与有效时长。'));}:undefined} openKnowledge={id=>{setKnowledgeId(id);void navigate('html');}} client={client} target={{workspaceId:workspace.view!.workspaceId!,chatId:workspace.view!.chatId!}} messages={generation.view?.messages??[]} pending={pendingVisible?pendingSend?.text:undefined} openNote={id => { setArtifactId(id); void navigate('markdown'); }} openScribble={id => { setScribbleId(id); void navigate('scribble'); }}/></div> : !readonly && !unbound && sourceReady ? <div className="chat-blank"><span className="sr-only">暂无问答记录，输入问题开始对话。</span></div> : <div className="empty-state"><Icon name="chat"/><h1>{readonly ? '暂无问答记录' : unbound ? '让视频成为你的知识' : '从一个问题开始'}</h1><p>{readonly ? '这里仅展示已保存的资料。' : unbound ? '打开 B 站视频后，在这里整理问题与想法。' : '写下想了解的内容，草稿会自动保留。'}</p>{!readonly && <><p className="hint">{mainSubtitle && mainSubtitle.kind !== 'native' ? subtitles.view!.sourceValid ? '主字幕已就绪，可发送问题' : '主字幕已失效，请在字幕模块重新选择' : video ? visionOnlyReady?'无可用字幕，将按授权读取代表画面':conditions.subtitleReady ? '完整字幕已就绪，可发送普通文本问题' : videoStatusLabel(video) : '等待完整字幕'}</p><VideoActions key={video?.binding?.epoch} video={video} client={client}/></>}</div>}
          {unsupported && <p className="generation-help"><strong>旧版生成协议已退役，请转换为 HTML 页面并重新选择。旧成果仍可只读查看。<button onClick={() => { setSettingsPage('templates'); setSettings(false); }}>打开模板工作流</button></strong></p>}
          {mainSubtitle && mainSubtitle.kind !== 'native' && !subtitles.view!.sourceValid && <p role="alert" className="generation-help">主字幕已失效，请在字幕模块重新选择。</p>}
          {generation.error && <div role="alert" className="error-banner">{generation.error}</div>}
          {!readonly && <section className={`composer ${dropActive?'drop-active':''}`} aria-label="输入区" onDragEnter={event=>{if(event.dataTransfer.types.includes('Files')||event.dataTransfer.files.length){event.preventDefault();setDropActive(true);}}} onDragOver={event=>{if(event.dataTransfer.types.includes('Files')||event.dataTransfer.files.length){event.preventDefault();event.dataTransfer.dropEffect='copy';}}} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDropActive(false);}} onDrop={event=>{event.preventDefault();setDropActive(false);void uploadImages([...event.dataTransfer.files]);}}>
            <input ref={fileInput} hidden type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="选择本地图片" onChange={event=>{const files=[...(event.currentTarget.files??[])];event.currentTarget.value='';void uploadImages(files);}}/>
            <ReferencePicker visionAvailable={nativeProvider} trigger={mention} close={closeMention} restoreFocus={restoreEditor} startCapture={()=>void captureCurrentFrame()} addImages={()=>fileInput.current?.click()} client={client} workspaceId={workspace.view?.workspaceId ?? null} chatId={workspace.view?.chatId ?? null} draft={workspace.draft} selectedTemplateName={templates.revision?.name??templates.templates.find(template=>template.revisionId===workspace.draft?.template?.revisionId)?.name} disabled={!workspace.draft || !!followup || !!workspace.draft.scribble || workspace.switching || composing || uploadBusy} change={update} templates={templates.templates} startScribble={startScribble} visionEnabled={!!workspace.draft?.visionEnabled} toggleVision={patch=>update({...patch,visionEnabled:!workspace.draft?.visionEnabled})} clearTemplate={patch=>update({...patch,template:null,outputType:'chat'})} selectTemplate={(template, patch) => { setMenu(false); update({ ...patch, template: { templateId: template.id, revisionId: template.revisionId }, outputType: template.outputType, modelId: template.defaultModelId ?? provider.view?.defaultModelId ?? null }); }}/>
            {dropActive&&<div className="drop-hint">松开以添加图片</div>}
            {!workspace.draft?.scribble&&templates.error && <p role="alert">{templates.error}</p>}
            {!workspace.draft?.scribble&&(workspace.draft?.outputType==='chat'||roleAllOutputs)&&roles.error && <p role="alert">{roles.error}</p>}{!workspace.draft?.scribble&&workspace.draft?.outputType==='html'&&(styles.error||styleMemory.error)&&<p role="alert">{styles.error||styleMemory.error}</p>}
            {!workspace.draft?.scribble&&workspace.draft?.template && workspace.draft.modelId && !provider.view?.models.some(m => m.id === workspace.draft?.modelId) && <p role="alert">模板默认模型不可用，请到 API 设置选择可用默认模型或修改模板。</p>}
            {workspace.view?.workspaceId&&workspace.view.chatId&&workspace.draft&&!workspace.draft.scribble&&!followup&&<AttachmentImages client={client} target={{workspaceId:workspace.view.workspaceId,chatId:workspace.view.chatId}} ids={workspace.draft.attachmentIds} remove={workspace.switching||uploadBusy?undefined:id=>void removeDraftImage(id)}/>}
            {uploadError&&<p role="alert">{uploadError}</p>}
            {!workspace.draft?.scribble&&!webReady&&<p role="alert">联网需要 DeepSeek deepseek-flash 检索模型；请检查服务配置，或关闭联网后重新发送。</p>}
            {!workspace.draft?.scribble&&!visionReady&&<p role="alert">本次开启了视觉识别或包含图片。请选择 DeepSeek 已声明支持视觉的模型；其它服务请关闭自主识别并移除草稿图片，带历史图片时可新建文本对话。</p>}
            {workspace.draft?.scribble&&<div className="reference-tags composer-tool-tags" aria-label="随笔标签"><button aria-label="取消随笔" disabled={workspace.switching||composing} onClick={cancelScribble}><Icon name="scribble"/>随笔 <span aria-hidden="true">×</span></button>{workspace.draft.scribble.time!==null&&<button aria-label="移除随笔时间点" title="不附时间点" disabled={workspace.switching||composing} onClick={()=>{update({scribble:{...workspace.draft!.scribble!,time:null}});editor.current?.focus();}}><Icon name="clock"/>{formatTime(workspace.draft.scribble.time)} <span aria-hidden="true">×</span></button>}</div>}
            <textarea ref={editor} aria-label="输入草稿" value={inputText} disabled={!workspace.draft || workspace.switching} maxLength={followup ? 8000 : 100000} placeholder="" aria-controls={mention ? "mention-menu" : undefined} onPaste={event=>{const files=[...event.clipboardData.items].flatMap(item=>{const file=item.kind==='file'?item.getAsFile():null;return file&&file.type.startsWith('image/')?[file]:[];});if(files.length){event.preventDefault();void uploadImages(files);}}} onCompositionStart={() => { setMention(null); setComposing(true); workspace.composition(true); }} onCompositionEnd={event => { editInput(event.currentTarget.value); trackMention(event.currentTarget, false); setComposing(false); workspace.composition(false); }} onChange={event => { editInput(event.target.value); trackMention(event.currentTarget); }} onClick={event => trackMention(event.currentTarget)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) trackMention(event.currentTarget); }} onKeyDown={event => {
              if (!event.nativeEvent.isComposing && !composing && event.keyCode !== 229) {
                if (event.key === 'Escape' && mention) { event.preventDefault(); setMention(null); return; }
                if (event.key === 'ArrowDown' && mention) { event.preventDefault(); document.querySelector<HTMLButtonElement>('#mention-menu button:not(:disabled)')?.focus(); return; }
                if (event.key === 'Enter' && mention) { event.preventDefault(); document.querySelector<HTMLButtonElement>('#mention-menu button:not(:disabled):not(.text-button)')?.click(); return; }
                const enter=composerEnterAction({key:event.key,shiftKey:event.shiftKey,composing:false,keyCode:event.keyCode,scribble:!!workspace.draft?.scribble});
                if (enter) { event.preventDefault(); if (enter==='save-scribble') void saveScribble(); else { setMention(null); if (canSend) void send(); } }
              } }}/>
            {followup&&<div className="knowledge-followup-preview"><strong>交互知识追问 · 原草稿已保留</strong><p>发送以下问题及选中条目，不发送保留草稿中的文字、模板、引用或附件。</p><pre>{followupEntry?[...followupEntry.groups.flatMap(g=>g.items),...followupEntry.concepts,...followupEntry.questions].find(e=>e.id===followup.entryId)?.body:'条目正在读取或已不可用，发送时会重新校验'}</pre><button onClick={()=>update({knowledgeFollowup:undefined})}>取消追问并恢复原草稿</button></div>}
            {followupError&&<p role="alert">{followupError}</p>}
            {scribbleError && <p role="alert">{scribbleError}</p>}
            <div className="toolbar">
              <button className="icon-button" disabled={!!followup || !!workspace.draft?.scribble || !workspace.draft || workspace.switching || composing} onClick={() => { setMenu(false); setStyleMenu(false); setMention(mention === 'more' ? null : 'more'); }} aria-label="更多输入操作" aria-expanded={mention === 'more'}><Icon name="plus"/></button>
              <div className="toolbar-spacer"/>
              <div className="output-control" ref={menuRef} onKeyDown={event => {
                if ((menu||styleMenu) && focusPicker(menuRef.current, event.key)) event.preventDefault(); if (event.key === 'Escape') { setMenu(false);setStyleMenu(false);menuButton.current?.focus(); }
              }}>
                <PickerPopover open={workspace.draft?.outputType==='html'&&!followup&&!workspace.draft?.scribble} className="html-style-control" label="HTML 风格选择" role="group">
                  <button className="pill" disabled={styleMemory.busy||workspace.switching||composing} aria-label={`HTML 风格：${styles.revision?.name??'默认'}`} aria-expanded={styleMenu} onClick={()=>{setMenu(false);setMention(null);setStyleMenu(!styleMenu);}} title={styles.revision?.name??'默认'}><SoftText text={styles.revision?.name??'默认'}/><Icon name="chevron"/></button>
                </PickerPopover>
                <PickerPopover open={styleMenu&&workspace.draft?.outputType==='html'&&!workspace.draft.scribble&&!followup} className="output-menu html-style-menu" label="HTML 页面风格"><button role="menuitemradio" aria-checked={!workspace.draft?.htmlStyle} onClick={()=>chooseStyle(null)}>默认</button>{styles.styles.map(style=><button key={style.id} role="menuitemradio" aria-checked={workspace.draft?.htmlStyle?.revisionId===style.revisionId} onClick={()=>chooseStyle({styleId:style.id,revisionId:style.revisionId})}>{style.name}</button>)}</PickerPopover>
                <button ref={menuButton} className="pill" aria-label={`产物类型：${outputLabel}`} aria-expanded={menu} aria-haspopup="menu" disabled={!!followup || !!workspace.draft?.scribble || !!workspace.draft?.template || !workspace.draft || workspace.switching || composing} onClick={() => { setMention(null); setStyleMenu(false); setMenu(!menu); }}><SoftText text={outputLabel}/><Icon name="chevron"/></button>
                <PickerPopover open={menu} className="output-menu" label="产物类型">{(['chat', 'markdown', 'html'] as const).map(type => <button role="menuitemradio" disabled={!!workspace.draft?.template} aria-checked={workspace.draft?.outputType === type} key={type} onClick={() => { update({ outputType: type }); setMenu(false); setStyleMenu(false); editor.current?.focus(); }}>{type === 'chat' ? 'Chat 问答' : type === 'markdown' ? 'Markdown 笔记' : 'HTML 页面'}</button>)}</PickerPopover>
              </div>
              <button className="send" disabled={workspace.draft?.scribble?workspace.switching||composing||!workspace.draft.scribble.text.trim():!canSend} onClick={() => workspace.draft?.scribble?void saveScribble():void send()} title={workspace.draft?.scribble?'发送随笔':generation.active ? '当前对话已有任务，可以编辑下一份草稿' : unsupported ? '旧版生成协议需转换并重新选择' : visionOnlyReady?'发送后确认读取代表画面':'需要完整字幕、可用模型与已保存输入'} aria-label="发送"><Icon name="send"/></button>
            </div>
          </section>}
        </> : <div className="empty-state"><Icon name={active}/><h1>{current.empty}</h1><p>{readonly ? '只展示这个工作空间已保存的内容。' : '你的学习内容将在这里汇集。'}</p><button className="text-button" onClick={() => void navigate('chat')}>返回问答</button></div>}
      </main>
      {workspace.switching && !pendingSend && <div className="switch-notice" role="status">正在切换内容…</div>}
      <div className="sr-only" role="status">{workspace.status}</div>
      {(exportError || appearanceError) && <p role="alert">{exportError || appearanceError}</p>}
      {workspace.error && <div className="error-banner" role="alert">{workspace.error}<button onClick={() => workspace.error.includes('另一窗口') ? setConfirmReload(true) : workspace.retry()}>{workspace.error.includes('另一窗口') ? '重新载入' : '重试'}</button></div>}
      {workspace.hasRecovery && <div className="error-banner">有未保存草稿，返回原视频／对话可继续恢复。<button onClick={workspace.downloadRecovery}>下载未保存草稿</button></div>}
    </div>
    {!pinned && <div className="edge-peek" onMouseEnter={openPeek} onMouseMove={openPeek} onMouseLeave={() => scheduleClosePeek()}/>}
    <aside className="sidebar" onMouseEnter={openPeek} onMouseLeave={() => scheduleClosePeek()} onFocus={openPeek} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) scheduleClosePeek(); }}>
      <button className="sidebar-toggle" aria-label={pinned ? '收起侧栏' : '固定侧栏'} aria-pressed={pinned} aria-expanded={pinned || peek} onClick={togglePinned}><Icon name="arrow"/></button>
      <nav ref={rail} className={`rail ${peek ? 'peeking' : ''}`} onMouseEnter={openPeek} onMouseLeave={() => scheduleClosePeek()} aria-label="模块导航" inert={!pinned && !peek}>
        <div className="rail-main">{modules.filter(module => module.id !== 'library').map(module => <button className={active === module.id ? 'active' : ''} key={module.id} title={module.title} aria-label={module.title} aria-current={active === module.id ? 'page' : undefined} onClick={() => void navigate(module.id)}><Icon name={module.id}/></button>)}</div>
        <div className="rail-bottom"><button aria-label="资料库" title="资料库" onClick={() => void navigate('library')}><Icon name="library"/></button><button aria-label="设置" title="设置" onClick={() => setSettings(value => !value)}><Icon name="settings"/></button></div>
      </nav>
    </aside>
    {settings && <SettingsMenu apiControls={<QuickProviderSwitcher provider={provider} readonly={readonly} manage={() => void openSettingsPage('api')}/>}
      roles={roles.roles} activeRole={rolePreference} activeRoleRevision={roles.revision} roleBusy={roleBusy} chooseRole={role=>void chooseRole(role)}
      webDefault={webDefault} webBusy={webPreferenceBusy || !nativeProvider} toggleWebDefault={()=>void toggleWebPreference()}
      color={accent} chooseColor={color => void chooseAccent(color)} readonly={readonly} close={() => setSettings(false)}
      openPage={page => void openSettingsPage(page)}/>
    }
    {confirmReload && <SettingsDialog title="重新载入草稿" onClose={() => setConfirmReload(false)}><p>载入会替换未保存输入，请先复制文字或下载完整草稿。</p><button onClick={workspace.downloadRecovery}>下载未保存草稿</button><button onClick={() => { setConfirmReload(false); void workspace.reload(); }}>已保留文字，载入已保存草稿</button></SettingsDialog>}

  </div>;
}

function SettingsDialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onCancel={onClose} onClose={onClose}><h2>{title}</h2>{children}<button className="dialog-close" onClick={onClose}>关闭</button></dialog>;
}

async function imageFileFrame(file:File,time:number):Promise<CapturedFrame>{
  let bitmap:ImageBitmap;
  try{bitmap=await createImageBitmap(file);}catch{throw new Error('图片无法读取，请换用 PNG、JPEG 或 WebP。');}
  try{
    if(!bitmap.width||!bitmap.height)throw new Error('图片尺寸无效。');
    let scale=Math.min(1,imageLimits.edge/bitmap.width,imageLimits.edge/bitmap.height,Math.sqrt(imageLimits.pixels/(bitmap.width*bitmap.height)));
    for(let attempt=0;attempt<8;attempt++){
      const width=Math.max(1,Math.floor(bitmap.width*scale)),height=Math.max(1,Math.floor(bitmap.height*scale));
      const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const context=canvas.getContext('2d');if(!context)throw new Error('当前浏览器无法处理图片。');
      context.drawImage(bitmap,0,0,width,height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('图片转换失败，请重试。');
      if(blob.size<=imageLimits.bytes){const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result):reject(new Error());reader.onerror=()=>reject(new Error());reader.readAsDataURL(blob);});return{dataUrl,width,height,time:Math.max(0,time)};}
      scale*=.78;
    }
    throw new Error(`图片内容过于复杂，处理后仍超过 ${imageLimits.bytes/1024/1024} MiB。`);
  }finally{bitmap.close();}
}
