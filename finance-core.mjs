import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasGoogleSheets, hasSupabase, loadSupabaseState, saveSupabaseState, telegramSend, syncSheets } from './integrations.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const dataFile = join(root, 'data.json');
const port = Number(process.env.PORT || 3000);
const people = [
  { id: 'svetlana', name: 'Svetlana de Monte Carlo', role: 'manager' },
  { id: 'richard', name: 'Richard Darling', role: 'sales' },
  { id: 'anastasia', name: 'Anastasia Ferrari', role: 'sales' },
  { id: 'jean', name: 'Jean-Claude Bērziņš', role: 'sales' },
  { id: 'kevin', name: 'Kevin von Whatever', role: 'expense' }
];
const money = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
async function load() { return hasSupabase() ? loadSupabaseState(people) : (existsSync(dataFile) ? JSON.parse(await readFile(dataFile, 'utf8')) : { employees: people, records: [] }); }
async function save(data) { if (hasSupabase()) return saveSupabaseState(data); await writeFile(dataFile, JSON.stringify(data, null, 2)); }
function response(res, status, body) { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
function validateReference(ref, type) { return new RegExp(`^${type === 'sale' ? 'S' : 'E'}\\d{2}$`).test(ref || ''); }
function actor(data, id) { return data.employees.find(x => x.id === id); }
function commission(amount, shares) {
  const pool = money(amount * .1); const ids = ['richard', 'anastasia', 'jean'];
  let amounts = Object.fromEntries(ids.map(id => [id, money(pool * shares[id] / 100)]));
  const diff = money(pool - Object.values(amounts).reduce((a, b) => a + b, 0));
  const leader = ids.sort((a,b) => shares[b] - shares[a])[0]; amounts[leader] = money(amounts[leader] + diff);
  return { pool, amounts };
}
function totals(records) {
  const result = { A: { income: 0, commissions: 0, expenses: 0 }, B: { income: 0, commissions: 0, expenses: 0 }, overhead: 0, awaiting: 0, commissionsByPerson: { richard: 0, anastasia: 0, jean: 0 } };
  for (const r of records) {
    if (r.type === 'sale' && r.status === 'approved') { const c = commission(r.amount, r.decision.shares); result[r.project].income += r.amount; result[r.project].commissions += c.pool; for (const [id, value] of Object.entries(c.amounts)) result.commissionsByPerson[id] += value; }
    if (r.type === 'expense') { if (r.status === 'awaiting_allocation') result.awaiting += r.amount; else if (r.finalAllocation === 'overhead') result.overhead += r.amount; else if (r.finalAllocation) result[r.finalAllocation].expenses += r.amount; }
  }
  for (const p of ['A','B']) { result[p].income = money(result[p].income); result[p].commissions = money(result[p].commissions); result[p].expenses = money(result[p].expenses); result[p].result = money(result[p].income - result[p].commissions - result[p].expenses); }
  result.overhead = money(result.overhead); result.awaiting = money(result.awaiting); result.company = money(result.A.income + result.B.income - result.A.commissions - result.B.commissions - result.A.expenses - result.B.expenses - result.overhead - result.awaiting);
  for (const id in result.commissionsByPerson) result.commissionsByPerson[id] = money(result.commissionsByPerson[id]); return result;
}
function submission(data, body) {
  const a = actor(data, body.actorId); if (!a) throw Error('Unknown employee.');
  const r = body.record; if (!r || !['sale', 'expense'].includes(r.type)) throw Error('Choose a transaction type.'); if (!validateReference(r.reference, r.type)) throw Error('Reference must use S01 or E01 format.');
  if (data.records.some(x => x.reference === r.reference)) throw Error('This reference already exists.');
  if (!(Number(r.amount) > 0)) throw Error('Amount must be greater than zero.');
  if (r.type === 'sale') { if (a.role !== 'sales') throw Error('Only salespeople can submit sales.'); if (!r.customer || !r.description || !['A','B'].includes(r.project)) throw Error('Complete all sale fields.'); const sum = ['richard','anastasia','jean'].reduce((n,id) => n + Number(r.shares?.[id]), 0); if (sum !== 100 || Object.values(r.shares || {}).some(x => Number(x) < 0 || Number(x) > 100)) throw Error('Commission shares must total exactly 100%.'); return { ...r, amount: money(r.amount), submittedBy: a.id, submittedAt: new Date().toISOString(), notificationChatId: a.telegramChatId || null, status: 'pending_approval', proposal: { shares: r.shares }, decision: null, syncStatus: 'pending', notificationStatus: 'not_required' }; }
  if (a.role !== 'expense') throw Error('Only Kevin can submit expenses.'); if (!r.description || !['Materials','Travel','Other'].includes(r.category) || !['A','B','overhead'].includes(r.proposedAllocation)) throw Error('Complete all expense fields.'); const automatic = r.proposedAllocation === 'overhead'; return { ...r, amount: money(r.amount), submittedBy: a.id, submittedAt: new Date().toISOString(), notificationChatId: a.telegramChatId || null, status: automatic ? 'allocated' : 'awaiting_allocation', finalAllocation: automatic ? 'overhead' : null, proposal: { allocation: r.proposedAllocation }, decision: automatic ? { allocation: 'overhead', at: new Date().toISOString() } : null, syncStatus: 'pending', notificationStatus: 'not_required' };
}
async function sync(record) { try { record.syncStatus = hasGoogleSheets() ? 'synced' : 'local_only'; const r = await syncSheets(record); record.syncStatus = r.status === 'not_configured' ? 'local_only' : 'synced'; } catch { record.syncStatus = 'failed'; } }
async function notify(record, text) { if (!record.notificationChatId) { record.notificationStatus = 'no_recipient'; return; } try { const r = await telegramSend(record.notificationChatId, text); record.notificationStatus = r.status; } catch { record.notificationStatus = 'failed'; } }
function submissionConfirmation(record) {
  if (record.type === 'sale') return `Sale ${record.reference} recorded: €${record.amount.toFixed(2)}, Project ${record.project}. Status: Pending approval.`;
  return `Expense ${record.reference} recorded: €${record.amount.toFixed(2)}, proposed allocation ${record.proposedAllocation}. Status: ${record.status.replaceAll('_', ' ')}.`;
}
function parseTelegramSubmission(text, employeeId) {
  const [command, ...parts] = String(text || '').trim().split(/\s*\|\s*/);
  const action = command.toLowerCase();
  if (action === 'sale') {
    const [reference, customer, project, amount, description, richard, anastasia, jean] = parts;
    return { actorId: employeeId, record: { type: 'sale', reference, customer, project, amount, description, shares: { richard: Number(richard), anastasia: Number(anastasia), jean: Number(jean) } } };
  }
  if (action === 'expense') {
    const [reference, category, amount, proposedAllocation, description] = parts;
    return { actorId: employeeId, record: { type: 'expense', reference, category, amount, proposedAllocation, description } };
  }
  throw Error('Use: sale | S01 | Customer | A or B | 1000 | Description | 50 | 30 | 20, or expense | E01 | Materials | 120 | A, B, or overhead | Description.');
}
async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`); if (req.method === 'GET' && url.pathname === '/') { res.writeHead(200, {'content-type':'text/html; charset=utf-8'}); return res.end(await readFile(join(root,'index.html'))); }
  if (req.method === 'GET' && url.pathname === '/app.js') { res.writeHead(200, {'content-type':'text/javascript; charset=utf-8'}); return res.end(await readFile(join(root,'app.js'))); }
  if (req.method === 'GET' && url.pathname === '/api/state') { const d = await load(); const viewer = actor(d, url.searchParams.get('actorId')); if (!viewer) return response(res,403,{error:'Choose a valid role.'}); const records = viewer.role === 'manager' ? d.records : d.records.filter(r => r.submittedBy === viewer.id); return response(res,200,{viewer:{id:viewer.id,role:viewer.role},employees:d.employees.map(({id,name,role})=>({id,name,role})),records,totals:viewer.role === 'manager' ? totals(d.records) : null}); }
  if (req.method !== 'POST') return response(res,404,{error:'Not found'});
  let body=''; for await (const c of req) { body += c; if (body.length > 100_000) throw Error('Request is too large.'); } try { body = JSON.parse(body || '{}'); const data = await load();
    if (url.pathname === '/telegram/webhook' || url.pathname === '/api/telegram/webhook') {
      if (process.env.TELEGRAM_WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== process.env.TELEGRAM_WEBHOOK_SECRET) return response(res, 401, { error: 'Invalid Telegram webhook secret.' });
      const message = body.message; if (!message?.chat?.id || !message?.from?.id) return response(res, 200, { ok: true });
      const employee = data.employees.find((person) => String(person.telegramUserId) === String(message.from.id));
      if (!employee) { await telegramSend(message.chat.id, 'Your Telegram account is not linked. Send these details to Svetlana for Manager setup. User ID: ' + message.from.id + '. Chat ID: ' + message.chat.id); return response(res, 200, { ok: true }); }
      if (String(message.text || '').trim().toLowerCase() === '/start') { await telegramSend(message.chat.id, `You are linked as ${employee.name}.`); return response(res, 200, { ok: true }); }
      const record = submission(data, parseTelegramSubmission(message.text, employee.id)); record.notificationChatId = String(message.chat.id); data.records.push(record); await sync(record); await save(data); await notify(record, submissionConfirmation(record)); await save(data); return response(res, 200, { ok: true });
    }
    if (url.pathname === '/api/submit') { const r = submission(data, body); data.records.push(r); await sync(r); await save(data); await notify(r, submissionConfirmation(r)); await save(data); return response(res,201,{record:r, totals:totals(data.records)}); }
    if (url.pathname === '/api/decision') { const a = actor(data, body.actorId); if (!a || a.role !== 'manager') throw Error('Only Svetlana can make decisions.'); const r=data.records.find(x=>x.reference===body.reference); if (!r) throw Error('Record not found.'); let decisionText; if (r.type === 'sale') { if (r.status === 'approved') throw Error('This sale was already approved.'); const shares=body.shares; const sum=['richard','anastasia','jean'].reduce((n,id)=>n+Number(shares?.[id]),0); if(sum!==100) throw Error('Commission shares must total 100%.'); r.decision={shares, at:new Date().toISOString()}; r.status='approved'; const c=commission(r.amount,shares); const changed=JSON.stringify(shares)!==JSON.stringify(r.proposal.shares); decisionText=`Sale ${r.reference} approved${changed?' — commission split changed':''}. Sale €${r.amount.toFixed(2)}; total commission €${c.pool.toFixed(2)}. Richard: ${shares.richard}% (€${c.amounts.richard.toFixed(2)}). Anastasia: ${shares.anastasia}% (€${c.amounts.anastasia.toFixed(2)}). Jean-Claude: ${shares.jean}% (€${c.amounts.jean.toFixed(2)}).`; } else { if(r.status==='allocated') throw Error('This expense was already allocated.'); const allocation=body.allocation; if(!['A','B','overhead'].includes(allocation)) throw Error('Choose a valid allocation.'); r.finalAllocation=allocation;r.decision={allocation,at:new Date().toISOString()};r.status='allocated'; const changed=allocation!==r.proposal.allocation; decisionText=`Expense ${r.reference}${changed?' — allocation changed':''}. €${r.amount.toFixed(2)}: ${r.description}. Proposed: ${r.proposal.allocation}. Approved: ${allocation}.`; } await sync(r); await save(data); await notify(r, decisionText); await save(data); return response(res,200,{record:r, totals:totals(data.records)}); }
    if (url.pathname === '/api/link') { const manager=actor(data,body.actorId); if (!manager || manager.role !== 'manager') throw Error('Only Svetlana can link Telegram accounts.'); const a=actor(data,body.employeeId); if(!a) throw Error('Employee not found.'); a.telegramUserId=String(body.telegramUserId||'');a.telegramChatId=String(body.telegramChatId||'');await save(data);return response(res,200,{employees:data.employees}); }
    if (url.pathname === '/api/retry') { const r=data.records.find(x=>x.reference===body.reference);if(!r)throw Error('Record not found.');await sync(r);await save(data);return response(res,200,{record:r}); }
    if (url.pathname === '/api/reset') { if (hasSupabase()) throw Error('Local reset is disabled while Supabase is connected.'); await save({employees:people,records:[]});return response(res,200,{ok:true}); }
    if (url.pathname === '/api/test') { for (const rec of testRecords(body.test)) { if (!data.records.some(x=>x.reference===rec.reference)) data.records.push(rec); } await save(data); return response(res,200,{ok:true}); }
    return response(res,404,{error:'Not found'});
  } catch(e) { return response(res,400,{error:e.message}); }
}
function sale(reference, by, customer, description, project, amount, shares, approved=true, finalShares=shares) { return {reference,type:'sale',submittedBy:by,submittedAt:new Date().toISOString(),customer,description,project,amount,shares,proposal:{shares},decision:approved?{shares:finalShares,at:new Date().toISOString()}:null,status:approved?'approved':'pending_approval',syncStatus:'local_only',notificationStatus:'not_required',notificationChatId:null}; }
function expense(reference, description, category, amount, proposed, approved=true, finalAllocation=proposed) { return {reference,type:'expense',submittedBy:'kevin',submittedAt:new Date().toISOString(),description,category,amount,proposedAllocation:proposed,proposal:{allocation:proposed},decision:approved?{allocation:finalAllocation,at:new Date().toISOString()}:null,finalAllocation:approved?finalAllocation:null,status:approved?'allocated':'awaiting_allocation',syncStatus:'local_only',notificationStatus:'not_required',notificationChatId:null}; }
function testRecords(t) { const one=[sale('S01','richard','Olivia Rose','One proud uncle and an emotional grandmother','A',1000,{richard:50,anastasia:30,jean:20}),sale('S02','anastasia','Daniel King','University friends, dancing, and the stripping performance','B',2000,{richard:0,anastasia:50,jean:50},true,{richard:20,anastasia:40,jean:40}),expense('E01','Rented suit and fake pearl necklace for the relatives','Materials',120,'A'),expense('E02','Taxi for the grandmother','Travel',80,'B',true,'A'),expense('E03','Monthly company website subscription','Other',100,'overhead')]; if(t==='1')return one; return [...one,sale('S03','jean','Emma Stonebridge','Premium relatives, including an uncle presented as a surgeon','A',1500,{richard:40,anastasia:40,jean:20},true,{richard:20,anastasia:30,jean:50}),sale('S04','richard','Lucas Green','Small group of loud university friends','B',800,{richard:25,anastasia:25,jean:50}),sale('S05','richard','Mia Brooks','Extra guests and an embarrassing speech','B',600,{richard:100,anastasia:0,jean:0},false),expense('E04','Replacement costumes after an enthusiastic dance performance','Materials',250,'B'),expense('E05','Minibus for university friends','Travel',90,'A',true,'B'),expense('E06','Company telephone subscription','Other',60,'overhead'),expense('E07','Emergency replacement clothing','Materials',140,'A',false)]; }
export { handle };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  http.createServer(handle).listen(port, () => console.log(`Friends Included is running at http://localhost:${port}`));
}
