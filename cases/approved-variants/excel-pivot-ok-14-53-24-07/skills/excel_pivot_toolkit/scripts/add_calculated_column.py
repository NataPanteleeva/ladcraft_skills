async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен"}

    source_path = get_string(params, "sourcePath").strip()
    if not source_path:
        return {"ok": False, "error": "sourcePath обязателен"}
    source_sheet = get_string(params, "sourceSheet").strip()
    target_path = normalize_result_path(get_string(params, "targetPath").strip(), source_path, "calc")
    target_sheet = get_string(params, "targetSheet").strip() or "Данные"
    new_column = get_string(params, "newColumn").strip()
    expression = get_string(params, "expression").strip()
    if not new_column or not expression:
        return {"ok": False, "error": "newColumn и expression обязательны"}

    # Safe ops: "Кол * Цена", "A + B", "A - B", "A / B" using column names as tokens
    try:
        from openpyxl import load_workbook

        buffer = await read_workbook_bytes(vfs, source_path)
        wb = load_workbook(io.BytesIO(buffer), data_only=True)
        parsed = sheet_to_records(wb, source_sheet)
        headers = list(parsed["headers"])
        if new_column in headers:
            return {"ok": False, "error": "Колонка уже есть: " + new_column}

        # Map longer names first to avoid partial replaces
        names = sorted(headers, key=lambda x: len(x), reverse=True)

        def eval_expr(row):
            expr = expression
            for name in names:
                if name and name in expr:
                    expr = expr.replace(name, str(to_number(row.get(name))))
            expr = expr.replace(",", ".")
            if not re.fullmatch(r"[0-9eE+\-*/().\s]+", expr or ""):
                raise ValueError("Небезопасное или непонятное expression: " + expression)
            return round_smart(eval(expr, {"__builtins__": {}}, {}))

        rows = []
        for row in parsed["rows"]:
            item = dict(row)
            try:
                item[new_column] = eval_expr(row)
            except Exception:
                item[new_column] = None
            rows.append(item)
        out_headers = headers + [new_column]
        aoa = records_to_aoa(out_headers, rows)
        write_info = await write_aoa_workbook(
            vfs,
            target_path,
            [{"name": target_sheet, "aoa": aoa}],
            source_path if target_path == source_path else None,
        )
        return analytics_done(
            target_path,
            "Добавлена колонка «" + new_column + "» = " + expression + ".",
            sourcePath=source_path,
            targetSheet=target_sheet,
            newColumn=new_column,
            expression=expression,
            rowCount=len(rows),
            preview=aoa[: min(11, len(aoa))],
            **write_info,
        )
    except Exception as err:
        return {"ok": False, "error": str(err), "sourcePath": source_path}
