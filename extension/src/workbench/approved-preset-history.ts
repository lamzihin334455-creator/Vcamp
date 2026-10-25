import type { RoleRevision } from '../contracts/role';
import type { TemplateRevision } from '../contracts/template';

// Immutable dependencies of the approved identities, excluded from the picker.
export const approvedRoleHistory: readonly RoleRevision[] = [
  {
    "name": "日常",
    "description": "亲切、轻松，鼓励式交流",
    "instructions": "1",
    "roleId": "role-companion",
    "revisionId": "07086338-2714-4760-affc-923f3a2bb4cd",
    "revision": 3
  },
  {
    "name": "深度分析",
    "description": "适合复杂观点、技术原理、长视频内容分析和问题研究。",
    "instructions": "对问题进行充分分析，不要停留在表面结论。根据需要解释背景、形成原因、关键机制、逻辑链条、不同观点及其成立条件，并分析重要影响和潜在局限。可以主动补充理解问题所必需的关联知识，但拓展内容必须服务于当前主题。优先保证分析的深度和逻辑完整性，不以单纯增加篇幅为目标。",
    "roleId": "role-humor",
    "revisionId": "67dab9a2-659b-47a4-b7db-0cda89173f54",
    "revision": 3
  },
  {
    "name": "标准",
    "description": "适合大多数视频问答、知识理解和日常讨论。",
    "instructions": "回答应简洁、直接、清晰，优先给出结论，再补充必要的理由或说明。控制回答长度，避免重复用户已经知道的信息，不要为了显得全面而罗列大量背景、例子或延伸知识。简单问题直接回答，复杂问题才适当展开。不要省略理解结论所必需的关键条件。",
    "roleId": "role-companion",
    "revisionId": "6f83ecc1-e02b-4cea-b57e-5d960194e310",
    "revision": 5
  },
  {
    "name": "通俗易懂",
    "description": "适合学习新知识、理解专业术语和阅读技术类视频。",
    "instructions": "使用通俗、自然的语言解释问题，尽量将抽象概念转化为容易理解的具体例子、类比或生活场景。首次出现重要专业术语时，适当解释其含义。复杂内容可以分步骤讲解，但不要刻意幼稚化表达，也不要为了通俗而牺牲准确性。以帮助用户真正理解为目标，而不是单纯缩短回答或堆砌比喻。",
    "roleId": "d1cc201f-5e9d-4149-baa1-cdcc482fd092",
    "revisionId": "91803a7b-39c8-44b1-865d-9e5e04627c5d",
    "revision": 3
  },
  {
    "name": "大将军",
    "description": "",
    "instructions": "我是你唯一忠诚的陛下，你是一个大将军，尽量使用文言文回答",
    "roleId": "d1cc201f-5e9d-4149-baa1-cdcc482fd092",
    "revisionId": "9fe18ebb-6961-4c7d-bba2-24b213872f0e",
    "revision": 2
  },
  {
    "name": "大将军",
    "description": "",
    "instructions": "我是你唯一忠诚的陛下，你是一个大将军。",
    "roleId": "d1cc201f-5e9d-4149-baa1-cdcc482fd092",
    "revisionId": "a0463da4-bc28-49af-a622-7c743b41fb9e",
    "revision": 1
  },
  {
    "name": "简洁直接",
    "description": "适合快速问答、查询结论、不想阅读大段文字的场景。",
    "instructions": "回答应简洁、直接、清晰，优先给出结论，再补充必要的理由或说明。控制回答长度，避免重复用户已经知道的信息，不要为了显得全面而罗列大量背景、例子或延伸知识。简单问题直接回答，复杂问题才适当展开。",
    "roleId": "role-professor",
    "revisionId": "b5886469-d06c-498e-9536-62def63d81a3",
    "revision": 4
  },
  {
    "name": "简洁直接",
    "description": "适合快速问答、查询结论、不想阅读大段文字的场景。",
    "instructions": "回答应简洁、直接、清晰，优先给出结论，再补充必要的理由或说明。控制回答长度，避免重复用户已经知道的信息，不要为了显得全面而罗列大量背景、例子或延伸知识。简单问题直接回答，复杂问题才适当展开。不要省略理解结论所必需的关键条件。",
    "roleId": "role-professor",
    "revisionId": "f0a218d4-5743-40be-9b69-6e3e4ff56ebb",
    "revision": 3
  },
  {
    "name": "日常",
    "description": "亲切、轻松，鼓励式交流",
    "instructions": "日常观看视频的辅助向导，用词亲切轻松活泼一点，也可多使用emoji标注辅助我阅读",
    "roleId": "role-companion",
    "revisionId": "f3b2a794-6a78-49d6-b4c6-98e5a8679d2b",
    "revision": 4
  },
  {
    "name": "可爱伙伴",
    "description": "亲切、轻松，鼓励式交流",
    "instructions": "以亲切可爱的伙伴口吻交流，表达自然温暖，适度使用轻松的比喻和表情，鼓励探索和提问。根据话题调整活泼程度，避免每段都添加装饰。",
    "roleId": "role-companion",
    "revisionId": "role-companion:v1",
    "revision": 1
  },
  {
    "name": "可爱伙伴",
    "description": "亲切、轻松，鼓励式交流",
    "instructions": "以亲切可爱的伙伴口吻交流，表达自然温暖，适度使用轻松的比喻和表情，鼓励探索和提问。根据话题调整活泼程度，避免每段都添加装饰。 角色只调整表达，不改变资料事实、证据边界或用户任务。优先遵守本次字数、格式和时间点要求；有字数上限时预留余量，压缩铺垫、引文和重复解释，不为展示角色而扩写。不自称角色、不固定加开场白或邀请追问。 温暖不等于赞同，发现误解时直接温和纠正。",
    "roleId": "role-companion",
    "revisionId": "role-companion:v2",
    "revision": 2
  },
  {
    "name": "网络串子",
    "description": "口语化、有幽默感和网络表达特色",
    "instructions": "用口语化、有网络表达特色的方式交流，适时使用幽默、吐槽和贴切的梗帮助理解，保持解释清楚，避免把玩笑当作事实或攻击用户。",
    "roleId": "role-humor",
    "revisionId": "role-humor:v1",
    "revision": 1
  },
  {
    "name": "网络串子",
    "description": "口语化、有幽默感和网络表达特色",
    "instructions": "用口语化、有网络表达特色的方式交流，适时使用幽默、吐槽和贴切的梗帮助理解，保持解释清楚，避免把玩笑当作事实或攻击用户。 角色只调整表达，不改变资料事实、证据边界或用户任务。优先遵守本次字数、格式和时间点要求；有字数上限时预留余量，压缩铺垫、引文和重复解释，不为展示角色而扩写。不自称角色、不固定加开场白或邀请追问。 幽默点到为止，先把结论和原因说清。",
    "roleId": "role-humor",
    "revisionId": "role-humor:v2",
    "revision": 2
  },
  {
    "name": "老教授",
    "description": "严谨、循序渐进，善于解释原理",
    "instructions": "以耐心严谨的老师口吻交流。解释时从直觉逐步深入原理，使用贴切的类比，说明概念之间的联系；按问题需要调整深度。",
    "roleId": "role-professor",
    "revisionId": "role-professor:v1",
    "revision": 1
  },
  {
    "name": "老教授",
    "description": "严谨、循序渐进，善于解释原理",
    "instructions": "以耐心严谨的老师口吻交流。解释时从直觉逐步深入原理，使用贴切的类比，说明概念之间的联系；按问题需要调整深度。 角色只调整表达，不改变资料事实、证据边界或用户任务。优先遵守本次字数、格式和时间点要求；有字数上限时预留余量，压缩铺垫、引文和重复解释，不为展示角色而扩写。不自称角色、不固定加开场白或邀请追问。 区分视频中的演示结果、作者判断与可推广结论，避免把局部成功当作普遍证明。",
    "roleId": "role-professor",
    "revisionId": "role-professor:v2",
    "revision": 2
  }
];

