# Architecture Checklist: 可读性与维护性热点重构

## Layering

- [x] CHK001 已明确热点入口文件目标是“参数解析 + orchestration”，而不是继续堆积领域 helper
- [x] CHK002 已明确 builder / evaluator / renderer / formatter 应下沉到 `plugins/spec-driver/scripts/lib/`
- [x] CHK003 已明确 `init-project.sh` 保持 shell 入口，但需要清晰的阶段边界

## Reuse

- [x] CHK004 已要求直接复用 `simple-yaml.mjs`、`script-report-io.mjs`、`product-artifact-patchers.mjs`、`script-diagnostics.mjs`
- [x] CHK005 已避免重新引入与 078 等价的 shared helper 分叉

## Testability

- [x] CHK006 已要求提取后的核心模块能被小粒度 unit tests 直接导入验证
- [x] CHK007 已要求 spec / verification 中能追踪“热点入口 -> 核心模块 -> 回归测试”的对应关系

## Safety

- [x] CHK008 已明确 preferred/legacy path、warning shape、JSON 输出字段等兼容边界不能因重构漂移
- [x] CHK009 已明确 081 不做大迁移、不过度抽象、不扩大为平台重写
