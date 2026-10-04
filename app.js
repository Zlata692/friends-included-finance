let state;
let current = 'richard';
const $ = (selector) => document.querySelector(selector);
const eur = (n) => new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(n);

async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  const payload = JSON.parse(text);
  if (!response.ok) throw new Error(payload.error);
  return payload;
}
function showNotice(text, error = false) { $('#notice').innerHTML = `<div class="notice ${error ? 'error' : ''}">${text}</div>`; window.scrollTo({ top: 0, behavior: 'smooth' }); }
async function refresh() {
  const response = await fetch(`/api/state?actorId=${encodeURIComponent(current)}`, { cache: 'no-store' });
  state = await response.json().catch(() => { throw new Error('The role could not be loaded. Please try again.'); });
  if (!response.ok) throw new Error(state.error);
  render();
}
function render() {
  const me = state.employees.find((person) => person.id === current);
  const manager = me.role === 'manager';
  $('#role').innerHTML = state.employees.map((person) => `<option value="${person.id}" ${person.id === current ? 'selected' : ''}>${person.name}</option>`).join('');
  $('#saleForm').classList.toggle('hidden', me.role !== 'sales');
  $('#expenseForm').classList.toggle('hidden', me.role !== 'expense');
  $('#forms').classList.toggle('hidden', manager);
  $('#manager').classList.toggle('hidden', !manager);
  $('#managerOnly').classList.toggle('hidden', !manager);
  $('#test1').classList.toggle('hidden', !manager); $('#test2').classList.toggle('hidden', !manager); $('#reset').classList.toggle('hidden', !manager);
  $('#overview').classList.toggle('hidden', !manager);
  if (manager) renderOverview();
  renderManager(me);
  renderTable(manager);
  $('#linkEmployee').innerHTML = state.employees.map((person) => `<option value="${person.id}">${person.name}</option>`).join('');
}
function renderOverview() {
  const t = state.totals;
  $('#stats').innerHTML = [['Company result', eur(t.company)], ['Company overhead', eur(t.overhead)], ['Awaiting allocation', eur(t.awaiting)], ['Pending sales', state.records.filter((r) => r.status === 'pending_approval').length], ['Total commission', eur(Object.values(t.commissionsByPerson).reduce((a, b) => a + b, 0))]].map(([label, value]) => `<div class="stat"><span class="muted">${label}</span><b>${value}</b></div>`).join('');
  $('#projects').innerHTML = ['A', 'B'].map((project) => `<article class="card"><h3>Project ${project} — ${project === 'A' ? 'Respectable Relatives' : 'Drunk University Friends'}</h3><div class="metric">${eur(t[project].result)}</div><div class="muted">Income ${eur(t[project].income)} · commissions ${eur(t[project].commissions)} · expenses ${eur(t[project].expenses)}</div></article>`).join('') + `<article class="card"><h3>Commission earned</h3><div class="muted">Richard ${eur(t.commissionsByPerson.richard)}<br>Anastasia ${eur(t.commissionsByPerson.anastasia)}<br>Jean-Claude ${eur(t.commissionsByPerson.jean)}</div></article>`;
}
function saleDecision(record) { const s = record.proposal.shares; return `<article class="card manager"><h3>${record.reference} · sale · ${eur(record.amount)}</h3><p>${record.customer} — ${record.description}<br><span class="muted">Proposed: Richard ${s.richard}% / Anastasia ${s.anastasia}% / Jean-Claude ${s.jean}%</span></p><div class="fields"><label><span>Richard</span><input id="${record.reference}-richard" type="number" value="${s.richard}"></label><label><span>Anastasia</span><input id="${record.reference}-anastasia" type="number" value="${s.anastasia}"></label><label><span>Jean-Claude</span><input id="${record.reference}-jean" type="number" value="${s.jean}"></label></div><p><button class="approve" data-ref="${record.reference}" data-type="sale">Approve sale</button></p></article>`; }
function expenseDecision(record) { const selected = (value) => record.proposal.allocation === value ? 'selected' : ''; return `<article class="card manager"><h3>${record.reference} · expense · ${eur(record.amount)}</h3><p>${record.description}<br><span class="muted">Proposed: ${record.proposal.allocation}</span></p><label><span>Final allocation</span><select id="${record.reference}-allocation"><option value="A" ${selected('A')}>Project A</option><option value="B" ${selected('B')}>Project B</option><option value="overhead" ${selected('overhead')}>Company overhead</option></select></label><p><button class="approve" data-ref="${record.reference}" data-type="expense">Confirm allocation</button></p></article>`; }
function renderManager(me) { const pending = state.records.filter((record) => record.status === 'pending_approval' || record.status === 'awaiting_allocation'); if (me.role !== 'manager') { $('#manager').innerHTML = ''; return; } $('#manager').innerHTML = `<h2>Manager decisions</h2>${pending.length ? pending.map((record) => record.type === 'sale' ? saleDecision(record) : expenseDecision(record)).join('') : '<div class="notice">No decisions awaiting action.</div>'}`; }
function renderTable(manager) {
  const rows = state.records.slice().reverse().map((record) => {
    const detail = record.type === 'sale' ? `${record.customer}<br><span class="muted">Project ${record.project}</span>` : `${record.category}<br><span class="muted">proposed ${record.proposal.allocation}${record.finalAllocation ? ` → final ${record.finalAllocation}` : ''}</span>`;
    const statusClass = record.status.includes('pending') || record.status.includes('awaiting') ? 'pending' : 'approved';
    const delivery = manager ? `<br><span class="muted">Sheets: ${record.syncStatus} · Telegram: ${record.notificationStatus}</span>` : '';
    const retry = manager && record.syncStatus === 'failed' ? `<button class="retry small" data-ref="${record.reference}">Retry sync</button>` : '';
    return `<tr><td><b>${record.reference}</b><br><span class="muted">${record.type}</span></td><td>${detail}</td><td>${record.description}</td><td>${eur(record.amount)}</td><td><span class="tag ${statusClass}">${record.status.replaceAll('_', ' ')}</span>${delivery}</td><td>${retry}</td></tr>`;
  }).join('');
  $('#table').innerHTML = `<table><thead><tr><th>Reference</th><th>Details</th><th>Description</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6">No submissions yet.</td></tr>'}</tbody></table>`;
}

