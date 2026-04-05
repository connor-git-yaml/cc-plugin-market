# Implementation Plan

1. 抽取产品生成产物共享路径 helper，定义 `current-spec` 与 `_generated` 的统一合同
2. 迁移 entity / workflow / quality / scorecard / adoption 五条生成链路到新目录
3. 更新 `spec-driver-sync` 的 skill、workflow、agent 文档到新路径
4. 更新相关集成测试与现有规范文档中的路径引用
5. 重新生成当前仓库的产品级派生产物，并删除旧路径历史产物
6. 运行 helper、定向测试、`lint`、`build` 验证

