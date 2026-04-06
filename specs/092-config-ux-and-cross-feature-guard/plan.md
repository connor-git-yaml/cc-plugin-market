---
feature: "092-config-ux-and-cross-feature-guard"
type: implementation-plan
created: 2026-04-06
status: Draft
milestone: M-088
depends_on:
  - spec.md
  - research/tech-research.md
---

# Feature 092: 配置体验 + 跨 Feature 守护 -- 技术规划

## 1. 架构概览

本 Feature 通过 6 项改进，补齐 spec-driver 在**配置可观测性**、**跨 Feature 冲突预警**和**验证健壮性**三个维度的短板。整体架构遵循"脚本层做数据、Prompt 层做智能"的分工原则：

```
┌─────────────────────────────────────────────────────────────────┐
│                     init-project.sh（触发入口）                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  check_config() → validate-config.mjs                    │   │
│  │    ├─ --validate    → Schema 校验（config-schema.mjs）   │   │
│  │    └─ --show-effective → effective config 展示            │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    Agent Prompt 扩展层                           │
│  ┌────────────────┐  ┌───────────────┐  ┌───────────────────┐  │
│  │ analyze.md      │  │ sync.md       │  │ verify.md         │  │
│  │ + Pass G:       │  │ + 矛盾检测    │  │ + timeout 前缀    │  │
│  │   跨 Feature    │  │ + 术语一致性  │  │   (config 注入)   │  │
│  │   冲突检测      │  │               │  │                   │  │
│  └────────────────┘  └───────────────┘  └───────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    配置层 + 元数据层                              │
│  ┌────────────────────────┐  ┌──────────────────────────────┐  │
│  │ config-schema.mjs      │  │ 8 x SKILL.md frontmatter     │  │
│  │ (Zod Schema 定义)      │  │ + allowed-tools              │  │
│  │ + verification.timeout │  │ + model                      │  │
│  └────────────────────────┘  │ + effort                     │  │
│                              └──────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**设计原则**：

1. **Parse-Validate-Diagnose-Fallback**：复用 `project-profile-resolver.mjs` 的成熟模式
2. **脚本层做数据，Prompt 层做智能**：Schema 校验和 effective config 走 Node.js 脚本；冲突检测、矛盾识别走 Agent Prompt
3. **追加型变更**：不删除、不替换现有逻辑，仅追加
4. **物理隔离并行安全**：SKILL.md 仅改 frontmatter（头 5-8 行），与 090 body 改动无冲突

---

## 2. 模块设计

### 2.1 新增模块

#### `plugins/spec-driver/scripts/lib/config-schema.mjs`

**职责**：定义 `spec-driver.config.yaml` 的完整 Zod Schema，导出校验和合并函数。

**接口**：

```javascript
// Schema 定义
export const specDriverConfigSchema: z.ZodType

// 内置默认值
export const BUILTIN_DEFAULTS: Record<string, unknown>

// preset 默认值表
export const PRESET_DEFAULTS: Record<string, Record<string, unknown>>

// 通用配置文件排除列表（跨 Feature 冲突检测用）
export const COMMON_CONFIG_FILES: Set<string>

// 校验入口
export function validateConfig(parsedYaml: unknown): {
  success: boolean;
  data?: object;
  diagnostics: Diagnostic[];
}

