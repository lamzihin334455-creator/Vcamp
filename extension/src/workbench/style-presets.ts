import {htmlStyles} from '../contracts/html-style';
import type {PromptStyle,StyleRevision} from '../contracts/style';
export const presetStyles:PromptStyle[]=Object.entries(htmlStyles).filter(([id])=>id!=='default').map(([id,style])=>({id:`builtin-style-${id}`,revisionId:`builtin-style-${id}:v1`,revision:1,builtin:true,name:style.label,description:style.instructions}));
export const retiredStyleIds=new Set(['builtin-style-skeuomorphic']);
// Historical requests and backups retain their original immutable description.
export const allPresetStyles:PromptStyle[]=[...presetStyles,{id:'builtin-style-skeuomorphic',revisionId:'builtin-style-skeuomorphic:v1',revision:1,builtin:true,deleted:true,name:'拟物风',description:'采用适度拟物设计：纸张、卡片或实体控件的材质、光影与层次，触感明确而装饰克制。保持文字对比、触控尺寸和操作反馈。'}];
export const presetStyleRevisions:StyleRevision[]=allPresetStyles.map(({id:styleId,builtin:_builtin,deleted:_deleted,...revision})=>({...revision,styleId}));
export function resolveStyleRevision(styleId:string,revisionId:string,stored:readonly StyleRevision[]){return stored.find(row=>row.styleId===styleId&&row.revisionId===revisionId)??presetStyleRevisions.find(row=>row.styleId===styleId&&row.revisionId===revisionId);}
