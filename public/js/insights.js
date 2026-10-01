// Reporting models: one-page executive summary, programme themes, and trends over time (with SVG charts).
'use strict';

const RATING_FILL = { Critical: 'var(--st-critical)', High: 'var(--st-serious)', Medium: 'var(--st-warn)', Low: 'var(--st-good)', 'Not rated': 'var(--neutral-2)' };
const OVERALL_OPTIONS = ['Controls operating effectively', 'Generally adequate, improvements needed', 'Weaknesses requiring action', 'Significant weaknesses', 'Not yet assessed'];

// ---------- executive summary ----------
function execSummaryModel(iv, fs) {
  const d = iv.data, h = d.header || {}, Q = qnOf(iv);
  const inc = Q.sections.filter((s) => sectionIncluded(s, d));
  const ratings = inc.map((s) => ({ s, r: d.sections?.[s.id]?.rating || 'Not assessed' }));
  const count = (r) => ratings.filter((x) => x.r === r).length;
  const open = fs.filter((f) => f.status !== 'Closed').map((f) => ({ f, ...findingScores(f) })).sort((a, b) => b.eff - a.eff);
  const nR = (r) => open.filter((x) => x.effR === r).length;
  let auto;
  if (nR('Critical') || nR('High') >= 2) auto = 'Significant weaknesses';
  else if (nR('High') || count('Ineffective')) auto = 'Weaknesses requiring action';
  else if (count('Partially effective') || nR('Medium')) auto = 'Generally adequate, improvements needed';
  else if (count('Effective')) auto = 'Controls operating effectively';
  else auto = 'Not yet assessed';
  const overall = d.report?.overall || auto;
  const tone = { 'Significant weaknesses': 'bad', 'Weaknesses requiring action': 'warn', 'Generally adequate, improvements needed': 'warn', 'Controls operating effectively': 'good' }[overall] || 'none';
  let answered = 0, concerns = 0, unknown = 0;
  Q.sections.forEach((s) => [s.opener, ...s.questions].forEach((q) => {
    const a = d.sections?.[s.id]?.answers?.[q.id]; if (!a) return;
    if ((a.r || '').trim() || a.qa) answered++;
    const sig = a.qa && T.answerSignal(q, a.qa); if (sig === 'concern') concerns++; if (sig === 'unknown') unknown++;
  }));
  const ev = evidenceRows(iv, []);
  const redFlags = Q.redFlags.filter((f) => d.redFlags?.[f.id]?.on);
  const actions = open.filter((x) => ['Critical', 'High'].includes(x.effR) || x.f.escalation === 'Yes')
    .map((x) => `${x.f.ref}: ${x.f.remediation || x.f.title}${x.f.controlOwner ? ` (owner: ${x.f.controlOwner}` : ''}${x.f.targetDate ? `${x.f.controlOwner ? ', ' : ' ('}by ${fmtDate(x.f.targetDate)})` : x.f.controlOwner ? ')' : ''}`);
  if (!actions.length) (d.report?.immediate || '').split('\n').map((l) => l.replace(/^-\s*/, '').trim()).filter(Boolean).forEach((l) => actions.push(l));
  const headline = (d.report?.execSummary || '').trim() || [
    `${ratings.filter((x) => !['Not assessed', 'Not applicable'].includes(x.r)).length} of ${inc.length} areas assessed: ${count('Effective')} effective, ${count('Partially effective')} partially effective, ${count('Ineffective')} ineffective.`,
    `${open.length} open finding${open.length === 1 ? '' : 's'}${open.length ? ` (${nR('Critical')} critical, ${nR('High')} high)` : ''}.`,
    redFlags.length ? `${redFlags.length} red flag${redFlags.length === 1 ? '' : 's'} heard.` : '',
    `Evidence: ${ev.filter((r) => r.status === 'Seen - verified').length} item(s) verified, ${ev.filter((r) => r.status === 'Requested').length} outstanding.`,
  ].filter(Boolean).join(' ');
  const ukCount = {}; open.forEach((x) => findingUkAreas(x.f).forEach((a) => { ukCount[a] = (ukCount[a] || 0) + 1; }));
  const ukAffected = T.ukAreas.map((a) => [a.area, ukCount[a.area] || 0]).filter(([, n]) => n).sort((a, b) => b[1] - a[1]);
  return {
    iv, h, overall, auto, tone, headline, ratings, open, ukAffected, actions: actions.slice(0, 6),
    figures: [['Questions answered', answered], ['Concerning answers', concerns], ["\"Don't know\"", unknown], ['Red flags heard', redFlags.length],
      ['Open findings', open.length], ['High / critical', nR('Critical') + nR('High')], ['Evidence outstanding', ev.filter((r) => r.status === 'Requested').length], ['Evidence verified', ev.filter((r) => r.status === 'Seen - verified').length]],
    strengths: ratings.filter((x) => x.r === 'Effective').map((x) => x.s.title),
    weak: ratings.filter((x) => ['Ineffective', 'Partially effective'].includes(x.r)).map((x) => `${x.s.title} (${x.r.toLowerCase()})`),
    depth: (T.depths.find((x) => x.id === depthOf(d)) || {}).label,
  };
}
function execSummaryHtml(m) {
  const h = m.h;
  const cls = (r) => ({ Effective: 'good', 'Partially effective': 'warn', Ineffective: 'bad', 'Not applicable': 'na' }[r] || 'none');
  return `<section class="execsum">
    <header class="es-head"><div><h1>Executive summary</h1><p>${esc(h.developerName || '')}${h.developerRole ? ', ' + esc(h.developerRole) : ''}${h.team ? ' · ' + esc(h.team) : ''} · ${esc(m.iv.ref)}</p></div>
      <div class="es-meta">${h.date ? fmtDate(h.date) : ''}<br>${esc(h.interviewer || '')}</div></header>
    <table class="kv-table es-kv"><tr><th>Application(s)</th><td>${esc(h.applications || '')}</td><th>Criticality</th><td>${esc(h.criticality || 'not recorded')}</td></tr>
      <tr><th>Business service(s)</th><td>${esc(h.businessService || '')}</td><th>Interview depth</th><td>${esc(m.depth || '')}</td></tr></table>
    <div class="es-overall es-${m.tone}"><span class="es-label">Overall assessment${m.overall === m.auto ? ' (indicative)' : ''}</span><strong>${esc(m.overall)}</strong><p>${esc(m.headline)}</p>${m.ukAffected.length ? `<p class="es-uk"><b>Regulatory areas affected:</b> ${m.ukAffected.map(([a, n]) => `${esc(a)} - ${esc(areaRegulator(a))} (${n})`).join(' · ')}</p>` : ''}</div>
    <div class="es-figs">${m.figures.map(([l, v]) => `<div><span>${esc(l)}</span><strong>${v}</strong></div>`).join('')}</div>
    <h2>Top risks</h2>
    ${m.open.length ? `<table class="table print-table es-table"><thead><tr><th>Ref</th><th>Finding</th><th>Rating</th><th>Owner</th><th>Target</th></tr></thead><tbody>
      ${m.open.slice(0, 5).map((x) => `<tr><td>${esc(x.f.ref)}</td><td>${esc(x.f.title)}</td><td class="nowrap"><span class="es-dot" style="background:${RATING_FILL[x.effR || 'Not rated']}"></span>${esc(x.effR || 'Not rated')}</td><td>${esc(x.f.controlOwner || '')}</td><td class="nowrap">${x.f.targetDate ? fmtDate(x.f.targetDate) : ''}</td></tr>`).join('')}</tbody></table>
      ${m.open.length > 5 ? `<p class="hint">…and ${m.open.length - 5} more open finding(s).</p>` : ''}` : '<p>No open findings.</p>'}
    <h2>Control areas</h2>
    <div class="es-strip">${m.ratings.map((x) => `<span class="es-cell es-${cls(x.r)}" title="${esc(x.s.title)}: ${esc(x.r)}"><b>${x.s.no}</b>${esc(x.s.title)}</span>`).join('')}</div>
    <p class="es-legend"><span class="es-cell es-good">Effective</span><span class="es-cell es-warn">Partially effective</span><span class="es-cell es-bad">Ineffective</span><span class="es-cell es-none">Not assessed</span></p>
    <div class="es-two"><div><h2>Strengths</h2>${m.strengths.length ? `<ul>${m.strengths.slice(0, 6).map((s) => `<li>${esc(s)}</li>`).join('')}</ul>` : '<p class="hint">None rated effective yet.</p>'}</div>
      <div><h2>Immediate actions</h2>${m.actions.length ? `<ol>${m.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ol>` : '<p class="hint">None identified.</p>'}</div></div>
    <p class="hint es-foot">${esc(T.APPLIES)} Findings are classified to distinguish regulatory requirements from expectations, good practice and internal policy. Overall assessment ${m.overall === m.auto ? 'is derived from ratings and findings - assessor to confirm' : 'set by the assessor'}.</p>
  </section>`;
}

// ---------- themes across interviews ----------
const RATING_ORDER = ['Critical', 'High', 'Medium', 'Low', ''];
function themesModel(ivsAll, fsAll, flt) {
  const st = computeStats(ivsAll, fsAll, flt);
  const ivs = st.ivs, fs = st.fs;
  const ivById = Object.fromEntries(ivsAll.map((i) => [i.id, i]));
  const team = (iv) => iv?.data.header?.team || '(no team)';
  const groups = {};
  fs.forEach((f) => {
    const tpl = f.templateId && templateById(f.templateId);
    const key = tpl ? tpl.id : `cat:${f.category || 'Uncategorised'}`;
    const g = groups[key] = groups[key] || { key, label: tpl ? tpl.title : `${f.category || 'Uncategorised'} (no template)`, templated: !!tpl, findings: [], ivs: new Set(), teams: new Set() };
    g.findings.push(f);
    if (f.interviewId && ivById[f.interviewId]) { g.ivs.add(f.interviewId); g.teams.add(team(ivById[f.interviewId])); }
  });
  const recurring = Object.values(groups).map((g) => {
    const worst = RATING_ORDER.find((r) => g.findings.some((f) => findingScores(f).effR === r)) || '';
    return { ...g, n: g.ivs.size, open: g.findings.filter((f) => f.status !== 'Closed').length, worst };
  }).sort((a, b) => b.n - a.n || b.findings.length - a.findings.length);
  const QS = flt.qn && T.qnById(flt.qn) ? [T.qnById(flt.qn)] : qnsIn(ivs);
  const redFlags = QS.flatMap((q) => q.redFlags).map((rf) => { const hit = ivs.filter((i) => i.data.redFlags?.[rf.id]?.on); return { rf, n: hit.length, teams: new Set(hit.map(team)) }; })
    .filter((x) => x.n).sort((a, b) => b.n - a.n);
  const weak = QS.flatMap((q) => q.sections).map((s) => {
    const rated = ivs.map((i) => i.data.sections?.[s.id]?.rating).filter((r) => r && !['Not assessed', 'Not applicable'].includes(r));
    const w = rated.filter((r) => r === 'Ineffective' || r === 'Partially effective').length;
    return { s, rated: rated.length, weak: w, ineffective: rated.filter((r) => r === 'Ineffective').length, pct: rated.length ? w / rated.length : 0 };
  }).filter((x) => x.weak).sort((a, b) => b.weak - a.weak || b.pct - a.pct);
  const byTeam = {};
  ivs.forEach((i) => { (byTeam[team(i)] = byTeam[team(i)] || []).push(i); });
  const teams = Object.entries(byTeam).map(([name, list]) => {
    const cms = qnsIn(list).map((q) => list.filter((i) => qnIdOf(i) === q.id)).filter((l) => l.length >= 2).map((l) => compareModel(l, { personal: false, diffOnly: true }).totals);
    const cm = cms.length ? { contradiction: cms.reduce((a, c) => a + c.contradiction, 0), gap: cms.reduce((a, c) => a + c.gap, 0) } : null;
    const ev = list.flatMap((i) => evidenceRows(i, []));
    return { name, interviews: list.length, contradictions: cm ? cm.contradiction : null, gaps: cm ? cm.gap : null,
      outstanding: ev.filter((r) => r.status === 'Requested').length, overdue: ev.filter(evOverdue).length,
      open: fs.filter((f) => f.status !== 'Closed' && list.some((i) => i.id === f.interviewId)).length };
  }).sort((a, b) => b.interviews - a.interviews);
  const top = [
    ...recurring.filter((g) => g.n >= 2).map((g) => ({ kind: 'Recurring finding', label: g.label, n: g.n, detail: `${g.findings.length} finding(s), ${g.open} open, worst rating ${g.worst || 'not rated'}; teams: ${[...g.teams].join(', ')}` })),
    ...redFlags.filter((x) => x.n >= 2).map((x) => ({ kind: 'Red flag', label: `“${x.rf.quote}”`, n: x.n, detail: x.rf.risk })),
    ...weak.filter((x) => x.weak >= 2).map((x) => ({ kind: 'Weak control area', label: secLabel(x.s), n: x.weak, detail: `rated weak in ${x.weak} of ${x.rated} interviews that assessed it (${x.ineffective} ineffective)` })),
    ...st.topQs.filter((x) => x.concern + x.unknown >= 2).map((x) => ({ kind: 'Concerning answers', label: x.q.q, n: x.concern + x.unknown, detail: `${x.concern} concern, ${x.unknown} "Don't know" out of ${x.n} (${x.s.title})` })),
  ].sort((a, b) => b.n - a.n).slice(0, 10);
  // Regulatory areas affected: open findings per area, the interviews and teams involved, and the worst rating. PRA areas first.
  const areas = T.ukAreas.map((a) => {
    const hits = fs.filter((f) => f.status !== 'Closed' && findingUkAreas(f).includes(a.area));
    const ivIds = new Set(hits.map((f) => f.interviewId).filter(Boolean));
    return { area: a.area, regulator: a.regulator, source: a.source, open: hits.length, interviews: ivIds.size,
      teams: new Set([...ivIds].map((id) => team(ivById[id]))), worst: RATING_ORDER.find((r) => hits.some((f) => findingScores(f).effR === r)) || '' };
  }).filter((a) => a.open);
  return { st, ivs, fs, recurring, redFlags, weak, teams, top, areas };
}
function themesHtml(m) {
  const n = m.ivs.length;
  return `<p class="intro">${n} interview(s) across ${m.teams.length} team(s), ${m.fs.length} finding(s). A theme appears here when it affects <strong>two or more interviews</strong>; everything is also listed in full below.</p>
    ${chartCard('Top themes', m.top.length ? `<ol class="themes">${m.top.map((t) => `<li><span class="theme-kind">${esc(t.kind)}</span> <strong>${esc(t.label)}</strong> <span class="theme-n">${t.n} interview${t.n === 1 ? '' : 's'}</span><br><span class="hint">${esc(t.detail)}</span></li>`).join('')}</ol>`
      : '<p class="empty">No theme yet affects two or more interviews. Record quick answers, red flags, ratings and findings (ideally from templates) to surface themes.</p>', '', 'wide')}
    ${chartCard('Regulatory areas affected (open findings)', m.areas.length ? `<table class="table"><thead><tr><th>Area</th><th>Regulator</th><th>Source</th><th class="num">Open findings</th><th class="num">Interviews</th><th>Worst</th></tr></thead><tbody>
      ${m.areas.map((a) => `<tr><td><strong>${esc(a.area)}</strong></td><td>${esc(a.regulator)}</td><td>${esc(a.source)}</td><td class="num">${a.open}</td><td class="num">${a.interviews}</td><td>${ratingChip(a.worst)}</td></tr>`).join('')}</tbody></table>
      <p class="hint">PRA areas are listed first: the PRA is the bank's prudential regulator. FCA and ICO areas follow.</p>` : '<p class="empty">No open findings linked to regulatory areas.</p>', '', 'wide')}
    ${chartCard('Recurring findings (grouped by template)', m.recurring.length ? `<table class="table"><thead><tr><th>Finding</th><th class="num">Interviews</th><th class="num">Findings</th><th class="num">Open</th><th>Worst</th><th>Teams</th></tr></thead><tbody>
      ${m.recurring.map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num">${g.findings.length}</td><td class="num">${g.open}</td><td>${ratingChip(g.worst)}</td><td>${esc([...g.teams].join(', '))}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Findings raised from a template (or a red flag) group together exactly; others are grouped by category.</p>` : '<p class="empty">No findings.</p>', '', 'wide')}
    <div class="grid-2">
      ${chartCard('Red flags heard in more than one place', hbar(m.redFlags.map((x) => ({ label: `“${x.rf.quote}”`, value: x.n, tip: [...x.teams].join(', ') }))), dataTable(['Red flag', 'Interviews', 'Teams'], m.redFlags.map((x) => [x.rf.quote, x.n, [...x.teams].join(', ')])))}
      ${chartCard('Control areas most often rated weak', hbar(m.weak.map((x) => ({ label: secLabel(x.s), value: x.weak, color: 'var(--st-serious)', tip: `${x.weak} of ${x.rated} assessed interviews` }))), dataTable(['Section', 'Rated weak', 'Assessed', 'Ineffective'], m.weak.map((x) => [`${x.s.no}. ${x.s.title}`, x.weak, x.rated, x.ineffective])))}
    </div>
    ${chartCard('By team', `<table class="table"><thead><tr><th>Team</th><th class="num">Interviews</th><th class="num">Open findings</th><th class="num">Contradictions</th><th class="num">Knowledge gaps</th><th class="num">Evidence outstanding</th><th class="num">Overdue</th></tr></thead><tbody>
      ${m.teams.map((t) => `<tr><td>${esc(t.name)}${t.interviews >= 2 ? ` <a href="#/compare?ids=${m.ivs.filter((i) => (i.data.header?.team || '(no team)') === t.name).slice(0, 6).map((i) => i.id).join(',')}" class="hint">compare</a>` : ''}</td><td class="num">${t.interviews}</td><td class="num">${t.open}</td><td class="num">${t.contradictions ?? '-'}</td><td class="num">${t.gaps ?? '-'}</td><td class="num">${t.outstanding}</td><td class="num">${t.overdue}</td></tr>`).join('')}</tbody></table>
      <p class="hint">Contradictions and knowledge gaps need at least two interviews in a team, and exclude questions about the individual.</p>`, '', 'wide')}
    ${chartCard('Questions most often answered with a concern or “Don\'t know”', m.st.topQs.length ? `<table class="table"><thead><tr><th>Question</th><th>Section</th><th class="num">Interviews</th><th class="num">Concern</th><th class="num">Don't know</th></tr></thead><tbody>
      ${m.st.topQs.map((x) => `<tr><td>${esc(x.q.q)}</td><td>${esc(secLabel(x.s))}</td><td class="num">${x.n}</td><td class="num">${x.concern}</td><td class="num">${x.unknown}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">No quick answers recorded.</p>', '', 'wide')}`;
}

// ---------- trends over time ----------
const monthLabel = (k) => new Date(k + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
function trendsModel(ivsAll, fsAll, flt) {
  const st = computeStats(ivsAll, fsAll, flt);
  const ivs = st.ivs, fs = st.fs;
  const closedOn = (f) => f.closedAt || (f.status === 'Closed' ? f.updatedAt : null);
  const dates = [...ivs.map((i) => i.data.header?.date), ...fs.map((f) => f.createdAt), ...fs.map(closedOn)].filter(Boolean).map((x) => x.slice(0, 7)).sort();
  const cur = today().slice(0, 7);
  const months = [];
  if (dates.length) {
    let [y, m] = dates[0].split('-').map(Number);
    const [ey, em] = cur.split('-').map(Number);
    while (y < ey || (y === ey && m <= em)) { months.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  }
  const ms = months.slice(-24);
  const qIndex = {}; T.sections.forEach((s) => [s.opener, ...s.questions].forEach((q) => { qIndex[`${s.id}|${q.id}`] = q; }));
  const rows = ms.map((k) => {
    const end = k + '-31~';
    const inMonth = ivs.filter((i) => (i.data.header?.date || '').slice(0, 7) === k);
    const raised = fs.filter((f) => (f.createdAt || '').slice(0, 7) === k);
    const byR = Object.fromEntries(['Critical', 'High', 'Medium', 'Low', 'Not rated'].map((r) => [r, raised.filter((f) => (findingScores(f).effR || 'Not rated') === r).length]));
    const ratings = inMonth.flatMap((i) => Object.values(i.data.sections || {}).map((s) => s?.rating)).filter((r) => r && !['Not assessed', 'Not applicable'].includes(r));
    let qa = 0, unk = 0;
    inMonth.forEach((i) => Object.entries(i.data.sections || {}).forEach(([sid, sec]) => Object.entries(sec?.answers || {}).forEach(([qid, a]) => {
      const q = qIndex[`${sid}|${qid}`]; if (!q || !a?.qa) return;
      const sig = T.answerSignal(q, a.qa); if (['good', 'partial', 'concern', 'unknown'].includes(sig)) { qa++; if (sig === 'unknown') unk++; }
    })));
    return {
      k, interviews: inMonth.length, raised: byR, raisedTotal: raised.length,
      closed: fs.filter((f) => (closedOn(f) || '').slice(0, 7) === k).length,
      backlog: fs.filter((f) => (f.createdAt || '') <= end && !((closedOn(f) || '~') <= end)).length,
      effectivePct: ratings.length ? Math.round((ratings.filter((r) => r === 'Effective').length / ratings.length) * 100) : null,
      dontKnowPct: qa ? Math.round((unk / qa) * 100) : null,
    };
  });
  return { rows };
}
// Vertical stacked columns. keys ordered; colors map. rows: [{k, parts}]
function columnsSvg(rows, keys, colors, title) {
  if (!rows.length) return '<p class="empty">No data for the current filters.</p>';
  const W = 720, H = 220, L = 34, B = 26, T0 = 10, R = 8;
  const max = Math.max(1, ...rows.map((r) => keys.reduce((a, k) => a + (r.parts[k] || 0), 0)));
  const step = (W - L - R) / rows.length, bw = Math.max(4, Math.min(38, step * 0.62));
  const y = (v) => H - B - (v / max) * (H - B - T0);
  const ticks = [0, Math.ceil(max / 2), max];
  return `<div class="legend">${keys.map((k) => `<span><i style="background:${colors[k]}"></i>${esc(k)}</span>`).join('')}</div>
  <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}</text>`).join('')}
    ${rows.map((r, i) => { let acc = 0; const x = L + i * step + (step - bw) / 2;
      const segs = keys.filter((k) => r.parts[k]).map((k) => { const v = r.parts[k], y1 = y(acc + v), h = y(acc) - y(acc + v); acc += v;
        return `<rect x="${x}" y="${y1}" width="${bw}" height="${Math.max(0, h - 1)}" rx="2" style="fill:${colors[k]}" tabindex="0" data-tip="${esc(`${v}|${k}|${monthLabel(r.k)}`)}"/>`; }).join('');
      return segs + ((rows.length <= 12 || i % Math.ceil(rows.length / 12) === 0) ? `<text x="${x + bw / 2}" y="${H - 8}" class="tick" text-anchor="middle">${monthLabel(r.k)}</text>` : ''); }).join('')}
  </svg>`;
}
// Line chart. series: [{label, color, values: [number|null]}]
function lineSvg(months, series, { pct = false, title = '' } = {}) {
  if (!months.length) return '<p class="empty">No data for the current filters.</p>';
  const W = 720, H = 220, L = 38, B = 26, T0 = 12, R = 12;
  const vals = series.flatMap((s) => s.values).filter((v) => v != null);
  const max = pct ? 100 : Math.max(1, ...vals);
  const x = (i) => L + (months.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (months.length - 1));
  const y = (v) => H - B - (v / max) * (H - B - T0);
  const ticks = pct ? [0, 50, 100] : [0, Math.ceil(max / 2), max];
  return `${series.length > 1 ? `<div class="legend">${series.map((s) => `<span><i class="line-key" style="background:${s.color}"></i>${esc(s.label)}</span>`).join('')}</div>` : ''}
  <svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
    ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid"/><text x="${L - 6}" y="${y(t) + 4}" class="tick" text-anchor="end">${t}${pct ? '%' : ''}</text>`).join('')}
    ${months.map((k, i) => (months.length <= 12 || i % Math.ceil(months.length / 12) === 0) ? `<text x="${x(i)}" y="${H - 8}" class="tick" text-anchor="middle">${monthLabel(k)}</text>` : '').join('')}
    ${series.map((s) => {
      const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v), v, months[i]])).filter(Boolean);
      const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
      return `${pts.length > 1 ? `<path d="${path}" fill="none" style="stroke:${s.color}" stroke-width="2" stroke-linejoin="round"/>` : ''}
        ${pts.map((p) => `<circle cx="${p[0]}" cy="${p[1]}" r="4" style="fill:${s.color}" class="pt" tabindex="0" data-tip="${esc(`${p[2]}${pct ? '%' : ''}|${s.label}|${monthLabel(p[3])}`)}"/>`).join('')}`;
    }).join('')}
  </svg>`;
}
function trendsHtml(m) {
  const rows = m.rows, months = rows.map((r) => r.k);
  if (!rows.length) return '<div class="card"><p class="empty">No dated interviews or findings yet.</p></div>';
  const rk = ['Critical', 'High', 'Medium', 'Low', 'Not rated'];
  return `<p class="intro">Month by month for the current filters (last 24 months at most). Findings are counted in the month they were raised; the backlog is the number still open at the end of each month.</p>
    ${chartCard('Findings raised per month, by rating', columnsSvg(rows.map((r) => ({ k: r.k, parts: r.raised })), rk, RATING_FILL, 'Findings raised per month'), dataTable(['Month', ...rk, 'Total', 'Closed'], rows.map((r) => [monthLabel(r.k), ...rk.map((k) => r.raised[k]), r.raisedTotal, r.closed])), 'wide')}
    <div class="grid-2">
      ${chartCard('Open findings backlog (end of month)', lineSvg(months, [{ label: 'Open findings', color: 'var(--seq-4)', values: rows.map((r) => r.backlog) }], { title: 'Open findings backlog' }), dataTable(['Month', 'Open at month end', 'Raised', 'Closed'], rows.map((r) => [monthLabel(r.k), r.backlog, r.raisedTotal, r.closed])))}
      ${chartCard('Interviews per month', columnsSvg(rows.map((r) => ({ k: r.k, parts: { Interviews: r.interviews } })), ['Interviews'], { Interviews: 'var(--seq-4)' }, 'Interviews per month'), dataTable(['Month', 'Interviews'], rows.map((r) => [monthLabel(r.k), r.interviews])))}
    </div>
    ${chartCard('Control quality over time', lineSvg(months, [{ label: 'Control areas rated Effective', color: 'var(--st-good)', values: rows.map((r) => r.effectivePct) }, { label: '"Don\'t know" answers', color: 'var(--neutral-2)', values: rows.map((r) => r.dontKnowPct) }], { pct: true, title: 'Control quality over time' }) +
      '<p class="hint">Share of assessed control areas rated Effective, and share of quick answers that were "Don\'t know", for interviews held in each month. Months without interviews are left blank.</p>',
      dataTable(['Month', '% rated Effective', '% "Don\'t know"'], rows.map((r) => [monthLabel(r.k), r.effectivePct ?? '-', r.dontKnowPct ?? '-'])), 'wide')}`;
}
