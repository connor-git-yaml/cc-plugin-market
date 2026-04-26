---
feature_id: "133"
phase: "7c"
verification_version: "1.0"
created_at: "2026-04-26"
gate_verify_recommendation: "FIX_REQUIRED"
---

# Feature 133 验证报告（Phase 7c）

## §1 工具链验证矩阵

| 命令 | 退出码 | 关键输出摘要 |
|------|--------|------------|
| `npm run lint` | **0** | `tsc --noEmit` 零错误 |
| `npm run build` | **0** | `tsc` 零错误，d3 内联无变化 |
| `npx vitest run` | **0** | 220 test files / 2155 tests passed，0 failed |
| `node --test plugins/spec-driver/tests/orchestrator.test.mjs` | **0** | 35 tests / 0 fail（含 T-025 Base Zod 回归组） |
| `node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs` | **0** | 21 tests / 0 fail（T1/T2/T3/T4 全组） |
| `npm run repo:check` | **0** | 所有检查项通过，含 `orchestration-overrides:overrides-file-exists: pass` |
| `npm run release:check` | **0** | Release contract valid |

**工具链结论：7/7 命令全部通过，退出码均为 0，零失败。**

---

## §2 端到端 Sanity 矩阵

### 场景 A：覆盖生效测试

**测试配置**：复制 `plugins/spec-driver/templates/orchestration-overrides.example.yaml` 到 `.specify/orchestration-overrides.yaml`（仅示例一有效：`GATE_DESIGN.default_behavior: auto`，示例二三已注释）

| 子测试 | 命令 | 结果 | 状态 |
|--------|------|------|------|
| fieldSources 含 overrides 来源 | `effective-orchestration fix --format json` | `fieldSources["gates.GATE_DESIGN.default_behavior"]: "overrides"` | PASS |
| annotate 注释来源 | `effective-orchestration fix --annotate` | stdout 含 `GATE_DESIGN: # source: overrides` 和 `default_behavior: auto # source: overrides` | PASS |
| 清理后 git 状态 | `rm .specify/orchestration-overrides.yaml` | git status clean，无残留文件 | PASS |

**备注**：example.yaml 中示例二（fix mode 整段重写）被注释掉，实际效果仅覆盖 GATE_DESIGN。在以独立 temp 目录写入含 fix 整段重写的 overrides 时验证（见 AC-001）。

### 场景 B：降级路径实测

**测试配置**：写入 `modes.fxi: { phases: [] }`（非 reserved mode 名）

| 子测试 | 命令 | 结果 | 状态 |
|--------|------|------|------|
| stderr 含 schema-fallback warning | `get-phases feature` | stderr: `orchestration-overrides.schema-fallback: [orchestration-overrides] overrides 校验失败，将使用 base 配置：字段 "modes"：包含未识别的字段 [fxi]` | PASS |
| 进程退出码 0 | 同上 | EXIT:0 | PASS |
| validate module status | `validateOrchestrationOverrides()` 直接调用 | `{"status":"error","errors":["schema 校验失败：..."],"warnings":[]}` | PASS |
| 清理后 git 状态 | `rm .specify/orchestration-overrides.yaml` | CLEAN | PASS |

### 场景 C：W-007 Bug 复现

**测试配置**：写入 `version: "99.0"` + `GATE_DESIGN.default_behavior: auto`（version 不一致）

| 子测试 | 命令 | 结果 | 状态 |
|--------|------|------|------|
| stderr 含 version-mismatch | `validate-config` | stderr: `orchestration-overrides.version-mismatch: version 不一致：base="1.0"，overrides="99.0"；将使用 base 配置` | PASS |
| stdout 报告"配置有效" | `validate-config` | stdout: `{"success":true,"message":"配置有效","is_fallback":false,...}` | **BUG 已复现** |
| isFallback 实际应为 true | -- | `isFallback` 在降级路径被硬设为 `false`（W-007） | CONFIRMED |
| 进程退出码 0 | `validate-config` | EXIT:0（正确） | PASS |
| 清理后 git 状态 | `rm .specify/orchestration-overrides.yaml` | CLEAN | PASS |

