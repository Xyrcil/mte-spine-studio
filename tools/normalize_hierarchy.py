"""Preserve Unity reference precision in an existing extraction."""
import json
from pathlib import Path
from extract_assets import precise_references, write_json

for path in Path("public/assets/spines").rglob("hierarchy.json"):
    write_json(path, precise_references(json.loads(path.read_text(encoding="utf-8"))))
