import {z} from 'zod';
export const htmlStyleSchema=z.enum(['default','apple','swiss','neumorphic','editorial','brutalist']);
export type HtmlStyle=z.infer<typeof htmlStyleSchema>;
export const htmlStyles:Record<HtmlStyle,{label:string;instructions:string}>={
 default:{label:'默认',instructions:''},
 apple:{label:'苹果风',instructions:'采用克制的现代苹果风：充足留白、清晰字号层级、柔和圆角、精致细线与少量半透明层次。优先阅读与操作，不复制品牌标识。'},
 swiss:{label:'瑞士风',instructions:'采用瑞士国际主义排版：明确网格、非对称编排、强对比无衬线标题、克制配色与精确对齐。让信息层级清楚。'},
 neumorphic:{label:'新拟态',instructions:'采用新拟态设计（Neumorphism）：背景与控件使用接近的柔和底色，以成对的柔和高光和阴影形成浅浮起或内凹层次，克制圆角和装饰。不模仿纸张、皮革等真实材质；确保文字对比、控件边界、键盘焦点及按下状态清楚。'},
 editorial:{label:'杂志风',instructions:'采用编辑式杂志设计：醒目的标题、富有节奏的图文分区、细致的注释与留白。窄屏改为单列，正文保持易读。'},
 brutalist:{label:'新粗野风',instructions:'采用新粗野主义设计：大胆字号、高对比色块、实线边框与硬阴影，交互明确。避免装饰压过正文。'}
};
