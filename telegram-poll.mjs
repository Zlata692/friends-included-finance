// Local development alternative to a public Telegram webhook.
// Keep this process running beside `npm start` while testing from Telegram.
const token = process.env.TELEGRAM_BOT_TOKEN;
const appBaseUrl = process.env.APP_BASE_URL || 'http://localhost:3000';
if (!token) throw new Error('TELEGRAM_BOT_TOKEN is required.');

let offset = 0;
console.log(`Polling Telegram and forwarding updates to ${appBaseUrl}/telegram/webhook`);
while (true) {
  try {
    const updatesResponse = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=25&offset=${offset}`);
    const updates = await updatesResponse.json();
    if (!updates.ok) throw new Error(updates.description || 'Telegram getUpdates failed.');
    for (const update of updates.result) {
      offset = update.update_id + 1;
      const response = await fetch(`${appBaseUrl}/telegram/webhook`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(process.env.TELEGRAM_WEBHOOK_SECRET ? { 'x-telegram-bot-api-secret-token': process.env.TELEGRAM_WEBHOOK_SECRET } : {}) },
        body: JSON.stringify(update)
      });
      if (!response.ok) console.error(`Local webhook returned ${response.status}: ${await response.text()}`);
    }
  } catch (error) {
    console.error(`Polling error: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}
