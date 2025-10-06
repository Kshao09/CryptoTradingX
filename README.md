# CryptoTradingX

Front-end **HTML/CSS/JS**, back-end **Node/Express**, DB **MySQL or SQL Server**. WebSocket price simulator for BTC-USD / ETH-USD. **Education only (no real funds).**

## Stack
- Frontend: HTML, CSS, JavaScript (vanilla)
- Backend: Node.js + Express (REST + WS)
- DB: MySQL 
- Auth: JWT + bcrypt
- Orders: Market / Limit (simulated fill)

## Run
1) Create DB from `/db/mysql/schema.sql` or `/db/sqlserver/schema.sql`
2) `cd backend && npm install && cp .env.example .env` (set `DB_TYPE` and creds)
3) `node server.js`
4) Open `frontend/index.html` or serve it (`npx http-server ./frontend -p 8080`)

## Endpoints
- POST `/api/auth/register`
- POST `/api/auth/login`
- GET  `/api/orders` (auth)
- POST `/api/orders` (auth)
- GET  `/api/portfolio` (auth)
- WS   `ws://localhost:3001/ws` (ticks)

MIT © 2025
[README (2).md](https://github.com/user-attachments/files/22704821/README.2.md)
ct for Software Design
