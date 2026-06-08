## 自用工具与反馈闭环（Dogfooding）

本项目的核心产物就是 Spectra（codebase → agent context）与 Spec Driver（spec-driven 研发流程）。研发自身需求时**优先 dogfood 这两个工具**，并在每个需求收尾回收一手使用反馈，形成"自用 → 暴露问题 → 改进"的闭环。

### 执行约定

- **尽量自用**：实现 / 修复 / 重构需求时优先用 Spec Driver 编排流程；需要代码库结构化上下文（依赖、影响面、symbol 定位、跨包关系）时优先调 Spectra MCP 工具，而非纯靠 Grep / Read 手工翻
- **每个需求收尾必附"工具使用反馈"**：在交付报告末尾追加一节，如实记录本次用 Spectra / Spec Driver 遇到的问题；没遇到就显式写"无"，不要省略这一节
- **反馈至少覆盖以下维度**：
  - MCP 是否可用（连接失败 / 工具缺失 / 调用报错 / namespace 不对）
  - 返回信息是否够用（字段缺失 / 上下文不全 / 缺 next-step 提示导致不知道下一步该调什么）
  - 流程是否顺畅（Spec Driver 的 gate / phase / 产物是否卡住、冗余或难用）
  - 结果是否准确（impact / graph / fuzzy match 等给出错误或误导性结果）
- **反馈是产品输入而非噪声**：发现的真问题应转化为后续 Fix / 改进 Feature 候选（按"大范围改动不塞当前 Milestone"原则分流到合适里程碑），不要在当前需求里顺手乱改工具源码

### 不适用场景

- 纯文档 / 纯配置 / 一行 typo 等无需结构化上下文的微改动可不强制自用，但仍建议记一句"本次未用及原因"
- 对 Spectra / Spec Driver 自身源码的改动需求按正常 Spec Driver 流程走，反馈聚焦"改动前后自用体验差异"
