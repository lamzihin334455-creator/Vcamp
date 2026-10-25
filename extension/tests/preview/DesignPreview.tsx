import { useState } from 'react';
import { Icon } from '../../src/app/Icons';
import '../../src/app/styles.css';
import './design.css';
/** Deliberately isolated from App, clients, persistence and production entrypoints. */
export function DesignPreview() {
  const [tab, setTab] = useState('html'), [initializing, setInitializing] = useState(false), [vision, setVision] = useState(false);
  return <div className="design-preview"><header><strong>阶段一 · 待确认交互示意</strong><small>独立演示，无服务请求、无偏好保存</small></header><nav>{[['html','HTML 页面'],['vision','视频理解'],['scribble','随笔时间块'],['switch','视频切换']].map(([id,label]) => <button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</nav>
    {tab==='html' && <section><div className="design-context"><span><Icon name="html"/>渲染方式交互学习页</span><button onClick={()=>setInitializing(!initializing)}>初始化示意</button></div><p className="design-caption">真实 HTML 引擎与初始化待阶段二实现。以下是页面内容与确认状态的设计示意。</p>{initializing ? <div className="design-card"><h2>重新初始化页面？</h2><p>建议恢复页面初始交互状态，已保存的原始 HTML 保持不变。具体行为待阶段二确定。</p><button onClick={()=>setInitializing(false)}>返回页面示意</button></div> : <article className="design-card"><small>VIDEO LEARNING / 01</small><h1>从内容到交互</h1><p>理解 SSR 与 CSR，选择适合当前页面的渲染方式。</p><div className="design-grid"><div><b>SSR</b><p>服务器先生成页面内容</p></div><div><b>CSR</b><p>浏览器完成页面渲染</p></div></div><details><summary>思考：内容展示与复杂交互如何取舍？</summary><p>结合首屏内容、状态更新与用户操作频率。</p></details></article>}</section>}
    {tab==='vision' && <section className="design-card"><small>设置 / 视频理解 · 移位建议</small><h1>视频理解</h1><label><input type="checkbox" checked={vision} onChange={e=>setVision(e.target.checked)}/>自主识别画面（示意）</label><p>需要时根据问题规划画面。实际请求仍需单独确认取帧权限及额外费用。</p><p className="design-caption">建议将开关放在此处；生产版保留输入区“视频能力”入口，等待确认。</p></section>}
    {tab==='scribble' && <section className="design-card"><small>随笔 / 时间块示意</small><h1>边看边记</h1><div className="design-time"><span>02:05</span><p>先明确页面目标，再决定渲染方式。<br/>首屏展示与后续交互需要分别考虑。</p></div><div className="design-time"><span>无时间</span><p>补充自己的想法，保持简短。</p></div><p className="design-caption">时间来自真实记录；生产中仍调用现有定位服务。此页只展示布局。</p></section>}
    {tab==='switch' && <section className="design-card"><div className="design-switch"><i/>正在切换视频…</div><h1>新内容即将就绪</h1><p>采用短状态条提示实际切换过程，已保存草稿仍按原视频与对话归属。</p></section>}
  </div>;
}
