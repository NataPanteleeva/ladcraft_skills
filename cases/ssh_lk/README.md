# Кейс: SSH remote ops (`ssh_lk`)

Удалённое выполнение shell-команд на Linux-сервере через Ladcraft-навык.

## Runtime: paramiko / paramikoSsh в Ladcraft

**Вывод:** стандартный Ladcraft runtime **не предоставляет** `globalThis.paramikoSsh` и **не включает** paramiko.

Канонические capabilities (снимок [`.pi/ladcraft-docs/ru/runtime-capabilities.snapshot.json`](../../.pi/ladcraft-docs/ru/runtime-capabilities.snapshot.json)):

| type | operations |
|------|------------|
| `vfs` | readFile, writeFile, listDir, … |
| `key-value-storage` | get, set |
| `sql-storage` | create, get, runSQL, … |
| `skills` | list, get, update, create, install |
| `userInfo` | get |

`paramikoSsh` существует **только** в локальном dev-server bundle коллеги (`cases/kudjshev/dev-server/`). На prod Ladcraft навык коллеги с прямым вызовом `paramikoSsh` **не работает** без доработки backend.

## Варианты адаптера SSH

| # | Подход | Где SSH выполняется | Работает на prod Ladcraft? | Примечание |
|---|--------|---------------------|----------------------------|------------|
| **A** | **HTTP SSH-gateway + `fetch`** | Отдельный сервис (бастион/VPS) | **Да** | Рекомендуемый путь; канон Ladcraft допускает `fetch` + `resources.network.hosts` |
| B | `paramikoSsh` (кастомный adapter) | Внутри runtime Ladcraft | Нет (сейчас) | Путь коллеги; нужна доработка backend |
| C | Python `handler` + paramiko inline | Python runtime навыка | **Неизвестно** | paramiko не задокументирован в `.pi/`; openpyxl есть в других навыках, paramiko — нет |
| D | Node `handler` + ssh2/npm | Node runtime навыка | **Неизвестно** | ssh2 не в каноне; зависит от sandbox npm на prod |

**Выбранная реализация в `ssh_lk/`:** вариант **A** (gateway-first) с fallback на `paramikoSsh` для локальной отладки через bundle коллеги.

## Состав кейса

```
ssh_lk/
  README.md                 этот файл
  gateway/                  HTTP→SSH шлюз (Express + ssh2) для prod
  ssh_lk/                   навык Ladcraft
    SKILL.md
    scripts/
      testSshConnection.js
      testSshConnection.meta.md
      runRemoteCommand.js
      runRemoteCommand.meta.md
```

## Настройка gateway (prod)

```bash
cd cases/ssh_lk/gateway
npm install
set GATEWAY_TOKEN=your-secret-token
set PORT=8080
npm start
```

В publish-конфиге навыка (`environment.app`):

- `SSH_GATEWAY_BASE_URL` — URL шлюза, напр. `https://ssh-gw.example.com`
- `SSH_GATEWAY_TOKEN` — тот же `GATEWAY_TOKEN`

В `resources.network.hosts` каждого tool укажите hostname шлюза (без path).

Пользователь при установке навыка задаёт **целевой сервер** (`SSH_HOST`, `SSH_USER`, …) — как у коллеги.

## Алгоритм exec в навыке

```
handler → execSsh(state, config)
            ├─ если SSH_GATEWAY_* в environment.app → fetch POST /v1/exec
            └─ иначе если globalThis.paramikoSsh → paramiko (только local dev)
```

## Перед publish

1. Заполнить `resources.network.hosts` hostname-ом реального gateway.
2. Задать `SSH_GATEWAY_BASE_URL` и `SSH_GATEWAY_TOKEN` в `environment.app` (publish/install).
3. Прогнать smoke: `testSshConnection` → `runRemoteCommand` с `uname -a`.
