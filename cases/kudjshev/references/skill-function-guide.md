---
sidebar_label: Функции-инструменты навыков
sidebar_position: 10
---

# Руководство по написанию функций-инструментов для навыков

Этот документ описывает правила и требования к пользовательским функциям, которые выполняются внутри инструментов приложений-навыков платформы. Функции исполняются в изолированной среде на базе Firecracker VM с Node.js 22.

---

## Формат функции

Функция должна быть объявлена как `async function` с именем `handler`. Именно эта функция вызывается рантаймом.

```javascript
async function handler(state, params) {
  // ваш код
  return { /* результат */ };
}
```

> **Важно:** используйте только синтаксис ES2022+. Импорты (`import`/`require`) не поддерживаются — все необходимые глобальные объекты передаются через `state`.

---

## Параметры функции

### `params` — входные параметры вызова

Произвольный объект, переданный при вызове инструмента. Его структура описывается в поле `schemas.input` инструмента.

```javascript
async function handler(state, params) {
  const { userId, query } = params;
  // ...
}
```

### `state` — контекст выполнения

Объект с доступом к окружению, платформенным возможностям и коммуникации с хостом.

#### `state.environment.app`

Переменные окружения уровня **приложения** — задаются разработчиком навыка и одинаковы для всех пользователей. Хранят ключи API, конфигурацию и другие app-level секреты.

```javascript
async function handler(state, params) {
  const apiKey = state.environment.app.GOOGLE_API_KEY;
  const baseUrl = state.environment.app.SERVICE_URL;
}
```

#### `state.environment.user`

Переменные окружения уровня **пользователя** — задаются при установке навыка конкретным пользователем. Хранят персональные токены, адреса, настройки.

```javascript
async function handler(state, params) {
  const userToken = state.environment.user.MY_PERSONAL_TOKEN;
}
```

#### `state.appHost`

URL хоста платформы с уже подставленным идентификатором текущей VM. Используется для формирования callback-ссылок при OAuth-редиректах.

Формат: `https://<platform-domain>/application/<vmId>`

```javascript
async function handler(state, params) {
  const callbackUrl = `${state.appHost}/callback`;
  // => например: https://platform.example.com/application/e5dW1wJHQm9lNZC8XmO-j/callback
}
```

#### `state.socket`

TCP-сокет соединения с хостом. Через него функция может:

- инициировать OAuth-редирект методом `redirect({ url })`
- слушать входящие HTTP-запросы (callback после редиректа) через `on('data', ...)`

```javascript
state.socket.redirect({ url: 'https://oauth-provider.com/auth?...' });
state.socket.on('data', (rawData) => { /* обработка ответа */ });
```

#### `state.capabilities`

Объект с платформенными возможностями, разрешёнными для данного инструмента (storage, notification и т.д.). Конкретные API capabilities зависят от конфигурации инструмента. Возможности ещё находятся в разработке.

---

## Возвращаемое значение

Функция должна вернуть произвольный объект — он станет результатом выполнения инструмента. Структура описывается в `schemas.output` инструмента.

```javascript
async function handler(state, params) {
  return {
    status: 'ok',
    data: { count: 42 },
  };
}
```

> Если функция ничего не возвращает (возвращает `undefined`), результатом будет `undefined`.

---

## Сетевые запросы

Внутри функции доступен глобальный `fetch` (Node.js 22). Сетевой доступ ограничен списком разрешённых хостов, указанных в поле `resources.network.hosts` инструмента.

```javascript
async function handler(state, params) {
  const response = await fetch('https://api.example.com/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.environment.app.API_KEY}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return await response.json();
}
```

> Запрос к хосту, не входящему в `network.hosts`, будет заблокирован на уровне iptables.

---

## OAuth-редирект

Если для работы инструмента требуется авторизация пользователя во внешнем сервисе (OAuth), функция использует механизм редиректа.

### Как это работает

1. Функция вызывает `state.socket.redirect({ url })` с URL страницы авторизации внешнего сервиса.
2. Платформа прерывает ожидание результата и возвращает вызывающему клиенту `redirect_id` и URL для перенаправления пользователя.
3. Пользователь переходит по URL, авторизуется, внешний сервис делает callback на `state.appHost`.
4. Платформа доставляет этот HTTP-запрос обратно в функцию через `state.socket`.
5. Функция обрабатывает callback и возвращает итоговый результат.

### Шаблон

