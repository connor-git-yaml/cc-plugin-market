"""nanoGPT model: GPT / Block / CausalSelfAttention / MLP."""
import math


class CausalSelfAttention:
    """Multi-head causal self-attention.

    使用 causal mask 让 token i 只能看 token ≤ i（GPT 自回归语义）。
    """

    def __init__(self, n_embd, n_head, block_size):
        assert n_embd % n_head == 0
        self.n_embd = n_embd
        self.n_head = n_head
        self.block_size = block_size
        # causal mask: 下三角矩阵（包括对角线）
        self.bias = self._make_causal_mask(block_size)

    def _make_causal_mask(self, block_size):
        # 1 表示可见，0 表示遮蔽
        return [[1 if j <= i else 0 for j in range(block_size)] for i in range(block_size)]

    def forward(self, x):
        # x shape: (B, T, n_embd)
        # 简化版：演示 attention 计算结构，省略真实矩阵运算
        return x  # placeholder


class MLP:
    """Feed-forward network with GELU activation."""

    def __init__(self, n_embd):
        self.n_embd = n_embd
        self.fc = None  # placeholder for Linear(n_embd, 4*n_embd)
        self.proj = None  # placeholder for Linear(4*n_embd, n_embd)

    def forward(self, x):
        # GELU activation: 0.5 * x * (1 + tanh(sqrt(2/pi) * (x + 0.044715 * x^3)))
        return x


class Block:
    """Transformer block: LayerNorm → Attention → residual → LayerNorm → MLP → residual."""

    def __init__(self, n_embd, n_head, block_size):
        self.attn = CausalSelfAttention(n_embd, n_head, block_size)
        self.mlp = MLP(n_embd)

    def forward(self, x):
        x = x + self.attn.forward(x)
        x = x + self.mlp.forward(x)
        return x


class GPT:
    """Top-level autoregressive language model.

    架构：embedding → N × Block → final layer norm → lm_head
    """

    def __init__(self, vocab_size, block_size, n_layer, n_head, n_embd):
        self.vocab_size = vocab_size
        self.block_size = block_size
        self.blocks = [Block(n_embd, n_head, block_size) for _ in range(n_layer)]

    def forward(self, idx):
        x = idx  # placeholder for embedding lookup
        for block in self.blocks:
            x = block.forward(x)
        return x
