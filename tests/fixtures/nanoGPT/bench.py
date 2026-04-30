"""nanoGPT benchmarking harness — measure tokens/second on a fixed config."""
from .model import GPT
import time


def bench_throughput(model: GPT, n_iters=100):
    """Measure model.forward() throughput."""
    start = time.time()
    for _ in range(n_iters):
        _ = model.forward([0])  # dummy input
    elapsed = time.time() - start
    return n_iters / elapsed if elapsed > 0 else 0
