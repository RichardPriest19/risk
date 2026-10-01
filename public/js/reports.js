// Statistical reports: KPIs, charts (HTML bars, 5x5 heatmap) each with a table view.
'use strict';

const STATUS_COLOR = { Low: 'var(--st-good)', Medium: 'var(--st-warn)', High: 'var(--st-serious)', Critical: 'var(--st-critical)' };
const EFF_COLOR = { 'Effective': 'var(--st-good)', 'Partially effective': 'var(--st-warn)', 'Ineffective': 'var(--st-critical)', 'Not assessed': 'var(--neutral-2)', 'Not applicable': 'var(--neutral-1)' };
const QA_COLOR = { 'Good': 'var(--st-good)', 'Partly / vague': 'var(--st-warn)', 'Concern': 'var(--st-critical)', "Don't know": 'var(--neutral-2)' };
const QA_SIG_KEY = { good: 'Good', partial: 'Partly / vague', concern: 'Concern', unknown: "Don't know" };
const EV_COLOR = { 'Seen - verified': 'var(--st-good)', 'Seen - not verified': 'var(--seq-3)', 'Requested': 'var(--st-warn)', 'Not available': 'var(--st-critical)' };

function countBy(list, fn) { const m = new Map(); list.forEach((x) => { const k = fn(x); if (k == null || k === '') return; (Array.isArray(k) ? k : [k]).forEach((kk) => m.set(kk, (m.get(kk) || 0) + 1)); }); return m; }