// effective config 合并
export function resolveEffectiveConfig(options: {
  configYaml: object;
  presetOverride?: string;
}): EffectiveConfigEntry[]
```

**估计行数**：~120 行

---

#### `plugins/spec-driver/scripts/validate-config.mjs`

**职责**：CLI 入口脚本，被 `init-project.sh` 调用。支持两种模式：

- `--validate`：执行 Schema 校验，输出 `createCheck()` 格式结果
- `--show-effective`：输出 effective config 表格（含来源标注）

**接口**：

```bash
node validate-config.mjs --project-root <path> --validate
node validate-config.mjs --project-root <path> --show-effective [--preset <name>]
```

**退出码**：

- `0`：校验通过
- `1`：Schema 校验失败（输出诊断信息到 stdout）
- `2`：YAML 语法错误（输出解析错误信息）

**输出格式**（`--show-effective`）：

```
[Effective Config]
┌─────────────────────────┬──────────────┬────────────────────┐
│ 配置项                   │ 生效值        │ 来源               │
├─────────────────────────┼──────────────┼────────────────────┤
│ preset                   │ quality-first│ config.yaml        │
│ gate_policy              │ balanced     │ config.yaml        │
│ verification.timeout     │ 300          │ 内置默认           │
│ ...                      │ ...          │ ...                │
└─────────────────────────┴──────────────┴────────────────────┘
```

**估计行数**：~80 行

---

### 2.2 修改模块

#### `plugins/spec-driver/scripts/init-project.sh`

**改动范围**：`check_config()` 函数扩展（L202-210）+ `run_init_checks()` 末尾追加调用

**改动内容**：

1. 在 `check_config()` 通过文件存在性检查后，调用 `validate-config.mjs --validate` 执行 Schema 校验
2. 在 `run_init_checks()` 末尾追加 `validate-config.mjs --show-effective` 调用
3. 新增 `validate_config_schema()` 函数封装校验逻辑

**估计新增行数**：~20 行

---

#### `plugins/spec-driver/agents/analyze.md`

**改动范围**：在现有 6 个 Pass（A-F）之后追加 Pass G

**改动内容**：

```markdown
7. **检测 Pass G: 跨 Feature 文件冲突检测**

   扫描当前 Feature 与近 5 个活跃 Feature 的文件路径交集：

   1. 从当前 Feature 的 tasks.md 提取所有 [P] 标记的文件路径引用
   2. 扫描 specs/ 下最近 5 个活跃 Feature 目录（按编号倒序，排除
      spec.md frontmatter 中 status 为 Completed/Abandoned 的 Feature）
      的 tasks.md，提取各自的文件路径集合
   3. 排除通用配置文件（package.json、tsconfig.json、spec-driver.config.yaml）
   4. 仅检测 src/、plugins/、scripts/ 下的文件
   5. 交集非空 → 输出 OVERLAP_WARNING：
      - 3+ 文件重叠 → HIGH
      - 1-2 文件重叠 → MEDIUM
      - 仅测试文件重叠 → LOW
   6. 无重叠 → 输出 `Pass G: CLEAN`
```

**估计新增行数**：~35 行

---

#### `plugins/spec-driver/agents/sync.md`

**改动范围**：在"文档健康度检查"部分（L292-304）扩充矛盾检测维度

**改动内容**：在现有 3 项健康度检查之后追加 2 项：

```markdown
4. **矛盾检测**：检查不同 Feature spec 之间是否存在数值冲突或行为描述冲突：
   - 对比各 spec 的 Functional Requirements 和 Constraints 区域
   - 标注数值矛盾（如"最大行数"在不同 spec 中给出不同值）
   - 标注行为冲突（如一个 spec 要求同步执行另一个要求异步执行）
   - 输出格式：`[矛盾] FR-xxx (Feature A) vs FR-yyy (Feature B): {描述}`

5. **术语一致性**：检查同一概念在不同 spec 中是否使用不同术语：
   - 构建术语映射表（从已有术语表和 current-spec.md 术语表章节提取）
   - 扫描各 spec 中未使用标准术语的地方
   - 输出格式：`[术语不一致] "{术语A}" (Feature X) vs "{术语B}" (Feature Y) — 建议统一为 "{标准术语}"`
```

**估计新增行数**：~40 行

---

#### `plugins/spec-driver/agents/verify.md`

**改动范围**：在 Layer 2 验证执行区域追加超时指示

**改动内容**：在 Bash 验证命令执行指示中追加：

```markdown
**超时保护**: 执行每个 Bash 验证命令时，在命令前附加 `timeout {N}s` 前缀，
其中 N 为编排器注入的 `verification.timeout` 值（秒）。如超时触发，
记录 `[TIMEOUT] 命令 "{cmd}" 在 {N} 秒后被终止` 并标记为 FAIL。
```

**估计新增行数**：~10 行

---

#### 8 个 SKILL.md frontmatter 增强

**改动范围**：仅修改 `---` 区域内的声明行（头 5-8 行）

**改动文件列表**（见 data-model.md 中的目标状态表）：

1. `plugins/spec-driver/skills/spec-driver-feature/SKILL.md`
2. `plugins/spec-driver/skills/spec-driver-story/SKILL.md`
3. `plugins/spec-driver/skills/spec-driver-implement/SKILL.md`
4. `plugins/spec-driver/skills/spec-driver-fix/SKILL.md`
5. `plugins/spec-driver/skills/spec-driver-resume/SKILL.md`
6. `plugins/spec-driver/skills/spec-driver-sync/SKILL.md`
7. `plugins/spec-driver/skills/spec-driver-doc/SKILL.md`
8. `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md`

**每个文件改动**：追加 `allowed-tools`、`model`、`effort` 三个 frontmatter 字段（~3 行/文件）

**估计总新增行数**：~24 行

---

## 3. 实现路线图

### 依赖关系图

```
Phase 1: 基础设施层
  ├─ T1: config-schema.mjs（Schema 定义 + 校验函数）
  └─ T2: validate-config.mjs（CLI 入口）
         └── 依赖 T1

