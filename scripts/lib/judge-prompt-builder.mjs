/**
 * Feature 162 Phase B2 (C-4 修复) — Judge prompt 共享构造模块
 *
 * 目的：calibration runner（scripts/calibrate-glm-judge.mjs）与生产 jury（
 * scripts/eval-judge-jury.mjs）共享同一份 adversarial judge prompt 文本，
 * 避免 calibration 阈值通过的 prompt 与生产实跑 prompt 漂移导致 calibration
 * 假阳性（"calibration 通过但生产 jury 行为不同"）。
 *
 * 设计：
 *   - 仅抽取 prompt 字符串构造函数，不动 jury 主流程
 *   - eval-judge-jury.mjs 重新 export 该函数，保持向后兼容
 *   - calibrate-glm-judge.mjs 实跑路径 import 该函数
 *
 * 关联：spec FR-022/FR-023，plan §2.5，Codex 对抗审查 C-4
 */

/**
 * 构造对抗性 (adversarial) judge prompt。
 *
 * 输入：
 *   - taskPrompt: 原始 SWE-Bench-Lite 任务描述（已截断以控制 token）
 *   - diff: driver 输出的 git diff（已匿名化以去除工具身份）
 *
 * 输出：strict JSON 评分 prompt（score + rationale + issues），中文 review 视角。
 *
 * 注意：
 *   - 输出格式被多个 caller（jury / calibration runner / unit tests）依赖
 *     做 snapshot 一致性比对，**任何修改必须同步更新 snapshot 测试**
 *   - tool 身份在 diff 入参前已通过 anonymizeDiff 替换为 <TOOL>，prompt
 *     中明确告知 judge "不要尝试猜测身份"
 */
export function buildAdversarialPrompt({ taskPrompt, diff }) {
  return `你是一个**严格的代码评审者**。下面是某 AI 工具针对一个编程任务的产出 diff。
工具身份已匿名化（不要尝试猜测身份；猜测无意义）。

## 任务描述

\`\`\`
${taskPrompt}
\`\`\`

## 工具产出 git diff

\`\`\`diff
${diff}
\`\`\`

## 评分要求

按 0-10 整数评分（10=完美，5=可接受但有显著问题，1-3=严重缺陷）。综合考虑：
- **正确性**：实现是否完成任务核心目标，逻辑/数学/接口是否正确
- **边界**：是否处理关键 edge cases
- **测试**：是否有针对性测试，覆盖度
- **可读性**：命名、注释、代码结构

**关键要求**：找出该产出至少 2 个具体问题（指出具体行/逻辑/缺漏，不是泛泛批评）。
如果产出确实接近完美，说明"无显著问题"，仍给出 1-2 个可改进点。

## 输出严格 JSON（无 markdown wrapper、无前后缀文字）

{
  "score": <0-10 整数>,
  "rationale": "<2-4 句中文，说明给分依据>",
  "issues": ["<问题 1，含具体位置或方面>", "<问题 2>"]
}
`;
}
