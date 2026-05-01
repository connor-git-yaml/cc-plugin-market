# 架构图谱分析报告

> 自动生成于 2026-04-30

## 概述

| 指标 | 数值 |
|------|------|
| 节点 | 32 |
| 边 | 18 |
| 社区 | 16 |
| 孤立节点 | 25 |

## God Nodes

度数显著高于平均值（> 均值 + 2σ）的核心枢纽节点：

| 节点 | 度数 | 主要关系类型 | 社区 |
|------|------|-------------|------|
| `model` | 7 | contains | 0 |

## 社区列表

| 社区 ID | 节点数 | 内聚度 | 核心节点 Top 3 |
|---------|--------|--------|---------------|
| 0 | 7 | 0.286 | `model.py`, `model.py#Block`, `model.py#CausalSelfAttention` |
| 1 | 6 | 0.333 | `../nanoGPT-output/spectra-full/modules/model.spec.md`, `../nanoGPT-output/spectra-full/modules/bench.spec.md`, `../nanoGPT-output/spectra-full/modules/sample.spec.md` |
| 2 | 4 | 0.500 | `train.py`, `train.py#estimate_loss`, `train.py#get_batch` |
| 3 | 3 | 0.667 | `data/shakespeare_char/prepare.py`, `data/shakespeare_char/prepare.py#decode`, `data/shakespeare_char/prepare.py#encode` |
| 4 | 1 | 1.000 | `../nanoGPT-output/spectra-full/modules/configurator.spec.md` |
| 5 | 1 | 1.000 | `../nanoGPT-output/spectra-full/modules/prepare.spec.md` |
| 6 | 1 | 1.000 | `config/eval_gpt2.py` |
| 7 | 1 | 1.000 | `config/eval_gpt2_large.py` |
| 8 | 1 | 1.000 | `config/eval_gpt2_medium.py` |
| 9 | 1 | 1.000 | `config/eval_gpt2_xl.py` |
| 10 | 1 | 1.000 | `config/finetune_shakespeare.py` |
| 11 | 1 | 1.000 | `config/train_gpt2.py` |
| 12 | 1 | 1.000 | `config/train_shakespeare_char.py` |
| 13 | 1 | 1.000 | `configurator.py` |
| 14 | 1 | 1.000 | `data/openwebtext/prepare.py` |
| 15 | 1 | 1.000 | `data/shakespeare/prepare.py` |

## Surprising Connections

跨社区或低置信度的意外关系：

| Source | Target | 关系类型 | 跨社区 | 置信度 | 评分 |
|--------|--------|---------|--------|--------|------|
| `../nanoGPT-output/spectra-full/modules/model.spec.md` | `model.py` | cross-module | 是 | INFERRED | 7 |
| `../nanoGPT-output/spectra-full/modules/train.spec.md` | `train.py` | cross-module | 是 | INFERRED | 6.49 |
| `../nanoGPT-output/spectra-full/modules/train.spec.md` | `../nanoGPT-output/spectra-full/modules/model.spec.md` | cross-module | 否 | INFERRED | 3.71 |
| `../nanoGPT-output/spectra-full/modules/bench.spec.md` | `../nanoGPT-output/spectra-full/modules/model.spec.md` | cross-module | 否 | INFERRED | 2.86 |
| `../nanoGPT-output/spectra-full/modules/sample.spec.md` | `../nanoGPT-output/spectra-full/modules/model.spec.md` | cross-module | 否 | INFERRED | 2.86 |
| `../nanoGPT-output/spectra-full/modules/bench.spec.md` | `bench.py` | cross-module | 否 | INFERRED | 2.46 |
| `../nanoGPT-output/spectra-full/modules/sample.spec.md` | `sample.py` | cross-module | 否 | INFERRED | 2.46 |

## Knowledge Gaps

检测到 25 个孤立节点（度数 0-1），可能存在文档覆盖不足：

- `../nanoGPT-output/spectra-full/modules/configurator.spec.md`
- `../nanoGPT-output/spectra-full/modules/prepare.spec.md`
- `bench.py`
- `config/eval_gpt2.py`
- `config/eval_gpt2_large.py`
- `config/eval_gpt2_medium.py`
- `config/eval_gpt2_xl.py`
- `config/finetune_shakespeare.py`
- `config/train_gpt2.py`
- `config/train_shakespeare_char.py`
- `configurator.py`
- `data/openwebtext/prepare.py`
- `data/shakespeare/prepare.py`
- `data/shakespeare_char/prepare.py#encode`
- `data/shakespeare_char/prepare.py#decode`
- `model.py#LayerNorm`
- `model.py#CausalSelfAttention`
- `model.py#MLP`
- `model.py#Block`
- `model.py#GPTConfig`
- ...及其他 5 个节点
