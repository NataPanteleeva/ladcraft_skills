# SSH-шлюз (один раз, не на целевых серверах)

Навык `remote-ssh-ops` подключается к **вашим** Linux-серверам по обычному SSH. На целевых серверах **ничего ставить не нужно**.

SSH-шлюз — отдельный сервис (бастион, VPS, ваш ПК), который Ladcraft вызывает по HTTP. Его URL и токен задаются в `environment.app` при публикации навыка. Пользователь при установке указывает только **IP сервера**, **логин** и **пароль/ключ**.

## Запуск для разработки

```bash
cd user-data/ssh-gateway-minimal
npm install
set GATEWAY_TOKEN=your-secret-token
npm start
```

В `environment.app` навыка:

- `SSH_GATEWAY_BASE_URL` = `http://localhost:8080`
- `SSH_GATEWAY_TOKEN` = тот же `GATEWAY_TOKEN`

В `network.hosts` tools добавьте `localhost` (только для локальных тестов).
