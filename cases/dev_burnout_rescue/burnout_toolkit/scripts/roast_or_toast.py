async def handler(state, params):
    params = params if isinstance(params, dict) else {}

    name = str(params.get("dev_name") or "").strip() or "друг"
    mood = str(params.get("mood") or "auto").strip().lower()

    def clamp_int(value, low, high):
        try:
            n = int(round(float(value)))
        except (TypeError, ValueError):
            n = 0
        return max(low, min(high, n))

    fatigue = clamp_int(params.get("fatigue"), 0, 100)
    caffeine = clamp_int(params.get("caffeine"), 0, 100)

    if mood not in ("roast", "toast"):
        mood = "toast" if fatigue >= 60 else "roast"

    if mood == "toast":
        line = (
            f"{name}, ты вывез ещё один день в этом легаси — это уже подвиг. "
            f"Усталость {fatigue}/100, кофе {caffeine}/100: имеешь полное право на перерыв."
        )
    else:
        line = (
            f"{name}, твой код держится на честном слове и {caffeine} единицах кофе. "
            f"Но эй — ты всё ещё компилируешься, в отличие от твоего настроения ({fatigue}/100)."
        )

    return {"ok": True, "mood": mood, "line": line, "fatigue": fatigue, "caffeine": caffeine}