Phase 2: 触发层集成
  └─ T3: init-project.sh（调用 validate-config.mjs）
         └── 依赖 T2

Phase 3: Agent Prompt 扩展（可并行）
  ├─ T4: analyze.md Pass G（跨 Feature 冲突检测）  [独立]
  ├─ T5: sync.md 矛盾检测（补全 087 遗留）        [独立]
  └─ T6: verify.md 超时保护                       [依赖 T1 的 timeout 字段定义]

Phase 4: 元数据层（可并行）
  └─ T7: 8 x SKILL.md frontmatter                 [独立]
```

### 实现顺序

| 顺序 | 任务 | 依赖 | 估计行数 | 优先级 |
|------|------|------|---------|--------|
| 1 | T1: `config-schema.mjs` | 无 | ~120 | P1 |
| 2 | T2: `validate-config.mjs` | T1 | ~80 | P1 |
| 3 | T3: `init-project.sh` 集成 | T2 | ~20 | P1 |
| 4 | T4: `analyze.md` Pass G | 无 | ~35 | P2 |
| 5 | T5: `sync.md` 矛盾检测 | 无 | ~40 | P3 |
| 6 | T6: `verify.md` 超时保护 | T1 | ~10 | P2 |
| 7 | T7: 8 x SKILL.md frontmatter | 无 | ~24 | P3 |

**总估计**：~330 行新增/修改代码

**并行化建议**：T4、T5、T7 与 Phase 1-2 无依赖，可在 T1 完成后与 T2/T3 并行推进。

---

## 4. 数据流

### 4.1 配置校验数据流

```
spec-driver.config.yaml
        │
        ▼
  simple-yaml.mjs
  parseYamlDocument()
        │
        ├── 解析失败 → 输出 YAML 语法错误（退出码 2）
        │
        ▼
  config-schema.mjs
  specDriverConfigSchema.safeParse()
        │
        ├── 校验失败 → diagnostics[] → 格式化输出（退出码 1）
        │                              ├─ 未知字段 → "你是否想写 {suggestion}?"
        │                              ├─ 类型错误 → "期望 {type}，实际 {actual}"
        │                              └─ 非法值   → "合法值: {values}"
        │
        ▼
  校验通过（退出码 0）
        │
        ▼
  init-project.sh
  INIT_RESULTS+=("config_schema:pass")
```

### 4.2 effective config 数据流

```
                    优先级链（从高到低）
  ┌──────────────────────────────────────────────────┐
  │ 1. --preset 命令行参数                            │
  │ 2. config.yaml agents.{id}.model                 │
  │ 3. config.yaml preset → PRESET_DEFAULTS[preset]  │
  │ 4. BUILTIN_DEFAULTS                              │
  └──────────────────────────────────────────────────┘
                    │
                    ▼
            resolveEffectiveConfig()
                    │
                    ▼
            EffectiveConfigEntry[]
            ┌───────────────────────────┐
            │ { key, value, source }    │
            │ { key, value, source }    │
            │ ...                       │
            └───────────────────────────┘
                    │
                    ▼
            格式化为 ASCII 表格 → stdout
```

### 4.3 跨 Feature 冲突检测数据流（analyze Agent Pass G）

```
当前 Feature tasks.md
        │
        ▼
  提取 [P] 标记的文件路径集合 → Set<currentPaths>
        │
        ▼
  扫描 specs/ 目录
  取最近 5 个活跃 Feature（按编号倒序，排除 Completed/Abandoned）
        │
        ▼
  每个 Feature: 提取 tasks.md 中的文件路径集合
        │
        ▼
  排除通用配置文件（package.json、tsconfig.json 等）
  仅保留 src/、plugins/、scripts/ 下的文件
        │
        ▼
  currentPaths ∩ featureNPaths → 重叠集合
        │
        ├── 空 → "Pass G: CLEAN"
        │
        └── 非空 → OVERLAP_WARNING
                   ├─ 3+ 文件 → severity: HIGH
                   ├─ 1-2 文件 → severity: MEDIUM
                   └─ 仅测试文件 → severity: LOW
