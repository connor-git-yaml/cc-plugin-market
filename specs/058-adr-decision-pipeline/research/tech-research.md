# Tech Research: 058 ADR 决策流水线

## 调研模式

- mode: `tech-only`
- reason: 058 是纯技术文档编排能力，重点在 ADR 结构、证据来源和 batch 接入，不涉及额外产品调研

## 代码库现状

### 现有主链路

- `src/panoramic/batch-project-docs.ts` 已经负责项目级 generator 编排，并在末尾补 `architecture-narrative`
- `src/panoramic/architecture-narrative.ts` 已经提供了项目级“技术叙事”事实层，适合作为 ADR pipeline 的上游
- `src/panoramic/pattern-hints-generator.ts` 提供了规则驱动的模式提示和 explanation，可作为 ADR 的辅助信号
- `specs/products/*/current-spec.md` 已经形成产品级活文档，是当前仓库可直接消费的产品/技术决策事实源

### 现有缺口

- batch 结果缺少“为什么这么设计”的文档层，当前只有 architecture narrative 和 pattern hints，还没有 ADR 草稿
- 真实项目上的设计理由仍散落在 `blueprint/spec/current-spec/commit` 中，无法统一输出
- 项目级文档编排还没有多文件子目录输出机制，`docs/adr/*.md` 需要作为新的嵌套目录产物接入

## 开源格式与可借鉴方案

### MADR / ADR

- MADR 提供了稳定的 ADR 章节组织方式，核心包括 `decision / context / consequences / alternatives`
- 这类格式适合被 reverse-spec 自动草拟，再由人审定，而不是在仓库内自创一套决策模板

### 结论

- 058 不需要引入完整 `adr-tools` CLI 才能起步；第一版先对齐 ADR/MADR 结构即可
- 输出应保持“候选 ADR 草稿”定位，状态默认 `proposed`

## 设计判断

1. **先做规则驱动，不先引入 LLM**
   - 058 的核心不是 prose 质量，而是“能不能从多源事实中稳定抽出候选决策”
   - 先用确定性信号匹配，可保证测试稳定、可解释、易回归

2. **先挂到 batch-project-docs，而不是新建 generator registry 分支**
   - ADR pipeline 是项目级编排后置环节，和 `architecture-narrative` 一样更像 batch augmentation，而不是传统单文档 generator
   - 这样接入成本低，也便于直接消费前面已经生成好的 structured outputs

3. **支持多源但允许缺源降级**
   - 对本仓库，可消费 `current-spec`、spec、blueprint、git commit
   - 对外部仓库，可回退到 `architecture-narrative`、`pattern-hints` 与源码路径信号

4. **第一版只做候选 ADR，不做决策冲突合并**
   - 冲突检测和 provenance 质量门更适合留给 059
   - 058 先把候选 ADR 和索引打通

## 推荐实现

- 新增 `src/panoramic/adr-decision-pipeline.ts`
- 在其中实现：
  - ADR corpus 收集
  - 多规则候选决策识别
  - ADR markdown / json 渲染
  - `docs/adr/index.md` 索引生成
- 修改 `src/panoramic/batch-project-docs.ts`
  - 在 `architecture-narrative` 之后执行 ADR pipeline
  - 将 `docs/adr/*.md` 纳入 generated docs 摘要
- 增加：
  - `templates/adr-draft.hbs`
  - `templates/adr-index.hbs`
  - `tests/panoramic/adr-decision-pipeline.test.ts`
  - `tests/integration/batch-panoramic-doc-suite.test.ts` 回归
