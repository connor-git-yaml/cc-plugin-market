# Plan — 136: orchestrator-cli generate-template + schema-fallback hint + loader-error 诊断

## 实施总览

四个 US 涉及三个文件：
- `plugins/spec-driver/scripts/orchestrator-cli.mjs` — 新增 `cmdGenerateTemplate` 函数 + `generate-template` case
- `plugins/spec-driver/lib/orchestration-resolver.mjs` — schema-fallback message 加 hint + loader-error/parse-error 拆分
- `docs/shared/agent-orchestration-overrides.md` — generate-template 用法 + diagnostic codes 表加 loader-error

测试集中在已有的 `orchestration-resolver.test.mjs`（T3 组用 spawnSync 测 CLI；resolver 直接调用测 hint 和 loader-error）。

## 各 User Story 实施细节

### US-1 — generate-template 命令

**入口**（orchestrator-cli.mjs case）：
```js
case 'generate-template': {
  if (args.length < 2) fail('generate-template 需要 <mode> 参数');
  const mode = args[1];
  const restArgs = args.slice(2);
  const projectRoot = parseProjectRoot(restArgs);
  await cmdGenerateTemplate(mode, { projectRoot });
  break;
}
```

**实现** `cmdGenerateTemplate(mode, { projectRoot })`：
1. 调用 `resolveOrchestrationConfig({ projectRoot })` 取得 base config
2. 校验 `mode` 在 `mergedConfig.modes` 中（与 `cmdEffectiveOrchestration` 同样的 mode 校验逻辑）→ 不存在则 stderr 输出错误信息（含合法 mode 列表）+ exit 1（**AC-1.5**）
3. 构造 template 对象：
   ```js
   const template = {
     version: mergedConfig.version,
     modes: {
       [mode]: mergedConfig.modes[mode],  // 完整 mode 对象（name + description + phases）
     },
   };
   ```
4. 拼接输出：
   - 顶部注释块（**AC-1.3**）：
     ```
     # 由 orchestrator-cli generate-template 生成
     # 修改下方 phases 内容后保存为 .specify/orchestration-overrides.yaml
     # 注意：mode 整段替换，phases 数组必须完整声明所有字段
     ```
   - YAML 正文：复用 `serializeYaml(template)`
5. **AC-1.6 风格**：`serializeYaml` 已经按 schema 字段顺序输出，但默认不在 phase 数组元素之间加空行。需要在生成 phases 数组的输出后做后处理：用正则将相邻 phase 元素之间插入空行（参考 `orchestration.yaml` 的视觉风格）

**stdout 输出**，无 `--stdout` 标志（默认就是 stdout，让用户用 shell `>` 重定向）。

### US-2 — schema-fallback hint

**位置**：`orchestration-resolver.mjs` 步骤 7（约 L315-322），在构造 `schema-fallback` diagnostic 时检查 issues 是否命中 `modes.*.phases.*`。

