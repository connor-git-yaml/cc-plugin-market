"""Parser stage: extract entities and relations from a Document."""
from typing import List
from .utils import Document, Entity, Relation


def parse_document(doc: Document) -> List[Entity]:
    """Extract entities from a Document body using simple regex heuristics."""
    entities: List[Entity] = []
    for line_num, line in enumerate(doc.text.splitlines(), start=1):
        if line.strip().startswith("ENTITY:"):
            name = line.split(":", 1)[1].strip()
            entities.append(Entity(name=name, source_path=doc.path, line=line_num))
    return entities


def extract_relations(entities: List[Entity]) -> List[Relation]:
    """Pair adjacent entities as 'co_occurs_with' relations."""
    relations: List[Relation] = []
    for prev, curr in zip(entities, entities[1:]):
        relations.append(Relation(source=prev.name, target=curr.name, kind="co_occurs_with"))
    return relations
