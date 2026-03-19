# Feature 040 技术决策研究

**日期**: 2026-03-19
**关联**: [spec.md](./spec.md) | [plan.md](./plan.md)

---

## Decision 1: Workspace 管理器类型检测方式

**问题**: extract 阶段如何确定当前 Monorepo 使用的包管理器类型（npm/pnpm/uv）？

**结论**: 在 extract 内部独立检测，按优先级顺序检查配置文件存在性。

**理由**:
- `ProjectContext.packageManager` 只反映 lock 文件检测结果（如 `pnpm`），但不区分该项目是否启用了 workspace
- `ProjectContext.workspaceType` 已在 isApplicable 中用于判断是否为 Monorepo，但不携带具体管理器类型信息
- extract 需要知道具体类型以选择正确的配置解析策略（package.json vs pnpm-workspace.yaml vs pyproject.toml）

**替代方案**:
- A) 扩展 ProjectContext 增加 `workspaceManager` 字段 -- 被拒绝。原因：修改 ProjectContext 影响面过大，需要修改 interfaces.ts Zod Schema + project-context.ts + 所有测试，超出 spec 范围
- B) 复用 ProjectContext.packageManager 映射 -- 被拒绝。原因：`packageManager === 'npm'` 无法区分 npm workspace 和普通 npm 项目

**检测优先级**:
```
1. pnpm-workspace.yaml 存在 → pnpm
2. package.json 含 workspaces 字段 → npm (含 yarn)
3. pyproject.toml 含 [tool.uv.workspace] 段 → uv
4. 以上均不匹配 → unknown（返回空 packages 列表）
```

---

## Decision 2: Glob 模式展开策略

**问题**: npm/pnpm workspace 的 members 使用 glob 模式（如 `packages/*`），如何展开？

**结论**: 使用 `fs.readdirSync` 实现简易 glob 展开，仅支持末尾 `*` 通配符。

**理由**:
- FR-006 明确要求使用 `fs.readdirSync` 展开，不引入额外 glob 库
- 实际 workspace 配置中 99% 的模式为 `path/*` 或 `path/prefix-*` 格式
- `*` 匹配的语义为"单层目录名中的零到多个字符"，不跨目录层级
- 非 glob 模式（如 uv 的精确路径 `packages/core`）直接作为字面路径处理

**替代方案**:
- A) 引入 `fast-glob` 或 `glob` 库 -- 被拒绝。原因：违反 FR-006 约束，增加依赖
- B) 实现完整的 glob 语法（`**`、`{}`、`?`） -- 被拒绝。原因：过度设计，实际 workspace 配置几乎不使用复杂 glob

**展开算法**:
```
input: "packages/*"
1. 将模式拆分为 prefix + "*" + suffix
   → prefix = "packages/", pattern = "*"
2. fs.readdirSync(path.join(projectRoot, "packages/"))
3. 过滤：entry.isDirectory() && entry.name 匹配 pattern
4. 对每个匹配的目录，检查是否包含 package.json 或 pyproject.toml
5. 返回有效子包路径列表
```

---

## Decision 3: TOML 解析策略

**问题**: 如何从 `pyproject.toml` 提取 `[tool.uv.workspace]` 段的 members 列表？

**结论**: 纯正则提取，不引入 TOML 解析库。

**理由**:
- FR-007 明确要求纯正则解析
- `project-context.ts` 已使用正则 `/^\[tool\.uv\.workspace\]/m` 检测该段存在性，模式已验证
- members 列表格式固定：`members = ["path1", "path2"]` 或多行 TOML 数组
- 子包 `pyproject.toml` 的 `[project]` 段同理，提取 `name`、`description`、`dependencies`

**替代方案**:
- A) 引入 `@iarna/toml` 或 `smol-toml` 库 -- 被拒绝。原因：违反 FR-007 约束，增加依赖
- B) 使用 JSON5/YAML parser 尝试解析 -- 被拒绝。原因：TOML 语法与 JSON/YAML 不兼容

**正则策略**:
```
1. 定位 [tool.uv.workspace] 段起始行
2. 提取 members = [...] 或 members = [\n  ...\n] 多行内容
3. 用正则提取所有双引号/单引号包裹的字符串值
4. 对子包 pyproject.toml 同理：
   - name: 匹配 /^name\s*=\s*"([^"]+)"/m
   - description: 匹配 /^description\s*=\s*"([^"]+)"/m
   - dependencies: 提取 [project].dependencies 段的列表
```