**实现**：
```js
const overridesParseResult = orchestrationOverridesSchema.safeParse(rawOverridesForStrip);
if (!overridesParseResult.success) {
  const issues = overridesParseResult.error.issues.map(formatZodIssue).join('; ');
  
  // AC-2.1/2.2/2.3：检测 modes.<m>.phases.* 路径，附加 hint
  const phaseIssue = overridesParseResult.error.issues.find(
    iss => Array.isArray(iss.path) && iss.path.length >= 4 
        && iss.path[0] === 'modes' && iss.path[2] === 'phases'
  );
  let message = `[orchestration-overrides] overrides 校验失败，将使用 base 配置：${issues}`;
  if (phaseIssue) {
    const modeName = phaseIssue.path[1];
    message += `\nhint: 运行 \`orchestrator-cli generate-template ${modeName}\` 获取含所有必填字段的完整 phase 模板`;
  }
  
  diagnostics.push(createDiagnostic(
    'warning',
    'orchestration-overrides.schema-fallback',
    message,
  ));
  ...
}
```

### US-3 — --project-root 支持

复用现有 `parseProjectRoot(args)` helper（L48-53），无新代码。

### US-4 — loader-error 与 parse-error 拆分

**位置**：`orchestration-resolver.mjs` 步骤 4（约 L246-265），现有结构：
```js
try {
  if (_loadOverrides) {
    rawOverrides = await _loadOverrides();
  } else {
    const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
    const content = fs.readFileSync(overridesPath, 'utf-8');
    rawOverrides = parseYamlDocument(content);
  }
} catch (error) {
  diagnostics.push(createDiagnostic(
    'warning',
    'orchestration-overrides.parse-error',
    `[orchestration-overrides] YAML 解析失败，将使用 base 配置：${error.message}`,
  ));
  ...
}
```

**改造**：把 try/catch 拆成两段，区分错误来源：
```js
try {
  if (_loadOverrides) {
    try {
      rawOverrides = await _loadOverrides();
    } catch (loaderError) {
      // AC-4.1：注入函数抛错 → loader-error
      diagnostics.push(createDiagnostic(
        'warning',
        'orchestration-overrides.loader-error',
        `[orchestration-overrides] overrides loader 失败，将使用 base 配置：${loaderError.message}`,
      ));
      const baseFieldSources = buildBaseOnlyFieldSources(baseConfig);
      return { mergedConfig: baseConfig, baseConfig, fieldSources: baseFieldSources, diagnostics, isFallback: true, isBaseInvalid: false };
    }
  } else {
    const overridesPath = path.join(projectRoot, '.specify', 'orchestration-overrides.yaml');
    const content = fs.readFileSync(overridesPath, 'utf-8');
    rawOverrides = parseYamlDocument(content);
  }
} catch (error) {
  // AC-4.2：文件 IO/YAML 解析失败 → parse-error（保持原状）
  diagnostics.push(createDiagnostic(
    'warning',
    'orchestration-overrides.parse-error',
    `[orchestration-overrides] YAML 解析失败，将使用 base 配置：${error.message}`,
  ));
  ...
}
```

## 测试方案

新增 5 个测试用例到 `orchestration-resolver.test.mjs`：

1. **T3-Y**: `runCli(['generate-template', 'fix'])` → exit 0，输出含 `version:`、`modes:`、`fix:`、所有 phase 字段（gates_before、is_critical 等）
2. **T3-Z**: `runCli(['generate-template', 'fauxmode'])` → exit 1，stderr 含合法 mode 列表
3. **T2-X (hint 命中)**: 注入含 `modes.fix.phases: [{ id: "1", name: "x" }]`（缺字段）→ schema-fallback diagnostic message 含 `\nhint: 运行 \`orchestrator-cli generate-template fix\``
4. **T2-Y (hint 不命中)**: 注入 `modes.feauture: {...}`（mode 名 typo）→ schema-fallback diagnostic message **不含** hint 文本
5. **T1-Z (loader-error)**: 注入 `_loadOverrides: () => { throw new Error('Custom loader failure') }` → diagnostic code = `orchestration-overrides.loader-error`，message 含 "loader 失败"，**不含** "YAML 解析失败"

## 文档更新

`docs/shared/agent-orchestration-overrides.md`：
- 新增 `### 生成 mode override 模板` 小节，给出 `node orchestrator-cli.mjs generate-template fix > .specify/orchestration-overrides.yaml` 用法
- diagnostic codes 表新增一行：`orchestration-overrides.loader-error | _loadOverrides 注入函数抛错 | 检查注入函数实现`

## 回归风险评估

- **零回归**：所有改动仅新增代码路径或细化既有 catch；现有测试（22 个）不受影响
- **AC-2.3 边界**：hint 仅在 `modes.*.phases.*` 命中时附加。如果未来 schema 改动影响路径结构，需要更新检测逻辑——加注释说明此点
- **loader-error 拆分**：现有调用方（CLI、orchestrator）不区分 diagnostic code（只看 level=warning），行为兼容
