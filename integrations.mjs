import { createSign } from 'node:crypto';

const configured = (name) => Boolean(process.env[name]);
const base64url = (value) => Buffer.from(value).toString('base64url');

export function hasSupabase() {
  return configured('SUPABASE_URL') && configured('SUPABASE_SECRET_KEY');
}
export function hasGoogleSheets() {
  return configured('GOOGLE_SHEETS_ID') && configured('GOOGLE_SERVICE_ACCOUNT_JSON');
}

async function supabase(path, options = {}) {
  const response = await fetch(`${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SECRET_KEY}`,
      'content-type': 'application/json',
      Prefer: 'return=representation,resolution=merge-duplicates',
      ...options.headers
    }
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}: ${await response.text()}`);
  return response.status === 204 ? null : response.json();
}

function employeeRow(person) {
  return { id: person.id, name: person.name, role: person.role, telegram_user_id: person.telegramUserId || null, telegram_chat_id: person.telegramChatId || null };
}
function recordRow(record) {
  return {
    reference: record.reference, type: record.type, submitted_by: record.submittedBy,
    submitted_at: record.submittedAt, notification_chat_id: record.notificationChatId || null,
    payload: record, proposal: record.proposal, decision: record.decision,
    status: record.status, sync_status: record.syncStatus, notification_status: record.notificationStatus
  };
}
export async function loadSupabaseState(defaultEmployees) {
  const [employees, rows, telegramLinks] = await Promise.all([
    supabase('employees?select=*'),
    supabase('transactions?select=*&order=submitted_at.asc'),
    supabase('telegram_links?select=*')
  ]);
  if (!employees.length) {
    await supabase('employees?on_conflict=id', { method: 'POST', body: JSON.stringify(defaultEmployees.map(employeeRow)) });
    return { employees: defaultEmployees, records: rows.map((row) => row.payload), telegramLinks: [] };
  }
  return {
    employees: employees.map((row) => ({ id: row.id, name: row.name, role: row.role, telegramUserId: row.telegram_user_id, telegramChatId: row.telegram_chat_id })),
    records: rows.map((row) => ({ ...row.payload, proposal: row.proposal, decision: row.decision, status: row.status, syncStatus: row.sync_status, notificationStatus: row.notification_status, notificationChatId: row.notification_chat_id })),
    telegramLinks: telegramLinks.map((row) => ({ telegramUserId: row.telegram_user_id, employeeId: row.employee_id, telegramChatId: row.telegram_chat_id }))
  };
}
export async function saveSupabaseState(data) {
  await Promise.all([
    supabase('employees?on_conflict=id', { method: 'POST', body: JSON.stringify(data.employees.map(employeeRow)) }),
    data.records.length ? supabase('transactions?on_conflict=reference', { method: 'POST', body: JSON.stringify(data.records.map(recordRow)) }) : Promise.resolve()
  ]);
}

// Links are separate from employees so a reviewer test account can be moved
// without replacing another real employee's Telegram account.
export function telegramEmployee(data, telegramUserId) {
  const link = (data.telegramLinks || []).find((item) => String(item.telegramUserId) === String(telegramUserId));
  if (link) return data.employees.find((person) => person.id === link.employeeId);
  return data.employees.find((person) => String(person.telegramUserId) === String(telegramUserId));
}

export async function setTelegramLink(employeeId, telegramUserId, telegramChatId) {
  const userId = String(telegramUserId || '').trim() || null;
  const chatId = String(telegramChatId || '').trim() || null;
  if (!userId && chatId) throw new Error('Enter a Telegram user ID as well as the chat ID.');
  if (!userId) {
    await supabase(`telegram_links?employee_id=eq.${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
    return;
  }
  const matches = await supabase(`telegram_links?telegram_user_id=eq.${encodeURIComponent(userId)}&select=employee_id`);
  if (matches.some((link) => link.employee_id !== employeeId)) throw new Error('This Telegram account is already linked to another employee. Use the explicit test-account transfer below; no link was changed.');
  await supabase('telegram_links?on_conflict=telegram_user_id', {
    method: 'POST',
    body: JSON.stringify([{ telegram_user_id: userId, employee_id: employeeId, telegram_chat_id: chatId }])
  });
}

