async def handler(state, params):
    """
    Disabled for agent auto-apply. Open-sheet overwrite is the plugin
    «Заменить» button (or local phrase intent). Returning ok:false prevents
    the plugin from applying sheet_replace_from_xlsx.
    """
    params = params if isinstance(params, dict) else {}
    source_path = get_string(params, "sourcePath").strip()
    return {
        "ok": False,
        "error": (
            "Перезапись открытого листа делает плагин (кнопка «Заменить» / «Лист» / «Вставить»). "
            "После sort/filter/pivot ответь строкой Файл: <targetPath> и остановись. "
            "Не вызывай sheet_replace."
        ),
        "hint": "plugin_replace_button",
        "sourcePath": source_path or None,
    }
