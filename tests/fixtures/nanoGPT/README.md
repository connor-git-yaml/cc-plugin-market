# nanoGPT (fixture snapshot)

Minimal GPT implementation focused on training causal language models.
The architecture follows the standard decoder-only transformer with multi-head causal
self-attention and feed-forward MLP blocks.

## Core Abstractions

- `GPT` — top-level autoregressive language model with `embedding` + N × `Block` + `lm_head`
- `Block` — transformer block: `LayerNorm` → `CausalSelfAttention` → residual → `LayerNorm` → `MLP` → residual
- `CausalSelfAttention` — multi-head self-attention with causal mask (token i 只能看 token ≤ i)
- `MLP` — feed-forward network with GELU activation

## Architectural Decisions

- 采用 **causal mask** 让 self-attention 只看历史 token，符合 GPT 自回归（autoregressive）语义
- decoder-only architecture（无 encoder）— 与 BERT 类 encoder 区分
- Pre-LayerNorm（norm-before-attention）— 训练稳定性优于 Post-LayerNorm
