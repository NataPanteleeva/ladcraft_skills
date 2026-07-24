async def handler(state, params):
    params = params if isinstance(params, dict) else {}
    vfs = get_vfs(state)
    if not vfs:
        return {"ok": False, "error": "VFS недоступен", "files": [], "count": 0, "preferred": None}

    roots_param = get_array(params, "roots")
    roots = [str(item or "").strip() for item in roots_param if str(item or "").strip()]
    if not roots:
        roots = ["/session/r7", "/session", "/workspace"]

    files = []
    for root in roots:
        await list_excel_in_dir(vfs, root, files, 0)

    seen = {}
    unique = []
    for item in files:
        path = item.get("path")
        if path in seen:
            continue
        seen[path] = True
        unique.append(item)

    def sort_key(item):
        path = str(item.get("path") or "")
        under_r7 = 0 if path.startswith("/session/r7/") else 1
        return (under_r7, path)

    unique.sort(key=sort_key)

    preferred = None
    r7_files = [f for f in unique if str(f.get("path") or "").startswith("/session/r7/")]
    if len(r7_files) == 1:
        preferred = r7_files[0].get("path")

    return {
        "ok": True,
        "files": unique,
        "count": len(unique),
        "preferred": preferred,
    }
