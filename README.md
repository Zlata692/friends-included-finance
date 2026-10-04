# Friends Included finance system

Local implementation of the Day 4 homework. Run it with Node 18+:

```powershell
cd friends-included
node app-server.mjs
```

Open http://localhost:3000. Pick a demonstration role, add transactions, and use Svetlana's role to approve or correct them. The server enforces permissions and saves local development data in `data.json`.

`POST /telegram/webhook` accepts Telegram-style updates when `TELEGRAM_BOT_TOKEN` is configured. Link a Telegram user ID and chat ID through Svetlana's Manager setup first, then send the bot one of these messages:

```text
sale | S01 | Customer name | A | 1000 | Description | 50 | 30 | 20
expense | E01 | Materials | 120 | A | Description
```

The system saves the transaction before trying the confirmation or later decision notification. `integrations.mjs` contains the Supabase, Google Sheets, and Telegram adapters; it deliberately never puts secrets in browser code. See `SETUP.md` for the one-time cloud setup.

For Vercel, the static interface is served from the project root and every `/api/*`
request is routed to the serverless handler in `api/index.mjs`. Set the same secrets
listed in `.env.example` in the Vercel project before deploying.
