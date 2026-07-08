# fix-compliance 测试 fixture 索引

手工构造的最小 transcript JSONL 片段（每行一个 Claude Code 会话 envelope 对象），供
`fix-compliance-core.test.mjs` / `fix-compliance-io.test.mjs` 断言判定逻辑。**不含真实敏感数据**。

envelope 结构参照 research.md「实测校准记录（T001）」：顶层 `type: "user"|"assistant"`；
`message.content` 为字符串或内容块数组；文本块 `{type:"text",text}`；工具调用块
`{type:"tool_use",name,input}`（assistant）；工具结果 `{type:"tool_result",...}`（挂 user，反伪造排除对象）。

## fixture 命名与用途

| 文件 | 场景 | 期望判定 |
|------|------|---------|
| `collapsed-zero-delegation.jsonl` | fix 展开 + 0 委派 + 无制品 + 纯文本收口（F206 核心坍塌） | 不合规（undetermined） |
| `compliant-full.jsonl` | fix 展开 + implement+verify 委派 + fix-report.md(Root Cause)+verification-report.md | 合规（repair） |
| `compliant-noop.jsonl` | fix 展开 + 1 次 no-op 核实类委派 + no-op 精简报告(判定依据) | 合规（no-op） |
| `noop-zero-delegation.jsonl` | no-op 报告但 0 委派 | 不合规（缺 delegation:noop-verify） |
| `malformed-transcript.txt` | 损坏/非 JSON | FR-013 fail-open |
| `placeholder-shell.jsonl` | 判定依据章节仅含 `{...}` 占位符 + 1 no-op 委派 | 不合规（artifact:placeholder） |
| `role-mismatch.jsonl` | 仅 1 次非 implement/verify 类委派冒充完整收口 | 不合规（缺角色委派） |
| `multi-expansion.jsonl` | feature 展开后再 fix 展开（含 fix 前的历史委派） | 最新展开=fix，仅统计 fix 锚点后委派 |
| `non-fix-session.jsonl` | 仅 feature 展开 | 非 fix 会话，零接触 |
| `fake-anchor-in-tool-result.jsonl` | tool_result 内伪造 spec-driver-story 展开痕迹 | 反伪造：锚定仍为 fix |
| `compliant-full-canonical-chinese-no-subagent-type.jsonl` | 中文 description + 无 subagent_type 的完整合规 | 合规（防假阻断回归） |
| `role-mismatch-plan-tasks-fix-word.jsonl` | plan/tasks 委派 desc 含「修复」但非「代码修复」 | 不归 implement 类（窄模式精确切分） |

## 约定

- fixture 中的特性目录路径统一用 `specs/301-fix-sample-bug`（generic，非真实 feature 号）
- 制品磁盘核验所需内容由测试用例以字符串直接提供给 `judgeCompliance`（fixture 只承载 transcript 侧信号），
  或由测试用临时目录动态铺制品，保证测试自包含可重复
</content>
</invoke>
