---
feature_id: 187
artifact: quickstart
created: 2026-06-14
---

# F187 快速上手指南

## 前置条件

1. **Python 3.11 或 3.12** 可用（host Python 3.14 不推荐，swebench 依赖可能有兼容问题）
2. **Docker 29+** 已启动（`docker info` 无错误）
3. **已 pull arm64 镜像**（smoke 前执行，约 200MB-1GB）

## 一次性 bootstrap

```bash
# 1. 安装 swebench Python venv（仅需跑一次）
bash scripts/setup-swebench-venv.sh

# 2. 验证 arm64 镜像可用（SWE-L003 对应实例）
docker manifest inspect ghcr.io/epoch-research/swe-bench.eval.arm64.pytest-dev__pytest-11143:latest

# 若上述命令报错（镜像不存在），说明该实例无 arm64 原生镜像，smoke 将使用 Rosetta 回退
```

## 运行单元测试（默认，无 docker 依赖）

```bash
npx vitest run tests/unit/feature-187-*.test.ts
```

## 运行 smoke 测试（需 docker + swebench venv）

```bash
# SWE-L003 单实例真实执行（约 30-120 秒）
RUN_SWEBENCH_SMOKE=1 npx vitest run tests/unit/feature-187-swebench-oracle.test.ts
```

## 使用新 oracle 执行单次评测

```bash
# 给定 SWE-L003 fixture + 候选 patch，执行 swebench oracle
node scripts/eval-task-runner.mjs \
  --task SWE-L003 \
  --tool spec-driver \
  --cleanup on-success

# 使用 experiment manifest 覆盖参数
node scripts/swe-bench-verified-cohort-batch.mjs \
  --smoke \
  --manifest experiment-manifest.yaml
```

## 冻结 oracle 语义（跑批前必须执行）

```bash
# 生成 oracleSpecHash 并写入 preregistration.md
node -e "
import('./scripts/lib/preregistration-check.mjs').then(m => {
  const block = m.freezeBlock(taskIds, { oracleKind: 'swebench-execution' });
  console.log(JSON.stringify(block, null, 2));
});
"
```

## 验收检查（Phase D）

```bash
npx vitest run         # 全量单测零失败
npm run build          # 零类型错误
npm run repo:check     # 零告警

# SC-015 护栏
git diff --exit-code -- scripts/swe-bench-fixture-import.py   # importer 零改动
rg "ANTHROPIC_API_KEY" scripts/ --include="*.mjs" | grep "必选\|required"  # 无 API key 必选前提
git check-ignore run_artifacts/ scripts/.swebench-venv/        # 产物路径已 gitignore
```