```

### 4.4 验证超时数据流

```
spec-driver.config.yaml
  verification:
    timeout: 300            ← config-schema.mjs 定义 + 校验
        │
        ▼
  编排器读取 effective config
        │
        ▼
  构建 verify Agent 上下文时注入:
  "verification.timeout = {N}"
        │
        ▼
  verify Agent 执行 Bash 命令时：
  timeout {N}s <original_command>
        │
        ├── 正常完成 → 继续
        └── 超时触发 → [TIMEOUT] 记录 + FAIL
```

---

## 5. 代码变更清单

### 5.1 新增文件

| 文件 | 类型 | 职责 | 行数 |
|------|------|------|------|
| `plugins/spec-driver/scripts/lib/config-schema.mjs` | ESM 模块 | Zod Schema 定义 + 校验函数 + effective config 合并 + 常量 | ~120 |
| `plugins/spec-driver/scripts/validate-config.mjs` | CLI 脚本 | 校验入口，被 init-project.sh 和 repo:check 调用 | ~80 |

### 5.2 修改文件

| 文件 | 改动区域 | 改动内容 | 新增行数 |
|------|---------|---------|---------|
| `plugins/spec-driver/scripts/init-project.sh` | L202-210 `check_config()` + L269-278 `run_init_checks()` | 新增 `validate_config_schema()` 函数；在 `run_init_checks()` 末尾追加校验和 effective config 展示调用 | ~20 |
| `plugins/spec-driver/agents/analyze.md` | L56 后（Pass F 之后） | 追加 Pass G: 跨 Feature 文件冲突检测 | ~35 |
| `plugins/spec-driver/agents/sync.md` | L292-304（文档健康度检查部分） | 追加矛盾检测和术语一致性检查两项 | ~40 |
| `plugins/spec-driver/agents/verify.md` | Layer 2 Bash 执行区域 | 追加 timeout 前缀指示 | ~10 |
| `plugins/spec-driver/skills/spec-driver-feature/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-story/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-implement/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-fix/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-resume/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-sync/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-doc/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |
| `plugins/spec-driver/skills/spec-driver-constitution/SKILL.md` | frontmatter（L1-5） | 追加 allowed-tools / model / effort | 3 |

### 5.3 不修改的文件（明确排除）

| 文件 | 原因 |
|------|------|
| `spec-driver.config.yaml` | `verification.timeout` 为可选新增字段，已有 config 无需修改 |
| `plugins/spec-driver/templates/spec-driver.config-template.yaml` | 模板在独立 PR 中更新（非本 Feature 范围，但可追加注释说明 timeout 字段） |
| SKILL.md body（`---` 区域之后） | 由 090 负责改动，092 不触碰 |

---

## 6. 风险缓解方案

### R1: simple-yaml.mjs 解析能力有限

**风险**：`simple-yaml.mjs` 不支持多行字符串、锚点、引用等高级 YAML 语法。

**缓解实现**：

1. `validate-config.mjs` 将 YAML 解析和 Schema 校验分为两个独立阶段
2. 解析阶段用 `try/catch` 捕获 `parseYamlDocument()` 的异常
3. 解析失败时输出友好的 YAML 语法错误（非 Schema 校验错误），提示用户检查缩进和语法
4. 空文件（0 字节）特殊处理：输出 "配置文件为空，请参考模板填写" 而非解析器栈追踪
5. `config-schema.mjs` 的 Schema 设计避免依赖 simple-yaml 不支持的特性（如不要求多行字符串值）

**兜底**：配置文件结构为 flat mapping + 1-2 层 nested mapping，完全在 `simple-yaml.mjs` 的支持范围内（已验证现有 `spec-driver.config.yaml` 可被正确解析）。

---

### R2: tasks.md 文件路径格式不一致

**风险**：跨 Feature 冲突检测依赖从 tasks.md 提取文件路径，格式不统一导致漏检。

**缓解实现**：

1. Pass G 使用宽松正则匹配多种常见路径格式：
   - 反引号包裹：`` `src/foo.ts` ``
   - [P] 标记后跟路径：`[P] src/foo.ts`
   - 行首路径引用：`- src/foo.ts`
