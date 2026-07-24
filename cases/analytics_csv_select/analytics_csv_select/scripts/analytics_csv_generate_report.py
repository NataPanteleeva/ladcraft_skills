import re

async def handler(state, params):
    warnings: list[str] = []
    params = params if isinstance(params, dict) else {}
    user_env = read_user_env(state if isinstance(state, dict) else {})
    skill_storage = resolve_skill_storage(state if isinstance(state, dict) else {})
    base_url = resolve_base_url(state if isinstance(state, dict) else {}, params, skill_storage)
    login = pick_string(params.get("login"), user_env.get("R7_DISK_LOGIN"))
    password = pick_string(params.get("password"), user_env.get("R7_DISK_PASSWORD"))
    # __PUBLISH_ENV_FALLBACK__

    if not base_url:
        return fail(
            "Не задан R7_DISK_BASE_URL в настройках установки навыка. "
            "Агент не должен запрашивать URL у пользователя — проверьте настройки навыка.",
            warnings,
        )

    csv_document_id = resolve_positive_id(params.get("csv_document_id"))
    is_shared = truthy_param(params.get("is_shared"))
    needs_personal_upload = (
        truthy_param(params.get("needs_personal_upload"))
        or truthy_param(params.get("upload_to_personal"))
        or is_shared
    )
    directory_id = resolve_positive_id(params.get("directory_id"))
    if directory_id is None and not needs_personal_upload and csv_document_id is None:
        directory_id = resolve_positive_id(user_env.get("ANALYTICS_CSV_DIRECTORY_ID", 109))
    csv_name = pick_string(params.get("csv_name"), user_env.get("ANALYTICS_CSV_DEFAULT_INPUT_NAME") or "data_first_1000.csv")
    output_name = ensure_xlsx_extension(
        pick_string(params.get("output_name"), user_env.get("ANALYTICS_CSV_DEFAULT_OUTPUT_NAME") or build_default_output_name())
    )
    conflict_policy = pick_string(params.get("conflict_policy"), "overwrite").lower()

    if not csv_name:
        return fail("Не задан csv_name.", warnings)
    if csv_document_id is None and directory_id is None:
        return fail("Не задан directory_id или csv_document_id.", warnings)

    auth_result = await ensure_auth_token(base_url, login, password, skill_storage, params.get("auth_token"))
    if not auth_result.get("ok"):
        return fail(
            auth_result.get("error", "Ошибка авторизации.")
            + " Проверьте R7_DISK_* в настройках установки навыка; не запрашивайте креды у пользователя.",
            warnings,
        )
    auth_token = auth_result["auth_token"]

    csv_doc_id = csv_document_id
    if csv_document_id is not None:
        csv_downloaded = await download_document_bytes(base_url, auth_token, csv_doc_id)
        if not csv_downloaded.get("ok") and _download_not_found(csv_downloaded) and csv_name:
            remapped = await resolve_csv_document_by_name(
                base_url, auth_token, csv_name, directory_id
            )
            if remapped.get("ok"):
                if directory_id is None:
                    directory_id = remapped.get("directory_id")
                if csv_document_id != remapped["document_id"]:
                    warnings.append(
                        f"document_id {csv_document_id} устарел — использован id {remapped['document_id']} по имени «{csv_name}»."
                    )
                csv_doc_id = remapped["document_id"]
                csv_downloaded = await download_document_bytes(base_url, auth_token, csv_doc_id)
    elif directory_id is not None:
        csv_lookup = await get_document_id_by_name(base_url, auth_token, directory_id, csv_name)
        if not csv_lookup.get("ok") or csv_lookup.get("documentId") is None:
            return fail(f"CSV «{csv_name}» не найден в папке directory_id={directory_id}.", warnings)
        csv_doc_id = csv_lookup["documentId"]
        csv_downloaded = await download_document_bytes(base_url, auth_token, csv_doc_id)
    else:
        remapped = await resolve_csv_document_by_name(base_url, auth_token, csv_name, None)
        if not remapped.get("ok"):
            return fail(remapped.get("error", "Не задан directory_id или csv_document_id."), warnings)
        csv_doc_id = remapped["document_id"]
        directory_id = remapped.get("directory_id")
        csv_downloaded = await download_document_bytes(base_url, auth_token, csv_doc_id)
    if not csv_downloaded.get("ok"):
        return fail(f"Не удалось скачать CSV: {csv_downloaded.get('error')}", warnings)

    csv_text = csv_downloaded["bytes"].decode("utf-8", errors="replace")
    analyzed = analyze_csv_text(csv_text)
    if not analyzed.get("ok"):
        return fail(analyzed.get("error", "Ошибка анализа CSV."), warnings)

    try:
        output_bytes = build_sales_report_xlsx(analyzed["analytics"])
    except Exception as err:
        return fail(f"Не удалось собрать XLSX (openpyxl): {err}", warnings)

    upload_directory_id = directory_id
    uploaded_to_personal = False
    if needs_personal_upload or (directory_id is None and csv_document_id is not None):
        personal_id = resolve_positive_id(
            params.get("output_directory_id"), user_env.get("ANALYTICS_CSV_PERSONAL_DIRECTORY_ID")
        )
        if personal_id is None:
            personal_id = await resolve_personal_root_directory_id(base_url, auth_token, skill_storage, user_env)
        if personal_id is None:
            return fail("Не удалось определить папку «Мои документы» для сохранения отчёта.", warnings)
        upload_directory_id = personal_id
        uploaded_to_personal = True
        if is_shared:
            warnings.append("Исходный CSV расшарен — отчёт сохранён в «Мои документы».")
        else:
            warnings.append("Папка исходного CSV недоступна для записи — отчёт сохранён в «Мои документы».")
    elif directory_id is None:
        return fail("Не задан directory_id для сохранения отчёта.", warnings)

    final_name_result = await resolve_output_name_by_policy(
        base_url, auth_token, upload_directory_id, output_name, conflict_policy
    )
    if not final_name_result.get("ok"):
        return fail(final_name_result.get("error", "Конфликт имени файла."), warnings)

    uploaded = await upload_replacing_document(
        base_url,
        auth_token,
        upload_directory_id,
        final_name_result["name"],
        output_bytes,
        XLSX_MIME,
        final_name_result.get("existing_document_id"),
    )
    if (
        not uploaded.get("ok")
        and not uploaded_to_personal
        and directory_id is not None
        and re.search(r"HTTP (403|406)", str(uploaded.get("error", "")))
    ):
        personal_id = await resolve_personal_root_directory_id(base_url, auth_token, skill_storage, user_env)
        if personal_id is not None:
            upload_directory_id = personal_id
            uploaded_to_personal = True
            warnings.append("Запись в папку CSV недоступна — отчёт сохранён в «Мои документы».")
            final_name_result = await resolve_output_name_by_policy(
                base_url, auth_token, upload_directory_id, output_name, conflict_policy
            )
            if not final_name_result.get("ok"):
                return fail(final_name_result.get("error", "Конфликт имени файла."), warnings)
            uploaded = await upload_replacing_document(
                base_url,
                auth_token,
                upload_directory_id,
                final_name_result["name"],
                output_bytes,
                XLSX_MIME,
                final_name_result.get("existing_document_id"),
            )
    if not uploaded.get("ok"):
        return fail(f"Не удалось загрузить отчёт: {uploaded.get('error')}", warnings)

    summary = analyzed["analytics"]["summary"]
    output_document_id = uploaded.get("document_id")
    web_ui_url = (
        f"{base_url}/doc.html?id={output_document_id}" if output_document_id is not None else f"{base_url}/docs/{upload_directory_id}"
    )
    in_place = uploaded.get("upload_method") == "in_place_id_header"
    warnings.append("Отчёт собран через openpyxl для редактора таблиц Р7 Офис (OnlyOffice).")
    warnings.append("Покупки для сводки/брендов/категорий/динамики: event_type=cart. Воронка: view → purchase.")
    if in_place:
        warnings.append(
            "Существующий файл отчет_продаж.xlsx обновлён in-place (тот же document_id). "
            "Если вкладка уже открыта в Р7 Офис — обновите страницу (F5), чтобы увидеть новые данные."
        )

    action_word = "обновлён" if in_place else "создан"
    reload_hint = (
        " Если файл уже открыт в Р7 Офис — нажмите F5 (перезагрузить вкладку), чтобы увидеть новые данные."
        if in_place
        else ""
    )
    location_hint = (
        " в «Мои документы»"
        if uploaded_to_personal
        else f" в папке id={upload_directory_id}"
    )
    return {
        "ok": True,
        "operation": "analytics_csv_generate_report",
        "base_url": base_url,
        "directory_id": upload_directory_id,
        "source_directory_id": directory_id,
        "uploaded_to_personal": uploaded_to_personal,
        "csv_name": csv_name,
        "csv_document_id": csv_doc_id,
        "csv_rows": analyzed["rowCount"],
        "output_name": final_name_result["name"],
        "output_document_id": output_document_id,
        "output_size_bytes": len(output_bytes),
        "output_mime_type": XLSX_MIME,
        "upload_method": uploaded.get("upload_method"),
        "web_ui_url": web_ui_url,
        "summary": summary,
        "sheets": list_report_sheets(analyzed["analytics"]),
        "warnings": warnings,
        "do_not_retry": True,
        "agent_stop": True,
        "forbid_followup_tools": ["analytics_csv_generate_report"],
        "agent_message": (
            f"Отчёт «{final_name_result['name']}» {action_word}{location_hint}. "
            f"Покупок (cart): {summary['purchaseCount']}, выручка: {summary['revenue']} руб. "
            f"Откройте в редакторе таблиц Р7 Офис: {web_ui_url}.{reload_hint}"
        ),
    }


def fail(message: str, warnings: list[str]) -> dict:
    return {
        "ok": False,
        "operation": "analytics_csv_generate_report",
        "error": message,
        "warnings": warnings + [message],
        "summary": None,
        "sheets": [],
    }
