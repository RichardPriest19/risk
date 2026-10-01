// Important business services register (PRA SS1/21): the services, their impact tolerances and mapping, and a
// service-level view of everything the interview programme has found about each one.
'use strict';

const SVC_DESIGNATIONS = ['Important business service', 'Candidate - under review', 'Not an important business service'];
const SVC_RESULTS = ['Within tolerance', 'Partly tested', 'Breached tolerance', 'Not tested'];
const SVC_STATUSES = ['Draft', 'Under review', 'Approved'];
const SVC_REGULATORS = ['PRA and FCA', 'PRA', 'FCA'];
// The SS1/21 mapping: the resources each service relies on. One item per line.
const SVC_MAPPING = [
  ['people', 'People and teams', 'e.g. Payments Engineering\nPayments Operations\nOut-of-hours on-call rota'],
  ['processes', 'Processes', 'e.g. Payment initiation\nSanctions screening\nEnd-of-day reconciliation'],
  ['technology', 'Technology - systems and applications', 'One per line, using the names given in interviews, e.g.\nPayments Gateway\nCore banking ledger'],
  ['suppliers', 'Third parties and suppliers', 'e.g. Cloud provider\nFaster Payments access provider\nCard processor'],
  ['facilities', 'Facilities', 'e.g. Head office\nRemote working'],
  ['data', 'Information and data', 'e.g. Customer account data\nPayment instructions'],
];
// Questionnaires every important business service should be covered by.
const SVC_EXPECTED_QNS = ['dev', 'ops', 'sec'];
const svcLines = (t) => String(t || '').split(/\n|;/).map((x) => x.trim()).filter(Boolean);
const monthsSince = (d) => (d ? (Date.now() - new Date(d).getTime()) / (30.44 * 864e5) : Infinity);
const isIbs = (svc) => svc.designation === 'Important business service';
const svcIdsOf = (iv) => iv?.data?.header?.serviceIds || iv?.header?.serviceIds || [];
const svcName = (id) => (state.services || []).find((s) => s.id === Number(id));
const SVC_TONE_LABEL = { good: 'No issues found', warn: 'Gaps to address', bad: 'Needs attention' };

async function loadServices() { state.services = await api('GET', '/api/services'); return state.services; }

// Checkbox list for linking a record to services (interview details, finding form).
function serviceCheckboxes(name, selected = [], disabled = false) {
  const list = state.services || [];
  if (!list.length) return `<p class="hint">No services in the register yet. ${canEdit() ? '<a href="#/service/new">Add one</a>' : ''}</p>`;
  return `<div class="area-grid svc-grid">${list.map((s) => `<label class="check"><input type="checkbox" ${name.startsWith('data-') ? name : `name="${name}"`} value="${s.id}"${selected.map(Number).includes(s.id) ? ' checked' : ''}${disabled ? ' disabled' : ''}> ${esc(s.ref)} ${esc(s.name)}${isIbs(s) ? ' <span class="tag ibs-tag">IBS</span>' : ''}</label>`).join('')}</div>`;
}

