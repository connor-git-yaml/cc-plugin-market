"""Shared dataclasses for the graphify pipeline."""
from dataclasses import dataclass


@dataclass
class Document:
    """A raw text document scanned from disk during ingestion."""

    path: str
    text: str


@dataclass
class Entity:
    """A named entity extracted by parse_document."""

    name: str
    source_path: str
    line: int


@dataclass
class Relation:
    """A directed relation between two named entities."""

    source: str
    target: str
    kind: str
