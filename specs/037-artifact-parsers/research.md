# Feature 037 技术决策研究

**Feature Branch**: `037-artifact-parsers`
**日期**: 2026-03-19
**输入**: spec.md + tech-research.md

---

## Decision 1: YAML 解析策略

**问题**: SKILL.md 的 frontmatter 和 behavior YAML 文件需要解析 YAML 格式内容，是否引入 YAML 解析库？

**结论**: 不引入新 YAML 库，使用纯正则/行级解析。

**理由**:
1. Constitution 原则 VII（纯 Node.js 生态）要求最小化运行时依赖
2. SKILL.md frontmatter 结构简单，仅需提取 `key: value` 格式的顶层字段（name/description/version）
3. behavior YAML 文件的结构也是扁平或浅嵌套的键值对，正则可覆盖
4. spec.md FR-024 明确要求"系统 MUST NOT 引入新的运行时依赖"

**替代方案**:
- `js-yaml`（26M weekly downloads）: 功能完备但违反零新增依赖要求
- `yaml`（15M weekly downloads）: YAML 1.2 完整支持，同样违反约束
- 内联一个极简 YAML 解析函数: 增加维护负担且仅用于简单场景

---

## Decision 2: Parser 基类 vs 独立实现

**问题**: 三个 Parser 是否需要一个共享基类来实现 parseAll、容错降级等共通逻辑？

**结论**: 使用抽象基类 `AbstractArtifactParser<T>` 封装共通逻辑。

**理由**:
1. `parseAll()` 的默认实现（循环调用 `parse()` + 降级处理）在三个 Parser 中完全一致
2. 容错降级的 try-catch + 降级结果返回逻辑是共通模式
3. ArtifactParserMetadataSchema 验证逻辑可在基类构造函数中统一执行
4. 参考 MockReadmeGenerator 的模式，但 Parser 的共通逻辑比 Generator 更重

**替代方案**:
- 每个 Parser 独立实现所有方法: 代码重复，违反 DRY 原则
- Mixin 模式: TypeScript 中 mixin 对类型推导不友好，增加复杂度
- 工具函数 + 组合: 可行但不如基类清晰

**实现细节**:
```typescript
abstract class AbstractArtifactParser<T> implements ArtifactParser<T> {
  abstract readonly id: string;
  abstract readonly name: string;
  abstract readonly filePatterns: readonly string[];

  // 子类实现核心解析逻辑
  protected abstract doParse(content: string, filePath: string): T;
  // 子类提供降级结果
  protected abstract createFallback(): T;

  async parse(filePath: string): Promise<T> {
    // 统一的容错逻辑
  }

  async parseAll(filePaths: string[]): Promise<T[]> {
    // 循环调用 parse()
  }
}
```

---

## Decision 3: 输出类型定义位置

**问题**: SkillMdInfo、BehaviorInfo、DockerfileInfo 三个输出类型应定义在哪里？

**结论**: 在 `src/panoramic/parsers/types.ts` 中集中定义所有输出类型和对应的 Zod Schema。

**理由**:
1. 三个输出类型之间没有交叉依赖，但都需要被外部消费者（如 Generator）导入
2. 集中定义便于导入管理，避免 `import { SkillMdInfo } from './skill-md-parser'` 导致循环依赖风险
3. Zod Schema 和 TypeScript 类型同文件定义，参考现有 `interfaces.ts` 的模式
4. spec.md FR-033 允许"集中在一个共享类型文件或各 Parser 文件中定义"

**替代方案**:
- 各 Parser 文件中分散定义: 增加导入路径管理成本
- 放入 `interfaces.ts`: 会使已经较大的接口文件进一步膨胀

---

## Decision 4: BehaviorYamlParser 格式检测策略

**问题**: BehaviorYamlParser 需要同时支持 YAML 和 Markdown 两种格式，如何判断文件格式？

**结论**: 两步判断——先按扩展名（`.yaml`/`.yml` vs `.md`），扩展名不明确时按内容特征（是否包含 `---` frontmatter 或 YAML 结构化缩进键值对）。

**理由**:
1. OctoAgent 的 behavior/ 目录目前使用 `.md` 扩展名，扩展名是最可靠的快速判断
2. filePatterns 已区分 `*.yaml`/`*.yml` 和 `*.md`，扩展名天然可用
3. 内容特征作为降级策略，覆盖扩展名缺失或不常规的场景

**替代方案**:
- 仅按扩展名: 无法处理 `.txt` 或无扩展名文件
- 仅按内容特征: 增加误判风险（某些 Markdown 文件可能包含 YAML 代码块）
- 用户显式指定格式: 违反自动化解析的设计原则

---

## Decision 5: Dockerfile 多行指令拼接时机

**问题**: Dockerfile 的 `\` 续行符拼接应在预处理阶段还是解析阶段处理？

**结论**: 在预处理阶段一次性完成所有多行拼接，生成"逻辑行"列表后再逐行解析。

**理由**:
1. 预处理拼接将问题分离——拼接逻辑和指令解析逻辑解耦
2. 拼接后的逻辑行可直接按 `INSTRUCTION args` 格式用正则匹配
3. 避免在指令解析阶段维护跨行状态机

**替代方案**:
- 解析阶段边拼接边解析: 逻辑耦合度高，难以测试
- 正则全文匹配多行指令: 正则复杂度高，可读性差

---

## Decision 6: 测试 Fixture 文件组织

**问题**: 测试 fixture 文件如何组织？

**结论**: 在 `tests/panoramic/fixtures/` 下按 Parser 类型分子目录组织。

**理由**:
1. spec.md FR-031 要求"测试数据（fixture 文件）MUST 放在 `tests/panoramic/fixtures/` 子目录下"
2. 按 Parser 类型分子目录（skill-md/、behavior/、dockerfile/）便于管理和查找
3. 每个子目录包含正常文件、边缘情况文件和降级测试文件

**文件结构**:
```
tests/panoramic/fixtures/
├── skill-md/
│   ├── standard.skill.md      # 标准 frontmatter + sections
│   ├── no-frontmatter.skill.md # 无 frontmatter
│   └── empty.skill.md          # 空文件
├── behavior/
│   ├── standard.yaml           # 标准 YAML 格式
│   ├── markdown-format.md      # Markdown 格式
│   └── invalid.yaml            # 无效格式
└── dockerfile/
    ├── single-stage.Dockerfile # 单阶段
    ├── multi-stage.Dockerfile  # 多阶段
    ├── multiline.Dockerfile    # 多行续行
    └── comments-only.Dockerfile # 仅注释
```

---

## Decision 7: 抽象基类文件位置

**问题**: AbstractArtifactParser 基类文件应放在哪里？

**结论**: 放在 `src/panoramic/parsers/abstract-artifact-parser.ts`。

**理由**:
1. 与三个具体 Parser 同目录，形成内聚的 parsers 模块
2. 不放入 `interfaces.ts`——基类包含实现逻辑，不属于纯接口定义
3. 从 `interfaces.ts` 导入 `ArtifactParser` 接口和 `ArtifactParserMetadataSchema`
