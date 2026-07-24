# SSH-gateway для навыка `ssh_lk`

HTTP-шлюз: Ladcraft → `POST /v1/exec` → SSH на целевой Linux.

На целевых серверах ничего устанавливать не нужно.

## Запуск

```bash
npm install
set GATEWAY_TOKEN=your-secret-token
npm start
```

Порт по умолчанию: `8080` (`PORT`).

## API

`GET /health` — Bearer `GATEWAY_TOKEN`

`POST /v1/exec` — Bearer `GATEWAY_TOKEN`

```json
{
  "host": "10.0.0.5",
  "port": 22,
  "username": "deploy",
  "command": "whoami",
  "timeoutSeconds": 60,
  "auth": {
    "type": "password",
    "password": "..."
  }
}
```

или `"auth": { "type": "private_key", "privateKey": "-----BEGIN..." }`

Ответ: `{ "ok": true, "exitCode": 0, "stdout": "...", "stderr": "" }`