**W-007 复现结论**：
- resolver 正确返回 `isFallback: true`（从 stderr 的 version-mismatch warning 可知已降级）
- `orchestrator-cli.mjs` 的 `validate-config` 命令将 `resolverResult.mergedConfig`（实为降级后的 base config）作为 preloadedConfig 注入 Orchestrator
- Orchestrator 在 `preloadedConfig` 路径硬设 `this.isFallback = false`（`orchestrator.mjs:36`）
- 导致 `getSummary().isFallback` 返回 `false`，validate-config 输出"配置有效"而非"使用后备配置"
- 这是**功能准确性 bug**：降级场景下的状态报告误导性地表示成功

---

## §3 AC-001~AC-023 真实输出验证

| AC | 命令 | 实际输出关键值 | 结果 |
|----|------|--------------|------|
| AC-001 | `get-phases fix --project-root <2phase-overrides>` | `phase_count: 2`，与 overrides 声明一致 | PASS |
| AC-002 | `effective-orchestration fix --annotate` | stdout 含 `# source: overrides`（3 处：modes.fix、GATE_DESIGN 顶层、default_behavior） | PASS |
| AC-003 | `effective-orchestration fix --format json` | `config` + `fieldSources` + `diagnostics` 三 key 均存在，`fieldSources["modes.fix"] = "overrides"` | PASS |
| AC-004 | `effective-orchestration fix --diff` | stdout: `~ modes.fix  base phases: 3 → overrides phases: 2` + `~ gates.GATE_DESIGN.default_behavior  base: always → overrides: auto`，modes.feature 不出现 | PASS |
| AC-005 | `get-phases feature`（YAML `modes: fix: phases`） | stderr: `version-mismatch`（non `parse-error`）；simple-yaml 宽松解析此 YAML 不抛出异常，version 字段解析为 undefined 触发 version-mismatch；退出码 0，使用 base config | WARN（diagnostic code 偏差）|
| AC-006 | `get-phases feature`（`modes.fxi: {phases:[]}`) | stderr: `schema-fallback`，退出码 0，使用 base config | PASS |
| AC-007 | `get-phases feature`（无 overrides 目录） | stderr 空，退出码 0 | PASS |
| AC-008 | `npm run repo:check`（无 overrides 文件） | `orchestration-overrides:overrides-file-exists: pass`，整体 EXIT:0 | PASS |
| AC-009 | `npm run repo:check`（`modes.fxi` 非法 overrides） | `orchestration-overrides:overrides-schema-validation: fail`，整体 EXIT:1，errors 含字段路径 | PASS |
| AC-010 | `node --test orchestration-resolver.test.mjs` | 21 tests / 0 fail（T1/T2/T3/T4 全组） | PASS |
| AC-011 | `git diff --name-only` | 无任何 SKILL.md 文件变更 | PASS |
| AC-012 | `node -e "import(...).then(m => ...)"` | exports: `resolveOrchestrationConfig` | PASS |
| AC-013 | `node -e "import(...).then(m => ...)"` | exports 含 `orchestrationBaseSchema`、`orchestrationOverridesSchema`、`orchestrationMergedSchema` 三件套，version 必填，modes enum 校验，parallel_groups 被 strip | PASS |
| AC-014 | `ls` + `grep "示例"` | 文件存在，含 5 处"示例"（三场景） | PASS |
| AC-015 | `resolveOrchestrationConfig({projectRoot: emptyDir})` | `isFallback: false`，`diagnostics.length: 0` | PASS |
| AC-016 | `node -e "..."` + 计时 | 38ms（< 200ms 阈值） | PASS |
| AC-017 | `grep "orchestration-overrides.yaml" AGENTS.md` | 3 处匹配（AGENTS.md、CLAUDE.md、docs/shared/agent-orchestration-overrides.md 均含） | PASS |
| AC-018 | `grep "orchestration-overrides" .specify/project-context.yaml` | 匹配到 forbidden_changes 旁注 | PASS |
| AC-019 | `node scripts/orchestrator-cli.mjs validate-config` | `{"success":true,"message":"配置有效","mode_count":8,"gate_count":6,"parallel_group_count":3}` EXIT:0 | PASS |
| AC-020 | `grep -n "validateOrchestrationYaml" orchestrator.mjs` | 函数体仅含 null 检查和 modes 存在性检查（薄壳），注释明确说明调用方应优先用 Zod | PASS |
| AC-021 | `node --test orchestrator.test.mjs` | 35 tests / 0 fail，含 Base Zod 回归 T-025 组 | PASS |
| AC-022 | `get-phases feature`（version: "99.0"） | stderr 含 `version-mismatch`，不含 `schema-fallback`，EXIT:0 | PASS |
| AC-023 | `get-phases feature`（含 `parallel_groups` 字段） | stderr: `unsupported-field` warning；gate override 仍生效（`GATE_DESIGN.default_behavior: auto`） | PASS |

