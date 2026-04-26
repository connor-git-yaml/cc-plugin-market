"""Query stage: BFS traversal over GraphStore."""
from collections import deque
from typing import List, Set
from .store import GraphStore


def find_path(store: GraphStore, src: str, dst: str, max_depth: int = 5) -> List[str]:
    """Return a path from src to dst via BFS, or [] if none exists within max_depth."""
    if src == dst:
        return [src]
    queue = deque([(src, [src])])
    visited: Set[str] = {src}
    while queue:
        node, path = queue.popleft()
        if len(path) > max_depth:
            continue
        for neighbor in store.neighbors(node):
            if neighbor == dst:
                return path + [neighbor]
            if neighbor not in visited:
                visited.add(neighbor)
                queue.append((neighbor, path + [neighbor]))
    return []
