async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "top")
    category_field = get_string(params, "categoryField").strip()
    value_field = get_string(params, "valueField").strip()
    aggregation = get_string(params, "aggregation").strip().lower() or "sum"
    if aggregation not in ("sum", "count", "avg", "min", "max"):
        aggregation = "sum"
    top_n = 10
    raw_n = params.get("topN")
    if isinstance(raw_n, (int, float)) and math.isfinite(float(raw_n)):
        top_n = max(1, min(50, int(round(float(raw_n)))))
    include_other = bool(params.get("includeOther")) if params.get("includeOther") is not None else True
    if not category_field or not value_field:
        return {"ok": False, "error": "categoryField и valueField обязательны"}

    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        for field in (category_field, value_field):
            if field not in parsed["headers"]:
                return {"ok": False, "error": "Нет колонки: " + field}

        groups = {}
        for row in parsed["rows"]:
            key = cell_key(row.get(category_field))
            if key not in groups:
                groups[key] = {"label": row.get(category_field), "values": []}
            if aggregation == "count":
                groups[key]["values"].append(1.0)
            else:
                n = to_number(row.get(value_field))
                if math.isfinite(n):
                    groups[key]["values"].append(n)

        ranked = []
        for g in groups.values():
            agg = aggregate(g["values"], aggregation)
            ranked.append({"category": g["label"], "value": None if agg is None else round_smart(agg)})
        ranked.sort(key=lambda x: (x["value"] is None, -(x["value"] or 0)))

        top = ranked[:top_n]
        other_vals = [x["value"] for x in ranked[top_n:] if x["value"] is not None]
        kpi_total = aggregate([x["value"] for x in ranked if x["value"] is not None], "sum")
        top_aoa = [[category_field, value_field + " (" + aggregation + ")"]]
        for item in top:
            top_aoa.append([item["category"], item["value"]])
        if include_other and other_vals:
            top_aoa.append(["Прочее", round_smart(aggregate(other_vals, "sum"))])

        kpi_aoa = [
            ["Метрика", "Значение"],
            ["Всего категорий", len(ranked)],
            ["Топ N", top_n],
            ["Сумма меры", None if kpi_total is None else round_smart(kpi_total)],
        ]
        if top:
            kpi_aoa.append(["Лидер", top[0]["category"]])
            kpi_aoa.append(["Значение лидера", top[0]["value"]])

        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [
                {"name": "Топ", "aoa": top_aoa},
                {"name": "KPI", "aoa": kpi_aoa},
            ],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Топ-"
            + str(top_n)
            + " по «"
            + category_field
            + "» / «"
            + value_field
            + "» ("
            + aggregation
            + ").",
            sourcePath=source_path,
            categoryField=category_field,
            valueField=value_field,
            aggregation=aggregation,
            topN=top_n,
            preview=top_aoa[: min(12, len(top_aoa))],
            kpi=kpi_aoa,
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