export async function transferTelegramLink(fromEmployeeId, toEmployeeId) {
  if (fromEmployeeId === toEmployeeId) throw new Error('Choose two different employees.');
  const people = await supabase(`employees?id=in.(${encodeURIComponent(fromEmployeeId)},${encodeURIComponent(toEmployeeId)})&select=id,name`);
  const from = people.find((person) => person.id === fromEmployeeId);
  const to = people.find((person) => person.id === toEmployeeId);
  if (!from || !to) throw new Error('Employee not found.');
  const links = await supabase(`telegram_links?employee_id=eq.${encodeURIComponent(fromEmployeeId)}&select=telegram_user_id`);
  if (!links.length) throw new Error(`${from.name} has no linked Telegram account to move.`);
  if (links.length > 1) throw new Error(`${from.name} has more than one Telegram account. Choose a single account in Manager setup instead.`);
  await supabase(`telegram_links?telegram_user_id=eq.${encodeURIComponent(links[0].telegram_user_id)}`, {
    method: 'PATCH', body: JSON.stringify({ employee_id: to.id })
  });
}

export async function telegramSend(chatId, text) {
  if (!configured('TELEGRAM_BOT_TOKEN') || !chatId) return { status: 'not_configured' };
  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text })
  });
  if (!response.ok) throw new Error(`Telegram returned ${response.status}`);
  return { status: 'sent' };
}

async function googleAccessToken() {
  const account = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${base64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: account.token_uri, iat: now, exp: now + 3600 }))}`;
  const signer = createSign('RSA-SHA256'); signer.update(unsigned); signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key, 'base64url')}`;
  const response = await fetch(account.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if (!response.ok) throw new Error(`Google OAuth returned ${response.status}: ${await response.text()}`);
  return (await response.json()).access_token;
}
function salesRow(r) {
  const proposed = r.proposal.shares; const approved = r.decision?.shares || {};
  return [r.reference, r.submittedAt, r.submittedBy, r.customer, r.project, r.description, r.amount, proposed.richard, proposed.anastasia, proposed.jean, approved.richard ?? '', approved.anastasia ?? '', approved.jean ?? '', r.status, r.syncStatus, r.notificationStatus];
}
function expensesRow(r) {
  return [r.reference, r.submittedAt, r.submittedBy, r.description, r.category, r.amount, r.proposal.allocation, r.finalAllocation || '', r.status, r.syncStatus, r.notificationStatus];
}
export async function syncSheets(record) {
  if (!hasGoogleSheets()) return { status: 'not_configured' };
  const token = await googleAccessToken(); const id = encodeURIComponent(process.env.GOOGLE_SHEETS_ID);
  const sheet = record.type === 'sale' ? 'Sales' : 'Expenses'; const row = record.type === 'sale' ? salesRow(record) : expensesRow(record);
  const headers = { Authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const valuesUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${sheet}!A:Z`)}`;
  const existingResponse = await fetch(valuesUrl, { headers });
  if (!existingResponse.ok) throw new Error(`Google Sheets returned ${existingResponse.status}: ${await existingResponse.text()}`);
  const values = (await existingResponse.json()).values || [];
  const existingIndex = values.findIndex((cells, index) => index > 0 && cells[0] === record.reference);
  if (existingIndex >= 0) {
    const updateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${sheet}!A${existingIndex + 1}`)}?valueInputOption=USER_ENTERED`;
    const update = await fetch(updateUrl, { method: 'PUT', headers, body: JSON.stringify({ values: [row] }) });
    if (!update.ok) throw new Error(`Google Sheets update returned ${update.status}: ${await update.text()}`);
  } else {
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(`${sheet}!A:Z`)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
    const append = await fetch(appendUrl, { method: 'POST', headers, body: JSON.stringify({ values: [row] }) });
    if (!append.ok) throw new Error(`Google Sheets append returned ${append.status}: ${await append.text()}`);
  }
  return { status: 'synced' };
}
