# Feature 037 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. ArtifactParser 接口（034 交付）

**文件**: `src/panoramic/interfaces.ts:228-264`

```typescript
interface ArtifactParser<T> {
  readonly id: string;
  readonly name: string;
  readonly filePatterns: readonly string[];
  parse(filePath: string): Promise<T>;
  parseAll(filePaths: string[]): Promise<T[]>;
}
```

元数据 Schema: `ArtifactParserMetadataSchema`（id kebab-case + name + filePatterns min(1)）

---

## 2. 三个 Parser 的目标制品格式

### SkillMdParser

**目标**: 解析 SKILL.md 文件，提取 trigger/description/constraints

**SKILL.md 通用格式**（基于 OctoAgent 示例）:
```yaml
---
name: apple-calendar
description: Apple Calendar.app integration...
version: 1.0.0
---

# Apple Calendar

## Commands
...

## Workflow
...
```

**提取策略**:
- YAML frontmatter（`---` 分隔）→ name/description/version
- Markdown body → 一级标题、二级标题列表（作为 sections/constraints）

**输出类型**: `SkillMdInfo { name, description, version?, title, sections: {heading, content}[] }`

### BehaviorYamlParser

**目标**: 解析 behavior YAML，提取状态-行为映射

**OctoAgent 实际情况**: behavior/ 目录目前使用 Markdown 而非 YAML。设计应支持两种格式：
- YAML 格式：结构化 key-value 映射
- Markdown 格式：提取标题和段落

**提取策略**:
- 如果是 YAML：解析为对象，提取 states/actions 结构
- 如果是 Markdown：按标题分段提取

**输出类型**: `BehaviorInfo { states: {name, description, actions: string[]}[] }`

### DockerfileParser

**目标**: 解析 Dockerfile，提取指令和阶段信息

**OctoAgent 示例**: 133 行完整 Dockerfile，含多阶段构建

**提取策略**:
- 逐行扫描，识别 FROM/RUN/COPY/ENV/EXPOSE/CMD/ENTRYPOINT 等
- 行尾 `\` 拼接多行指令
- 多个 FROM → 多阶段构建检测

**输出类型**: `DockerfileInfo { stages: {baseImage, alias?, instructions: {type, args}[]}[] }`

---

## 3. YAML 依赖分析

**现状**: 项目无 YAML 解析库依赖。

**选项**:
- `js-yaml`（26M weekly downloads，轻量）
- `yaml`（15M weekly downloads，YAML 1.2 完整支持）
- 纯正则解析（适用于简单 frontmatter，但 behavior YAML 需要完整解析）

**建议**: 对 SKILL.md frontmatter 使用简单正则（避免新增依赖），对 behavior YAML 如果结构复杂则考虑 `yaml` 库。但蓝图风险清单提到"纯 Node.js 生态"，应优先使用正则/行级解析。

**最终决策**: 不引入新 YAML 库。使用正则解析 frontmatter（`---` 分隔 + 行级 key: value），behavior YAML 使用 JSON.parse 或正则匹配结构化字段。

---

## 4. 测试组织模式

现有 `tests/panoramic/` 按功能文件组织：
- `schemas.test.ts` — Zod Schema 验证
- `mock-generator.test.ts` — Mock 生命周期
- `project-context.test.ts` — 构建函数
- `generator-registry.test.ts` — Registry 功能

Feature 037 建议：
- `tests/panoramic/skill-md-parser.test.ts`
- `tests/panoramic/behavior-yaml-parser.test.ts`
- `tests/panoramic/dockerfile-parser.test.ts`
- 测试数据放在 `tests/panoramic/fixtures/` 子目录

---

## 5. 关键设计决策

1. **不引入新运行时依赖**: YAML frontmatter 用正则解析，保持纯 Node.js 生态
2. **每个 Parser 独立文件**: `src/panoramic/parsers/skill-md-parser.ts` 等
3. **parseAll 默认实现**: 循环调用 parse()，子类可覆写优化
4. **容错设计**: parse 失败返回降级结果而非抛异常（与 batch-orchestrator 降级模式一致）
5. **filePatterns**: SkillMdParser → `['**/SKILL.md']`，BehaviorYamlParser → `['**/behavior/**/*.yaml', '**/behavior/**/*.yml']`，DockerfileParser → `['**/Dockerfile', '**/Dockerfile.*']`
