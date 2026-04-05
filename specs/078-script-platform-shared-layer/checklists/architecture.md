# Architecture Checklist: Script Platform 共享层收敛

**Purpose**: 检查 078 技术方案是否沿用现有 `plugins/spec-driver/scripts/lib` 共享层模式，并保持外部合同稳定  
**Created**: 2026-04-05  
**Feature**: [spec.md](../spec.md)

## Layering

- [x] CHK001 078 继续把 Bash 保持为轻量入口，不把新的业务逻辑塞回 shell
- [x] CHK002 共享基础能力放在 `plugins/spec-driver/scripts/lib/`，供 `.mjs` 直接复用
- [x] CHK003 方案未把六条脚本整体迁移到 `src/**` TypeScript，符合“只收敛边界、不大迁移”的蓝图原则

## Existing Reuse

- [x] CHK004 方案复用现有 `simple-yaml.mjs`，而不是新造第二套 YAML lib
- [x] CHK005 方案复用现有 `product-artifact-paths.mjs` 的 preferred/legacy path 合同
- [x] CHK006 方案以现有集成测试为回归基线，而不是重写同步链路

## Dependency / Compatibility

- [x] CHK007 已明确不新增运行时依赖和常驻服务
- [x] CHK008 已明确保持 `--project-root` / `--json` 调用方式与输出路径稳定
- [x] CHK009 已明确继续兼容 Codex / Claude 双端执行

## Verification Strategy

- [x] CHK010 需要为共享 YAML / IO / patch / diagnostics 增加专门 unit tests
- [x] CHK011 需要回归六条主链对应的 integration tests
- [x] CHK012 需要跑 `npm run lint`、`npm run build` 和 `npm test`

## Notes

- 当前最需要避免的架构错误不是“抽少了”，而是“为统一而统一”，把不同报告的业务模板硬塞进同一 renderer。
- 共享层的职责应该停留在 primitives；具体报告内容仍由各脚本自身负责。