---

## Decision 4: pnpm-workspace.yaml 解析策略

**问题**: 如何解析 `pnpm-workspace.yaml` 的 `packages` 字段？

**结论**: 逐行正则匹配 YAML 列表项，不引入 YAML 解析库。

**理由**:
- pnpm-workspace.yaml 结构极简，仅包含 `packages:` 一个顶级键和一个字符串列表
- 标准格式固定为 `- "pattern"` 或 `- 'pattern'` 或 `- pattern`（无引号）
- 复杂 YAML 特性（锚点、合并、多文档）在此文件中不会出现

**替代方案**:
- A) 引入 `js-yaml` 库 -- 被拒绝。原因：新增运行时依赖，违反七. 纯 Node.js 生态精神（尽量复用内置能力）
- B) 使用 JSON.parse 尝试 -- 被拒绝。原因：YAML 不是 JSON 超集

**解析算法**:
```
1. 读取文件内容
2. 定位 "packages:" 行
3. 后续行中匹配 /^\s*-\s*['"]?([^'"]+)['"]?\s*$/ 提取每个 pattern
4. 遇到非缩进行或 EOF 停止
```

---

## Decision 5: 内部依赖提取方式

**问题**: 如何判断子包的依赖列表中哪些属于 workspace 内部依赖？

**结论**: 构建 workspace 内所有子包名的 Set，遍历每个子包的 dependencies 做交集。

**理由**:
- 简单高效，时间复杂度 O(P * D)，P 为子包数、D 为平均依赖数
- 不需要解析版本范围或 `workspace:*` 协议
- 对 npm/pnpm：遍历 `package.json` 的 `dependencies` + `devDependencies` 对象的 key
- 对 uv：遍历 `pyproject.toml` 的 `[project].dependencies` 列表，提取包名部分（去除版本约束）

**替代方案**:
- A) 仅检测 `workspace:*` 协议前缀 -- 被拒绝。原因：npm 原生 workspace 引用可能不使用 `workspace:` 前缀，yarn 和 pnpm 行为不同
- B) 使用 lock 文件解析精确依赖 -- 被拒绝。原因：过度复杂，lock 文件格式多样

---

## Decision 6: Mermaid 节点 ID 转义

**问题**: 包名如 `@scope/package-name` 包含 Mermaid 不允许的字符（`@`、`/`），如何处理？

**结论**: 将非法字符替换为下划线 `_`，同时保留原始包名作为节点标签。

**理由**:
- Mermaid `graph TD` 节点 ID 仅允许字母、数字、下划线
- 使用 `nodeId["@scope/package"]` 语法可以同时指定 ID 和显示标签
- 参考 `data-model-generator.ts` 中 `sanitizeMermaidId()` 函数的实现模式

**实现**:
```
节点定义: scope_package["@scope/package"]
依赖边: scope_package --> other_package
```

---

## Decision 7: 语言推断策略

**问题**: 如何为每个子包推断主要语言？

**结论**: 基于子包目录内的标志性文件存在性推断。

**理由**:
- FR-012 要求按文件特征推断
- 规则简单可靠，覆盖 JS/TS 和 Python 两大生态

**推断规则**（优先级从高到低）:
```
1. 存在 tsconfig.json → TypeScript
2. 存在 package.json → JavaScript (若无 tsconfig)
3. 存在 pyproject.toml 或 setup.py → Python
4. 以上均无 → Unknown
```

---

## Decision 8: 模板放置与查找

**问题**: `workspace-index.hbs` 模板文件如何放置和查找？

**结论**: 放置在 `templates/workspace-index.hbs`，使用 `import.meta.url` 相对路径查找。

**理由**:
- 与现有模板文件（`config-reference.hbs`、`data-model.hbs`、`index-spec.hbs`）保持一致
- `data-model-generator.ts` 使用 `path.dirname(fileURLToPath(import.meta.url))` + `../../templates/` 的模式，可直接复用

**替代方案**:
- A) 内联模板字符串 -- 被拒绝。原因：模板较长，影响代码可读性
- B) 运行时从 process.cwd() 查找 -- 被拒绝。原因：不稳定，依赖调用位置
