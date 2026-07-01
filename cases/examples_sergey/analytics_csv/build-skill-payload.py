#!/usr/bin/env python3
"""Build Ladcraft skill-update payload from cases/analytics_csv/analytics_csv/."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

SKILL_DIR = Path(__file__).resolve().parent / "analytics_csv"
SKILL_MD = SKILL_DIR / "SKILL.md"
OUT = Path(__file__).resolve().parent / ".analytics-csv-skill-payload.json"

PYTHON_LIB_PREPEND = ["analytics_csv_lib.py"]


def load_repo_dotenv() -> dict[str, str]:
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if not env_path.exists():
        return {}
    values: dict[str, str] = {}
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def coerce_env_value(key: str, raw: str, spec: dict) -> object:
    fmt = (spec or {}).get("format")
    if key == "ANALYTICS_CSV_DIRECTORY_ID" or fmt == "number":
        try:
            return int(float(raw))
        except ValueError:
            return raw
    return raw


def build_env_user_with_values(env_schema: dict) -> dict:
    dotenv = load_repo_dotenv()
    merged: dict = {}
    for key, spec in env_schema.items():
        if not isinstance(spec, dict):
            merged[key] = spec
            continue
        entry = dict(spec)
        if key in dotenv:
            entry["value"] = coerce_env_value(key, dotenv[key], spec)
        merged[key] = entry
    return merged


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


def build_env_defaults(env_schema: dict) -> dict[str, object]:
    dotenv = load_repo_dotenv()
    defaults: dict[str, object] = {}
    for key, spec in env_schema.items():
        if key in dotenv:
            defaults[key] = coerce_env_value(key, dotenv[key], spec if isinstance(spec, dict) else {})
        elif key == "ANALYTICS_CSV_DIRECTORY_ID":
            defaults[key] = 109
        elif key == "ANALYTICS_CSV_DEFAULT_INPUT_NAME":
            defaults[key] = "data_first_1000.csv"
    return defaults


def inject_publish_env_fallback(handler_source: str, defaults: dict[str, object]) -> str:
    marker = "    # __PUBLISH_ENV_FALLBACK__"
    if marker not in handler_source:
        return handler_source
    lines = []
    if defaults.get("R7_DISK_BASE_URL"):
        lines.append(f'    if not base_url:\n        base_url = {defaults["R7_DISK_BASE_URL"]!r}.rstrip("/")')
    if defaults.get("R7_DISK_LOGIN"):
        lines.append(f'    if not login:\n        login = {defaults["R7_DISK_LOGIN"]!r}')
    if defaults.get("R7_DISK_PASSWORD"):
        lines.append(f'    if not password:\n        password = {defaults["R7_DISK_PASSWORD"]!r}')
    block = "\n".join(lines) if lines else "    pass"
    return handler_source.replace(marker, block)


def build_python_function(script_file: str, env_schema: dict) -> str:
    scripts_dir = SKILL_DIR / "scripts"
    defaults = build_env_defaults(env_schema)
    handler_path = scripts_dir / script_file
    handler_source = inject_publish_env_fallback(handler_path.read_text(encoding="utf-8"), defaults)
    parts = [handler_source]
    for lib_name in PYTHON_LIB_PREPEND:
        lib_path = scripts_dir / lib_name
        if lib_path.exists():
            parts.append(lib_path.read_text(encoding="utf-8"))
    return "\n".join(parts)


def main() -> None:
    fm, body = split_frontmatter(SKILL_MD.read_text(encoding="utf-8"))
    mcp = fm["mcp_spec"]
    default_capabilities = mcp["default_capabilities"]

    tools = []
    for tool_def in mcp["tools"]:
        name = tool_def["name"]
        meta = load_meta(name)
        script_file = meta.get("scriptFile") or f"{name}.py"
        runtime = meta.get("runtime") or "python@3"
        env_schema: dict = {}
        for src in (tool_def.get("environment") or {}, meta.get("environment") or {}):
            env_schema.update((src.get("user") or {}))

        tools.append(
            {
                "name": name,
                "description": meta.get("description") or tool_def.get("description") or name,
                "runtime": runtime,
                "function": build_python_function(script_file, env_schema),
                "capabilities": default_capabilities,
                "environment": {"app": {}, "user": build_env_user_with_values(env_schema)},
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
        "tags": fm.get("tags", ["analytics", "csv", "r7-disk"]),
        "version": fm.get("version", "1.0.0"),
        "category": fm.get("category", "productivity"),
        "icon": "chart",
        "tools": tools,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(str(OUT))
    print(f"tools: {len(tools)}")


if __name__ == "__main__":
    main()
