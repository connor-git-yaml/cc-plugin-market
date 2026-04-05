# Tech Research

## 结论

- 这轮不需要新引入治理框架；直接在现有 `065 scorecards` 与 `059 quality-report` 合同上补齐输入即可。
- 更合理的治理口径是“只统计已实现 feature”，而不是要求历史 Draft 与 blueprint 也满足当前 verification freshness。

## 采用方案

1. 新增 `generate-product-quality-reports.mjs`
2. 调整 `generate-product-scorecards.mjs` 的 verification 统计范围
3. 刷新当前真正纳入治理的 stale verification

## 不采用方案

- 不回填全部历史 Draft 的 verification：成本高，且会把历史记录和当前健康度混为一谈
- 不引入新的治理 schema：会让 059/065/068 出现三套并存模型
