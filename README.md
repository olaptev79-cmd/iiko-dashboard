# iiko-dashboard

**Дашборд аналитики для iikoRMS / iikoServer** — реал-тайм визуализация продаж, номенклатуры и отделений через OLAP API.

## Возможности

- **6 ключевых показателей**: выручка, чеки, средний чек, гости, прогноз выручки, выполнение плана
- **Графики**: выручка по дням (бары), структура продаж по отделениям (круговая)
- **Топ-20 блюд** с фильтрами по периодам (7/30 дней)
- **Рейтинг филиалов** — топ-10 по выручке за 30 дней
- **Живые данные** через iiko OLAP API v2
- **Docker Compose** для быстрого развёртывания

## Требования

- Docker + Docker Compose
- Доступ к серверу iikoRMS/iikoServer
- Учётные данные администратора iiko

## Быстрый старт

### 1. Клонировать репозиторий

```bash
git clone https://github.com/olaptev79-cmd/iiko-dashboard.git
cd iiko-dashboard
```

### 2. Настроить переменные окружения

```bash
cp .env.example .env
```

Открыть `.env` и указать реальные данные:

```env
IIKO_URL=https://ваш-сервер.iiko.it
IIKO_LOGIN=admin
IIKO_PASSWORD=ваш_пароль
PORT=3001
```

### 3. Запустить контейнеры

```bash
docker compose up --build -d
```

### 4. Открыть дашборд

**Frontend:** [http://localhost](http://localhost)

**Backend API:** [http://localhost:3001](http://localhost:3001)

## Архитектура

```
iiko-dashboard/
├── backend/
│   ├── iikoClient.js         # Клиент для работы с iiko OLAP API
│   ├── dashboardService.js   # Бизнес-логика: агрегация, фильтрация, прогнозы
│   ├── server.js             # Express REST API
│   └── Dockerfile
├── frontend/
│   ├── index.html            # SPA на vanilla JS + Chart.js
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```

## API Endpoints

| Endpoint | Описание |
|----------|----------|
| `GET /api/health` | Статус подключения к iiko |
| `GET /api/dashboard` | Сводка за сегодня: выручка, чеки, средний чек, гости |
| `GET /api/chart?days=7` | Динамика выручки за N дней |
| `GET /api/top-dishes?days=7` | Топ-20 блюд за N дней |
| `GET /api/branches?days=30` | Рейтинг филиалов за N дней |
| `GET /api/forecast` | Прогноз выручки и выполнение плана |
| `GET /api/departments` | Список отделений |

## Технологии

- **Backend**: Node.js, Express, Axios, dotenv
- **Frontend**: HTML5, CSS3, Vanilla JS, Chart.js
- **Инфраструктура**: Docker, Docker Compose, Nginx
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

В `index.html` измените `const API` на `http://localhost:3001`.

## Отладка

### Проверка подключения к iiko

```bash
curl http://localhost:3001/api/health
```

Ожидаемый ответ:

```json
{
  "status": "online",
  "url": "https://ваш-сервер.iiko.it",
  "login": "admin",
  "timestamp": "2026-06-16T14:00:00.000Z"
}
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

- Проверка docker-compose синтаксиса
- Проверка `.env.example`
- Lint Dockerfile

## Лицензия

MIT

## Автор

[olaptev79-cmd](https://github.com/olaptev79-cmd)

## Поддержка

Откройте [issue](https://github.com/olaptev79-cmd/iiko-dashboard/issues) для вопросов и предложений.
