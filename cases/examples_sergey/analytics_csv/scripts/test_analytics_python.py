"""Local smoke test for Python analytics + openpyxl XLSX builder."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "analytics_csv" / "scripts"))

from analytics_csv_lib import analyze_csv_text, build_sales_report_xlsx

csv_path = ROOT / "data_first_1000.csv"
out_path = ROOT / "analytics_csv" / "templates" / "sales_report_python_test.xlsx"

csv_text = csv_path.read_text(encoding="utf-8")
result = analyze_csv_text(csv_text)
if not result.get("ok"):
    raise SystemExit(result.get("error"))

xlsx_bytes = build_sales_report_xlsx(result["analytics"])
out_path.write_bytes(xlsx_bytes)
print("Written:", out_path, len(xlsx_bytes), "bytes")
print("Summary:", result["analytics"]["summary"])

import zipfile

with zipfile.ZipFile(out_path) as zf:
    print("testzip:", zf.testzip())
