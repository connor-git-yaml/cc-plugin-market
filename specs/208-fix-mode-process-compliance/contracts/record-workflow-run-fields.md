# 合同：`record-workflow-run.mjs` 新增可选字段（FR-014）

**修改文件**：`plugins/spec-driver/scripts/record-workflow-run.mjs`（现有 332 行，本次新增约 40-70 行）

## 向后兼容契约（不可违反）

1. 未传入任何新增 CLI flag / `options.complianceVerdict` 时，`recordWorkflowRun()` 产出的事件对象**逐字节**与改动前一致（新增字段不出现，而非出现为 `null`）。
2. 现有 5 个调用方（`spec-driver-fix` / `spec-driver-story` / `spec-driver-implement` / `spec-driver-doc` / `spec-driver-resume` 五个 SKILL.md 中的既有调用文本）**逐字不变**，不修改其调用参数。
3. `VALID_RESULTS` 枚举（`success`/`partial`/`paused`/`failed`）不变，不新增/不删除取值。

## 新增能力

### 新增 CLI flag（供编程调用等价传参，本次唯一实际使用者是 `fix-compliance-judge.mjs` 的降级放行分支，见下）

| flag | 类型 | 说明 |
|------|------|------|
| `--compliance-closure-form <repair\|no-op\|undetermined>` | string | 对应 `complianceVerdict.closureForm` |
| `--compliance-compliant <true\|false>` | boolean（字符串解析） | 对应 `complianceVerdict.compliant` |
| `--compliance-missing <逗号分隔列表>` | string | 对应 `complianceVerdict.missing`，复用现有 `splitList()` helper |
| `--compliance-degraded <true\|false>` | boolean（字符串解析） | 对应 `complianceVerdict.degraded` |
| `--compliance-block-count <N>` | number | 对应 `complianceVerdict.blockCount` |

### 编程调用（推荐路径，供 hook 内 in-process 调用，避免额外子进程开销）

```js
import { recordWorkflowRun } from './record-workflow-run.mjs';

recordWorkflowRun({
  projectRoot,
  workflowId: 'spec-driver-fix',
  runId: sessionId,
  result: 'failed',
  completedPhases: [],
  warnings: ['[GATE-DEGRADED] fix 会话在 3 次不合规尝试后降级放行，缺失: fix-report.md'],
  complianceVerdict: {
    closureForm: 'undetermined',
    compliant: false,
    missing: ['fix-report.md'],
    degraded: true,
    blockCount: 2,
  },
});
```

### 事件字段新增

```jsonc
{
  // ...既有字段不变...
  "complianceVerdict": {   // 仅显式传参时出现
    "closureForm": "repair | no-op | undetermined",
    "compliant": false,
    "missing": ["fix-report.md"],
    "degraded": true,
    "blockCount": 2
  }
}
```

## 唯一生产调用方说明

本次范围内，`complianceVerdict` 字段的**唯一生产写入路径**是 `fix-compliance-judge.mjs` 在"降级放行"（同一会话第 3 次及以后仍不合规但因阻断上限触发放行）分支中的编程调用。fix SKILL.md 自身既有的"运行事件记录"步骤（正常收口路径）**不修改**，不传入任何 `--compliance-*` flag（理由见 research.md D4：避免在模型可直接执行的 Bash 步骤中引入判据自证）。
