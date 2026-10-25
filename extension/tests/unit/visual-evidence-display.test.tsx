import {expect,test} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {VisualEvidence} from '../../src/workbench/VisualEvidence';
import {allocateVisualPlan} from '../../src/generation/visual-selection';
import {visualEvidenceNote} from '../../src/generation/visual-evidence-note';
import type {JobView,ChatRequestSnapshot} from '../../src/contracts/generation';
import type {EvidencePlan,VisionStage} from '../../src/contracts/vision';

test('final images do not inherit confirmation or observations from the replaced image',()=>{
  const plan:EvidencePlan={version:2,scope:'focused',needsNewFrames:true,evidence:[{id:'e1',need:'核对外观',priority:'required',mode:'single',reuseAttachmentIds:[],detailNeed:'overview',reason:'核对主要画面',windows:[{from:1,to:3,anchor:2,cueIds:[0],basis:'subtitle'}]}],unresolved:[]};
  const snapshot={target:{kind:'chat'},attachmentIds:[],historyProjection:[]} as unknown as ChatRequestSnapshot;
  const audit=allocateVisualPlan(plan,snapshot,[],'','');
  audit.frames=[{slotKey:'e1_0',attachmentId:'new',time:2.5,detail:'original'}];
  audit.slots[0].detailReason='第二阶段按明确缺口补帧，保留清晰细节；补后未再次独立核验';
  audit.candidates=[{slotKey:'e1_0',time:2,width:2,height:2,bytes:100,quality:.5,decision:'superseded'}];
  const visual:VisionStage={phase:'answering',resolution:'images',attachmentIds:['new'],audit,evidencePlan:plan,review:{version:1,status:'complete',images:[],results:[{evidenceId:'e1',status:'partial',imageRefs:['i0'],observations:['OLD_CONFIRMED_OBSERVATION'],checks:[{checkId:'c0',target:'颜色',status:'confirmed',imageRefs:['i0'],observation:'OLD_CONFIRMED_OBSERVATION'},{checkId:'c1',target:'边框',status:'unreadable',imageRefs:['i0'],observation:'旧图看不清'}],missing:'边框：看不清',refinements:[]}],repairs:[{slotKey:'e1_0',state:'captured-unverified',window:plan.evidence[0].windows[0],originalWindow:plan.evidence[0].windows[0]}],refinementNotes:['内部补图取舍']}};
  const job={state:'completed',visual} as JobView;
  const html=renderToStaticMarkup(<VisualEvidence job={job}/>);
  expect(html).toContain('边框：看不清');expect(html).toContain('2.500');
  expect(html).not.toMatch(/补帧|补图|补前|OLD_CONFIRMED_OBSERVATION|颜色：已确认/);
  expect(visual.review!.results[0].checks![0].status).toBe('confirmed');
  const note=visualEvidenceNote(visual);expect(note).toContain('不能把旧图观察当成新图已确认内容');
  expect(note).toContain('不等于独立实测证明像素完全一致');expect(note).toContain('行为不能用单张状态图确认');
});
