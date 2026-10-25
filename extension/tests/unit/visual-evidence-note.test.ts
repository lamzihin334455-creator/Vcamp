import {expect,test} from 'vitest';
import {visualEvidenceNote} from '../../src/generation/visual-evidence-note';
import type {VisionStage} from '../../src/contracts/vision';

test('final evidence context carries original provenance and gaps without repeating fallible OCR observations',()=>{
  const visual={phase:'answering',resolution:'images',attachmentIds:[],audit:{frames:[],historyAttachmentIds:[],unresolved:['未确认结果'],stopReason:'local-selection-complete'},evidencePlan:{evidence:[{id:'e1',need:'观察结果外观',mode:'single',detailNeed:'overview'}]},review:{status:'complete',results:[{evidenceId:'e1',status:'partial',observations:['WRONG_OCR_40px'],missing:'复选框被遮挡'}],repairs:[]}} as unknown as VisionStage;
  const note=visualEvidenceNote(visual);expect(note).toContain('复选框被遮挡');expect(note).toContain('overview');expect(note).toContain('未确认结果');expect(note).not.toContain('WRONG_OCR_40px');
  expect(visualEvidenceNote({...visual,resolution:'subtitle'})).toContain('自主画面未作为回答依据');
});
