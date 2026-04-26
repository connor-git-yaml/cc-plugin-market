"""Ingestion stage of the graphify pipeline.

Reads raw text files and yields Document objects to downstream stages.
"""
from pathlib import Path
from typing import Iterator
from .utils import Document


def ingest_files(root: Path) -> Iterator[Document]:
    """Walk the directory tree and emit a Document per file."""
    for path in root.rglob("*.txt"):
        text = path.read_text(encoding="utf-8")
        yield Document(path=str(path), text=text)


def ingest_single(path: Path) -> Document:
    """Read a single file into a Document; raises FileNotFoundError if missing."""
    text = path.read_text(encoding="utf-8")
    return Document(path=str(path), text=text)