// Everything known about one service, from the register entry and the linked interviews and findings.
function serviceModel(svc, ivs, fs) {
  const linked = ivs.filter((i) => svcIdsOf(i).includes(svc.id));
  const ivIds = new Set(linked.map((i) => i.id));
  const findings = fs.filter((f) => (f.serviceIds || []).includes(svc.id) || (f.interviewId && ivIds.has(f.interviewId)));
  const open = findings.filter((f) => f.status !== 'Closed').map((f) => ({ f, ...findingScores(f) })).sort((a, b) => b.eff - a.eff);
  const hc = open.filter((x) => ['High', 'Critical'].includes(x.effR));
  const coverage = T.questionnaires.map((q) => ({ q, ivs: linked.filter((i) => qnIdOf(i) === q.id), expected: SVC_EXPECTED_QNS.includes(q.id) }));
  const weak = [];
  linked.forEach((i) => qnOf(i).sections.forEach((s) => { const r = i.data?.sections?.[s.id]?.rating; if (r === 'Ineffective' || r === 'Partially effective') weak.push({ iv: i, s, r }); }));
  const ev = linked.flatMap((i) => evidenceRows(i, []));
  const evOutstanding = ev.filter((r) => r.status === 'Requested');
  const evOverdueRows = ev.filter(evOverdue);
  const redFlags = linked.flatMap((i) => qnOf(i).redFlags.filter((f) => i.data?.redFlags?.[f.id]?.on).map((f) => ({ iv: i, f })));
  const apps = linked.map((i) => (i.data?.header?.applications || '').toLowerCase()).join(' | ');
  const systems = svcLines(svc.technology).map((name) => ({ name, covered: apps.includes(name.toLowerCase()) }));
  const flags = [];
  const ibs = isIbs(svc);
  if (!svc.owner) flags.push(['warn', 'No business owner recorded.']);
  if (ibs && !svc.accountableSmf) flags.push(['warn', 'No accountable senior manager recorded.']);
  if (ibs && !svc.toleranceText && !svc.toleranceHours) flags.push(['bad', 'No impact tolerance set.']);
  if (ibs) {
    if (!svc.scenarioTestDate || svc.scenarioResult === 'Not tested' || !svc.scenarioResult) flags.push(['bad', 'Not yet tested against its impact tolerance.']);
    else if (monthsSince(svc.scenarioTestDate) > 12) flags.push(['warn', `Last scenario test was ${fmtDate(svc.scenarioTestDate)} - over 12 months ago.`]);
    if (svc.scenarioResult === 'Breached tolerance') flags.push(['bad', 'The last scenario test breached the impact tolerance.']);
  }
  const unmapped = SVC_MAPPING.filter(([k]) => !svcLines(svc[k]).length).map(([, l]) => l.split(' - ')[0].toLowerCase());
  if (unmapped.length) flags.push(['warn', `Mapping incomplete: no ${unmapped.join(', ')} recorded.`]);
  if (!svc.reviewDate || monthsSince(svc.reviewDate) > 12) flags.push(['warn', 'Not reviewed in the last 12 months.']);
  if (hc.length) flags.push(['bad', `${hc.length} open High or Critical finding${hc.length === 1 ? '' : 's'}.`]);
  const missing = coverage.filter((c) => c.expected && !c.ivs.length).map((c) => c.q.title);
  if (ibs && missing.length) flags.push(['warn', `No ${missing.join(', ')} interview linked yet.`]);
  const uncovered = systems.filter((x) => !x.covered);
  if (uncovered.length && linked.length) flags.push(['warn', `${uncovered.length} mapped system${uncovered.length === 1 ? '' : 's'} not covered by any linked interview.`]);
  const tone = flags.some((x) => x[0] === 'bad') ? 'bad' : flags.length ? 'warn' : 'good';
  return { svc, linked, findings, open, hc, coverage, weak, evOutstanding, evOverdueRows, redFlags, systems, uncovered, flags, tone, ibs };
}

const svcTone = (tone, text) => `<span class="es-chip es-${tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : 'good'}">${esc(text || SVC_TONE_LABEL[tone])}</span>`;
const svcResultChip = (r) => (r ? svcTone(r === 'Within tolerance' ? 'good' : r === 'Breached tolerance' || r === 'Not tested' ? 'bad' : 'warn', r) : '<span class="hint">-</span>');
const qnShort = (q) => q.short || q.title;

