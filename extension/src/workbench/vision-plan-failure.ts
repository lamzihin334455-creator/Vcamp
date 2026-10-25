import type {VisionPlanFailure} from '../contracts/vision';

const reasons:Record<VisionPlanFailure['code'],string>={
  'invalid-json':'规划正文未通过 JSON 语法解析',
  'invalid-schema':'规划字段类型、必填项或长度不符合要求',
  'unsupported-version':'规划协议版本不受支持',
  'invalid-duration':'视频时长无效',
  'duplicate-id':'证据编号重复',
  'invalid-reuse':'引用了不可用或重复的已有图片',
  'invalid-group':'对比或过程证据的画面数量不完整',
  'over-budget':'规划的完整证据组超出本次可用取帧槽位',
  'invalid-window':'时间窗口越界、顺序或锚点无效',
  'invalid-cue':'字幕引用无效或与窗口不相交',
  'inconsistent-flags':'是否需要新截图与窗口内容不一致'
};
export function visionPlanFailureText(failure:VisionPlanFailure){
  const syntax=failure.syntax;
  return reasons[failure.code]+(syntax?.line!==undefined&&syntax.column!==undefined?`（第 ${syntax.line} 行，第 ${syntax.column} 列）`:'');
}