```javascript
async function handler(state, params) {
  // 1. Сформировать URL для авторизации у внешнего провайдера.
  //    state.appHost уже содержит уникальный ID этой VM —
  //    именно на этот URL провайдер должен прислать callback.
  const callbackUrl = `${state.appHost}/callback`;
  const authUrl =
    `https://oauth.example.com/authorize` +
    `?client_id=${state.environment.app.CLIENT_ID}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&scope=profile`;

  // 2. Отправить редирект — функция продолжит работу,
  //    но платформа вернёт клиенту redirect_id + authUrl.
  state.socket.redirect({ url: authUrl });

  // 3. Ждать HTTP-запрос от внешнего провайдера (OAuth callback).
  const callbackRequest = await new Promise((resolve) => {
    state.socket.on('data', (rawData) => {
      resolve(parseHttpRequest(rawData.toString()));
    });
  });

  // 4. Обменять code на access_token.
  const tokenResponse = await fetch('https://oauth.example.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: callbackRequest.query.code,
      client_id: state.environment.app.CLIENT_ID,
      client_secret: state.environment.app.CLIENT_SECRET,
      redirect_uri: callbackUrl,
    }),
  });

  const { access_token } = await tokenResponse.json();

  // 5. Использовать токен для получения данных и вернуть результат.
  const profile = await fetch('https://oauth.example.com/userinfo', {
    headers: { Authorization: `Bearer ${access_token}` },
  }).then((r) => r.json());

  return { profile };
}

