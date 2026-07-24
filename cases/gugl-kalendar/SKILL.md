---
name: gugl-kalendar
description: Управление встречами в Google Calendar (primary)
version: 9.1.0
category: integrations
mcp_spec:
  default_capabilities:
    required:
      - type: key-value-storage
        operations:
          - Get
          - Set
        scope: $USER
  tools:
    - name: google_calendar_oauth
      description: OAuth 2.0 Google Calendar (calendar.events + freebusy), сохранение токенов в KV.
    - name: list_events
      description: Список событий primary за период (today, tomorrow, this_week, next_n_days).
    - name: create_event
      description: Создание события с FreeBusy-проверкой участников и опциональным recurrence.
    - name: update_event
      description: Редактирование события по eventId (summary, время, attendees, recurrence и др.).
    - name: delete_event
      description: Удаление события по eventId из primary календаря.
general:
  lib:
    - runtime: nodejs@24
      code: |
        function offsetToIana(offset) {
          const map = {
            "+03:00": "Europe/Moscow",
            "+02:00": "Europe/Kaliningrad",
            "+04:00": "Europe/Samara",
            "+05:00": "Asia/Yekaterinburg",
            "+00:00": "UTC",
            "-05:00": "America/New_York",
            "-08:00": "America/Los_Angeles",
          };
          return map[offset] || null;
        }

        function ianaToOffset(timeZone) {
          const map = {
            "Europe/Moscow": "+03:00",
            "Europe/Kaliningrad": "+02:00",
            "Europe/Samara": "+04:00",
            "Asia/Yekaterinburg": "+05:00",
            UTC: "+00:00",
            "America/New_York": "-05:00",
            "America/Los_Angeles": "-08:00",
          };
          return map[timeZone] || "+00:00";
        }

        function msToOffsetWallClock(ms, offset) {
          const sign = offset.charAt(0) === "-" ? -1 : 1;
          const parts = offset.slice(1).split(":");
          const totalMin = sign * (Number(parts[0]) * 60 + Number(parts[1] || 0));
          const d = new Date(ms + totalMin * 60 * 1000);
          const pad = function (n) {
            return String(n).padStart(2, "0");
          };
          return (
            d.getUTCFullYear() +
            "-" +
            pad(d.getUTCMonth() + 1) +
            "-" +
            pad(d.getUTCDate()) +
            "T" +
            pad(d.getUTCHours()) +
            ":" +
            pad(d.getUTCMinutes()) +
            ":" +
            pad(d.getUTCSeconds())
          );
        }

        function stripFraction(iso) {
          return iso.replace(/\.\d{1,3}(?=(?:[+-]\d{2}:\d{2}|Z)$)/, "");
        }

        function buildGoogleCalendarStartEnd(startDateTime, endDateTime, durationMinutes, timeZoneParam) {
          const startMs = Date.parse(startDateTime);
          if (!Number.isFinite(startMs)) {
            return { ok: false, error: "INVALID_INPUT", details: { field: "startDateTime" } };
          }

          let endMs;
          if (endDateTime && typeof endDateTime === "string") {
            endMs = Date.parse(endDateTime);
            if (!Number.isFinite(endMs)) {
              return { ok: false, error: "INVALID_INPUT", details: { field: "endDateTime" } };
            }
          } else if (durationMinutes != null) {
            const dm = Number(durationMinutes);
            if (!Number.isFinite(dm) || dm <= 0 || dm > 24 * 60) {
              return { ok: false, error: "INVALID_INPUT", details: { field: "durationMinutes" } };
            }
            endMs = startMs + dm * 60 * 1000;
          } else {
            return {
              ok: false,
              error: "INVALID_INPUT",
              details: { need_one_of: ["endDateTime", "durationMinutes"] },
            };
          }

          if (endMs <= startMs) {
            return {
              ok: false,
              error: "INVALID_RANGE",
              details: { message: "end must be after start" },
            };
          }

          const startOffsetMatch = startDateTime.match(/([+-]\d{2}:\d{2})$/);
          const endOffsetMatch =
            typeof endDateTime === "string" ? endDateTime.match(/([+-]\d{2}:\d{2})$/) : null;
          const offset =
            (startOffsetMatch && startOffsetMatch[1]) ||
            (endOffsetMatch && endOffsetMatch[1]) ||
            ianaToOffset(timeZoneParam || "UTC");
          const timeZone =
            (typeof timeZoneParam === "string" && timeZoneParam.trim()) ||
            (startOffsetMatch && offsetToIana(startOffsetMatch[1])) ||
            (endOffsetMatch && offsetToIana(endOffsetMatch[1])) ||
            "UTC";

          const startWall = startOffsetMatch
            ? stripFraction(startDateTime.slice(0, -startOffsetMatch[0].length))
            : msToOffsetWallClock(startMs, offset);
          let endWall;
          if (endDateTime && endOffsetMatch) {
            endWall = stripFraction(endDateTime.slice(0, -endOffsetMatch[0].length));
          } else {
            endWall = msToOffsetWallClock(endMs, offset);
          }

          return {
            ok: true,
            startMs: startMs,
            endMs: endMs,
            freeBusyMin: new Date(startMs).toISOString(),
            freeBusyMax: new Date(endMs).toISOString(),
            start: { dateTime: startWall, timeZone: timeZone },
            end: { dateTime: endWall, timeZone: timeZone },
          };
        }

        async function readCalendarApiError(res) {
          const text = await res.text();
          try {
            return JSON.parse(text);
          } catch (_) {
            return { message: text };
          }
        }