$('#role').addEventListener('change', async (event) => { current = event.target.value; try { await refresh(); } catch (error) { showNotice(error.message, true); } });
$('#saleForm').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.target); try { await api('/api/submit', { actorId: current, record: { type: 'sale', reference: form.get('reference'), customer: form.get('customer'), description: form.get('description'), project: form.get('project'), amount: form.get('amount'), shares: { richard: Number(form.get('richard')), anastasia: Number(form.get('anastasia')), jean: Number(form.get('jean')) } } }); event.target.reset(); showNotice('Sale saved. It is awaiting Svetlana’s approval.'); await refresh(); } catch (error) { showNotice(error.message, true); } });
$('#expenseForm').addEventListener('submit', async (event) => { event.preventDefault(); const form = new FormData(event.target); try { await api('/api/submit', { actorId: current, record: { type: 'expense', reference: form.get('reference'), description: form.get('description'), category: form.get('category'), amount: form.get('amount'), proposedAllocation: form.get('allocation') } }); event.target.reset(); showNotice('Expense saved.'); await refresh(); } catch (error) { showNotice(error.message, true); } });
document.addEventListener('click', async (event) => { try { if (event.target.classList.contains('approve')) { const reference = event.target.dataset.ref; const body = event.target.dataset.type === 'sale' ? { actorId: current, reference, shares: { richard: Number($(`#${reference}-richard`).value), anastasia: Number($(`#${reference}-anastasia`).value), jean: Number($(`#${reference}-jean`).value) } } : { actorId: current, reference, allocation: $(`#${reference}-allocation`).value }; await api('/api/decision', body); showNotice(`${reference} updated.`); await refresh(); } if (event.target.classList.contains('retry')) { await api('/api/retry', { actorId: current, reference: event.target.dataset.ref }); showNotice('Sync retry completed.'); await refresh(); } } catch (error) { showNotice(error.message, true); } });
$('#link').addEventListener('click', async () => { try { await api('/api/link', { actorId: current, employeeId: $('#linkEmployee').value, telegramUserId: $('#telegramUser').value, telegramChatId: $('#telegramChat').value }); showNotice('Telegram link saved.'); await refresh(); } catch (error) { showNotice(error.message, true); } });
$('#reset').onclick = async () => { if (confirm('Clear all local transactions?')) { try { await api('/api/reset', { actorId: current }); showNotice('Local data cleared.'); await refresh(); } catch (error) { showNotice(error.message, true); } } };
$('#test1').onclick = async () => { try { await api('/api/test', { actorId: current, test: '1' }); showNotice('Test 1 records loaded.'); await refresh(); } catch (error) { showNotice(error.message, true); } };
$('#test2').onclick = async () => { try { await api('/api/test', { actorId: current, test: '2' }); showNotice('Test 2 records loaded.'); await refresh(); } catch (error) { showNotice(error.message, true); } };
refresh().catch((error) => showNotice(error.message, true));