// ---------- register ----------
async function viewServices() {
  setActiveNav('services');
  const [svcs, ivs, fs] = await Promise.all([loadServices(), api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
  const models = svcs.map((s) => serviceModel(s, ivs, fs));
  const ibsN = models.filter((m) => m.ibs).length;
  view().innerHTML = `
    <div class="page-head"><h1>Important business services</h1>
      <div class="row">${canEdit() ? '<a class="btn btn-primary" href="#/service/new">+ Add service</a><button class="btn" id="svcCsv">Export CSV</button>' : ''}<a class="btn" href="#/print/services">Print register</a></div></div>
    <p class="intro">The services the bank provides to its customers and markets, the impact tolerance for each important business service, and the people, processes, technology, suppliers, facilities and data behind them (PRA SS1/21). Link interviews and findings to a service to see, in one place, how well it is controlled. ${helpBtn('services')}</p>
    ${svcs.length ? `<div class="tiles">
      <div class="tile"><span class="tile-label">Important business services</span><span class="tile-value">${ibsN}</span><span class="tile-sub">${svcs.length} services in the register</span></div>
      <div class="tile"><span class="tile-label">Not tested or test over 12 months</span><span class="tile-value">${models.filter((m) => m.ibs && (monthsSince(m.svc.scenarioTestDate) > 12 || !m.svc.scenarioResult || m.svc.scenarioResult === 'Not tested')).length}</span><span class="tile-sub">important business services</span></div>
      <div class="tile"><span class="tile-label">Breached tolerance at last test</span><span class="tile-value">${models.filter((m) => m.svc.scenarioResult === 'Breached tolerance').length}</span><span class="tile-sub">services</span></div>
      <div class="tile"><span class="tile-label">High / critical open findings</span><span class="tile-value">${new Set(models.flatMap((m) => m.hc.map((x) => x.f.id))).size}</span><span class="tile-sub">linked to a service</span></div>
    </div>` : ''}
    <div class="card">${svcs.length ? `<table class="table svc-table"><thead><tr><th>Ref</th><th>Service</th><th>Owner / accountable</th><th>Impact tolerance</th><th>Last scenario test</th><th>Interviews</th><th>Open findings</th><th>Health</th></tr></thead><tbody>
      ${models.map((m) => `<tr><td><a href="#/service/${m.svc.id}">${esc(m.svc.ref)}</a>${m.svc.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</td>
        <td><a href="#/service/${m.svc.id}"><strong>${esc(m.svc.name)}</strong></a><br><small class="hint">${esc(m.svc.designation || 'Designation not set')}${m.svc.status ? ' · ' + esc(m.svc.status) : ''}</small></td>
        <td>${esc(m.svc.owner || '')}${m.svc.accountableSmf ? `<br><small class="hint">${esc(m.svc.accountableSmf)}</small>` : ''}</td>
        <td>${esc(m.svc.toleranceText || (m.svc.toleranceHours ? m.svc.toleranceHours + ' hours' : ''))}</td>
        <td>${m.svc.scenarioTestDate ? fmtDate(m.svc.scenarioTestDate) + '<br>' : ''}${svcResultChip(m.svc.scenarioResult)}</td>
        <td class="nowrap">${m.linked.length}<br>${m.coverage.map((c) => `<span class="cov ${c.ivs.length ? 'cov-yes' : c.expected ? 'cov-no' : 'cov-na'}" title="${esc(c.q.title)}: ${c.ivs.length} interview(s)">${esc(qnShort(c.q))}</span>`).join('')}</td>
        <td class="num">${m.open.length}${m.hc.length ? `<br><small class="overdue">${m.hc.length} high/critical</small>` : ''}</td>
        <td>${svcTone(m.tone)}${m.flags[0] ? `<br><small class="hint">${esc(m.flags[0][1])}${m.flags.length > 1 ? ` (+${m.flags.length - 1} more)` : ''}</small>` : ''}</td></tr>`).join('')}
      </tbody></table>` : `<div class="empty-state"><p><strong>No services yet.</strong> Start with the bank's important business services - for example retail payments, account opening, savings withdrawals - using the names and impact tolerances from the operational resilience self-assessment.</p>${canEdit() ? '<a class="btn btn-primary" href="#/service/new">+ Add the first service</a>' : ''}</div>`}
    </div>`;
  const c = $('#svcCsv'); if (c) c.onclick = () => download('/api/export/services.csv', 'business-services.csv').catch(fail);
}

// ---------- one service ----------
async function viewService(id) {
  setActiveNav('services');
  const [svcs, ivs, fs] = await Promise.all([loadServices(), api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
  const isNew = id === 'new';
  if (isNew && !canEdit()) throw new Error('You do not have permission to add services.');
  const svc = isNew ? { designation: 'Important business service', status: 'Draft', regulators: 'PRA and FCA', scenarioResult: 'Not tested' } : svcs.find((s) => s.id === Number(id));
  if (!svc) throw new Error('Service not found.');
  const ro = !canEdit();
  const v = (k) => svc[k] ?? '';
  const I = (k, label, type = 'text', ph = '', cls = '') => `<label class="${cls}">${label} <input type="${type}" name="${k}" value="${esc(v(k))}" placeholder="${esc(ph)}"${k === 'name' ? ' required' : ''}${type === 'number' ? ' min="0" step="0.5"' : ''}></label>`;
  const A = (k, label, rows = 3, ph = '', cls = 'full') => `<label class="${cls}">${label} <textarea name="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(v(k))}</textarea></label>`;
  const S = (k, label, list) => `<label>${label} <select name="${k}">${options(list, v(k), 'Select…')}</select></label>`;
  const m = isNew ? null : serviceModel(svc, ivs, fs);
  view().innerHTML = `
    <div class="page-head"><div><a class="back" href="#/services">← Services</a><h1>${isNew ? 'New service' : `${esc(svc.ref)} · ${esc(svc.name)}`}</h1></div>
      <div class="row">${isNew ? '' : `<a class="btn" href="#/print/service/${svc.id}">Print / PDF</a><a class="btn" href="#/reports?svc=${svc.id}">Reports for this service</a>`}${!isNew && isAdmin() ? '<button class="btn btn-danger" id="svcDel">Delete</button>' : ''}</div></div>
    ${svc.demo ? '<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> Demonstration service - an example, not a real record.</p></div>' : ''}
    ${m ? serviceSummaryHtml(m) + serviceDetailHtml(m) : ''}
    <form id="svcForm" class="card">
      ${m ? '<h2 class="svc-form-head">Register entry</h2>' : ''}
      <fieldset ${ro ? 'disabled' : ''}>
      <h2>Service</h2>
      <div class="form-grid">
        ${I('name', 'Service name', 'text', 'e.g. Retail payments - making a payment', 'full')}
        ${S('designation', `Designation ${helpBtn('services')}`, SVC_DESIGNATIONS)}${S('status', 'Register status', SVC_STATUSES)}
        ${A('description', 'Description - what the service lets customers or markets do', 2)}
        ${I('customers', 'Who receives it', 'text', 'e.g. Retail customers; SME customers', 'full')}
        ${I('owner', 'Business owner', 'text', 'Name and role')}${I('accountableSmf', 'Accountable senior manager', 'text', 'e.g. SMF24 Chief Operations')}
        ${S('regulators', 'Regulators', SVC_REGULATORS)}<span></span>
      </div>
      <h2>Impact tolerance</h2>
      <div class="form-grid">
        ${A('toleranceText', 'Impact tolerance', 2, 'e.g. Customers must be able to make payments within 4 hours of disruption, with no more than 1 day of delayed payments')}
        ${I('toleranceHours', 'Maximum tolerable disruption (hours)', 'number', 'e.g. 4')}${I('otherMetrics', 'Other tolerance measures', 'text', 'e.g. number of customers affected, value of payments')}
      </div>
      <h2>Mapping (people, processes, technology, suppliers, facilities, data)</h2>
      <p class="hint">One item per line. Name systems the way interviewees do - the service page checks each system against the applications recorded on linked interviews.</p>
      <div class="form-grid">${SVC_MAPPING.map(([k, l, ph]) => A(k, l, 4, ph, '')).join('')}</div>
      <h2>Testing and review</h2>
      <div class="form-grid">
        ${I('scenarioTestDate', 'Last scenario test', 'date')}${S('scenarioResult', 'Result against impact tolerance', SVC_RESULTS)}
        ${A('scenarioNotes', 'Scenarios tested and what they showed', 3, 'e.g. Loss of cloud region: recovered in 5h against a 4h tolerance; manual payment workaround untested')}
        ${A('vulnerabilities', 'Known vulnerabilities and remediation', 3, 'Weaknesses that could stop the bank staying within tolerance, and what is being done')}
        ${I('selfAssessmentRef', 'Self-assessment reference', 'text', 'e.g. Operational resilience self-assessment 2026, section 4')}${I('reviewDate', 'Last reviewed', 'date')}
        ${I('approvedBy', 'Approved by', 'text', 'e.g. Board Risk Committee, 12 March 2026')}<span></span>
        ${A('notes', 'Notes', 2)}
      </div>
      </fieldset>
      ${svc.id ? `<p class="hint">Created by ${esc(svc.createdBy)} ${fmtDateTime(svc.createdAt)} · last updated by ${esc(svc.updatedBy)} ${fmtDateTime(svc.updatedAt)}</p>` : ''}
      ${ro ? '' : `<div class="row-end"><button class="btn btn-primary" type="submit">${isNew ? 'Add service' : 'Save service'}</button></div>`}
    </form>`;
  const form = $('#svcForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = { ...svc };
    for (const el of form.elements) if (el.name) body[el.name] = el.value;
    body.toleranceHours = body.toleranceHours ? Number(body.toleranceHours) : '';
    try {
      const saved = isNew ? await api('POST', '/api/services', body) : await api('PUT', `/api/services/${svc.id}`, body);
      toast(`${saved.ref} saved.`);
      if (isNew) location.hash = `#/service/${saved.id}`; else viewService(String(saved.id));
    } catch (err) { fail(err); }
  };
  const del = $('#svcDel');
  if (del) del.onclick = async () => {
    if (!(await modalConfirm(`Delete ${svc.ref} ${svc.name}? Links from interviews and findings are removed; the interviews and findings themselves are kept.`, 'Delete service'))) return;
    try { const r = await api('DELETE', `/api/services/${svc.id}`); toast(`Service deleted; unlinked from ${r.unlinked} record(s).`); location.hash = '#/services'; } catch (err) { fail(err); }
  };
}

// Health and coverage at the top of a service page (and its printout).
function serviceSummaryHtml(m) {
  const s = m.svc;
  return `<section class="card svc-summary">
    <div class="svc-head">${svcTone(m.tone)} <strong>${esc(s.designation || 'Designation not set')}</strong>${s.toleranceText || s.toleranceHours ? ` · impact tolerance: ${esc(s.toleranceText || s.toleranceHours + ' hours')}` : ''}</div>
    ${m.flags.length ? `<ul class="svc-flags">${m.flags.map(([t, txt]) => `<li class="flag-${t}">${esc(txt)}</li>`).join('')}</ul>` : '<p>No gaps found from the register entry or the linked interviews and findings.</p>'}
    <div class="tiles svc-tiles">
      <div class="tile"><span class="tile-label">Linked interviews</span><span class="tile-value">${m.linked.length}</span><span class="tile-sub">${m.coverage.filter((c) => c.ivs.length).length} of ${T.questionnaires.length} questionnaires</span></div>
      <div class="tile"><span class="tile-label">Open findings</span><span class="tile-value">${m.open.length}</span><span class="tile-sub">${m.hc.length} high or critical</span></div>
      <div class="tile"><span class="tile-label">Control areas rated weak</span><span class="tile-value">${m.weak.length}</span><span class="tile-sub">ineffective or partially effective</span></div>
      <div class="tile"><span class="tile-label">Evidence outstanding</span><span class="tile-value">${m.evOutstanding.length}</span><span class="tile-sub">${m.evOverdueRows.length} overdue</span></div>
    </div></section>`;
}

// What the interview programme has found about the service.
function serviceDetailHtml(m, forPrint) {
  const link = (h, t) => (forPrint ? esc(t) : `<a href="${h}">${esc(t)}</a>`);
  return `
    <section class="card"><h2>Coverage by questionnaire</h2>
      <p class="hint">Every important business service should be covered at least by software development, technology operations and information security interviews.</p>
      <table class="table"><thead><tr><th>Questionnaire</th><th>Linked interviews</th></tr></thead><tbody>
      ${m.coverage.map((c) => `<tr><td>${esc(c.q.title)}${c.expected ? '' : ' <small class="hint">(where relevant)</small>'}</td><td>${c.ivs.length ? c.ivs.map((i) => `${link(`#/interview/${i.id}`, i.ref)} ${esc(i.data.header?.developerName || '')}${i.data.header?.team ? ' · ' + esc(i.data.header.team) : ''} <small class="hint">(${esc(i.status)})</small>`).join('<br>') : `<span class="${c.expected ? 'overdue' : 'hint'}">None yet</span>`}</td></tr>`).join('')}
      </tbody></table></section>
    ${m.systems.length ? `<section class="card"><h2>Mapped systems and interview coverage</h2><ul class="svc-systems">${m.systems.map((x) => `<li class="${x.covered ? 'cov-yes' : 'cov-no'}">${x.covered ? '✓' : '✗'} ${esc(x.name)}${x.covered ? '' : ' <small class="hint">- not named on any linked interview</small>'}</li>`).join('')}</ul></section>` : ''}
    <section class="card"><h2>Open findings</h2>
      ${m.open.length ? `<table class="table"><thead><tr><th>Ref</th><th>Finding</th><th>Rating</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>
      ${m.open.map((x) => `<tr><td>${link(`#/finding/${x.f.id}`, x.f.ref)}</td><td>${esc(x.f.title)}</td><td>${ratingChip(x.effR, x.eff)}</td><td>${esc(x.f.controlOwner || '')}</td><td class="${isOverdue(x.f) ? 'overdue' : ''}">${fmtDate(x.f.targetDate)}</td><td>${esc(x.f.status)}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">No open findings linked to this service.</p>'}</section>
    <section class="card"><h2>Control areas rated weak</h2>
      ${m.weak.length ? `<table class="table"><thead><tr><th>Area</th><th>Rating</th><th>Interview</th></tr></thead><tbody>${m.weak.map((w) => `<tr><td>${esc(secLabel(w.s))}</td><td>${esc(w.r)}</td><td>${link(`#/interview/${w.iv.id}/${w.s.id}`, w.iv.ref)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No control areas rated ineffective or partially effective.</p>'}</section>
    ${m.redFlags.length ? `<section class="card"><h2>Red flags heard</h2><ul>${m.redFlags.map((x) => `<li>“${esc(x.f.quote)}” - ${link(`#/interview/${x.iv.id}/redflags`, x.iv.ref)}</li>`).join('')}</ul></section>` : ''}
    ${m.evOutstanding.length ? `<section class="card"><h2>Evidence outstanding</h2><table class="table"><thead><tr><th>Interview</th><th>Item</th><th>Due</th></tr></thead><tbody>${m.evOutstanding.map((r) => `<tr><td>${link(`#/interview/${r.iv.id}`, r.iv.ref)}</td><td>${esc(r.label)}</td><td class="${evOverdue(r) ? 'overdue' : ''}">${fmtDate(r.due)}</td></tr>`).join('')}</tbody></table></section>` : ''}`;
}

function serviceRegisterPrintHtml(models) {
  return `<header class="doc-head"><h1>Important business services register</h1><p>${models.length} services · ${models.filter((m) => m.ibs).length} important business services</p></header>
    <table class="table print-table"><thead><tr><th>Ref</th><th>Service</th><th>Owner / accountable</th><th>Impact tolerance</th><th>Last test</th><th>Interviews</th><th>Open (H/C)</th><th>Health</th></tr></thead><tbody>
    ${models.map((m) => `<tr><td>${esc(m.svc.ref)}</td><td><strong>${esc(m.svc.name)}</strong><br><small>${esc(m.svc.designation || '')}</small></td><td>${esc(m.svc.owner || '')}<br><small>${esc(m.svc.accountableSmf || '')}</small></td>
      <td>${esc(m.svc.toleranceText || (m.svc.toleranceHours ? m.svc.toleranceHours + ' hours' : ''))}</td><td>${m.svc.scenarioTestDate ? fmtDate(m.svc.scenarioTestDate) : ''} ${esc(m.svc.scenarioResult || '')}</td>
      <td>${m.linked.length} (${m.coverage.filter((c) => c.ivs.length).map((c) => esc(qnShort(c.q))).join(', ') || 'none'})</td><td>${m.open.length} (${m.hc.length})</td><td>${esc(SVC_TONE_LABEL[m.tone])}${m.flags.length ? `<br><small>${m.flags.map((f) => esc(f[1])).join(' ')}</small>` : ''}</td></tr>`).join('')}
    </tbody></table>`;
}

function servicePrintHtml(m) {
  const s = m.svc;
  const kv = [['Reference', s.ref], ['Designation', s.designation], ['Register status', s.status], ['Description', s.description], ['Who receives it', s.customers], ['Business owner', s.owner], ['Accountable senior manager', s.accountableSmf], ['Regulators', s.regulators],
    ['Impact tolerance', s.toleranceText], ['Maximum tolerable disruption (hours)', s.toleranceHours], ['Other tolerance measures', s.otherMetrics],
    ...SVC_MAPPING.map(([k, l]) => [l, svcLines(s[k]).join('; ')]),
    ['Last scenario test', s.scenarioTestDate ? fmtDate(s.scenarioTestDate) : ''], ['Result', s.scenarioResult], ['Scenarios and results', s.scenarioNotes], ['Known vulnerabilities and remediation', s.vulnerabilities],
    ['Self-assessment reference', s.selfAssessmentRef], ['Last reviewed', s.reviewDate ? fmtDate(s.reviewDate) : ''], ['Approved by', s.approvedBy], ['Notes', s.notes]];
  return `<header class="doc-head"><h1>${esc(s.ref)} · ${esc(s.name)}</h1><p>Business service record and interview programme summary</p></header>
    ${serviceSummaryHtml(m)}
    <section class="print-sec"><h2>Register entry</h2><table class="kv-table">${kv.map(([k, x]) => `<tr><th>${esc(k)}</th><td>${nl2br(x == null ? '' : String(x))}</td></tr>`).join('')}</table></section>
    ${serviceDetailHtml(m, true)}`;
}

async function viewPrintServices(id) {
  const [svcs, ivs, fs] = await Promise.all([loadServices(), api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
  if (id) {
    const svc = svcs.find((s) => s.id === id); if (!svc) throw new Error('Service not found.');
    printFrame(`${svc.ref} ${svc.name}`, servicePrintHtml(serviceModel(svc, ivs, fs)), `#/service/${svc.id}`);
  } else printFrame('Important business services register', serviceRegisterPrintHtml(svcs.map((s) => serviceModel(s, ivs, fs))), '#/services');
}
