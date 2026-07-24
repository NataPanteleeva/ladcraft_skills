---
name: remote-ssh-ops
description: Выполнение команд на удалённом Linux-сервере по SSH через paramiko.
mcp_spec:
  tools:
    - name: testSshConnection
      environment:
        user:
          SSH_HOST:
            title: "IP-адрес или hostname сервера"
            format: string
          SSH_PORT:
            title: "Порт SSH"
            format: string
          SSH_USER:
            title: "Имя пользователя (логин)"
            format: string
          SSH_PASSWORD:
            title: "Пароль SSH"
            format: string
          SSH_PRIVATE_KEY:
            title: "Приватный ключ SSH (если вход по ключу)"
            format: string
    - name: runRemoteCommand
      environment:
        user:
          SSH_HOST:
            title: "IP-адрес или hostname сервера"
            format: string
          SSH_PORT:
            title: "Порт SSH"
            format: string
          SSH_USER:
            title: "Имя пользователя (логин)"
            format: string
          SSH_PASSWORD:
            title: "Пароль SSH"
            format: string
          SSH_PRIVATE_KEY:
            title: "Приватный ключ SSH (если вход по ключу)"
            format: string
---

# Remote SSH Ops

Ты выполняешь задачи на **удалённом Linux-сервере** по SSH (библиотека **paramiko**). На целевом сервере **ничего устанавливать не нужно** — только стандартный SSH.

При **включении навыка** пользователь указал в форме:

- `SSH_HOST` — IP или hostname
- `SSH_USER` — логин
- `SSH_PASSWORD` или `SSH_PRIVATE_KEY`
- `SSH_PORT` — порт (если не 22)

**Не запрашивай эти данные повторно**, если tool не вернул ошибку конфигурации.

Tools: `testSshConnection`, `runRemoteCommand`. Оба вызывают SSH через runtime-адаптер `paramikoSsh`.

## Алгоритм

1. Понять задачу пользователя.
2. `testSshConnection` — проверить доступ (`whoami`, `hostname`). При `ok: false` — остановиться и объяснить ошибку.
3. `runRemoteCommand` с `{ "command": "..." }` — одна shell-команда на вызов.
4. Анализировать `exitCode`, `stdout`, `stderr`.
5. Структурированный отчёт пользователю.

## Параметры `runRemoteCommand`

- `command` (обязательно) — одна shell-команда.
- `timeoutSeconds` (опционально) — 1–300, по умолчанию 60.

## Чтение ответа

- `ok: true`, `exitCode: 0` — успех на сервере.
- `ok: true`, `exitCode !== 0` — команда выполнена, но с ошибкой; покажи `stderr`/`stdout`.
- `ok: false` — проблема SSH или конфигурации.

## Примеры

```json
{ "command": "uname -a && df -h" }
```

```json
{ "command": "systemctl status nginx --no-pager" }
```

## Безопасность

- Не выводи `SSH_PASSWORD`, `SSH_PRIVATE_KEY`.
- Перед деструктивными командами — **спроси подтверждение**.
- Начинай с read-only команд при неочевидных задачах.

## Ограничения

- Только `testSshConnection` и `runRemoteCommand`.
- Не вызывай platform-инструменты вне пакета навыка.
- Интерактивный TTY не поддерживается.
- Одна команда — один вызов tool.

## Формат итога

1. Цель  
2. Результат (команды и вывод)  
3. Состояние  
4. Следующий шаг (если нужен)
