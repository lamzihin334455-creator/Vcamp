import type { Template, TemplateRevision } from '../contracts/template';

// Reviewed prototype names/descriptions, with production requirements narrowed
// to supported outputs. Demo model names, vision and workflow scripts omitted.
const initialPresets: readonly Template[] = [
  { id: 'builtin-summary', revisionId: 'builtin-summary:v1', revision: 1, builtin: true, name: '快速总结', description: '快速了解内容与核心观点', requirements: '用五个要点概括当前视频，简洁说明适合谁观看，区分视频事实与推断。', outputType: 'chat', defaultModelId: null },
  { id: 'builtin-note', revisionId: 'builtin-note:v1', revision: 1, builtin: true, name: '知识笔记', description: '整理章节、结论和关键时间节点', requirements: '用 Markdown 整理关键概念、章节、结论和行动建议，保留视频中的关键时间点。', outputType: 'markdown', defaultModelId: null },
  { id: 'builtin-map', revisionId: 'builtin-map:v1', revision: 1, builtin: true, name: '学习导图', description: '结构化整理，并生成 HTML 导图', requirements: '生成层级清晰、可展开的交互式知识导图，以自包含 HTML 呈现。', outputType: 'html', defaultModelId: null }
];
const knowledgePresets: readonly Template[] = initialPresets.map(t=>t.id==='builtin-map'?{...t,revision:2,revisionId:'builtin-map:v2',outputProtocol:'knowledge-json-v1',description:'整理视频分类、概念关系与深入问题',requirements:'整理当前视频的概括、分类知识、概念关系及相关问答，提供可深入追问的问题。仅输出交互知识 JSON v1，区分视频依据、解释和推断。'}:t);
const htmlPresets: readonly Template[] = knowledgePresets.map(t=>t.id==='builtin-map'?{...t,name:'交互学习页',revision:3,revisionId:'builtin-map:v3',outputProtocol:'html-page-v1',description:'按问题生成可阅读操作的 HTML 页面',requirements:'围绕当前视频与用户问题生成完整、自包含、风格统一的 HTML/CSS/JavaScript 学习页面，窄栏可读，包含适合此主题的页内交互，区分视频依据与补充解释。'}:t);
const flexiblePresets: readonly Template[] = htmlPresets.map(t=>t.id==='builtin-map'?{...t,revision:4,revisionId:'builtin-map:v4',description:'根据本次要求生成 HTML 页面',requirements:'根据本次要求与视频资料生成自包含 HTML 页面；内容结构、表现方式和页内交互由模型按任务需要决定。'}:t.id==='builtin-summary'?{...t,revision:2,revisionId:'builtin-summary:v2',requirements:'概括当前视频的核心内容与主要观点，帮助用户快速理解。按内容选择合适结构，不固定要点数量或额外栏目。表达详略和时间呈现遵循当前角色及本次要求。'}:{...t,revision:2,revisionId:'builtin-note:v2',description:'整理便于理解与回顾的知识笔记',requirements:'用 Markdown 整理便于理解与回顾的视频笔记，呈现重要概念、关系与结论；按内容选择结构，不强行补齐章节或行动建议。表达详略和时间呈现遵循当前角色及本次要求。'});
const evidenceGuidance='准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。';
const evidencePresets: readonly Template[] = flexiblePresets.map(t=>({...t,revision:t.revision+1,revisionId:`${t.id}:v${t.revision+1}`,requirements:t.requirements+' '+evidenceGuidance+(t.id==='builtin-summary'?' 默认先给核心结论，再用少量紧凑段落或要点解释；未要求详细时以约200至400字为宜，不逐段复述或罗列非核心推广信息。本次明确要求优先。':t.id==='builtin-note'?' 优先记录可复用的概念、依据和适用条件，合并重复论点；案例服务于理解，不把口述观点改写成已验证事实。':' 交互须服务理解且实际可操作，提供清楚的操作标签和状态反馈；窄栏可读，不依赖外部资源，不把猜测做成确定答案。')}));
export const presetTemplates: readonly Template[] = evidencePresets.map(t=>t.id==='builtin-summary'?{...t,revision:4,revisionId:'builtin-summary:v4',requirements:t.requirements.replace(' 默认先给核心结论，再用少量紧凑段落或要点解释；未要求详细时以约200至400字为宜，不逐段复述或罗列非核心推广信息。本次明确要求优先。',' 默认只给一句核心结论和少量短要点，每点一句话；全文目标200至300字，不超过400字（含标题、标点和时间标签，不计链接地址）。不另加重复栏目，不逐段复述或罗列非核心推广信息。本次明确要求或角色要求详细时按其展开。')}:t);
const versionHistory: readonly TemplateRevision[] = [...initialPresets,...knowledgePresets.filter(t=>t.revision===2),...htmlPresets.filter(t=>t.revision===3),...flexiblePresets,...evidencePresets,...presetTemplates].map(({ id, builtin: _builtin, ...fields }) => ({ templateId: id, ...fields }));
// Unchanged presets can occur in adjacent release sets; each version is one dependency.
export const presetRevisions: readonly TemplateRevision[] = [...new Map(versionHistory.map(revision => [revision.revisionId, revision])).values()];
export const resolveTemplateRevision = (templateId: string, revisionId: string, revisions: readonly TemplateRevision[]) => [...presetRevisions, ...revisions].find(row => row.templateId === templateId && row.revisionId === revisionId);
