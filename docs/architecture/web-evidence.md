# T14 联网与来源契约

现行0.1.28：可信执行器验证冻结分析源，把完整可用字幕及覆盖信息复用到关键词规划和最终回答；与问题、标题和所选知识最小片段一起外发，原材料不持久化。现有请求字符上限适用，不以静默截断替代完整输入。材料输入不证明相关性，真实服务仍待更新后复验，见本次修复报告（历史内部记录，未纳入公开源码：`../reports/web-direct-search-2026-10-21.md`）。

W12-T14-01 允许产品实现；依据归档的 WEB-04 最小实测证据（历史内部记录，未纳入公开源码：`../launch/evidence/WEB-04-approved-result.json`），实测 TARGET `9312d114e6d05e10b0139a8aa7aa4e867ce5ac32`、REPORT `904fe04a4fc5c1f80284c00d41bbeb99c9561add`。这只解除路线阻塞，不代表开放领域真实性、完整R3或产品真实联网验收通过。WEB-04旧parser拒绝url-grammar、费用未知、fragment定位未核验等限制保留；本实现没有移植实验网址白名单、终端审核或网页GET。

当前Chat开关存入其Draft可选`webEnabled`；缺值关闭。能力目录、模板要求、模型规划和用户提问意图均不构成联网授权。`vcamp.webDefault`是可信local设置，用于以后新建Chat；用户修改默认值时也同步当前可见Chat，之后各Chat可独立覆盖，不导出服务设置。发送冻结当前开关、所选回答模型、视频标题及`WebOptions`：DeepSeek / deepseek-flash / deepseek-search-v2、最多1次搜索、1024输出tokens上限、30秒。重试只新增attempt、沿用原snapshot和已冻结视觉依据；旧deepseek-native-v1快照保持可读，实际由同服务的新适配器执行并记录真实route。当前Chat仍开启联网才允许原联网任务重试；排队执行、关键词规划前及规划后搜索前均检查开关。每次允许的重试重新检索，旧attempt或历史来源不当作本次证据。

`WebEvidencePort.retrieve({options,question,videoTitle,videoContext?},signal)`返回`{evidence,material}`。可信执行器读取Key，先用确切deepseek-flash生成严格JSON关键词（512tokens／1024字符、无工具参数），再由应用显式POST原服务同host的`/v1/tools/search`，`count=5,need_content=false`。query限1至128个Unicode字符；ori_question仅在原问题本身符合该限制时发送。规划和一次搜索共用30秒，不再调用原生工具循环。回答仍用所选模型，指令查看器分别显示规划和实际搜索；模型与搜索分别可能计费，总金额未知。关闭时不调用检索端点；不会为每个字幕段、视觉规划或图片重复搜索。没有来源立即失败，无自动重试、续轮或离线降级。HTTP400/422、端点404、鉴权、限流、超时及格式错误分别映射固定错误码。

响应限1MiB、严格UTF-8/JSON，解析独立Search的results，最多接受50个候选、5个唯一且有summary或snippet摘录的来源；可空标题和官方附加元数据合法。不以计划文字或标题代替摘录，不依赖stop_reason或服务内部工具次数。来源存储契约仍允许读取旧版20来源，正文引用上限40。普通HTTPS主机来源保留完整原始URI/query/fragment，标题仅展示、缺值回退域名；排除userinfo、控制字符、非法编码、明显凭据参数、localhost/本机域及IP字面地址。这里采用保守的主机名链接边界，不执行DNS/抓站/通用网址审查。URL不会变成权限或业务命令。链接由用户点击新页打开，noopener/noreferrer/no-referrer；未新增任意站点读取权限。

`WebEvidence` v1保存状态、检索时间、`executionLinked`、`sources[{id,uri,title?}]`、`references[{uri,sourceId|null}]`、排除数量及已报告数值usage。只保存最小元数据；材料限8000字符、去除其中URL后作为不可信资料交最终生成、随后丢弃；raw响应/网页不入库。模型引用按正文显式HTTP(S) URI逐字匹配本次来源，不做URL归一化。非法正文链接导致web-protocol，不写成功。自动引用编号、无显式URI的陈述不推测为已引用；引文匹配不验证事实或片段定位。

| 状态 | 产品含义 |
| --- | --- |
| searching | 正在等待真实检索响应，无伪流进度 |
| retrieved | 有本次关联来源，最终回答尚未成功 |
| cited | 回答显式链接全部逐字对应本次来源 |
| uncited | 有来源，回答未显式引用链接 |
| unmatched | 回答存在未对应本次来源的安全链接，明确未核对 |
| failed | 检索未完成即停止、失败或中断 |

后续回答失败可保留retrieved及任务失败原因；不会冒充cited或成功成果。0.1.29起，正文下方只显示默认折叠的“来源（数量）”，展开后展示本次来源链接；不再显示检索日期、记录、费用提示或重复引用列表，无来源时不渲染空框。来源状态、时间、用量及引用关系仍按原契约保存，故障详情入口保留。Chat视频`[mm:ss]`复用既有seek命令。Markdown只做可信渲染；T09保持严格JSON v1，网页补充放解释/推断文本，来源区独立，不增加任意HTML/脚本或资源字段。

同一signal贯穿检索和原生成链；停止／删除／旧attempt检查在写事务内生效。`webEvidence`检查点同步attempt与assistant；finish原子核来源、计算引用关系并保存终态与成果。取消检索改failed；删除或导入运行态同样收敛，不接受迟到回写、不重新联网。本次维持已有DB9、backup format5，无清库或迁移；导入核身份/关系、冲突重映射、往返见[备份契约](backup.md)。

验收边界：定向单测覆盖三种输出+手动PNG/T16冻结PNG、分段不重复传证据、取消/删除/导入中断与备份往返；安装受控HTTP覆盖Chat/Markdown/知识、真实执行器T16无需帧规划、重开、取消/失败/原快照重试及旧format2文件导入。未重做实站取帧矩阵；真实服务组合质量、事实准确性、计费及完整T22 not-run。

2026-10-21 / 0.1.26：现行状态联动、解析兼容与最小诊断、时间轴校验和真实服务验证边界见修复报告（历史内部记录，未纳入公开源码：`../reports/web-state-timeline-2026-10-21.md`）。

2026-10-21 / 0.1.27：搜索前计划文字不作为网页摘录；补充HTTP/工具失败分类、最近18项诊断保留和复制/下载入口。旧任务没有的诊断不补造，反馈版本是导出时版本。见联网失败续修报告（历史内部记录，未纳入公开源码：`../reports/web-tool-recovery-2026-10-21.md`）。

2026-10-21 / 0.1.28：HTTP200真实诊断在原生响应envelope校验失败；改用关键词规划及应用控制的一次独立Search，实际诊断为adapter3／deepseek-search-v2。旧原生工具块规则为历史实现，已不用于新执行或重试。见独立搜索修复报告（历史内部记录，未纳入公开源码：`../reports/web-direct-search-2026-10-21.md`）。