2. 对匹配到的路径做归一化（去除前导 `./`、统一路径分隔符）
3. 无法匹配的格式跳过而非报错，并在报告末尾统计跳过数量
4. 若某个 Feature 的 tasks.md 不存在，跳过该 Feature 继续检测

---

### R3: 092 与 090 并行开发时 SKILL.md 冲突

**风险**：两个 Feature 同时修改同一个 SKILL.md 文件。

**缓解实现**：

1. **物理隔离约定**：092 仅改 frontmatter（`---` 区域内，头 5-8 行），090 仅改 body（第 10 行以后）
2. **验证脚本**：在 tasks.md 中明确标注 SKILL.md 的改动仅限 frontmatter 区域
3. **Git 三向合并兜底**：frontmatter 和 body 之间有 `---` 分隔线和空行，物理距离 > 5 行，Git 自动合并可处理
4. **合并顺序建议**：无硬性要求，两个 Feature 的 SKILL.md 改动完全正交

---

### R4: 验证超时在 Prompt 编排中无法强制执行

**风险**：LLM 可能"忘记"在 Bash 命令前加 `timeout` 前缀。

**缓解实现**：

1. **verify.md 强指示**：在 Layer 2 Bash 执行部分用 MUST 级语言："执行每个 Bash 验证命令时 MUST 附加 `timeout {N}s` 前缀"
2. **编排器注入**：主编排器 SKILL.md 在构建 verify Agent 上下文时，将 `verification.timeout` 值显式写入 Agent 输入区域
3. **Bash `timeout` 标准性**：该命令为 GNU coreutils 标准工具，macOS 需 `brew install coreutils` 提供 `gtimeout`；verify.md 中追加降级提示："若 `timeout` 命令不可用，使用 `gtimeout` 或跳过超时保护"
4. **极大值警告**：Schema 校验对 `timeout > 3600` 输出 WARNING（值偏大，可能导致单命令阻塞超过 1 小时）

---

### R5: sync.md 矛盾检测与 091 冲突

**风险**：091 将瘦身 sync.md 合并算法核心。

**缓解实现**：

1. **改动位置隔离**：092 的矛盾检测追加在"文档健康度检查"部分（sync.md L292-304 区域），091 的合并算法瘦身主要在 L38-190 区域
2. **合并顺序遵循蓝图**：M-088 蓝图建议 092 先合并到 master，091 在其基础上瘦身
3. **矛盾检测自包含**：新增的矛盾检测逻辑独立成段，不依赖合并算法核心的具体实现细节
4. **若 091 先合并**：矛盾检测逻辑仍可追加到瘦身后的健康度检查区域，改动正交

---

## 7. 宪法对齐检查

| 宪法原则 | 对齐说明 |
|---------|---------|
| 原则 I: 需求来源于用户 | 6 项改进均来自 M-083 review 识别的 P1 遗留项和 088 蓝图验收标准 |
| 原则 II: 可验证的需求 | 每项改进均有 spec.md 中定义的独立测试和验收场景 |
| 原则 III: YAGNI | 零新增外部依赖；所有改进直接解决已识别的 P1 问题；无假设性需求 |
| 原则 IV: 诚实标注不确定性 | Schema 校验输出明确的错误位置和修复建议；effective config 标注每项值的来源 |

---

## 8. 配置模板更新建议

虽然 `spec-driver.config-template.yaml` 的更新不在本 Feature 的强制范围内，但建议在实现完成后追加以下注释块（可作为 follow-up task）：

```yaml
# ═══════════════════════════════════════
# 验证超时配置（可选）
# ═══════════════════════════════════════
# 验证命令（build/lint/test）的超时时间（秒）
# 超时后命令将被自动终止
# 默认值: 300（5 分钟）
#
# verification:
#   timeout: 300
```

---

## 9. 验证策略

### 9.1 自动化验证

- `npm run repo:check` 全部 pass
- `validate-config.mjs --validate` 对合法配置返回退出码 0
- `validate-config.mjs --validate` 对 3 种错误类型分别输出正确的诊断信息

### 9.2 手动验证

- 在 `spec-driver.config.yaml` 中制造结构错误，运行 `init-project.sh`，验证错误输出
- 运行 `validate-config.mjs --show-effective`，验证每项来源标注正确
- 检查 8 个 SKILL.md frontmatter 完整性

### 9.3 并行开发验证

- 模拟 090 的 SKILL.md body 改动 + 092 的 frontmatter 改动，验证 Git 三向合并无冲突