**AC 验证汇总**：22 PASS / 1 WARN（AC-005 diagnostic code 偏差）/ 0 FAIL

---

## §4 7a + 7b 汇总分类

### 4.1 实质 Bug（影响功能正确性，建议本 Feature 修复）

| 编号 | 来源 | 文件:行号 | 描述 | 严重性 | 建议处置 |
|------|------|---------|------|--------|---------|
| **W-007** | 7b CHK-QR-21 | `orchestrator.mjs:36` | `preloadedConfig` 路径硬编码 `isFallback = false`，丢失 resolver 的实际 fallback 状态；`validate-config` 命令在降级场景（version-mismatch 等）下输出"配置有效"和 `is_fallback: false`，状态报告具有误导性 | WARNING（功能准确性影响） | **建议本 Feature 修复**：在 `buildOrchestrator()` 中将 `resolverResult.isFallback` 透传到 Orchestrator（通过 `options.isFallback`），或在 `validate-config` handler 直接从 `resolverResult.isFallback` 读取状态 |

### 4.2 设计偏差（spec ↔ 实现 drift）

| 编号 | 来源 | 文件:行号 | 描述 | 严重性 | 建议处置 |
|------|------|---------|------|--------|---------|
| **AC-005 偏差** | 本次验证 | `orchestration-resolver.mjs` + `simple-yaml.mjs` | AC-005 要求 YAML 语法错误触发 `parse-error`，但 simple-yaml 对 `modes: fix: phases` 宽松解析为 `{modes: "fix: phases"}`，触发 `version-mismatch` 而非 `parse-error`；parse-error 路径极难通过 simple-yaml 触发 | INFO | 文档化为已知限制：说明 `parse-error` 仅在 simple-yaml 真正抛出 `Error`（如文件 I/O 错误）时触发；spec AC-005 中的 YAML 示例实际经由 version-mismatch 路径处理，结果等效（均降级 base，均有 warning） |
| **CHK-SR-10 fieldSources 粒度** | 7a | `orchestration-resolver.mjs` + spec FR-005 | spec 要求 fieldSources 粒度为 Mode 级（`modes.feature`）和 Gate 级（`gates.GATE_DESIGN`），但实现下钻到 Gate 子字段级（`gates.GATE_DESIGN.default_behavior`），粒度更细 | INFO | 可接受偏差：实现比 spec 更细粒度，提供了更丰富的调试信息；`--annotate` 输出利用了字段级 fieldSources；不建议修改 |

### 4.3 技术债（不影响功能，可推迟）