// Вспомогательная функция: минимальный парсер HTTP/1.1 запроса
function parseHttpRequest(raw) {
  const [headerSection, body = ''] = raw.split('\r\n\r\n');
  const lines = headerSection.split('\r\n');
  const [method, fullPath] = lines[0].split(' ');
  const [path, queryString = ''] = fullPath.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString));
  return { method, path, query, body };
}
```

> `state.socket.redirect()` не завершает выполнение функции — код после вызова продолжает работать. Именно там нужно подписаться на `data` и дождаться callback.

---

## Обработка ошибок

Любое необработанное исключение внутри функции приведёт к тому, что рантайм вернёт ошибку вызывающему сервису и остановит VM.

```javascript
async function handler(state, params) {
  if (!params.userId) {
    throw new Error('userId is required');
  }

  try {
    const result = await fetch(`https://api.example.com/users/${params.userId}`);
    if (!result.ok) {
      throw new Error(`Upstream error: ${result.status}`);
    }
    return await result.json();
  } catch (err) {
    throw new Error(`Failed to fetch user: ${err.message}`);
  }
}
```

---

## Ограничения ресурсов

Каждый инструмент запускается с явными лимитами, задаваемыми в поле `resources` при описании инструмента:


| Параметр                  | По умолчанию | Описание                               |
| ------------------------- | ------------ | -------------------------------------- |
| `resources.cpu`           | `0.5`        | Доля CPU (0.0–1.0)                     |
| `resources.memory`        | `128`        | Размер оперативной памяти, MiB         |
| `resources.timeout`       | `30000`      | Максимальное время выполнения, мс      |
| `resources.network.hosts` | `[]`         | Список разрешённых для запросов хостов |


Превышение `timeout` приводит к принудительной остановке VM и ошибке.

---

## OAuth с HTTP-роутингом через встроенный модуль `node:http`

Когда OAuth-провайдер делает callback, хост доставляет его в VM как сырой HTTP-запрос через уже открытый TCP-сокет. Вместо того чтобы вручную разбирать байты, можно передать сокет встроенному Node.js HTTP-серверу — он сам распарсит запрос и вызовет обработчик с готовыми объектами `req`/`res`.

Это позволяет регистрировать несколько маршрутов внутри одной функции и обрабатывать их независимо, как в обычном веб-сервере.

### Как это работает технически

1. `await import('node:http')` — динамический импорт работает в eval-контексте Node.js 22.
2. `state.socket.removeAllListeners('data')` — снимает слушателя протокольного парсера VM, который больше не нужен: после вызова `redirect()` хост не присылает сообщения протокола, только HTTP.
3. `server.emit('connection', state.socket)` — передаёт уже открытый сокет HTTP-серверу. Node.js начинает читать из него как из нового TCP-соединения и вызывает `'request'` на каждый входящий HTTP-запрос.
4. `req.url` содержит путь запроса — роутинг реализуется любым удобным способом.

### Пример: Google OAuth с несколькими маршрутами

```javascript
async function handler(state, params) {
  const clientId     = state.environment.app.OAUTH_CLIENT_ID;
  const clientSecret = state.environment.app.OAUTH_CLIENT_SECRET;

  // state.appHost уже содержит уникальный ID этой VM:
  // https://platform.example.com/application/<vmId>
  const callbackUrl = `${state.appHost}/callback`;

  // Формируем URL авторизации Google и отправляем редирект.
  // После этого вызова платформа вернёт клиенту redirect_id + url,
  // но выполнение функции продолжается — мы ждём callback.
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id',     clientId);
  authUrl.searchParams.set('redirect_uri',  callbackUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope',         'openid email profile');
  authUrl.searchParams.set('access_type',   'offline');
  state.socket.redirect({ url: authUrl.toString() });

  // Ждём HTTP-запрос(ы) от хоста через Promise.
  // Резолвим его только когда основной flow завершится.
  return await new Promise(async (resolve, reject) => {
    const { createServer } = await import('node:http');

    // Убираем слушателя протокола — он больше не нужен,
    // теперь сокет будет отдан HTTP-серверу.
    state.socket.removeAllListeners('data');

    // Создаём HTTP-сервер и регистрируем маршруты.
    const server = createServer();

    // Вспомогательная функция: собирает тело запроса из стрима.
    function readBody(req) {
      return new Promise((res) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end',  ()      => res(Buffer.concat(chunks).toString()));
      });
    }

    // Маршруты ——————————————————————————————————————————

    async function onCallback(req, res) {
      const { searchParams } = new URL(req.url, state.appHost);
      const code = searchParams.get('code');

      if (!code) {
        res.writeHead(400).end('Missing code');
        reject(new Error('OAuth callback: code parameter is missing'));
        return;
      }

      // Обмениваем code на токены.
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          code,
          client_id:     clientId,
          client_secret: clientSecret,
          redirect_uri:  callbackUrl,
        }),
      });

      if (!tokenRes.ok) {
        res.writeHead(502).end('Token exchange failed');
        reject(new Error(`Token exchange failed: ${tokenRes.status}`));
        return;
      }

      const tokens = await tokenRes.json();

      // Получаем профиль пользователя.
      const profileRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await profileRes.json();

      // Отвечаем пользователю в браузере и резолвим результат функции.
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        '<html><body><h1>Авторизация успешна. Можно закрыть вкладку.</h1></body></html>',
      );

      resolve({
        email:        profile.email,
        name:         profile.name,
        access_token: tokens.access_token,
      });
    }

    async function onHealthz(req, res) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ status: 'waiting_callback' }));
    }

    async function onNotFound(req, res) {
      res.writeHead(404).end('Not found');
    }

    // Роутер ———————————————————————————————————————————

    const routes = {
      '/callback': onCallback,
      '/healthz':  onHealthz,
    };

    server.on('request', async (req, res) => {
      try {
        const appBasePath = new URL(state.appHost).pathname;
        const { pathname } = new URL(req.url, state.appHost);
        const route = pathname.slice(appBasePath.length) || '/';
        const routeHandler = routes[route] ?? onNotFound;
        await routeHandler(req, res);
      } catch (err) {
        res.writeHead(500).end('Internal error');
        reject(err);
      }
    });

    // Передаём уже открытый сокет HTTP-серверу.
    // Node.js начинает читать из него входящие запросы.
    server.emit('connection', state.socket);
  });
}
```

### Ключевые моменты

- `removeAllListeners('data')` вызывается **до** `server.emit('connection', ...)` — иначе протокольный парсер VM и HTTP-парсер будут конкурировать за одни и те же данные.
- `server.emit('connection', state.socket)` не создаёт нового TCP-соединения — он просто сообщает HTTP-серверу «вот сокет, читай из него».
- Маршрутов может быть сколько угодно — паттерн `routes[pathname]` легко расширяется.
- `readBody(req)` — опциональная утилита для маршрутов, ожидающих тело POST-запроса.

---

## Полные примеры

### Простой HTTP-инструмент

```javascript
async function handler(state, params) {
  const { city } = params;

  const url = `https://wttr.in/${encodeURIComponent(city)}?format=j1`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'platform-skill/1.0' },
  });

  if (!response.ok) {
    throw new Error(`Weather API error: ${response.status}`);
  }

  const data = await response.json();
  const current = data.current_condition[0];

  return {
    city,
    temp_c: current.temp_C,
    description: current.weatherDesc[0].value,
  };
}
```

### Инструмент с переменными окружения

```javascript
async function handler(state, params) {
  const apiKey = state.environment.app.OPENAI_API_KEY;
  const userLang = state.environment.user.PREFERRED_LANGUAGE ?? 'en';

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Reply in ${userLang}.` },
        { role: 'user', content: params.prompt },
      ],
    }),
  });

  const data = await response.json();
  return { answer: data.choices[0].message.content };
}
```

---

## Краткая памятка


| Что                         | Как                                             |
| --------------------------- | ----------------------------------------------- |
| Объявить функцию            | `async function handler(state, params) { ... }` |
| Получить входные параметры  | `params.myField`                                |
| Получить app-переменную     | `state.environment.app.MY_KEY`                  |
| Получить user-переменную    | `state.environment.user.MY_KEY`                 |
| URL для OAuth callback      | `state.appHost` (уже содержит уникальный ID VM) |
| Инициировать OAuth-редирект | `state.socket.redirect({ url })`                |
| Получить OAuth callback     | `state.socket.on('data', handler)`              |
| Вернуть результат           | `return { ... }` — произвольный объект          |
| Вернуть ошибку              | `throw new Error('message')`                    |
| HTTP-запросы                | глобальный `fetch` (Node.js 22)                 |


