# Release Note — Feature 182 增量缓存正确性修复

> `v4.3.x`：修复增量缓存 4 项正确性缺陷（hash 公式分叉 / 混语言碰撞 / checkpoint 重复条目 / full 静默降级）；升级后存量 `skeletonHash` 与 `sourceTargetKey` 一次性失效，首次 batch 增量将触发全量重生成，属预期行为，无需迁移脚本。
