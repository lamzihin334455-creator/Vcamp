import type {JobView} from '../contracts/generation';
import {generationDiagnosticSchema} from '../contracts/generation-diagnostic';

/** Deliberately excludes prompts, response bodies, URLs, headers and images. */
export function failureFeedback(job:JobView,appVersion:string){
  const diagnostics=(job.diagnostics??[]).map(d=>generationDiagnosticSchema.parse(d));
  const web=job.webEvidence,visual=job.visual;
  return JSON.stringify({
    format:'vcamp-failure-feedback-v1',appVersionAtExport:appVersion,
    jobId:job.jobId,attemptId:job.attemptId,state:job.state,error:job.error,
    diagnosticStatus:diagnostics.length?'recorded':'not-recorded',
    ...(!diagnostics.length?{notice:'此任务未记录详细诊断，旧记录无法补回。更新后重试会记录新的执行阶段。'}:{}),
    diagnostics,
    ...(web?{web:{status:web.status,executionLinked:web.executionLinked,sourceCount:web.sources.length,excludedSources:web.excludedSources,usage:web.usage}}:{}),
    ...(visual?{visual:{phase:visual.phase,frameCount:visual.attachmentIds.length,resolution:visual.resolution,issue:visual.issue,mediaFailure:visual.mediaFailure,planningFailure:visual.planningFailure,planningCorrection:visual.planningCorrection,planningTokensUpperBound:visual.planningTokensUpperBound,cueGrounded:visual.cueGrounded,...(visual.review?{review:{status:visual.review.status,failure:visual.review.failure,correction:visual.review.correction,checksVersion:visual.review.checksVersion,checkedItems:visual.review.results.length,sufficientItems:visual.review.results.filter(r=>r.status==='sufficient').length,checkedTargets:visual.review.results.reduce((n,r)=>n+(r.checks?.length??0),0),confirmedTargets:visual.review.results.reduce((n,r)=>n+(r.checks?.filter(c=>c.status==='confirmed').length??0),0),repairs:visual.review.repairs.map(r=>({state:r.state}))}}:{})}}:{}),
    coverage:job.coverage,mediaDuration:job.mediaDuration
  },null,2);
}

export function installedVersion(){
  try{return chrome.runtime.getManifest().version;}catch{return 'unknown';}
}
