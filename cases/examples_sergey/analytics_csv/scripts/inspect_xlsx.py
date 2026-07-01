import re
import sys
import zipfile
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "analytics_csv" / "scripts"))
from analytics_csv_lib import analyze_csv_text, build_sales_report_xlsx

csv_path = Path(__file__).resolve().parent.parent / "data_first_1000.csv"
csv_text = csv_path.read_text(encoding="utf-8")
data = build_sales_report_xlsx(analyze_csv_text(csv_text)["analytics"])
z = zipfile.ZipFile(BytesIO(data))
raw = z.read("xl/workbook.xml")
print(raw[:120])
for match in re.finditer(rb'name="([^"]+)"', raw):
    name_bytes = match.group(1)
    print("sheet hex:", name_bytes.hex(), "utf8:", name_bytes.decode("utf-8", errors="replace"))