| 编号 | 来源 | 文件:行号 | 描述 | 严重性 | 建议处置 |
|------|------|---------|------|--------|---------|
| **W-001** | 7b CHK-QR-03 | `orchestrator-cli.mjs:255-441`（187 行） | 文件从 257 行增长至 589 行，YAML 序列化辅助函数（147 行）应提取到独立模块 | WARNING | 推迟：规划在下一个重构窗口将 `yamlScalar/serializeYaml/serializeWithAnnotations/formatDiff` 提取到 `lib/orchestration-output-serializer.mjs` |
| **W-002/W-004** | 7b CHK-QR-07/13 | `orchestration-schema.mjs:176` | `modeOverrideSchema.passthrough()` 允许任意额外字段进入合并流程，与整体 `.strict()` 策略不一致；虽有 orchestrationMergedSchema 防御，但存在无声污染窗口 | WARNING | 推迟：将 `.passthrough()` 改为 `.strip()`，不影响已有功能，建议 Feature 134 随手改 |
| **W-003** | 7b CHK-QR-09 | `orchestrator-cli.mjs:489` | `--diff` 使用哨兵路径 `/tmp/__no_overrides_dir__` 获取 base config，语义隐式，存在潜在脆弱性 | WARNING | 推迟：增加 `_skipOverrides?: boolean` 参数，或在 resolver 返回值中暴露 `baseConfig` |
| **W-005** | 7b CHK-QR-15 | `orchestration-schema.mjs:286` | `z.any().optional()` 类型信息完全丢失 | WARNING | 推迟：改为 `z.record(z.string(), z.unknown()).optional()`，成本低 |
| **W-006** | 7b CHK-QR-18 | `orchestration-schema.mjs:248` | 过期注释提及 `_strippedFields` 机制，实际从未实现 | WARNING | 推迟或随手修：成本极低，更新注释说明 resolver 步骤 6 手动检测 |
| **W-008** | 7b CHK-QR-26 | `orchestrator-cli.mjs:489` | `--diff` 调用 resolver 两次，重复加载 base config | WARNING | 推迟：同 W-003 修复方向 |
| **W-009** | 7b CHK-QR-37 | `docs/shared/agent-orchestration-overrides.md:1-6` | 文档仅 6 行，缺乏决策场景指引和降级排查说明 | WARNING | 推迟：补充"overrides vs config.yaml 选择"和"降级信号排查"节 |
| **W-010** | 7b CHK-QR-40 | `orchestration-resolver.test.mjs` | 缺少 CLI 不存在 mode 时退出码 1 的测试（FR-011 要求） | WARNING | 推迟：增加 T3-6 用例 |
| **I-001** | 7b | `orchestration-schema.mjs:115` | `applicable_modes` 注释表述矛盾 | INFO | 随手修即可 |

### 4.4 可接受偏差（spec 描述过严，实现实际更合理）

| 编号 | 来源 | 描述 | 理由 |
|------|------|------|------|
| **CHK-SR-11 fieldSources 粒度扩展** | 7a | fieldSources 比 spec 粒度更细（字段级 vs 来源级） | 实现更丰富，为 `--annotate` 提供了字段级来源标注，提升用户体验；不破坏向后兼容 |
| **AC-005 version-mismatch 路径** | 本次 | `modes: fix: phases` 被 simple-yaml 宽松解析，走 version-mismatch 而非 parse-error | 最终行为等效（均降级 base + warning）；spec 中用于演示 parse-error 的 YAML 示例在 simple-yaml 下不会触发语法错误，是 simple-yaml 固有限制，非实现缺陷 |

---

## §5 W-007 复现结果与建议

### 复现步骤

```bash
# 写入 version 不一致的 overrides
cat > .specify/orchestration-overrides.yaml << 'EOF'
version: "99.0"
gates:
  GATE_DESIGN:
    default_behavior: auto
EOF

# 运行 validate-config
node plugins/spec-driver/scripts/orchestrator-cli.mjs validate-config
```

### 实际输出

**stderr（正确）**：
```
[orchestration-overrides] orchestration-overrides.version-mismatch: [orchestration-overrides] version 不一致：base="1.0"，overrides="99.0"；将使用 base 配置
```

