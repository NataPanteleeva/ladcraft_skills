#!/usr/bin/env python3
"""Build Ladcraft skill-update payload from cases/r7-disk-api/."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent
SKILL_MD = SKILL_DIR / "SKILL.md"
OUT = SKILL_DIR / ".r7-skill-payload.json"


def split_frontmatter(text: str) -> tuple[dict, str]:
    parts = text.split("---", 2)
    if len(parts) < 3:
        raise SystemExit("SKILL.md: missing YAML frontmatter")
    return yaml.safe_load(parts[1]), parts[2].strip()


def load_meta(tool_name: str) -> dict:
    meta_path = SKILL_DIR / "scripts" / f"{tool_name}.meta.md"
    text = meta_path.read_text(encoding="utf-8")
    parts = text.split("---", 2)
    return yaml.safe_load(parts[1])


def main() -> None:
    fm, body = split_frontmatter(SKILL_MD.read_text(encoding="utf-8"))
    mcp = fm["mcp_spec"]
    default_capabilities = mcp["default_capabilities"]
    tools_by_name = {t["name"]: t for t in mcp["tools"]}

    tools = []
    for tool_def in mcp["tools"]:
        name = tool_def["name"]
        meta = load_meta(name)
        script_file = meta.get("scriptFile") or f"{name}.js"
        handler_path = SKILL_DIR / "scripts" / script_file
        lib_path = SKILL_DIR / "scripts" / "gost34_docx_formatter.lib.js"
        handler_code = handler_path.read_text(encoding="utf-8")
        if script_file == "r7_disk_gost34_generate.js" and lib_path.exists():
            function = lib_path.read_text(encoding="utf-8") + "\n" + handler_code
        else:
            function = handler_code
        env_user = {}
        for src in (tool_def.get("environment") or {}, meta.get("environment") or {}):
            env_user.update((src.get("user") or {}))

        tools.append(
            {
                "name": name,
                "description": meta.get("description") or tool_def.get("description") or name,
                "runtime": "nodejs@24",
                "function": function,
                "capabilities": default_capabilities,
                "environment": {"app": {}, "user": env_user},
                "resources": meta["resources"],
                "schemas": {
                    "input": meta["schemas"]["input"],
                    "output": meta["schemas"]["output"],
                },
            }
        )

    payload = {
        "skill": fm["name"],
        "name": fm["name"],
        "description": fm["description"],
        "detailed_description": body,
        "tags": ["r7", "disk", "gost34", "docx"],
        "version": "1.0.0",
        "category": "hr_recruiting",
        "icon": "document",
        "tools": tools,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(str(OUT))
    print(f"tools: {len(tools)}")


if __name__ == "__main__":
    main()
