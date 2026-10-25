import type { PromptRole } from '../contracts/role';
import type { Template } from '../contracts/template';

// Approved by the maintainer from the 2026-10-25 configuration backup.
// Keep prompt content verbatim; historical presets remain in their version archives.
export const approvedRoles: readonly PromptRole[] = [
  {
    "name": "简洁直接",
    "description": "适合快速问答、查询结论、不想阅读大段文字的场景。",
    "instructions": "回答应简洁、直接、清晰，优先给出结论，再补充必要的理由或说明。控制回答长度，避免重复用户已经知道的信息，不要为了显得全面而罗列大量背景、例子或延伸知识。简单问题直接回答，复杂问题才适当展开。",
    "id": "role-professor",
    "revisionId": "b5886469-d06c-498e-9536-62def63d81a3",
    "revision": 4,
    "builtin": true
  },
  {
    "name": "标准",
    "description": "适合大多数视频问答、知识理解和日常讨论。",
    "instructions": "回答应简洁、直接、清晰，优先给出结论，再补充必要的理由或说明。控制回答长度，避免重复用户已经知道的信息，不要为了显得全面而罗列大量背景、例子或延伸知识。简单问题直接回答，复杂问题才适当展开。不要省略理解结论所必需的关键条件。",
    "id": "role-companion",
    "revisionId": "6f83ecc1-e02b-4cea-b57e-5d960194e310",
    "revision": 5,
    "builtin": true
  },
  {
    "name": "深度分析",
    "description": "适合复杂观点、技术原理、长视频内容分析和问题研究。",
    "instructions": "对问题进行充分分析，不要停留在表面结论。根据需要解释背景、形成原因、关键机制、逻辑链条、不同观点及其成立条件，并分析重要影响和潜在局限。可以主动补充理解问题所必需的关联知识，但拓展内容必须服务于当前主题。优先保证分析的深度和逻辑完整性，不以单纯增加篇幅为目标。",
    "id": "role-humor",
    "revisionId": "67dab9a2-659b-47a4-b7db-0cda89173f54",
    "revision": 3,
    "builtin": true
  },
  {
    "name": "通俗易懂",
    "description": "适合学习新知识、理解专业术语和阅读技术类视频。",
    "instructions": "使用通俗、自然的语言解释问题，尽量将抽象概念转化为容易理解的具体例子、类比或生活场景。首次出现重要专业术语时，适当解释其含义。复杂内容可以分步骤讲解，但不要刻意幼稚化表达，也不要为了通俗而牺牲准确性。以帮助用户真正理解为目标，而不是单纯缩短回答或堆砌比喻。",
    "id": "d1cc201f-5e9d-4149-baa1-cdcc482fd092",
    "revisionId": "91803a7b-39c8-44b1-865d-9e5e04627c5d",
    "revision": 3,
    "builtin": true
  }
];

export const approvedTemplates: readonly Template[] = [
  {
    "name": "快速总结",
    "description": "快速了解内容与核心观点",
    "requirements": "帮助我快速了解这段内容，并判断是否适合继续观看或阅读。用几句话说明核心主题、内容侧重和主要收获，再介绍它适合哪些兴趣或需求。涉及理解门槛或明显局限时，简要提醒。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "id": "builtin-summary",
    "revisionId": "58fb44d9-24c2-41a9-9c02-bc0230533480",
    "revision": 7,
    "builtin": true,
    "sortIndex": 0
  },
  {
    "name": "坐标传送门",
    "description": "",
    "requirements": "为观众制作便于选看的视频导览。按主要主题整理观看入口，同一主题下的追问、举例和细节合并。每个入口按“简短标题＋起始时间＋一句内容提示”分块呈现，告诉观众这里讲什么，帮助判断是否想看。对于前后依赖较强、缺少自然分区的内容，改为简短的整体导读。只呈现导览，不展示分区判断过程。",
    "outputType": "chat",
    "defaultModelId": null,
    "requiredSources": [],
    "id": "24a93f51-992d-4c01-ac2f-3099f8f1109e",
    "revisionId": "eaac0065-2be4-4dfe-83bb-fbf070535ba8",
    "revision": 8,
    "builtin": true,
    "sortIndex": 1
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
    "id": "5e50e65f-42bc-4877-be7a-733155cd0ae4",
    "revisionId": "6af90a3f-e74c-4538-b927-cdb2e2ec0e6a",
    "revision": 6,
    "builtin": true,
    "sortIndex": 2
  },
  {
    "name": "独立阅读文档",
    "description": "整理便于理解与回顾的独立MD文档",
    "requirements": "将视频内容转写、整理为一篇可独立阅读的完整文档，面向没有看过原视频的读者。\n保留原内容的重要信息、论述过程和必要例子，交代清楚理解所需的背景与概念。将口语表达、零散讨论和上下文指代整理为连贯的书面正文，结构与篇幅根据实际内容展开，让读者无需搭配视频也能读懂。\n以实际取得的资料为依据。涉及关键画面时，将已取得的视觉信息融入文字说明；资料不足以还原的内容明确标明，不自行补全。",
    "outputType": "markdown",
    "defaultModelId": null,
    "requiredSources": [],
    "id": "builtin-note",
    "revisionId": "10055998-4b96-40c4-8ab6-3b38be2621a9",
    "revision": 5,
    "builtin": true,
    "sortIndex": 3
  },
  {
    "name": "风格化交互页面",
    "description": "根据本次要求生成 HTML 页面",
    "requirements": "将视频内容整理为可独立阅读的 HTML 页面，保留理解所需的背景、解释和例子。\n根据内容选择合适的组织与呈现方式，灵活运用排版、字体、色彩和视觉元素，充分体现所选风格。让信息层次清楚、重点容易捕捉、阅读节奏舒适，使页面的视觉设计帮助读者理解内容。",
    "outputType": "html",
    "outputProtocol": "html-page-v1",
    "defaultModelId": null,
    "requiredSources": [],
    "id": "builtin-map",
    "revisionId": "22b9ba8d-3fe5-49e4-9ba7-2c143000fa70",
    "revision": 9,
    "builtin": true,
    "sortIndex": 4
  }
];
