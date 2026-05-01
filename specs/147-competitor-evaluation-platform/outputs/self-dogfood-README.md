# self-dogfood outputs（本地查看）

self-dogfood 项目的工具产物**未入库**（spectra 6.8MB + graphify 17MB + aider 12KB ≈ 24MB），主要因 graphify graph.json (5.5MB) + cache (7.5MB) + spectra modules/panoramic.spec.md (984KB outlier)。

如要查看：
- spectra: `~/.spectra-baselines/self-dogfood-output/spectra-full/{modules,project,_meta}/`
- graphify: `~/.spectra-baselines/self-dogfood-output/graphify-full/{GRAPH_REPORT.md,graph.json,graph.html}`
- aider-repomap: `~/.spectra-baselines/self-dogfood-output/aider-repomap-full/aider-repomap-stdout.log`

跑一次 baseline-collect 即可重生：

```bash
npm run baseline:collect -- --target self-dogfood --tool spectra --mode full
npm run eval:competitor -- --target self-dogfood --tool graphify --frozen
npm run eval:competitor -- --target self-dogfood --tool aider-repomap --frozen
```
