# Real integrations setup

This project intentionally remains local until you decide to publish it. Do not put any values below in browser code, GitHub, or Google Sheets cells.

## 1. Supabase

1. Create a Supabase project and open its SQL editor.
2. Run `supabase.sql`.
3. In the project settings, copy the project URL and **service role** key.
4. Create `.env` from `.env.example` and set `SUPABASE_URL` and `SUPABASE_SECRET_KEY`.

With both values set, Supabase becomes the source of truth. The server reads and upserts employees and transaction records through its REST API. Local reset is then disabled so it cannot wipe cloud data accidentally.

## 2. Google Sheets

1. Create a spreadsheet with two tabs named exactly `Sales` and `Expenses`.
2. Add a header row to each tab. The app writes values by reference in column A and updates the same row after approval or retry.
3. In Google Cloud, enable Google Sheets API, create a service account, and download its JSON key.
4. Share the spreadsheet with the service account email as **Editor**; share it with the instructor as **Viewer**.
5. Put the spreadsheet ID in `GOOGLE_SHEETS_ID` and the complete one-line JSON key in `GOOGLE_SERVICE_ACCOUNT_JSON`.

The Sales columns are: reference, time, salesperson, customer, project, description, amount, proposed Richard/Anastasia/Jean-Claude percentages, approved percentages, status, Sheets status, Telegram status. Expenses contain the analogous proposal and final allocation fields.

## 3. Telegram

1. Create a bot with BotFather and copy its token to `TELEGRAM_BOT_TOKEN`.
2. Generate a long random `TELEGRAM_WEBHOOK_SECRET`.
3. For local testing, run this in a second terminal while the app is running:

```powershell
npm run telegram:poll
```

This uses Telegram's long polling, so no public URL is required. Do not register a webhook while using this mode.

4. After you eventually have a public HTTPS URL, stop the polling process and register the webhook:

```text
https://api.telegram.org/bot<token>/setWebhook?url=https://YOUR-URL/telegram/webhook&secret_token=YOUR-SECRET
```

5. On the local website, select Svetlana and link each employee's Telegram user ID and chat ID. Each employee must open the bot and send `/start` before notifications can arrive.

Transaction message formats:

```text
sale | S01 | Olivia Rose | A | 1000 | One proud uncle | 50 | 30 | 20
expense | E01 | Materials | 120 | A | Rented suit and necklace
```

The bot rejects unlinked Telegram users. It stores the original chat ID on the record, so later manager decisions return to the original submission chat even after an employee's link changes.

## 4. Start locally

```powershell
Copy-Item .env.example .env
# Fill .env, then:
npm start
```

You can work locally without any credentials; records then live only in `data.json`, and external delivery indicators show `local_only` or `not_configured`.
