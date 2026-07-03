# Aqba Dashboard

**Дашборд аналитики для iikoRMS / iikoServer** — реал-тайм визуализация продаж, номенклатуры и отделений через OLAP API.

## Возможности

- **Экран входа в приложении** — адрес сервера, логин и пароль вводятся прямо в веб-интерфейсе, без пересборки контейнера
- **6 ключевых показателей**: выручка, чеки, средний чек, гости, прогноз выручки, выполнение плана
- **Графики**: выручка по дням (бары), структура продаж по отделениям (круговая)
- **Топ-20 блюд** с фильтрами по периодам (7/30 дней)
- **Рейтинг филиалов** — топ-10 по выручке за 30 дней
- **Живые данные** через iiko OLAP API v2
- **Сессии на сервере** — учётные данные iiko не хранятся в браузере, только httpOnly cookie сессии
- **Docker Compose** для быстрого развёртывания, с healthcheck на оба контейнера

## Требования

- Docker + Docker Compose
- Доступ к серверу iikoRMS/iikoServer (адрес, логин и пароль администратора — вводятся при входе в приложение)

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone https://github.com/olaptev79-cmd/iiko-dashboard.git
cd iiko-dashboard
```

### 2. Настроить переменные окружения приложения

```bash
cp .env.example .env
```

Эти переменные касаются только самого приложения (порт, режим запуска) — учётные данные iiko здесь **не указываются**:

```env
PORT=3001
NODE_ENV=production
```

### 3. Запустить контейнеры

```bash
docker compose up --build -d
```

### 4. Открыть дашборд и войти

**Frontend:** [http://localhost](http://localhost)

При первом открытии появится экран входа — укажите:

- **Адрес сервера** — например `mycompany.iiko.it` (протокол `https://` подставится автоматически, если не указан)
- **Логин** и **пароль** администратора iiko

Данные для входа проверяются напрямую на вашем сервере iiko и не сохраняются на бэкенде дашборда сверх времени активной сессии (8 часов бездействия — автоматический разлогин). Флажок «Запомнить адрес и логин» сохраняет в браузере только адрес сервера и логин (не пароль), чтобы не вводить их каждый раз.

**Backend API:** [http://localhost:3001](http://localhost:3001)

## Архитектура

```
iiko-dashboard/
├── backend/
│   ├── iikoClient.js         # Клиент для работы с iiko OLAP API (SHA1-хеш пароля, авто-нормализация URL)
│   ├── sessionStore.js       # In-memory реестр сессий: sessionId -> клиент iiko + метаданные
│   ├── dashboardService.js   # Бизнес-логика: агрегация, фильтрация, прогнозы
│   ├── server.js             # Express REST API + роуты авторизации, cookie-сессии, rate limit на login
│   └── Dockerfile
├── frontend/
│   ├── index.html            # SPA на vanilla JS + Chart.js: экран логина + дашборд
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## Как работает авторизация

1. Пользователь вводит адрес сервера, логин и пароль на экране входа.
2. Backend создаёт клиент iiko с этими данными и проверяет их прямым запросом к `/resto/api/auth` на указанном сервере.
3. Если данные верны — backend создаёт сессию (случайный ID) и возвращает её в httpOnly cookie `aqba_sid`.
4. Все последующие запросы к `/api/dashboard`, `/api/chart` и т.д. используют эту cookie, чтобы найти нужный клиент iiko в памяти сервера.
5. Сессии, неактивные более 8 часов, автоматически удаляются.
6. Логин защищён простым rate-limit — не более 10 попыток за 5 минут с одного IP.

## API Endpoints

| Endpoint | Описание | Требует сессию |
|----------|----------|----------------|
| `POST /api/auth/login` | Вход: `{ url, login, password }` → устанавливает cookie сессии | Нет |
| `POST /api/auth/logout` | Выход, удаление сессии | Нет |
| `GET /api/auth/me` | Проверка текущей сессии | Нет |
| `GET /api/health` | Статус подключения к iiko | Да |
| `GET /api/dashboard` | Сводка за сегодня: выручка, чеки, средний чек, гости | Да |
| `GET /api/chart?days=7` | Динамика выручки за N дней | Да |
| `GET /api/top-dishes?days=7` | Топ-20 блюд за N дней | Да |
| `GET /api/branches?days=30` | Рейтинг филиалов за N дней | Да |
| `GET /api/forecast` | Прогноз выручки и выполнение плана | Да |
| `GET /api/departments` | Список отделений | Да |
| `GET /api/ping` | Проверка живости backend (healthcheck) | Нет |

## Технологии

- **Backend**: Node.js, Express, Axios, cookie-parser, dotenv
- **Frontend**: HTML5, CSS3, Vanilla JS, Chart.js
- **Инфраструктура**: Docker, Docker Compose (с healthcheck), Nginx
- **iiko API**: OLAP v2 (reportType: SALES), Corporation API

## Разработка

### Локальный запуск backend

```bash
cd backend
npm install
node server.js
```

### Локальный запуск frontend

```bash
cd frontend
python3 -m http.server 3000
# или
npx serve .
```

Фронтенд автоматически обращается к `http://localhost:3001` при запуске на `localhost:3000`; в остальных случаях (например, за nginx-прокси) API-запросы идут на тот же origin через `/api/`.

## Отладка

### Проверка живости backend

```bash
curl http://localhost:3001/api/ping
```

### Проверка текущей сессии

```bash
curl -b cookies.txt http://localhost:3001/api/auth/me
```

### Логи контейнеров

```bash
docker compose logs -f backend
docker compose logs -f frontend
```

### Рестарт после изменений

```bash
docker compose down
docker compose up --build -d
```

## CI/CD

Репозиторий использует GitHub Actions для валидации:

- Проверка синтаксиса всех backend-модулей (`server.js`, `iikoClient.js`, `dashboardService.js`, `sessionStore.js`)
- Проверка docker-compose синтаксиса
- Проверка `.env.example`
- Lint Dockerfile

## Лицензия

MIT

## Автор

[olaptev79-cmd](https://github.com/olaptev79-cmd)

## Поддержка

Откройте [issue](https://github.com/olaptev79-cmd/iiko-dashboard/issues) для вопросов и предложений.
