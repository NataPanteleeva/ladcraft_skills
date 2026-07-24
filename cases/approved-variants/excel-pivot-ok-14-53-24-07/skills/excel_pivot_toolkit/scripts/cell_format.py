async def handler(state, params):
    """Prepare open-Cell format op; plugin applies via Asc."""
    params = params if isinstance(params, dict) else {}
    target = get_string(params, "target").strip().lower() or "used"
    if target not in ("used", "selection", "range", "cells"):
        return {"ok": False, "error": "target: used | selection | range | cells"}
    range_addr = get_string(params, "range").strip()
    cells_raw = get_array(params, "cells")
    cells = [str(x or "").strip() for x in cells_raw if str(x or "").strip()]
    if target == "range" and not range_addr:
        return {"ok": False, "error": "range обязателен при target=range"}
    if target == "cells" and not cells:
        return {"ok": False, "error": "cells обязателен при target=cells"}

    fmt_in = params.get("format")
    if not isinstance(fmt_in, dict) or not fmt_in:
        return {"ok": False, "error": "format обязателен (объект со свойствами оформления)"}

    allowed = {
        "bold",
        "italic",
        "fontName",
        "fontSize",
        "fontColorRgb",
        "fillRgb",
        "underline",
        "headerBold",
        "headerFillRgb",
        "bordersOutline",
    }
    unsupported = []
    format_out = {}
    for key, val in fmt_in.items():
        if key not in allowed:
            unsupported.append(str(key))
            continue
        format_out[key] = val

    # Safety: «шапка жирным» на used → headerBold (строка 1), не bold всего листа/столбца.
    if (
        target == "used"
        and format_out.get("bold") is True
        and "headerBold" not in format_out
        and set(format_out.keys()) <= {"bold"}
    ):
        format_out = {"headerBold": True}
    if format_out.get("headerBold") is True and "bold" in format_out:
        del format_out["bold"]

    if not format_out:
        return {
            "ok": False,
            "error": (
                "format пуст после фильтрации. Поддерживаются только: "
                + ", ".join(sorted(allowed))
                + ". Не поддерживаются (в т.ч. толщина/внутренние границы): "
                + (", ".join(unsupported) if unsupported else "—")
            ),
            "supportedFormatKeys": sorted(allowed),
            "rejectedKeys": unsupported,
        }

    data = {
        "target": target,
        "range": range_addr or None,
        "cells": cells if cells else None,
        "format": format_out,
        "rejectedKeys": unsupported if unsupported else None,
    }
    return {
        "ok": True,
        "type": "cell_format",
        "data": data,
        "partial": bool(unsupported),
        "rejectedKeys": unsupported if unsupported else None,
        "note": (
            "Часть полей отброшена (не поддерживаются): " + ", ".join(unsupported)
            if unsupported
            else None
        ),
    }