**stdout（问题所在）**：
```json
{
  "success": true,
  "message": "配置有效",
  "is_fallback": false,
  "mode_count": 8,
  "gate_count": 6,
  "parallel_group_count": 3,
  "version": "1.0"
}
```

### Bug 根因

`orchestrator.mjs:33-36`：
```js
if (options.preloadedConfig) {
  this.config = options.preloadedConfig;
  this.isFallback = false;  // 永远设为 false，与 resolver 的实际 isFallback 状态脱钩
}
```

当 version-mismatch 触发时，resolver 返回 `isFallback: true`，但 CLI 的 `buildOrchestrator()` 将降级后的 base config 作为 preloadedConfig 注入，Orchestrator 将 `isFallback` 强制设为 `false`，导致 `validate-config` 命令的 `getSummary()` 返回 `isFallback: false`，输出"配置有效"。

### 影响范围

- `validate-config` 命令在所有降级场景（version-mismatch / schema-fallback / parse-error）下均报告"配置有效"，用户无法通过此命令判断是否使用了降级配置
- 其他命令（get-phases、effective-orchestration 等）通过 stderr warning 提供准确信息，不受 isFallback 丢失影响
- 不影响实际配置的使用（降级后使用 base config 是正确的），仅影响状态报告准确性

### 建议修复方案

最小侵入式修复：在 `orchestrator-cli.mjs` 的 `buildOrchestrator()` 函数中返回 `resolverResult`，各命令 handler 直接使用 `resolverResult.isFallback` 用于 CLI 输出，而非依赖 `orch.getSummary().isFallback`。

**修复等级建议**：建议本 Feature 修复（`validate-config` 命令是用户判断 overrides 是否生效的主要工具，在降级场景下给出错误信息会误导排查方向）。

---

## §6 GATE_VERIFY 推荐

### 推荐决策

**FIX_REQUIRED**

### 决策理由

W-007 是实质 bug：`validate-config` 命令在 version-mismatch 等降级场景下输出 `"is_fallback": false` + `"message": "配置有效"`，与实际降级状态相悖。该命令是用户判断 overrides 配置是否生效的主要工具，错误信息会误导用户排查方向（用户会认为 overrides 已生效，但实际在使用 base config）。

### 必须修复清单（最小修复，不包含推迟项）

| 编号 | 文件:行号 | 修复内容 |
|------|---------|---------|
| **W-007** | `orchestrator.mjs:36` + `orchestrator-cli.mjs` `buildOrchestrator()` | 将 `resolverResult.isFallback` 透传，`validate-config` 命令中从 `resolverResult.isFallback` 读取状态（而非 `orch.getSummary().isFallback`） |

### 推迟项（不阻断合并的技术债）

- W-001（文件膨胀）：下一重构窗口
- W-002/W-004（passthrough 策略）：Feature 134 随手改
- W-003/W-008（--diff 双 resolver 调用）：下一迭代
- W-005（z.any 类型信息丢失）：低优先级
- W-006（过期注释）：随手改，成本极低
- W-009（文档信息密度不足）：下一文档迭代
- W-010（FR-011 测试缺口）：下一测试迭代

### 修复后可达状态

修复 W-007 后，工具链 7/7 通过 + AC 23/23 通过（含 AC-005 的已知限制文档化） + 0 FAIL，推荐状态升级为 **READY_FOR_MERGE**。

---

## §7 T-037 / T-038 状态

**T-037（全量 repo:check + release:check）**：本次验证中已完成。
- `npm run repo:check` EXIT:0，所有检查项通过
- `npm run release:check` EXIT:0，release contract valid
- 任务完成判据满足

**T-038（清理临时测试目录）**：已完成。
- `/tmp/e2e-*` 目录（含 e2e-valid-overrides、e2e-invalid-overrides、e2e-schema-fallback 等）已全部清理
- `.specify/orchestration-overrides.yaml` 临时测试文件已全部删除，git status CLEAN
- 11 个源码文件（4 改造 + 7 新增）均存在并内容符合 spec 约定

