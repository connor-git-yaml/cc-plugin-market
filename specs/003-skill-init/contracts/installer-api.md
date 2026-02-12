# Installer API Contract: skill-installer.ts

**Date**: 2026-02-12

## Module: `src/installer/skill-installer.ts`

共享核心安装/卸载逻辑，供 `init` 命令和 `postinstall`/`preuninstall` 脚本复用。

## Exported Functions

### `installSkills(options: InstallOptions): InstallSummary`

将 Skill Pack 安装到指定目标位置。

**Parameters**:

```typescript
interface InstallOptions {
  /** 安装目标基础路径（如 `/path/to/project/.claude/skills/`） */
  targetDir: string;
  /** 安装模式标记（影响日志输出） */
  mode: 'project' | 'global';
}
```

**Returns**: `InstallSummary`

**Behavior**:

1. 遍历所有 skill 定义（从 `skill-templates.ts` 获取）
2. 对每个 skill:
   - 创建目标目录 `{targetDir}/{skillName}/`（递归创建）
   - 检测 `SKILL.md` 是否已存在（区分 `installed` vs `updated` 状态）
   - 写入 SKILL.md 内容
   - 记录结果（成功/失败）
3. 单个 skill 失败不中断其他 skill 的安装
4. 返回 `InstallSummary`

**Error Handling**: 不抛出异常。所有错误记录在 `InstallResult.error` 中。

---

### `removeSkills(options: RemoveOptions): InstallSummary`

从指定目标位置移除已安装的 skill。

**Parameters**:

```typescript
interface RemoveOptions {
  /** 目标基础路径 */
  targetDir: string;
  /** 移除模式标记 */
  mode: 'project' | 'global';
}
```

**Returns**: `InstallSummary`

**Behavior**:

1. 遍历所有 skill 名称
2. 对每个 skill:
   - 检测 `{targetDir}/{skillName}/` 是否存在
   - 存在则递归删除（`rmSync({ recursive: true, force: true })`）
   - 不存在则标记为 `skipped`
3. 单个 skill 删除失败不中断其他
4. 返回 `InstallSummary`

**Error Handling**: 不抛出异常。

---

### `resolveTargetDir(mode: 'project' | 'global'): string`

解析安装目标目录的绝对路径。

**Returns**:

- `mode === 'project'`: `path.join(process.cwd(), '.claude', 'skills')`
- `mode === 'global'`: `path.join(os.homedir(), '.claude', 'skills')`

---

### `formatSummary(summary: InstallSummary): string`

格式化安装/移除结果为用户友好的中文输出字符串。

**Returns**: 多行字符串，包含状态图标和路径信息。

## Module: `src/installer/skill-templates.ts`

### `SKILL_DEFINITIONS: readonly SkillDefinition[]`

包含 3 个 skill 的完整定义（name + SKILL.md 内容）。

```typescript
interface SkillDefinition {
  readonly name: string;
  readonly content: string;
}
```

skill 列表：

1. `reverse-spec` — 单模块 spec 生成
2. `reverse-spec-batch` — 批量 spec 生成
3. `reverse-spec-diff` — spec 漂移检测

每个 `content` 包含完整的 SKILL.md 文本（frontmatter + 指令 + 内联降级逻辑）。
