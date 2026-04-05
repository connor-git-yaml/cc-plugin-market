# Implementation Plan

1. 为 Spec Driver 新增最小 `project-context-template.yaml` 模板源
2. 扩展 `init-project.sh`，在空项目中创建 canonical `.specify/project-context.yaml`
3. 为 legacy `.specify/project-context.md` 增加确定性的兼容模式与迁移提示
4. 更新共享上下文片段、README、产品活文档和版本号到 075 合同
5. 为 init / migration 路径补充集成测试
6. 重跑 `docs:sync:agents`、product helpers、Codex 包装安装和验证链路
