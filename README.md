# RPS MagicBlock Backend

Backend сервер для игры Rock Paper Scissors на Solana с поддержкой MagicBlock.

## 🚀 Быстрый старт

### Установка

```bash
npm install
```

### Настройка переменных окружения

Скопируйте `.env.example` в `.env` и заполните значения:

```bash
cp .env.example .env
```

Заполните следующие переменные:
- `SUPABASE_URL` - URL вашего Supabase проекта
- `SUPABASE_SERVICE_ROLE_KEY` - Service Role ключ из Supabase
- `SOLANA_RPC_URL` - URL Solana RPC (devnet или mainnet)
- `SERVICE_WALLET_PRIVATE_KEY` (опционально) - приватный ключ service wallet

### Запуск

```bash
# Development
npm run dev

# Production
npm start
```

## 📋 Требования

- Node.js 18+
- Supabase проект с настроенной базой данных
- Solana devnet RPC доступ

## 🔧 API Endpoints

- `GET /health` - Health check
- `GET /api/games/:gameId` - Получить информацию об игре
- `WebSocket` - Socket.io для реального времени

## 🎮 WebSocket Events

### От клиента:
- `create_game` - Создать новую игру
- `join_game` - Присоединиться к игре
- `submit_move` - Отправить ход (rock/paper/scissors)
- `leave_game` - Покинуть игру

### От сервера:
- `game_created` - Игра создана
- `game_joined` - Игрок присоединился
- `game_started` - Игра началась
- `move_submitted` - Ход принят
- `round_completed` - Раунд завершен
- `game_finished` - Игра завершена

## 📝 Лицензия

MIT