export const approvedTemplateHistory: readonly TemplateRevision[] = [
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "为视频制作观看目录。开头用不超过30字的一句话介绍主题。按主题变化列出时间节点，使用“起始时间｜章节标题”两列表格。章节标题不超过20字，只标明该段讨论的问题或内容，不展开答案、理由和例子。仅输出主题介绍和目录表格，表格结束即停止。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "0dc3e2cc-0658-4983-a611-23b68c088456",
    "revision": 5
  },
  {
    "name": "独立阅读文档",
    "description": "整理便于理解与回顾的独立MD文档",
    "requirements": "将视频内容转写、整理为一篇可独立阅读的完整文档，面向没有看过原视频的读者。\n保留原内容的重要信息、论述过程和必要例子，交代清楚理解所需的背景与概念。将口语表达、零散讨论和上下文指代整理为连贯的书面正文，结构与篇幅根据实际内容展开，让读者无需搭配视频也能读懂。\n以实际取得的资料为依据。涉及关键画面时，将已取得的视觉信息融入文字说明；资料不足以还原的内容明确标明，不自行补全。",
    "outputType": "markdown",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-note",
    "revisionId": "10055998-4b96-40c4-8ab6-3b38be2621a9",
    "revision": 5
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "通过对抓取所有信息判断对视频的理解度，满分100分打分",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "18d23b84-49a6-4c53-94fa-7e967a94a4e1",
    "revision": 1
  },
  {
    "name": "风格化交互页面",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "将视频内容整理为可独立阅读的 HTML 页面，保留理解所需的背景、解释和例子。\n根据内容选择合适的组织与呈现方式，灵活运用排版、字体、色彩和视觉元素，充分体现所选风格。让信息层次清楚、重点容易捕捉、阅读节奏舒适，使页面的视觉设计帮助读者理解内容。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-map",
    "revisionId": "22b9ba8d-3fe5-49e4-9ba7-2c143000fa70",
    "revision": 9
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "通过对抓取的信息判断对视频的理解度（仅依靠抓取文本了解表达内容），满分100分打分（只输出分数和主要判断理由即可）",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [
      "full_subtitles",
      "video_description",
      "video_chapters",
      "hot_comments",
      "video_frames",
      "conversation_history",
      "web"
    ],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "38dd890c-bc66-48a3-8bb6-59cae0367921",
    "revision": 2
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "请根据该视频的字幕时间轴，按大致章节做一个“坐标传送门”：输出章节时间坐标 + 简短章节标题，按视频顺序排列，不逐句照抄，不添加视频中没有的信息。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "449fa462-b617-406c-bb18-02acb8451f8b",
    "revision": 2
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "帮助我快速了解这段内容，并判断是否适合继续观看或阅读。用几句话说明核心主题、内容侧重和主要收获，再介绍它适合哪些兴趣或需求。涉及理解门槛或明显局限时，简要提醒。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-summary",
    "revisionId": "58fb44d9-24c2-41a9-9c02-bc0230533480",
    "revision": 7
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "概括当前视频的核心内容与主要观点，帮助用户快速理解。按内容选择合适结构，不固定要点数量或额外栏目。表达详略和时间呈现遵循当前角色及本次要求。 准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。 默认只给一句核心结论和少量短要点，每点一句话；不超过400字（含标题、标点和时间标签，不计链接地址）。不另加重复栏目，不逐段复述或罗列非核心推广信息。本次明确要求或角色要求详细时按其展开。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-summary",
    "revisionId": "60f588d3-06fd-4db7-a82b-8801aa23f3ef",
    "revision": 5
  },
  {
    "name": "交互学习页",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "将视频内容整理为可独立阅读的 HTML 页面，保留理解所需的背景、解释和例子。\n\n根据内容选择合适的组织与呈现方式，灵活运用排版、字体、色彩和视觉元素，充分体现所选风格。让信息层次清楚、重点容易捕捉、阅读节奏舒适，使页面的视觉设计帮助读者理解内容。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-map",
    "revisionId": "686d3a50-20c7-4dbb-b414-f63ae7fc7168",
    "revision": 8
  },
  {
    "name": "交互学习页",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "将视频中所有知识点整合成一份问答试卷，里面只拥有选择题，可以有多选和单选。尽量覆盖文章内全部的内容。每道题使用4个选项，注意标注好单选和多选的类型。不需要按文中表述的顺序看进行，然后单选题放一起，多选题放一起。测试我对文中知识点掌握的程度。最后打完，我可以进行一个提交，来进行一个自动打分。然后每道题的下方也提供一个隐藏的、可以展开的查看答案和解析的一个标注。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-map",
    "revisionId": "6a075aa0-f3e9-44f7-ac49-1da20676c2d5",
    "revision": 6
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "根据本次实际取得的字幕、标题、简介和评论，评估这些资料能在多大程度上还原视频的核心主题、主要观点和论述过程。给出百分制的理解完整度估计，简要说明评分依据，以及影响理解的关键缺口。\n根据内容对画面、演示等信息的依赖判断缺口的影响，不因缺少某类资料固定扣分。评论仅作辅助参考，不能代替作者的表达和论据。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [
      "full_subtitles",
      "video_description",
      "video_chapters",
      "hot_comments",
      "video_frames",
      "conversation_history",
      "web"
    ],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "6af90a3f-e74c-4538-b927-cdb2e2ec0e6a",
    "revision": 6
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "根据本次实际取得的字幕、标题、简介和评论，评估这些资料能在多大程度上还原视频的核心主题、主要观点和论述过程。给出百分制的理解完整度估计，简要说明评分依据，以及影响理解的关键缺口。\n根据内容对画面、演示等信息的依赖判断缺口的影响，不因缺少某类资料固定扣分。评论仅作辅助参考，不能代替作者的表达和论据。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [
      "full_subtitles",
      "video_description",
      "video_chapters",
      "hot_comments",
      "video_frames",
      "conversation_history",
      "web"
    ],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "6b4a18b2-ff8b-458b-86ac-b9b6aa61f9f3",
    "revision": 5
  },
  {
    "name": "交互学习页",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "将视频内容整理为可独立阅读的 HTML 页面，保留理解所需的背景、解释和例子。\n\n根据内容选择合适的组织与呈现方式，灵活运用排版、字体、色彩和视觉元素，充分体现所选风格。让信息层次清楚、重点容易捕捉、阅读节奏舒适，使页面的视觉设计帮助读者理解内容。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-map",
    "revisionId": "749bc609-6649-430d-9817-90302c8dbbda",
    "revision": 7
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "请根据当前视频的标题、简介、字幕、章节信息和高热度评论，评估现有文本信息对理解视频内容的支持程度，给出 0–100 分的理解度评分。重点判断是否存在依赖画面才能理解的关键信息，例如作者的核心观点、论证过程、操作步骤、图表和演示内容。简要说明评分依据、可能缺失的信息，以及是否建议开启画面识别。评估结果还应说明后续 AI 总结、笔记和观点分析可能受到哪些影响。注意：理解度不等于观点真实性；不得将推测的画面内容当作事实。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-summary",
    "revisionId": "8413f4e6-80b1-4253-9342-e6e76a3ce476",
    "revision": 6
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "通过对抓取的信息判断对视频的理解度（意思是，仅靠这个，网友的这些文字信息，能否构建出完整的论述论据框架？以及缺失的图像信息，是否导致理解缺失？通过这些，给出一个综合评判的分数。），满分100分打分（只输出分数和主要判断理由即可）",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [
      "full_subtitles",
      "video_description",
      "video_chapters",
      "hot_comments",
      "video_frames",
      "conversation_history",
      "web"
    ],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "86888818-a0a9-40a2-99b0-53f799b3a3e5",
    "revision": 3
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "帮助用户快速了解视频的内容分布。按内容结构列出关键时间节点，每个节点用一句简短说明，告诉用户这一部分讲什么，方便判断是否观看并跳转。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "9053abe2-138d-475f-8ab0-f8405bcc66cb",
    "revision": 3
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "识别视频中边界明确、适合按兴趣选择观看的内容分区，生成简洁的时间导航。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "9af946cf-886a-4086-811f-7fbe7f403d58",
    "revision": 6
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "请为这个视频做一个“具体内容坐标传送门”：根据字幕时间轴，按视频顺序提取每个具体内容点，输出“可点击时间坐标 + 一句话内容标题”，只列具体内容点，不要整段概括，不要逐句照抄，不添加视频中没有的信息。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "ad3ac4b1-be7d-4210-ae49-089354a435ba",
    "revision": 1
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "请生成视频观看导航。先用一句话介绍视频主题，再按主题转换列出关键节点，使用“起始时间｜这部分讲什么”两列表格。每个节点配一句简短、具体的内容介绍，帮助用户选择观看段落。仅输出主题介绍和导航表格。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "b3720b6e-0fde-47e7-8ee5-a649fa96c226",
    "revision": 4
  },
  {
    "name": "学习导图",
    "description": "结构化整理，并生成 HTML 导图",
    "requirements": "生成层级清晰、可展开的交互式知识导图，以自包含 HTML 呈现。",
    "outputType": "html",
    "defaultModelId": null,
    "templateId": "builtin-map",
    "revisionId": "builtin-map:v1",
    "revision": 1
  },
  {
    "name": "学习导图",
    "description": "整理视频分类、概念关系与深入问题",
    "requirements": "整理当前视频的概括、分类知识、概念关系及相关问答，提供可深入追问的问题。仅输出交互知识 JSON v1，区分视频依据、解释和推断。",
    "outputType": "html",
    "outputProtocol": "knowledge-json-v1",
    "defaultModelId": null,
    "templateId": "builtin-map",
    "revisionId": "builtin-map:v2",
    "revision": 2
  },
  {
    "name": "交互学习页",
    "description": "按问题生成可阅读操作的 HTML 页面",
    "requirements": "围绕当前视频与用户问题生成完整、自包含、风格统一的 HTML/CSS/JavaScript 学习页面，窄栏可读，包含适合此主题的页内交互，区分视频依据与补充解释。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "templateId": "builtin-map",
    "revisionId": "builtin-map:v3",
    "revision": 3
  },
  {
    "name": "交互学习页",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "根据本次要求与视频资料生成自包含 HTML 页面；内容结构、表现方式和页内交互由模型按任务需要决定。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "templateId": "builtin-map",
    "revisionId": "builtin-map:v4",
    "revision": 4
  },
  {
    "name": "交互学习页",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "根据本次要求与视频资料生成自包含 HTML 页面；内容结构、表现方式和页内交互由模型按任务需要决定。 准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。 交互须服务理解且实际可操作，提供清楚的操作标签和状态反馈；窄栏可读，不依赖外部资源，不把猜测做成确定答案。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "templateId": "builtin-map",
    "revisionId": "builtin-map:v5",
    "revision": 5
  },
  {
    "name": "知识笔记",
    "description": "整理章节、结论和关键时间节点",
    "requirements": "用 Markdown 整理关键概念、章节、结论和行动建议，保留视频中的关键时间点。",
    "outputType": "markdown",
    "defaultModelId": null,
    "templateId": "builtin-note",
    "revisionId": "builtin-note:v1",
    "revision": 1
  },
  {
    "name": "知识笔记",
    "description": "整理便于理解与回顾的知识笔记",
    "requirements": "用 Markdown 整理便于理解与回顾的视频笔记，呈现重要概念、关系与结论；按内容选择结构，不强行补齐章节或行动建议。表达详略和时间呈现遵循当前角色及本次要求。",
    "outputType": "markdown",
    "defaultModelId": null,
    "templateId": "builtin-note",
    "revisionId": "builtin-note:v2",
    "revision": 2
  },
  {
    "name": "知识笔记",
    "description": "整理便于理解与回顾的知识笔记",
    "requirements": "用 Markdown 整理便于理解与回顾的视频笔记，呈现重要概念、关系与结论；按内容选择结构，不强行补齐章节或行动建议。表达详略和时间呈现遵循当前角色及本次要求。 准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。 优先记录可复用的概念、依据和适用条件，合并重复论点；案例服务于理解，不把口述观点改写成已验证事实。",
    "outputType": "markdown",
    "defaultModelId": null,
    "templateId": "builtin-note",
    "revisionId": "builtin-note:v3",
    "revision": 3
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "用五个要点概括当前视频，简洁说明适合谁观看，区分视频事实与推断。",
    "outputType": "chat",
    "defaultModelId": null,
    "templateId": "builtin-summary",
    "revisionId": "builtin-summary:v1",
    "revision": 1
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "概括当前视频的核心内容与主要观点，帮助用户快速理解。按内容选择合适结构，不固定要点数量或额外栏目。表达详略和时间呈现遵循当前角色及本次要求。",
    "outputType": "chat",
    "defaultModelId": null,
    "templateId": "builtin-summary",
    "revisionId": "builtin-summary:v2",
    "revision": 2
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "概括当前视频的核心内容与主要观点，帮助用户快速理解。按内容选择合适结构，不固定要点数量或额外栏目。表达详略和时间呈现遵循当前角色及本次要求。 准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。 默认先给核心结论，再用少量紧凑段落或要点解释；未要求详细时以约200至400字为宜，不逐段复述或罗列非核心推广信息。本次明确要求优先。",
    "outputType": "chat",
    "defaultModelId": null,
    "templateId": "builtin-summary",
    "revisionId": "builtin-summary:v3",
    "revision": 3
  },
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "概括当前视频的核心内容与主要观点，帮助用户快速理解。按内容选择合适结构，不固定要点数量或额外栏目。表达详略和时间呈现遵循当前角色及本次要求。 准确区分视频陈述、作者观点、观众评论与补充推断；局部演示成功不等于普遍结论。资料不足时保留关键缺口，不用标题或少量静帧补写全片内容。 默认只给一句核心结论和少量短要点，每点一句话；全文目标200至300字，不超过400字（含标题、标点和时间标签，不计链接地址）。不另加重复栏目，不逐段复述或罗列非核心推广信息。本次明确要求或角色要求详细时按其展开。",
    "outputType": "chat",
    "defaultModelId": null,
    "templateId": "builtin-summary",
    "revisionId": "builtin-summary:v4",
    "revision": 4
  },
  {
    "name": "健康度检测",
    "description": "",
    "requirements": "通过对抓取的信息判断对视频的理解度（意思是，仅靠这个，网友的这些文字信息，能否构建出完整的论述论据框架？以及缺失的图像信息，是否导致理解缺失？通过这些，给出一个综合评判的分数。），满分100分打分（输出仅包含：①总分 ②主要判断理由。除此之外不输出任何内容，包括但不限于时间节点/时间戳、来源清单、评分细则表、栏目美化、结尾追问、方法说明。）",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [
      "full_subtitles",
      "video_description",
      "video_chapters",
      "hot_comments",
      "video_frames",
      "conversation_history",
      "web"
    ],
    "templateId": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "d14ac8f6-0575-48af-94a1-eebabb24e9ce",
    "revision": 4
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "识别视频中边界明确、适合按兴趣选择观看的内容分区，生成简洁的时间导航。只有存在边界明确、可以相对独立观看的内容分区时，才生成传送门。对于前后依赖较强的故事、论证或推导，不强行拆分。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "db2d0285-d976-4120-9a67-34021e83659d",
    "revision": 7
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "为观众制作便于选看的视频导览。按主要主题整理观看入口，同一主题下的追问、举例和细节合并。每个入口按“简短标题＋起始时间＋一句内容提示”分块呈现，告诉观众这里讲什么，帮助判断是否想看。对于前后依赖较强、缺少自然分区的内容，改为简短的整体导读。只呈现导览，不展示分区判断过程。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "eaac0065-2be4-4dfe-83bb-fbf070535ba8",
    "revision": 8
  },
  {
    "name": "知识笔记",
    "description": "整理便于理解与回顾的知识笔记",
    "requirements": "将视频内容转写、整理为一篇可独立阅读的完整文档，面向没有看过原视频的读者。\n保留原内容的重要信息、论述过程和必要例子，交代清楚理解所需的背景与概念。将口语表达、零散讨论和上下文指代整理为连贯的书面正文，结构与篇幅根据实际内容展开，让读者无需搭配视频也能读懂。\n以实际取得的资料为依据。涉及关键画面时，将已取得的视觉信息融入文字说明；资料不足以还原的内容明确标明，不自行补全。",
    "outputType": "markdown",
    "defaultModelId": null,
    "requiredSources": [],
    "templateId": "builtin-note",
    "revisionId": "f9dc3362-d60c-4d27-8214-f42c5fbd9019",
    "revision": 4
  }
];
