# 合同：`spec-driver.config.yaml` 新增 `fix_compliance` 字段（FR-015）

## Schema 定义位置

`plugins/spec-driver/scripts/lib/config-schema.mjs`（现有 526 行，本次新增约 15-20 行，**不触发 Codebase Reality Check 的前置清理规则**——新增行数 < 50）。

```js
const fixComplianceSchema = z.object({
  enforcement: z.enum(['block', 'warn', 'off']).default('block'),
}).default({});

// 顶层 schema 追加：
// fix_compliance: fixComplianceSchema,
```

`BUILTIN_DEFAULTS` 追加：`'fix_compliance.enforcement': 'block'`。

## `spec-driver.config.yaml` 用户可见字段

```yaml
# ═══════════════════════════════════════
# Fix 模式流程依从性强制程度（Feature 208）
# ═══════════════════════════════════════
# block（默认）：不合规收口一律阻断；warn：放行但反馈+落盘；off：零接触跳过
fix_compliance:
  enforcement: block
```

**本仓库自身的 `spec-driver.config.yaml`（项目根）不做此次改动**——`block` 已是缺省行为，且该文件位于 `plugins/spec-driver/**` 之外，属于 C-002 约束边界外的项目配置文件，本次不触碰（详见 plan.md Impact Assessment）。

## 判定路径的独立读取契约（关键：不经由 `config-schema.mjs`/zod）

`fix-compliance-judge.mjs` / `fix-compliance-io.mjs` **不 import `config-schema.mjs`**，改为直接使用 `plugins/spec-driver/scripts/lib/simple-yaml.mjs` 的 `parseYamlDocument()` 读取 `fix_compliance.enforcement` 字段，理由：

1. Hook 判定路径必须在 zod 缺失/损坏的环境下依然可用（`config-schema.mjs` 依赖 `loadZod()` 优雅降级，但引入该模块本身仍是不必要的间接依赖链，与 C-003"零 LLM/零额外调用路径复杂度"的稳健性精神一致）。
2. `validate-config.mjs --validate` 走 `config-schema.mjs`/zod 路径做**声明式** schema 校验（给用户友好的报错/建议字段），与 Stop hook 的**非抛出式**运行时读取是两个不同目的的独立实现，刻意不复用，避免为追求 DRY 而在高频轻量路径上引入不必要的依赖面（Constitution III"三行重复代码优于一个过早抽象"）。

## FR-015 判定顺序在 `fix-compliance-io.mjs` 的落地（`resolveEnforcementFromConfig` 的输入来源）

```text
1. findConfigFile(projectRoot)：projectRoot/spec-driver.config.yaml 优先，
   否则 projectRoot/.specify/spec-driver.config.yaml；均不存在 → enforcement='block'，configDegraded=false（无配置=默认值，非降级）
2. 文件存在但读取/parseYamlDocument 抛出异常，或 fix_compliance.enforcement 取值不在 {block,warn,off} 集合内
   → enforcement='block'，configDegraded=true，diagnostics 追加 'config-degraded'
3. 合法解析出 enforcement ∈ {block,warn,off} → 直接采用，configDegraded=false
```

此三步为**非抛出式**实现（内部 try/catch 吞掉所有解析异常，统一归约为上述规则），产出结果传给 `judgeCompliance` 前置分支：`enforcement==='off'` 立即短路退出，之后才进入 fix 会话识别与合规判定（FR-013 的 fail-open 只作用于此步之后的阶段）。
