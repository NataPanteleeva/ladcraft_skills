# Paramiko SSH (локальная разработка)

Навык выполняет SSH через **paramiko** (`_paramiko_runner.py`).

## Зависимости

1. Установите Python 3.10+ и добавьте в PATH.
2. Установите paramiko:

```bash
pip install -r requirements.txt
```

Или: `pip install paramiko`

3. Перезапустите dev-server (`npm run dev`).

## Локальный тест

В web-ui заполните **форму установки** (installation form) для навыка:

- `SSH_HOST`, `SSH_USER`, `SSH_PASSWORD` (или `SSH_PRIVATE_KEY`)
- `SSH_PORT` — при необходимости

Затем запустите `testSshConnection`.

## Publish

В production runtime Ladcraft должен предоставлять адаптер `globalThis.paramikoSsh.exec(...)` с тем же контрактом, что и локальный dev-server.
