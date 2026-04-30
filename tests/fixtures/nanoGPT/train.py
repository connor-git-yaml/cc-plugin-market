"""nanoGPT training loop with simple AdamW optimizer wrapper."""
from .model import GPT


def train(model: GPT, data, epochs=10, lr=1e-3):
    """Mini training loop. 每个 epoch 跑一遍 batch，反向传播 + 参数更新。"""
    for epoch in range(epochs):
        for batch in data:
            # 简化：placeholder for forward/backward/step
            _ = model.forward(batch)
    return model


def make_optimizer(model: GPT, lr=1e-3):
    """构造 AdamW 优化器（placeholder）。"""
    return {"lr": lr, "model": model}