---

# Google Calendar (LadCraft)

Навык даёт агенту доступ к **основному календарю** (`primary`) Google: однократная **OAuth 2.0** авторизация, **список событий** по пресетам периода, **создание**, **редактирование** и **удаление** событий.

## Цель

- Получать события из `primary` за период, заданный пресетом.
- Создавать событие в `primary`; при пересечении занятости у участников возвращать структуру `conflicts`, но **событие всё равно создавать**.
- Редактировать (`update_event`) и удалять (`delete_event`) события по `eventId`.

## Когда использовать (триггеры)

- Нужно прочитать расписание пользователя в Google Calendar (сегодня, завтра, неделя, N дней).
- Нужно создать встречу и понять, у кого из участников слот пересекается с занятостью (FreeBusy).
- Нужно изменить или удалить существующее событие по его `eventId`.
- Перед `list_events` / `create_event` / `update_event` / `delete_event` при ошибке `AUTH_REQUIRED` — вызвать `google_calendar_oauth`.

## Шаги для агента


1. **Выполни целевое действие**: если `list_events`, `create_event`, `update_event` или `delete_event` вернули `ok: false`, `error: "AUTH_REQUIRED"` — вызови `google_calendar_oauth` и повтори операцию.
2. **OAuth** (`google_calendar_oauth`): пользователь проходит браузерный поток; после успеха токены сохраняются в user-scoped key-value storage. В ответе **нет** access/refresh токенов — только статус. Запрашиваются scope **`https://www.googleapis.com/auth/calendar.events`** и **`https://www.googleapis.com/auth/calendar.events.freebusy`** (события и FreeBusy), не полный **`https://www.googleapis.com/auth/calendar`**.
3. **Список** (`list_events`): передай `preset` (`today` | `tomorrow` | `this_week` | `next_n_days`). Для `next_n_days` укажи `days` (1–30).
4. **Создание** (`create_event`): укажи `summary`, `startDateTime` (ISO 8601, лучше с offset, напр. `+03:00`) и либо `endDateTime`, либо `durationMinutes`. Для **recurrence** передай массив RRULE (напр. `["RRULE:FREQ=WEEKLY;BYDAY=MO,TH"]`); `startDateTime` должен попадать на один из дней RRULE. Опционально `attendees`, `timeZone` (IANA, напр. `Europe/Moscow`). Ответ: `createdEvent`, `conflicts`, `warnings`; при ошибке API смотри `details`.
5. **Редактирование** (`update_event`): передай `eventId` и любые поля для обновления (`summary`, `startDateTime`, `endDateTime`, `attendees`, `location`, `description`, `recurrence`). Ответ: `updatedEvent`.
6. **Удаление** (`delete_event`): передай `eventId`. Ответ: `deleted: true/false`; при 404/410 — предупреждение, что событие уже удалено.

## Пресеты периода (list_events)

Границы дней и недели считаются в **локальном часовом поясе среды выполнения VM** (как у `Date` в Node.js), не в произвольном IANA-профиле пользователя. События по-прежнему приходят от Google в том виде, в каком отдаёт Calendar API (время событий — по данным API).

| Пресет | Смысл |
|--------|--------|
| `today` | с 00:00:00 до 00:00:00 следующего дня, локально |
| `tomorrow` | следующий календарный день, те же границы |
| `this_week` | с понедельника 00:00:00 по воскресенье 23:59:59.999 (интервал до начала следующего понедельника), локально |
| `next_n_days` | с 00:00:00 сегодня на `days` полных суток вперёд |

## Ограничения и риски

- Только календарь **`primary`**. Recurrence передаётся как массив строк в формате Google Calendar API (RRULE/RDATE/EXRULE/EXDATE).
- FreeBusy для внешних участников может быть недоступен или пустым — смотри `warnings` и флаги в `conflicts`.
- Нужны **OAuth Client ID/Secret** в GCP, redirect URI, совместимый с `state.appHost` + путь `/callback`, и в consent screen указаны scope **`calendar.events`** и **`calendar.events.freebusy`**.
- Квоты и политики Google Calendar API применяются как у любого клиента API.

## Скрипты (инструменты)

- `google_calendar_oauth` — OAuth 2.0 Google (`calendar.events` + `calendar.events.freebusy`), сохранение токенов в KV.
- `list_events` — список событий по пресету.
- `create_event` — FreeBusy по `primary` и email участников, затем вставка события; опционально `recurrence`.
- `update_event` — patch-обновление события по `eventId`; опционально `recurrence`.
- `delete_event` — удаление события по `eventId`.

## Типовые ошибки

- выполнять `google_calendar_oauth` прежде чем получить ошибку `AUTH_REQUIRED` от целевого действия
