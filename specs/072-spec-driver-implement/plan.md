# Implementation Plan

1. 新增 `spec-driver-implement` source skill，固定其输入合同、阶段裁剪和 fallback 规则
2. 更新 `resume` 文档边界，明确与 `implement` 的职责分工
3. 将 `implement` 接入 Codex 安装脚本、postinstall 提示和 workflow registry
4. 更新 product entity / current-spec / README / marketplace 元数据中的入口集合与版本描述
5. 重新生成 `.codex` 包装与产品级派生产物
6. 运行集成测试、helper、lint、build，并回填 verification report
