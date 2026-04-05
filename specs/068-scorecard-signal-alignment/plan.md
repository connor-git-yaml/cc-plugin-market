# Implementation Plan

1. 新增产品级 quality report helper，并回写 entity/catalog 摘要
2. 校准 scorecard 的 verification freshness 口径，只统计已实现 feature
3. 接入 `spec-driver-sync` 治理事实链路
4. 刷新当前纳入治理但 stale 的 verification 报告
5. 运行定向测试、helper、lint、build 验证
