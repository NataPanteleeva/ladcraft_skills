#!/usr/bin/env python3
"""Build Ladcraft skill payload for excel_table_disk_toolkit."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

CASE = Path(__file__).resolve().parent
SKILL_DIR = CASE / "excel_table_disk_toolkit"
SKILL_MD = SKILL_DIR / "SKILL.md"
OUT = CASE / ".excel-table-disk-skill-payload.json"

PYTHON_LIB_PREPEND = {"disk_table_op": ["_disk_lib_src.py"]}
JS_LIB_PREPEND = {"list_xlsx_on_disk": ["_r7_disk_xlsx_common.js"]}

R7_DISK_ENV_USER = {
    "R7_DISK_BASE_URL": {"title": "Базовый URL Р7-Диска", "format": "string"},
    "R7_DISK_LOGIN": {"title": "Логин Р7-Диска", "format": "string"},
    "R7_DISK_PASSWORD": {"title": "Пароль Р7-Диска", "format": "string", "secret": True},
}


def load_install_defaults() -> dict[str, str]:
    path = CASE / "install.defaults.json"
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    out: dict[str, str] = {}
    for key in R7_DISK_ENV_USER:
        value = raw.get(key) if isinstance(raw, dict) else None
        if isinstance(value, str) and value.strip() and value.strip() != "YOUR_PASSWORD_HERE":
            out[key] = value.strip()
    return out


def load_repo_dotenv() -> dict[str, str]:
    env_path = CASE.parent.parent / ".env"
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
    return raw


def build_env_user_with_values(env_schema: dict) -> dict:
    dotenv = {**load_install_defaults(), **load_repo_dotenv()}
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
    text = (SKILL_DIR / "scripts" / f"{tool_name}.meta.md").read_text(encoding="utf-8")
    return yaml.safe_load(text.split("---", 2)[1])


def build_env_defaults(env_schema: dict) -> dict[str, object]:
    dotenv = {**load_install_defaults(), **load_repo_dotenv()}
    defaults: dict[str, object] = {}
    for key in R7_DISK_ENV_USER:
        if key in dotenv:
            defaults[key] = dotenv[key]
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


def inject_js_publish_env_fallback(source: str, defaults: dict[str, object]) -> str:
    marker = "\t// __PUBLISH_ENV_FALLBACK__"
    if marker not in source:
        return source
    lines = []
    if defaults.get("R7_DISK_BASE_URL"):
        url = str(defaults["R7_DISK_BASE_URL"]).rstrip("/")
        lines.append(f"\tif (!baseUrl) baseUrl = {url!r};")
    if defaults.get("R7_DISK_LOGIN"):
        lines.append(f"\tif (!login) login = {defaults['R7_DISK_LOGIN']!r};")
    if defaults.get("R7_DISK_PASSWORD"):
        lines.append(f"\tif (!password) password = {defaults['R7_DISK_PASSWORD']!r};")
    block = "\n".join(lines) if lines else "\t/* no defaults */"
    return source.replace(marker, block)


def build_function_source(tool_name: str, script_file: str, runtime: str, skill_env_schema: dict) -> str:
    scripts_dir = SKILL_DIR / "scripts"
    handler_source = (scripts_dir / script_file).read_text(encoding="utf-8")
    defaults = build_env_defaults(skill_env_schema)
    if runtime.startswith("python"):
        handler_source = inject_publish_env_fallback(handler_source, defaults)
        parts = []
        for lib_name in PYTHON_LIB_PREPEND.get(tool_name, []):
            parts.append((scripts_dir / lib_name).read_text(encoding="utf-8"))
        parts.append(handler_source)
        return "\n".join(parts)
    parts = []
    for lib_name in JS_LIB_PREPEND.get(tool_name, []):
        lib_source = (scripts_dir / lib_name).read_text(encoding="utf-8")
        parts.append(inject_js_publish_env_fallback(lib_source, defaults))
    parts.append(handler_source)
    return "\n".join(parts)


def main() -> None:
    fm, body = split_frontmatter(SKILL_MD.read_text(encoding="utf-8"))
    mcp = fm["mcp_spec"]
    default_capabilities = mcp["default_capabilities"]
    tool_defs = mcp["tools"]
    first_meta = load_meta(tool_defs[0]["name"])
    skill_env_schema = dict(R7_DISK_ENV_USER)
    skill_env_publish = build_env_user_with_values(skill_env_schema)

    tools = []
    for index, tool_def in enumerate(tool_defs):
        name = tool_def["name"]
        meta = load_meta(name)
        runtime = meta.get("runtime") or "python@3"
        script_file = meta.get("scriptFile") or f"{name}.js"
        tools.append(
            {
                "name": name,
                "description": meta.get("description") or name,
                "runtime": runtime,
                "function": build_function_source(name, script_file, runtime, skill_env_schema),
                "capabilities": default_capabilities,
                "environment": {"app": {}, "user": skill_env_publish if index == 0 else {}},
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
        "description": fm["description"] if isinstance(fm["description"], str) else str(fm["description"]),
        "detailed_description": body,
        "tags": fm.get("tags", []),
        "version": fm.get("version", "1.0.0"),
        "category": fm.get("category", "productivity"),
        "icon": "table",
        "tools": tools,
    }
    if isinstance(payload["description"], dict):
        payload["description"] = body[:200]
    # yaml may parse description as folded
    desc = fm.get("description")
    if not isinstance(desc, str):
        payload["description"] = "Табличная аналитика Excel на Р7-Диске (list + ops)."
    else:
        payload["description"] = " ".join(desc.split())

    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    print(str(OUT))
    print(f"tools: {len(tools)} sizes={[len(t['function']) for t in tools]}")


if __name__ == "__main__":
    main()
