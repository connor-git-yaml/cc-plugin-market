# 架构图谱分析报告

> 自动生成于 2026-04-30

## 概述

| 指标 | 数值 |
|------|------|
| 节点 | 13 |
| 边 | 6 |
| 社区 | 7 |
| 孤立节点 | 11 |

## God Nodes

未检测到度数异常高的节点。

## 社区列表

| 社区 ID | 节点数 | 内聚度 | 核心节点 Top 3 |
|---------|--------|--------|---------------|
| 0 | 5 | 0.400 | `micrograd/nn.py`, `micrograd/nn.py#Layer`, `micrograd/nn.py#MLP` |
| 1 | 3 | 0.667 | `micrograd/engine.py`, `../micrograd-output/spectra-full/modules/engine.spec.md`, `micrograd/engine.py#Value` |
| 2 | 1 | 1.000 | `../micrograd-output/spectra-full/modules/__init__.spec.md` |
| 3 | 1 | 1.000 | `../micrograd-output/spectra-full/modules/nn.spec.md` |
| 4 | 1 | 1.000 | `../micrograd-output/spectra-full/modules/setup.spec.md` |
| 5 | 1 | 1.000 | `micrograd/__init__.py` |
| 6 | 1 | 1.000 | `setup.py` |

## Surprising Connections

跨社区或低置信度的意外关系：

| Source | Target | 关系类型 | 跨社区 | 置信度 | 评分 |
|--------|--------|---------|--------|--------|------|
| `../micrograd-output/spectra-full/modules/engine.spec.md` | `micrograd/engine.py` | cross-module | 否 | INFERRED | 3 |

## Knowledge Gaps

检测到 11 个孤立节点（度数 0-1），可能存在文档覆盖不足：

- `../micrograd-output/spectra-full/modules/__init__.spec.md`
- `../micrograd-output/spectra-full/modules/engine.spec.md`
- `../micrograd-output/spectra-full/modules/nn.spec.md`
- `../micrograd-output/spectra-full/modules/setup.spec.md`
- `micrograd/__init__.py`
- `micrograd/engine.py#Value`
- `micrograd/nn.py#Module`
- `micrograd/nn.py#Neuron`
- `micrograd/nn.py#Layer`
- `micrograd/nn.py#MLP`
- `setup.py`