// Horizontal bar chart. items: [{label, value, color?, tip?}]
function hbar(items, { unit = '', max, pct = false } = {}) {
  if (!items.length) return '<p class="empty">No data for the current filters.</p>';
  const m = max || Math.max(...items.map((i) => i.value), 1);
  return `<div class="hbar" role="list">${items.map((i) => `
    <div class="hbar-row" role="listitem">
      <span class="hbar-label">${esc(i.label)}</span>
      <span class="hbar-track"><span class="hbar-fill" tabindex="0" style="width:${i.value ? Math.max(0.5, (i.value / m) * 100) : 0}%;${i.value ? '' : 'min-width:0;'}background:${i.color || 'var(--seq-4)'}" data-tip="${esc(`${i.value}${pct ? '%' : ''}${unit}|${i.label}${i.tip ? '|' + i.tip : ''}`)}"></span></span>
      <span class="hbar-val">${i.value}${pct ? '%' : ''}</span>
    </div>`).join('')}</div>`;
}
// Stacked 100% rows. rows: [{label, parts: {key: n}}], keys ordered, colors map.
function stacked(rows, keys, colors) {
  if (!rows.length) return '<p class="empty">No data for the current filters.</p>';
  const legend = `<div class="legend">${keys.map((k) => `<span><i style="background:${colors[k]}"></i>${esc(k)}</span>`).join('')}</div>`;
  return legend + `<div class="stack-chart">${rows.map((r) => {
    const tot = keys.reduce((a, k) => a + (r.parts[k] || 0), 0) || 1;
    return `<div class="hbar-row"><span class="hbar-label">${esc(r.label)}</span><span class="stack-track">${keys.filter((k) => r.parts[k]).map((k) =>
      `<span class="stack-seg" tabindex="0" style="width:${(r.parts[k] / tot) * 100}%;background:${colors[k]}" data-tip="${esc(`${r.parts[k]} (${Math.round((r.parts[k] / tot) * 100)}%)|${k}|${r.label}`)}"></span>`).join('')}</span></div>`;
  }).join('')}</div>`;
}
function heatmap(fs, lk, ik, title) {
  const grid = {}; let max = 0;
  fs.forEach((f) => { const l = Number(f[lk]), i = Number(f[ik]); if (l && i) { const k = `${l}-${i}`; grid[k] = (grid[k] || 0) + 1; max = Math.max(max, grid[k]); } });
  const seq = ['var(--seq-1)', 'var(--seq-2)', 'var(--seq-3)', 'var(--seq-4)', 'var(--seq-5)', 'var(--seq-6)'];
  const cell = (l, i) => {
    const n = grid[`${l}-${i}`] || 0, zone = scoreRating(l * i);
    const bg = n ? seq[Math.min(5, Math.ceil((n / max) * 5))] : 'var(--surface-2)';
    return `<td class="hm-cell${n && n / max > 0.5 ? ' dark' : ''}" style="background:${bg}" tabindex="0" data-tip="${esc(`${n} finding${n === 1 ? '' : 's'}|Likelihood ${l} × impact ${i} = ${l * i} (${zone})`)}"><span class="hm-zone">${zone[0]}</span>${n || ''}</td>`;
  };
  return `<figure class="heatmap"><figcaption>${esc(title)}</figcaption><table><tbody>
    ${[5, 4, 3, 2, 1].map((l) => `<tr><th scope="row">${l} ${esc(T.likelihood[l - 1][1])}</th>${[1, 2, 3, 4, 5].map((i) => cell(l, i)).join('')}</tr>`).join('')}
    <tr><th></th>${T.impact.map(([n, l]) => `<th scope="col">${n}<br>${esc(l)}</th>`).join('')}</tr>
  </tbody></table><p class="hint">Rows: likelihood · columns: impact · letter = rating zone (L/M/H/C) · shading = number of findings.</p></figure>`;
}
function dataTable(headers, rows) {
  return `<details class="tview"><summary>Show as table</summary><table class="table"><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length}" class="empty">No data</td></tr>`}</tbody></table></details>`;
}
const chartCard = (title, body, table, cls = '') => `<section class="card chart-card ${cls}"><h2>${esc(title)}</h2>${body}${table || ''}</section>`;

function computeStats(ivsAll, fsAll, flt) {
  const ivs = ivsAll.filter((i) => {
    const h = i.data.header || {};
    return (!flt.svc || svcIdsOf(i).includes(Number(flt.svc))) && (!flt.qn || qnIdOf(i) === flt.qn) && (!flt.from || (h.date || '') >= flt.from) && (!flt.to || (h.date || '') <= flt.to) && (!flt.team || h.team === flt.team)
      && (!flt.app || (h.applications || '').toLowerCase().includes(flt.app.toLowerCase()));
  });
  const ivIds = new Set(ivs.map((i) => i.id));
  const ivFiltered = flt.svc || flt.qn || flt.from || flt.to || flt.team || flt.app; // unlinked findings have no questionnaire
  const QS = flt.qn && T.qnById(flt.qn) ? [T.qnById(flt.qn)] : qnsIn(ivs);
  const SECS = QS.flatMap((q) => q.sections);
  const fs = fsAll.filter((f) => {
    if (f.interviewId && ivIds.has(f.interviewId)) return true;
    if (flt.svc) return (f.serviceIds || []).includes(Number(flt.svc)); // linked to the service directly
    if (f.interviewId && ivFiltered) return false;
    const d = (f.createdAt || '').slice(0, 10);
    return (!flt.from || d >= flt.from) && (!flt.to || d <= flt.to) && (!flt.team || (f.developerTeam || '').includes(flt.team))
      && (!flt.app || (f.application || '').toLowerCase().includes(flt.app.toLowerCase()));
  });
  const open = fs.filter((f) => f.status !== 'Closed');
  const ratingOrder = ['Critical', 'High', 'Medium', 'Low'];
  const byRating = countBy(open, (f) => findingScores(f).effR);
  const effRows = SECS.map((s) => ({ label: secLabel(s), parts: Object.fromEntries(T.sectionRatings.map((r) => [r, ivs.filter((i) => ((i.data.sections || {})[s.id]?.rating || 'Not assessed') === r).length])) }));
  const ev = { 'Seen - verified': 0, 'Seen - not verified': 0, 'Requested': 0, 'Not available': 0 };
  const evBySection = SECS.map((s) => {
    const parts = { 'Seen - verified': 0, 'Seen - not verified': 0, 'Requested': 0, 'Not available': 0 };
    ivs.forEach((i) => { const e = (i.data.sections || {})[s.id]?.evidence || {}; Object.values(e).forEach((x) => { if (x && parts[x.status] !== undefined) { parts[x.status]++; ev[x.status]++; } }); });
    return { label: secLabel(s), parts };
  }).filter((r) => Object.values(r.parts).some(Boolean));
  // Quick answers, read through each question's polarity (a "Yes" can be good or a concern). Facts and N/A are excluded.
  const qIndex = {};
  SECS.forEach((s) => [s.opener, ...s.questions].forEach((q) => { qIndex[`${s.id}|${q.id}`] = { s, q }; }));
  const perQ = {}; const qaTot = { answered: 0, unknown: 0, concern: 0 };
  const qaBySection = SECS.map((s) => {
    const parts = Object.fromEntries(Object.keys(QA_COLOR).map((k) => [k, 0]));
    ivs.forEach((i) => Object.entries((i.data.sections || {})[s.id]?.answers || {}).forEach(([qid, a]) => {
      const hit = a?.qa && qIndex[`${s.id}|${qid}`]; if (!hit) return;
      const sig = T.answerSignal(hit.q, a.qa), k = QA_SIG_KEY[sig]; if (!k) return;
      parts[k]++; qaTot.answered++; if (sig === 'unknown') qaTot.unknown++; if (sig === 'concern') qaTot.concern++;
      const pq = perQ[`${s.id}|${qid}`] = perQ[`${s.id}|${qid}`] || { s, q: hit.q, n: 0, concern: 0, unknown: 0 };
      pq.n++; if (sig === 'concern') pq.concern++; if (sig === 'unknown') pq.unknown++;
    }));
    return { label: secLabel(s), parts };
  }).filter((r) => Object.values(r.parts).some(Boolean));
  const topQs = Object.values(perQ).filter((x) => x.concern + x.unknown > 0)
    .sort((a, b) => (b.concern + b.unknown) / b.n - (a.concern + a.unknown) / a.n || b.n - a.n).slice(0, 15);
  const rf = QS.flatMap((q) => q.redFlags).map((f) => ({ label: `“${f.quote}”`, value: ivs.filter((i) => (i.data.redFlags || {})[f.id]?.on).length })).filter((x) => x.value).sort((a, b) => b.value - a.value);
  // Checklist completion is measured within each questionnaire (their checklists differ).
  const ck = QS.flatMap((q) => { const qi = ivs.filter((i) => qnIdOf(i) === q.id); return q.checklist.map(([k, l]) => ({ label: (QS.length > 1 ? q.title + ' - ' : '') + l, value: qi.length ? Math.round((qi.filter((i) => (i.data.checklist || {})[k]).length / qi.length) * 100) : 0 })); });
  const teams = {};
  ivs.forEach((i) => { const t = i.data.header?.team || '(no team)'; teams[t] = teams[t] || { ivs: 0, fs: 0, open: 0, hc: 0 }; teams[t].ivs++; });
  fs.forEach((f) => { const iv = ivs.find((i) => i.id === f.interviewId); const t = iv ? (iv.data.header?.team || '(no team)') : '(not linked)'; teams[t] = teams[t] || { ivs: 0, fs: 0, open: 0, hc: 0 }; teams[t].fs++; if (f.status !== 'Closed') { teams[t].open++; if (['High', 'Critical'].includes(findingScores(f).effR)) teams[t].hc++; } });
  return {
    ivs, fs, open, ratingOrder, byRating, effRows, ev, evBySection, rf, ck, teams, qaBySection, topQs, qaTot,
    kpi: {
      interviews: ivs.length, complete: ivs.filter((i) => i.status === 'Complete').length, findings: fs.length, open: open.length,
      highOpen: open.filter((f) => ['High', 'Critical'].includes(findingScores(f).effR)).length, overdue: fs.filter(isOverdue).length,
      accepted: fs.filter((f) => f.status === 'Risk accepted').length, redFlags: ivs.reduce((a, i) => a + Object.values(i.data.redFlags || {}).filter((x) => x && x.on).length, 0),
      escalated: open.filter((f) => f.escalation === 'Yes').length,
    },
    byCat: [...countBy(fs, (f) => f.category)].sort((a, b) => b[1] - a[1]),
    byStatus: FINDING_STATUSES.map((s) => [s, fs.filter((f) => f.status === s).length]),
    byClass: [...countBy(fs, (f) => f.classification)].sort((a, b) => b[1] - a[1]),
    byUk: [...countBy(fs, (f) => findingUkAreas(f))].sort((a, b) => b[1] - a[1]),
    byEff: [...countBy(fs, (f) => f.controlEffectiveness)],
  };
}

function statsHtml(st) {
  const k = st.kpi;
  const tile = (l, v, s) => `<div class="tile"><span class="tile-label">${esc(l)}</span><span class="tile-value">${v}</span><span class="tile-sub">${esc(s)}</span></div>`;
  return `
    <div class="tiles">
      ${tile('Interviews', k.interviews, `${k.complete} complete`)}
      ${tile('Findings', k.findings, `${k.open} open`)}
      ${tile('High / critical open', k.highOpen, 'residual, or inherent if not assessed')}
      ${tile('Overdue actions', k.overdue, 'past target date')}
      ${tile('Risk accepted', k.accepted, 'formally accepted findings')}
      ${tile('Escalated (open)', k.escalated, 'escalation required')}
      ${tile('Red flags heard', k.redFlags, 'across interviews')}
      ${tile("\"Don't know\" answers", st.qaTot.answered ? Math.round((st.qaTot.unknown / st.qaTot.answered) * 100) + '%' : '-', `of ${st.qaTot.answered} quick answers`)}
    </div>
    <div class="grid-2">
      ${chartCard('Open findings by rating', hbar(st.ratingOrder.map((r) => ({ label: r, value: st.byRating.get(r) || 0, color: STATUS_COLOR[r] }))), dataTable(['Rating', 'Open findings'], st.ratingOrder.map((r) => [r, st.byRating.get(r) || 0])))}
      ${chartCard('Findings by status', hbar(st.byStatus.map(([l, v]) => ({ label: l, value: v }))), dataTable(['Status', 'Findings'], st.byStatus))}
    </div>
    ${chartCard('Risk heatmaps', `<div class="grid-2">${heatmap(st.fs, 'likelihood', 'impact', 'Inherent risk')}${heatmap(st.fs, 'residualLikelihood', 'residualImpact', 'Residual risk')}</div>`)}
    <div class="grid-2">
      ${chartCard('Findings by risk category', hbar(st.byCat.map(([l, v]) => ({ label: l, value: v }))), dataTable(['Category', 'Findings'], st.byCat))}
      ${chartCard('Findings by classification', hbar(st.byClass.map(([l, v]) => ({ label: l, value: v }))), dataTable(['Classification', 'Findings'], st.byClass))}
    </div>
    <div class="grid-2">
      ${chartCard('Findings by regulatory area (PRA first)', hbar(st.byUk.map(([l, v]) => ({ label: `${l} - ${areaRegulator(l)}`, value: v }))), dataTable(['Regulatory area', 'Regulator', 'Findings'], st.byUk.map(([l, v]) => [l, areaRegulator(l), v])))}
      ${chartCard('Findings by control effectiveness', hbar(st.byEff.map(([l, v]) => ({ label: l, value: v }))), dataTable(['Effectiveness', 'Findings'], st.byEff))}
    </div>
    ${chartCard('Control assessment by section (number of interviews)', stacked(st.effRows, T.sectionRatings, EFF_COLOR), dataTable(['Section', ...T.sectionRatings], st.effRows.map((r) => [r.label, ...T.sectionRatings.map((k) => r.parts[k])])), 'wide')}
    ${chartCard('Quick answers by section', stacked(st.qaBySection, Object.keys(QA_COLOR), QA_COLOR) + '<p class="hint">Each answer is read through the question: a “Yes” to “Can developers approve their own changes?” counts as a concern. Plain facts and N/A are excluded.</p>', dataTable(['Section', ...Object.keys(QA_COLOR)], st.qaBySection.map((r) => [r.label, ...Object.keys(QA_COLOR).map((kk) => r.parts[kk])])), 'wide')}
    ${chartCard('Questions most often answered with a concern or “Don\'t know”', st.topQs.length ? `<table class="table"><thead><tr><th>Question</th><th>Section</th><th class="num">Interviews</th><th class="num">Concern</th><th class="num">Don't know</th></tr></thead><tbody>
      ${st.topQs.map((x) => `<tr><td>${esc(x.q.q)}</td><td>${esc(secLabel(x.s))}</td><td class="num">${x.n}</td><td class="num">${x.concern ? Math.round((x.concern / x.n) * 100) + '%' : '-'}</td><td class="num">${x.unknown ? Math.round((x.unknown / x.n) * 100) + '%' : '-'}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No concerning or “Don\'t know” quick answers for the current filters.</p>', '', 'wide')}
    ${chartCard('Evidence status by section (evidence items)', stacked(st.evBySection, Object.keys(EV_COLOR), EV_COLOR) + `<p class="hint">Totals: ${Object.entries(st.ev).map(([kk, v]) => `${esc(kk)} ${v}`).join(' · ')}. “I believe we do this” is not the same as “here is the evidence”.</p>`, dataTable(['Section', ...Object.keys(EV_COLOR)], st.evBySection.map((r) => [r.label, ...Object.keys(EV_COLOR).map((kk) => r.parts[kk])])), 'wide')}
    <div class="grid-2">
      ${chartCard('Most frequently heard red flags (interviews)', hbar(st.rf), dataTable(['Red flag', 'Interviews'], st.rf.map((x) => [x.label, x.value])))}
      ${chartCard('Checklist completion across interviews', hbar(st.ck, { max: 100, pct: true }), dataTable(['Checklist item', '% of interviews'], st.ck.map((x) => [x.label, x.value + '%'])))}
    </div>
    ${chartCard('By team', `<table class="table"><thead><tr><th>Team</th><th class="num">Interviews</th><th class="num">Findings</th><th class="num">Open</th><th class="num">High/critical open</th></tr></thead><tbody>
      ${Object.entries(st.teams).map(([t, v]) => `<tr><td>${esc(t)}</td><td class="num">${v.ivs}</td><td class="num">${v.fs}</td><td class="num">${v.open}</td><td class="num">${v.hc}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No data</td></tr>'}</tbody></table>`, '', 'wide')}
    ${chartCard('Remediation due - overdue and next 30 days', dueTable(st.fs), '', 'wide')}`;
}

function readFilters() {
  return { svc: $('#rSvc')?.value || '', qn: $('#rQn')?.value || '', from: $('#rFrom')?.value || '', to: $('#rTo')?.value || '', team: $('#rTeam')?.value || '', app: $('#rApp')?.value || '' };
}
let lastReportFilters = { svc: '', qn: '', from: '', to: '', team: '', app: '' };

// Reports page: audience reports first (board, compliance, CTO), then the assessors' working analysis.
const REPORT_TABS = [
  ['Reports for', [['board', 'Board of Directors', 'Plain English: facts and figures, what works, concerns, actions'], ['compliance', 'Head of Compliance', 'Plain English: obligations affected, accepted risks, overdue actions, evidence'],
    ['finance', 'Chief Financial Officer', 'Plain English: accounts, regulatory reports, payments and fraud'],
    ['technology', 'CTO - technical report', 'Findings, control areas, consistency between teams, regulatory sources'], ['briefing', null, 'The case for change, with the decisions requested']]],
  ['Working analysis', [['stats', 'Statistics', 'All charts and counts'], ['themes', 'Themes', 'What recurs across interviews'], ['trends', 'Trends', 'Month by month']]],
];
async function viewReports(tab = 'board') {
  setActiveNav('reports');
  const [ivs, fs] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))].sort();
  const f = lastReportFilters;
  const audBtns = (k) => `<button class="btn" id="rWordAud" data-kind="${k}">Download Word (.docx)</button><a class="btn btn-primary" href="#/print/${k}">Print / PDF</a>`;
  const actions = {
    board: audBtns('board'), compliance: audBtns('compliance'), finance: audBtns('finance'), technology: audBtns('technology'),
    stats: '<button class="btn" id="rCsv">Export statistics (CSV)</button><a class="btn" href="#/print/stats">Print statistics report</a>',
    themes: '<button class="btn" id="rWord">Download Word (.docx)</button><a class="btn" href="#/print/themes">Print themes report</a>',
    trends: '<a class="btn" href="#/print/trends">Print trends report</a>',
    briefing: '<button class="btn" id="rWordBrief">Download Word (.docx)</button><a class="btn btn-primary" href="#/print/briefing">Print / PDF</a>',
  }[tab];
  state.briefingDoc = await api('GET', '/api/docs/briefing');
  await loadServices();
  if (AUD_KINDS[tab]) await loadAudDoc(tab);
  const tabLabel = (k, l) => l || `${briefingTabLabel()} paper`;
  view().innerHTML = `
    <div class="page-head"><h1>Reports</h1><div class="row">${actions}</div></div>
    <nav class="report-nav" aria-label="Reports">${REPORT_TABS.map(([group, items]) => `<div class="rn-group"><span class="rn-label">${esc(group)}</span><div class="rn-items">${items.map(([k, l, hint]) => `<a href="#/reports/${k}" class="rn-item${tab === k ? ' active' : ''}"><strong>${esc(tabLabel(k, l))}</strong><small>${esc(hint)}</small></a>`).join('')}</div></div>`).join('')}</nav>
    <div class="filters card">
      ${state.services.length ? `<label>Business service <select id="rSvc">${options(state.services.map((s) => [s.id, `${s.ref} ${s.name}`]), f.svc, 'All services')}</select></label>` : ''}
      ${MULTI_QN ? `<label>Questionnaire <select id="rQn">${options(T.questionnaires.map((q) => [q.id, q.title]), f.qn, 'All questionnaires')}</select></label>` : ''}
      <label>Interview date from <input type="date" id="rFrom" value="${esc(f.from)}"></label>
      <label>to <input type="date" id="rTo" value="${esc(f.to)}"></label>
      <label>Team <select id="rTeam">${options(teams, f.team, 'All teams')}</select></label>
      <label>Application contains <input id="rApp" value="${esc(f.app)}"></label>
      <button class="btn btn-ghost" id="rClear">Clear filters</button>
    </div>
    <div id="rBody"></div>`;
  let st;
  const draw = () => {
    lastReportFilters = readFilters();
    if (tab === 'themes') { $('#rBody').innerHTML = themesHtml(themesModel(ivs, fs, lastReportFilters)); return; }
    if (tab === 'trends') { $('#rBody').innerHTML = trendsHtml(trendsModel(ivs, fs, lastReportFilters)); return; }
    if (tab === 'briefing') { renderBriefing($('#rBody'), ivs, fs, lastReportFilters); return; }
    if (AUD_KINDS[tab]) { renderAudience(tab, $('#rBody'), ivs, fs, lastReportFilters); return; }
    st = computeStats(ivs, fs, lastReportFilters); $('#rBody').innerHTML = statsHtml(st);
  };
  const FIDS = ['rSvc', 'rQn', 'rFrom', 'rTo', 'rTeam', 'rApp'].filter((id) => $('#' + id));
  FIDS.forEach((id) => $('#' + id).addEventListener('input', draw));
  $('#rClear').onclick = () => { FIDS.forEach((id) => { $('#' + id).value = ''; }); draw(); };
  draw();
  const w = $('#rWord'); if (w) w.onclick = () => wordThemes(lastReportFilters).then(() => toast('Word document downloaded.')).catch(fail);
  const wa = $('#rWordAud'); if (wa) wa.onclick = () => wordAudience(wa.dataset.kind).then(() => toast('Word document downloaded.')).catch(fail);
  const wb = $('#rWordBrief'); if (wb) wb.onclick = () => wordBriefing().then(() => toast('Word document downloaded.')).catch(fail);
  if (tab !== 'stats') return;
  $('#rCsv').onclick = () => {
    const rows = [['Measure', 'Group', 'Value']];
    Object.entries(st.kpi).forEach(([kk, v]) => rows.push(['KPI', kk, v]));
    st.ratingOrder.forEach((r) => rows.push(['Open findings by rating', r, st.byRating.get(r) || 0]));
    st.byStatus.forEach(([l, v]) => rows.push(['Findings by status', l, v]));
    st.byCat.forEach(([l, v]) => rows.push(['Findings by category', l, v]));
    st.byClass.forEach(([l, v]) => rows.push(['Findings by classification', l, v]));
    st.byUk.forEach(([l, v]) => rows.push([`Findings by regulatory area (${areaRegulator(l)})`, l, v]));
    st.effRows.forEach((r) => T.sectionRatings.forEach((kk) => rows.push(['Control assessment - ' + kk, r.label, r.parts[kk]])));
    st.evBySection.forEach((r) => Object.keys(r.parts).forEach((kk) => rows.push(['Evidence - ' + kk, r.label, r.parts[kk]])));
    st.qaBySection.forEach((r) => Object.keys(r.parts).forEach((kk) => rows.push(['Quick answers - ' + kk, r.label, r.parts[kk]])));
    st.topQs.forEach((x) => { rows.push(['Question concern %', x.q.q, Math.round((x.concern / x.n) * 100)]); rows.push(["Question don't know %", x.q.q, Math.round((x.unknown / x.n) * 100)]); });
    st.rf.forEach((x) => rows.push(['Red flag heard', x.label, x.value]));
    st.ck.forEach((x) => rows.push(['Checklist completion %', x.label, x.value]));
    saveBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), `statistics-${today()}.csv`);
  };
}
