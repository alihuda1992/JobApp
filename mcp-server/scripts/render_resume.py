#!/usr/bin/env python3
"""
Called by the MCP server's render_tailored_resume tool.
Reads a JSON operations payload from stdin, applies edits to the resume
template, and saves the result.

Input (stdin):
{
  "template_path": "...",
  "output_path": "...",
  "operations": [
    {"op": "set_text",          "anchor": "...", "text": "...", "occurrence": 1},
    {"op": "replace_bullets",   "anchor": "...", "bullets": ["...", "..."], "occurrence": 1},
    {"op": "remove_role",       "anchor": "...", "occurrence": 1},
    {"op": "set_skill_category","label": "Transformation:  ", "items": "...", "occurrence": 1}
  ]
}

Output (stdout): {"saved": "<output_path>", "purged_bullets": N}
Errors go to stderr; exit code 1 on failure.
"""
import sys
import json
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_resume import (
    load, set_paragraph_text, find_paragraph,
    replace_bullets_after, remove_role_block,
    set_skill_category, purge_empty_bullets, save,
)

data = json.load(sys.stdin)
template_path = data["template_path"]
output_path   = data["output_path"]
operations    = data["operations"]

doc = load(template_path)

for op in operations:
    kind       = op["op"]
    occurrence = int(op.get("occurrence", 1))

    if kind == "set_text":
        p = find_paragraph(doc, op["anchor"], occurrence)
        set_paragraph_text(p, op["text"])

    elif kind == "replace_bullets":
        p = find_paragraph(doc, op["anchor"], occurrence)
        replace_bullets_after(doc, p, op["bullets"])

    elif kind == "remove_role":
        try:
            p = find_paragraph(doc, op["anchor"], occurrence)
            remove_role_block(doc, p)
            # Also remove the company-name line if specified
            if op.get("company_anchor"):
                try:
                    cp = find_paragraph(doc, op["company_anchor"])
                    from build_resume import remove_paragraph
                    remove_paragraph(cp)
                except ValueError:
                    pass
        except ValueError as e:
            print(f"[warn] remove_role skipped — {e}", file=sys.stderr)

    elif kind == "set_skill_category":
        set_skill_category(doc, op["label"], op["items"], occurrence)

    else:
        print(f"[warn] unknown op {kind!r}", file=sys.stderr)

purged = purge_empty_bullets(doc)
save(doc, output_path)
print(json.dumps({"saved": output_path, "purged_bullets": purged}))
