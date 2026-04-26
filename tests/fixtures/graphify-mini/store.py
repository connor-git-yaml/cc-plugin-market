"""Store stage: persist entities and relations into an in-memory graph."""
from collections import defaultdict
from typing import Dict, List
from .utils import Entity, Relation


class GraphStore:
    """In-memory key-value store for graph nodes and edges."""

    def __init__(self) -> None:
        self.entities: Dict[str, Entity] = {}
        self.relations: List[Relation] = []
        self.adjacency: Dict[str, List[str]] = defaultdict(list)

    def add_entity(self, entity: Entity) -> None:
        self.entities[entity.name] = entity

    def add_relation(self, relation: Relation) -> None:
        self.relations.append(relation)
        self.adjacency[relation.source].append(relation.target)

    def neighbors(self, name: str) -> List[str]:
        return list(self.adjacency.get(name, []))
