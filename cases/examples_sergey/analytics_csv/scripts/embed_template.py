"""Embed sales_report_template.xlsx as base64 into xlsx_report_builder.lib.js"""
from __future__ import annotations

import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "analytics_csv" / "templates" / "sales_report_template.xlsx"
OUT = ROOT / "analytics_csv" / "scripts" / "xlsx_template.b64.js"

MARKER_START = "/*__XLSX_TEMPLATE_B64_START__*/"
MARKER_END = "/*__XLSX_TEMPLATE_B64_END__*/"


def main() -> None:
    data = TEMPLATE.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    chunks = [b64[i : i + 76] for i in range(0, len(b64), 76)]
    body = "\n".join(f'  "{line}",' for line in chunks)
    content = (
        f"{MARKER_START}\n"
        f"const XLSX_TEMPLATE_BASE64_CHUNKS = [\n{body}\n];\n"
        f"const XLSX_TEMPLATE_BASE64 = XLSX_TEMPLATE_BASE64_CHUNKS.join('');\n"
        f"{MARKER_END}\n"
    )
    OUT.write_text(content, encoding="utf-8")
    print(f"Written {OUT} ({len(data)} bytes -> {len(b64)} b64 chars)")


if __name__ == "__main__":
    main()
