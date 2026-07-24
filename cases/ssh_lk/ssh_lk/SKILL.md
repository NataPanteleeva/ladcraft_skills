---
name: ssh_lk
description: Выполнение команд на удалённом Linux-сервере по SSH через HTTP-gateway (prod) или paramikoSsh (local dev).
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
            secret: true
          SSH_PRIVATE_KEY:
            title: "Приватный ключ SSH (если вход по ключу)"
            format: string
            secret: true
        app:
          SSH_GATEWAY_BASE_URL:
            title: "URL SSH-шлюза (HTTPS)"
            format: uri
          SSH_GATEWAY_TOKEN:
            title: "Bearer-токен SSH-шлюза"
            format: string
            secret: true
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
            secret: true
          SSH_PRIVATE_KEY:
            title: "Приватный ключ SSH (если вход по ключу)"
            format: string
            secret: true
        app:
          SSH_GATEWAY_BASE_URL:
            title: "URL SSH-шлюза (HTTPS)"
            format: uri
          SSH_GATEWAY_TOKEN:
            title: "Bearer-токен SSH-шлюза"
            format: string
            secret: true
general:
  environment:
    app:
      SSH_GATEWAY_BASE_URL: ""
      SSH_GATEWAY_TOKEN: ""
  lib:
    - runtime: nodejs@24
      code: |
        function asObject(value) {
          return value && typeof value === 'object' ? value : null;
        }

        function getString(source, key) {
          const object = asObject(source);
          if (!object) return '';
          const value = object[key];
          return typeof value === 'string' ? value : '';
        }

        function normalizePrivateKey(raw) {
          const trimmed = String(raw || '').trim();
          if (!trimmed) return '';
          if (trimmed.includes('\\n')) return trimmed.replace(/\\n/g, '\n');
          return trimmed;
        }

        function resolveSshTarget(state) {
          const userEnv = asObject(state && state.environment && state.environment.user) || {};

          const host = getString(userEnv, 'SSH_HOST').trim();
          if (!host) {
            return { ok: false, error: 'Укажите IP-адрес сервера (SSH_HOST) при установке навыка' };
          }

          const username = getString(userEnv, 'SSH_USER').trim();
          if (!username) {
            return { ok: false, error: 'Укажите имя пользователя (SSH_USER) при установке навыка' };
          }

          let port = 22;
          const portRaw = getString(userEnv, 'SSH_PORT').trim();
          if (portRaw) {
            const parsed = Number.parseInt(portRaw, 10);
            if (Number.isFinite(parsed) && parsed > 0 && parsed <= 65535) {
              port = parsed;
            }
          }

          return { ok: true, host, port, username };
        }

        function resolveSshAuth(state) {
          const userEnv = asObject(state && state.environment && state.environment.user) || {};
          const privateKey = normalizePrivateKey(getString(userEnv, 'SSH_PRIVATE_KEY'));
          const password = getString(userEnv, 'SSH_PASSWORD');

          if (privateKey) {
            return { ok: true, privateKey, password: '' };
          }
          if (password) {
            return { ok: true, privateKey: '', password };
          }
          return {
            ok: false,
            error: 'Укажите пароль (SSH_PASSWORD) или приватный ключ (SSH_PRIVATE_KEY) при установке навыка'
          };
        }

        function clampTimeout(value, fallback) {
          const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
          return Math.min(300, Math.max(1, n));
        }

        function resolveGatewayConfig(state) {
          const appEnv = asObject(state && state.environment && state.environment.app) || {};
          const baseUrl = getString(appEnv, 'SSH_GATEWAY_BASE_URL').trim().replace(/\/$/, '');
          const token = getString(appEnv, 'SSH_GATEWAY_TOKEN');
          if (!baseUrl || !token) {
            return { ok: false };
          }
          return { ok: true, baseUrl, token };
        }

        async function execViaGateway(gateway, config) {
          const auth = config.privateKey
            ? { type: 'private_key', privateKey: config.privateKey }
            : { type: 'password', password: config.password || '' };

          const response = await fetch(gateway.baseUrl + '/v1/exec', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: 'Bearer ' + gateway.token
            },
            body: JSON.stringify({
              host: config.host,
              port: config.port || 22,
              username: config.username,
              command: config.command,
              timeoutSeconds: config.timeoutSeconds || 60,
              auth
            })
          });

          let data = {};
          try {
            data = await response.json();
          } catch {
            return {
              ok: false,
              error: 'SSH-gateway вернул не-JSON (HTTP ' + response.status + ')'
            };
          }

          if (!response.ok) {
            return {
              ok: false,
              error: (data && data.error) || 'HTTP ' + response.status,
              stdout: (data && data.stdout) || '',
              stderr: (data && data.stderr) || ''
            };
          }

          return data;
        }

        async function execViaParamikoSsh(config) {
          const sshApi = globalThis.paramikoSsh;
          if (!sshApi || typeof sshApi.exec !== 'function') {
            return { ok: false, error: 'paramikoSsh недоступен' };
          }
          return sshApi.exec(config);
        }

        async function execSsh(state, config) {
          const gateway = resolveGatewayConfig(state);
          if (gateway.ok) {
            return execViaGateway(gateway, config);
          }

          const paramikoResult = await execViaParamikoSsh(config);
          if (paramikoResult.ok || paramikoResult.error !== 'paramikoSsh недоступен') {
            return paramikoResult;
          }

          return {
            ok: false,
            error:
              'SSH runtime недоступен: задайте SSH_GATEWAY_BASE_URL и SSH_GATEWAY_TOKEN (environment.app) или используйте runtime с paramikoSsh'
          };
        }
---

# SSH Remote Ops

Ты выполняешь задачи на **удалённом Linux-сервере** по SSH. На целевом сервере **ничего устанавливать не нужно**.

При **включении навыка** пользователь указал:

- `SSH_HOST`, `SSH_USER`, `SSH_PASSWORD` или `SSH_PRIVATE_KEY`, `SSH_PORT` (если не 22)

**Не запрашивай эти данные повторно**, если tool не вернул ошибку конфигурации.

SSH выполняется через **HTTP SSH-gateway** (`environment.app`: `SSH_GATEWAY_BASE_URL`, `SSH_GATEWAY_TOKEN`). Локально возможен fallback на `paramikoSsh`.

Tools: `testSshConnection`, `runRemoteCommand`.

## Алгоритм

1. Понять задачу пользователя.
2. `testSshConnection` — проверить доступ. При `ok: false` — остановиться.
3. `runRemoteCommand` с `{ "command": "..." }` — одна shell-команда на вызов.
4. Анализировать `exitCode`, `stdout`, `stderr`.
5. Структурированный отчёт.

## Параметры `runRemoteCommand`

- `command` (обязательно)
- `timeoutSeconds` (опционально) — 1–300, по умолчанию 60

## Чтение ответа

- `ok: true`, `exitCode: 0` — успех
- `ok: true`, `exitCode !== 0` — команда выполнена с ошибкой
- `ok: false` — проблема SSH, gateway или конфигурации

## Безопасность

- Не выводи пароли, ключи, `SSH_GATEWAY_TOKEN`.
- Перед деструктивными командами — **спроси подтверждение**.
- Начинай с read-only команд при неочевидных задачах.

## Ограничения

- Только `testSshConnection` и `runRemoteCommand`.
- Интерактивный TTY не поддерживается.
- Одна команда — один вызов tool.

## Формат итога

1. Цель
2. Результат (команды и вывод)
3. Состояние
4. Следующий шаг (если нужен)
