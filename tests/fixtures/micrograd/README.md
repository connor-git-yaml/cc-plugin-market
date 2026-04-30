# micrograd (fixture snapshot)

A tiny scalar-valued autograd engine. Written for educational purposes: implements
backpropagation over a dynamic, build-as-you-go computational graph using `Value`
nodes that store their gradient and a `_backward` closure.

## Core Abstractions

- `Value` — scalar-valued node in the autograd graph; holds `data`, `grad`, `_op`,
  and a `_backward` callable
- `Neuron` — a single linear unit with bias + non-linearity
- `Layer` — collection of `Neuron`s
- `MLP` — multi-layer perceptron stacked from `Layer`s

## Architectural Decisions

- 反向传播采用动态计算图（dynamic computational graph）— `Value` 节点的
  `_backward` 闭包累加梯度，避免显式构建反向图
- 不依赖任何外部库（vanilla Python）— 教学目的的简洁性优先
