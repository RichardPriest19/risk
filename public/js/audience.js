// Reports for three audiences, built from the same data:
//  - Board of Directors and Head of Compliance: plain English only - facts and figures, what is working, concerns,
//    what is being done. No acronyms or technical terms: wording comes from TR.plain, never from technical fields.
//  - CTO: the technical report - finding references, control areas, red flags, consistency between teams, regulatory sources.
// Each report has a little editable wording (title, period, overall message, decisions), saved for everyone.
'use strict';

const P = TR.plain;
const SERIOUS = ['Critical', 'High'];
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const plainCat = (c) => P.categories[c] || P.categories.Other;
const plainArea = (a) => (P.areas[a] || [a])[0];
const plainReg = (r) => P.regulators[r] || r;
// A finding as non-technical readers see it: the plain template wording, or its plain category if written freehand.
const plainFinding = (f) => (f.templateId && P.templates[f.templateId] ? { title: P.templates[f.templateId][0], why: P.templates[f.templateId][1] } : { title: `Other issue: ${plainCat(f.category).toLowerCase()}`, why: '' });
const plainDeptOf = (iv) => P.depts[qnIdOf(iv)] || 'Other';
const plainService = (t) => String(t || '').replace(/impact tolerance/g, 'agreed limit of disruption').replace(/scenario test/g, 'recovery test');
// Senior manager function codes (e.g. SMF24) mean nothing to non-technical readers; keep the role name only.
const plainRole = (t) => String(t || '').replace(/\bSMF\s?\d+\s*[-:,]?\s*/gi, '').trim();
// Capitalised terms (acronyms) in text - used to warn when entered data would put jargon into a plain-English report.
const acronymsIn = (text) => [...new Set(String(text).split(/[^A-Za-z0-9]+/).filter((w) => (w.match(/[A-Z]/g) || []).length >= 2 && !/[a-z]/.test(w)))].filter((w) => !['CONFIDENTIAL', 'DEMO'].includes(w));
const monthYear = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '');
const OVERALL_LABELS = ['Significant improvement needed', 'Improvement needed', 'Generally sound, with improvements to make', 'Sound'];

const AUD_KINDS = {
  board: { label: 'Board of Directors', tab: 'Board', defaults: { title: 'Technology risk report to the Board' } },
  compliance: { label: 'Head of Compliance', tab: 'Head of Compliance', defaults: { title: 'Technology risk: compliance report' } },
  technology: { label: 'Chief Technology Officer', tab: 'CTO - technical report', defaults: { title: 'Technology risk: technical report' } },
};
const audDefaults = (kind) => ({ org: 'Atom bank', period: '', preparedBy: state.user.fullName, date: today(), overall: '', message: '', decisions: '', includeDemo: false, ...AUD_KINDS[kind].defaults });

// ---------- model shared by all three reports ----------
function audienceModel(ivsAll, fsAll, flt, doc) {
  const ivsIn = doc.includeDemo ? ivsAll : ivsAll.filter((i) => !i.data.demo);
  const fsIn = doc.includeDemo ? fsAll : fsAll.filter((f) => !f.demo);
  const th = themesModel(ivsIn, fsIn, flt);
  const ivs = th.ivs, fs = th.fs;
  const scored = fs.map((f) => ({ f, ...findingScores(f) }));
  const open = scored.filter((x) => x.f.status !== 'Closed');
  const rank = (x) => ({ Critical: 4, High: 3, Medium: 2, Low: 1 }[x.effR] || 0);
  open.sort((a, b) => rank(b) - rank(a) || (a.f.targetDate || '9').localeCompare(b.f.targetDate || '9'));
  const serious = open.filter((x) => SERIOUS.includes(x.effR));
  const overdue = open.filter((x) => isOverdue(x.f));
  const active = open.filter((x) => x.f.status !== 'Risk accepted');
  const unplanned = active.filter((x) => !x.f.controlOwner || !x.f.targetDate);
  const closedOn = (f) => f.closedAt || (f.status === 'Closed' ? f.updatedAt : '');
  const t90 = new Date(Date.now() - 90 * 864e5).toISOString();
  const resolved90 = scored.filter((x) => x.f.status === 'Closed' && (closedOn(x.f) || '') >= t90);
  const raised90 = scored.filter((x) => (x.f.createdAt || '') >= t90);
  const openThen = scored.filter((x) => (x.f.createdAt || '') < t90 && !(x.f.status === 'Closed' && (closedOn(x.f) || '') < t90));
  // Evidence: did what we asked for exist, and was it checked?
  const ev = ivs.flatMap((i) => evidenceRows(i, []).map((r) => ({ ...r, dept: plainDeptOf(i) })));
  const evAsked = ev.filter((r) => r.status && r.status !== 'Not requested');
  const evN = { asked: evAsked.length, checked: evAsked.filter((r) => r.status === 'Seen - verified').length, seen: evAsked.filter((r) => r.status === 'Seen - not verified').length,
    missing: evAsked.filter((r) => r.status === 'Not available').length, waiting: evAsked.filter((r) => r.status === 'Requested').length, late: evAsked.filter(evOverdue).length };
  const evByDept = Object.entries(evAsked.reduce((a, r) => { const d = a[r.dept] = a[r.dept] || { asked: 0, checked: 0, waiting: 0, missing: 0 }; d.asked++; if (r.status === 'Seen - verified') d.checked++; if (r.status === 'Requested') d.waiting++; if (r.status === 'Not available') d.missing++; return a; }, {}));
  // Control ratings grouped into plain areas.
  const cat = {};
  ivs.forEach((i) => qnOf(i).sections.forEach((s) => {
    const r = i.data.sections?.[s.id]?.rating; if (!r || r === 'Not assessed' || r === 'Not applicable') return;
    const c = cat[plainCat(T.sectionCategory[s.id])] = cat[plainCat(T.sectionCategory[s.id])] || { good: 0, weak: 0, n: 0, raw: T.sectionCategory[s.id] };
    c.n++; if (r === 'Effective') c.good++; else c.weak++;
  }));
  // Concerns: open issues grouped by what they are, most serious and most widespread first.
  const groups = {};
  open.forEach((x) => {
    const key = x.f.templateId && P.templates[x.f.templateId] ? x.f.templateId : 'cat:' + (x.f.category || 'Other');
    const g = groups[key] = groups[key] || { key, ...plainFinding(x.f), raw: x.f.category, items: [], teams: new Set(), depts: new Set(), worst: 0, tech: x.f.title };
    g.items.push(x); g.worst = Math.max(g.worst, rank(x));
    const iv = ivs.find((i) => i.id === x.f.interviewId);
    if (iv) { g.teams.add(iv.data.header?.team || 'Unnamed team'); g.depts.add(plainDeptOf(iv)); }
  });
  const concerns = Object.values(groups).sort((a, b) => b.worst - a.worst || b.teams.size - a.teams.size || b.items.length - a.items.length);
  const coveredCats = new Set(concerns.map((g) => plainCat(g.raw)));
  Object.entries(cat).filter(([name, c]) => c.weak >= 2 && !coveredCats.has(name)).forEach(([name, c]) =>
    concerns.push({ key: 'weak:' + name, title: `${name}: controls rated weak`, why: `Rated weak in ${c.weak} of ${c.n} interviews that looked at this area, although no specific issue has yet been recorded.`, items: [], teams: new Set(), depts: new Set(), worst: 2 }));
  const sevWord = (w) => ({ 4: 'Critical', 3: 'High', 2: 'Medium', 1: 'Low' }[w] || 'Not yet rated');
  // Good points.
  const depts = [...new Set(ivs.map(plainDeptOf))];
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))];
  const teamsClear = teams.filter((t) => !serious.some((x) => ivs.find((i) => i.id === x.f.interviewId)?.data.header?.team === t));
  const good = [
    ...Object.entries(cat).filter(([, c]) => c.n >= 2 && c.good / c.n >= 0.6).sort((a, b) => b[1].good - a[1].good).slice(0, 4)
      .map(([name, c]) => `${name}: controls rated effective in ${c.good} of ${c.n} interviews that looked at this area.`),
    resolved90.length ? `${plural(resolved90.length, 'issue')} resolved in the last three months, each with the fix checked before closing.` : '',
    evN.checked ? `${plural(evN.checked, 'piece')} of evidence ${evN.checked === 1 ? 'has' : 'have'} been seen and checked, proving those controls work in practice.` : '',
    teams.length && teamsClear.length ? `${teamsClear.length} of ${plural(teams.length, 'team')} interviewed ${teamsClear.length === 1 ? 'has' : 'have'} no serious open issues.` : '',
  ].filter(Boolean);
  // Overall position.
  const crit = serious.filter((x) => x.effR === 'Critical').length;
  const auto = !ivs.length && !fs.length ? 'Not yet assessed' : crit || serious.length >= 3 ? OVERALL_LABELS[0] : serious.length || overdue.length ? OVERALL_LABELS[1] : open.length ? OVERALL_LABELS[2] : OVERALL_LABELS[3];
  const overall = doc.overall || auto;
  const tone = overall === OVERALL_LABELS[0] ? 'bad' : overall === OVERALL_LABELS[3] ? 'good' : overall === 'Not yet assessed' ? 'none' : 'warn';
  const overallText = ivs.length || fs.length
    ? `${plural(ivs.length, 'interview')} across ${plural(depts.length, 'department')} and ${plural(teams.length, 'team')}. ${plural(open.length, 'issue')} ${open.length === 1 ? 'is' : 'are'} open, of which ${serious.length} ${serious.length === 1 ? 'is' : 'are'} serious (rated high or critical) and ${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} past ${overdue.length === 1 ? 'its' : 'their'} target date.`
    : 'No interviews are included yet.';
  // Important business services, in plain terms.
  const svcs = (state.services || []).filter((x) => (doc.includeDemo || !x.demo) && (!flt.svc || x.id === Number(flt.svc)) && (isIbs(x) || x.designation === 'Candidate - under review'))
    .map((x) => serviceModel(x, ivs, fs));
  const recovery = (s) => (!s.scenarioResult || s.scenarioResult === 'Not tested' ? 'Not yet tested' : s.scenarioResult === 'Breached tolerance' ? 'No - the last test failed'
    : s.scenarioResult === 'Partly tested' ? 'Partly tested' : monthsSince(s.scenarioTestDate) > 12 ? 'Yes, but the test is over a year old' : 'Yes');
  const trend = [
    ['Open issues', open.length, openThen.length],
    ['Serious open issues', serious.length, openThen.filter((x) => SERIOUS.includes(x.effR)).length],
  ].map(([l, now, then]) => ({ l, now, then, dir: now < then ? 'Better' : now > then ? 'Worse' : 'No change' }));
  // Risks formally accepted, and their expiry.
  const accepted = open.filter((x) => x.f.status === 'Risk accepted').map((x) => {
    const exp = x.f.riskAcceptanceExpiry; const days = exp ? Math.round((new Date(exp) - new Date(today())) / 864e5) : null;
    return { ...x, exp, state: !exp ? 'No expiry date' : days < 0 ? 'Expired' : days <= 30 ? `Expires in ${plural(days, 'day')}` : 'Current' };
  });
  const breach = open.filter((x) => ['Regulatory requirement', 'Material risk'].includes(x.f.classification));
  const obligations = T.ukAreas.map((a) => {
    const hits = open.filter((x) => findingUkAreas(x.f).includes(a.area));
    return { a, plainName: plainArea(a.area), means: (P.areas[a.area] || [])[1] || '', reg: plainReg(a.regulator), open: hits.length, serious: hits.filter((x) => SERIOUS.includes(x.effR)).length, overdue: hits.filter((x) => isOverdue(x.f)).length };
  }).filter((o) => o.open).sort((a, b) => b.serious - a.serious || b.open - a.open);
  const range = (() => { const d = ivs.map((i) => i.data.header?.date).filter(Boolean).sort(); return d.length ? (d[0] === d[d.length - 1] ? fmtDate(d[0]) : `${fmtDate(d[0])} to ${fmtDate(d[d.length - 1])}`) : ''; })();
  return { doc, th, ivs, fs, open, serious, overdue, unplanned, resolved90, raised90, evN, evByDept, cat, concerns, sevWord, good, depts, teams, overall, tone, overallText, svcs, recovery, trend, accepted, breach, obligations, range,
    demo: doc.includeDemo && (ivsAll.some((i) => i.data.demo) || fsAll.some((f) => f.demo)) };
}
const audPeriod = (m) => m.doc.period || (lastReportFilters.from || lastReportFilters.to ? `${lastReportFilters.from ? fmtDate(lastReportFilters.from) : 'start'} to ${lastReportFilters.to ? fmtDate(lastReportFilters.to) : 'date'}` : `Position at ${fmtDate(m.doc.date || today())}`);
const progressWord = (x) => (x.f.status === 'Risk accepted' ? 'Risk accepted' : isOverdue(x.f) ? 'Overdue' : !x.f.targetDate ? 'No target date yet' : x.f.status === 'In remediation' ? 'Being fixed' : 'Not started');
const svcHealthWord = (x) => ({ bad: 'Needs attention', warn: 'Gaps to address', good: 'No issues found' }[x.tone]);

// ---------- HTML ----------
function audHead(m, kind) {
  const d = m.doc;
  return `<header class="brief-head"><p class="brief-kicker">${esc(d.org || 'The bank')} · CONFIDENTIAL · for the ${esc(AUD_KINDS[kind].label)}</p>
    <h1>${esc(d.title)}</h1><p class="brief-sub">${esc(audPeriod(m))}</p>
    <p class="hint">Prepared by ${esc(d.preparedBy || '')} · ${d.date ? fmtDate(d.date) : ''}</p></header>
    ${m.demo ? '<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> This report includes demonstration data. Untick “Include demo data” before sharing it.</p></div>' : ''}`;
}
const audFig = (label, value, sub, tone) => `<div class="aud-fig${tone ? ' aud-' + tone : ''}"><strong>${esc(String(value))}</strong><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
const audOverall = (m) => `<div class="aud-overall aud-${m.tone}"><span class="aud-ov-label">Overall position</span><strong>${esc(m.overall)}</strong><p>${esc(m.overallText)}</p>${m.doc.message ? `<p>${nl2br(m.doc.message)}</p>` : ''}</div>`;
const audGood = (m) => (m.good.length ? `<ul class="aud-goodlist">${m.good.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '<p class="hint">It is too early to identify strengths: more interviews and evidence are needed.</p>');
function audServicesTable(m, withOwner) {
  if (!m.svcs.length) return '<p class="hint">No important business services are recorded in the register yet.</p>';
  return `<table class="table print-table aud-table"><thead><tr><th>Service</th><th>Agreed limit of disruption</th><th>Recovery within the limit proven?</th>${withOwner ? '<th>Accountable senior manager</th>' : ''}<th class="num">Serious issues</th><th>Overall</th></tr></thead><tbody>
    ${m.svcs.map((x) => `<tr><td><strong>${esc(x.svc.name)}</strong>${x.ibs ? '' : '<br><small>Under review - may become an important service</small>'}</td><td>${esc(x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not yet set'))}</td>
      <td>${esc(m.recovery(x.svc))}</td>${withOwner ? `<td>${esc(plainRole(x.svc.accountableSmf) || 'Not recorded')}</td>` : ''}<td class="num">${x.hc.length}</td><td>${svcTone(x.tone, svcHealthWord(x))}${x.flags.length ? `<br><small>${esc(plainService(briefSvcGaps(x)[0]))}</small>` : ''}</td></tr>`).join('')}</tbody></table>`;
}
function audConcerns(m, max = 6) {
  if (!m.concerns.length) return '<p>No open issues.</p>';
  return `<ol class="aud-concerns">${m.concerns.slice(0, max).map((g) => `<li><strong>${esc(g.title)}</strong> <span class="aud-sev aud-sev-${g.worst}">${esc(m.sevWord(g.worst))}</span>
    ${g.why ? `<br>${esc(g.why)}` : ''}${g.items.length ? `<br><small>${plural(g.items.length, 'open issue')}${g.depts.size ? ` · ${[...g.depts].join(', ')}` : ''}${g.teams.size > 1 ? ` · found in ${g.teams.size} teams` : ''}</small>` : ''}</li>`).join('')}</ol>
    ${m.concerns.length > max ? `<p class="hint">${plural(m.concerns.length - max, 'further concern')} ${m.concerns.length - max === 1 ? 'is' : 'are'} listed in the technical report.</p>` : ''}`;
}
function audTrend(m) {
  return `<table class="table print-table aud-table"><thead><tr><th>Measure</th><th class="num">Now</th><th class="num">Three months ago</th><th>Direction</th></tr></thead><tbody>
    ${m.trend.map((t) => `<tr><td>${esc(t.l)}</td><td class="num">${t.now}</td><td class="num">${t.then}</td><td>${svcTone(t.dir === 'Better' ? 'good' : t.dir === 'Worse' ? 'bad' : 'warn', t.dir)}</td></tr>`).join('')}
    <tr><td>Issues raised in the last three months</td><td class="num">${m.raised90.length}</td><td></td><td></td></tr>
    <tr><td>Issues resolved in the last three months</td><td class="num">${m.resolved90.length}</td><td></td><td></td></tr></tbody></table>`;
}
function audAbout(m) {
  return `<p class="hint aud-about">About this report: it is based on ${plural(m.ivs.length, 'structured interview')}${m.range ? ` held ${esc(m.range)}` : ''}, the issues recorded from them and the evidence collected. Issues are rated critical, high, medium or low; “serious” means high or critical. An issue is only marked resolved when the fix has been checked. Regulatory statements summarise our understanding at the date of this report and are not legal advice.</p>`;
}

function boardHtml(m) {
  const e = m.evN;
  return `<section class="brief aud">${audHead(m, 'board')}
    <h2>1. Summary</h2>${audOverall(m)}
    <div class="aud-figs">
      ${audFig('people interviewed', m.ivs.length, `${plural(m.depts.length, 'department')}, ${plural(m.teams.length, 'team')}`)}
      ${audFig('issues open', m.open.length)}
      ${audFig('serious issues open', m.serious.length, 'rated high or critical', m.serious.length ? 'bad' : 'good')}
      ${audFig('actions overdue', m.overdue.length, 'past their target date', m.overdue.length ? 'bad' : 'good')}
      ${audFig('issues resolved', m.resolved90.length, 'in the last three months', m.resolved90.length ? 'good' : '')}
      ${audFig('evidence checked', e.asked ? `${e.checked} of ${e.asked}` : '-', 'items proven to work')}
    </div>
    <h2>2. What is working well</h2>${audGood(m)}
    <h2>3. Main concerns</h2>${audConcerns(m)}
    <h2>4. What is being done</h2>
    <p>${plural(m.open.length, 'issue')} ${m.open.length === 1 ? 'is' : 'are'} open. ${m.unplanned.length ? `${m.unplanned.length} still ${m.unplanned.length === 1 ? 'needs' : 'need'} an owner or a target date; ` : 'Every open issue has an owner and a target date; '}${m.overdue.length ? `${m.overdue.length} ${m.overdue.length === 1 ? 'is' : 'are'} overdue.` : 'none is overdue.'}</p>
    ${m.serious.length ? `<table class="table print-table aud-table"><thead><tr><th>Serious issue</th><th>Department</th><th>Target</th><th>Progress</th></tr></thead><tbody>
      ${m.serious.slice(0, 10).map((x) => { const iv = m.ivs.find((i) => i.id === x.f.interviewId); return `<tr><td>${esc(plainFinding(x.f).title)}</td><td>${esc(iv ? plainDeptOf(iv) : '')}</td><td class="nowrap">${esc(monthYear(x.f.targetDate) || 'Not set')}</td><td>${esc(progressWord(x))}</td></tr>`; }).join('')}</tbody></table>` : '<p>There are no serious open issues.</p>'}
    <h2>5. Our most important services</h2>
    <p>These are the services whose disruption would most harm customers or the bank. For each, the bank has agreed the most disruption it can tolerate and must show, by testing, that it can recover within that limit.</p>
    ${audServicesTable(m, false)}
    <h2>6. Is it getting better?</h2>${audTrend(m)}
    <h2>7. Decisions and support needed</h2>${m.doc.decisions ? `<div class="brief-ask">${nl2br(m.doc.decisions)}</div>` : '<p class="hint">None requested in this report.</p>'}
    ${audAbout(m)}</section>`;
}

function complianceHtml(m) {
  const e = m.evN;
  const soon = m.accepted.filter((x) => x.state !== 'Current').length;
  return `<section class="brief aud">${audHead(m, 'compliance')}
    <h2>1. Summary</h2>${audOverall(m)}
    <div class="aud-figs">
      ${audFig('issues open', m.open.length)}
      ${audFig('could breach a regulatory rule', m.breach.length, 'open issues', m.breach.length ? 'bad' : 'good')}
      ${audFig('serious issues open', m.serious.length, 'rated high or critical', m.serious.length ? 'bad' : 'good')}
      ${audFig('actions overdue', m.overdue.length, 'past their target date', m.overdue.length ? 'bad' : 'good')}
      ${audFig('accepted risks', m.accepted.length, soon ? `${soon} expired or expiring within 30 days` : 'none expiring soon', soon ? 'bad' : '')}
      ${audFig('evidence checked', e.asked ? `${e.checked} of ${e.asked}` : '-', `${e.missing} do not exist`, e.missing ? 'bad' : '')}
    </div>
    <h2>2. Regulatory obligations affected</h2>
    ${m.obligations.length ? `<table class="table print-table aud-table"><thead><tr><th>Obligation</th><th>Regulator</th><th>What it requires</th><th class="num">Open issues</th><th class="num">Serious</th><th class="num">Overdue</th><th>Position</th></tr></thead><tbody>
      ${m.obligations.map((o) => `<tr><td><strong>${esc(o.plainName)}</strong></td><td>${esc(o.reg)}</td><td><small>${esc(o.means)}</small></td><td class="num">${o.open}</td><td class="num">${o.serious}</td><td class="num">${o.overdue}</td><td>${svcTone(o.serious ? 'bad' : 'warn', o.serious ? 'Concern' : 'Watch')}</td></tr>`).join('')}</tbody></table>` : '<p>No open issues are linked to a regulatory obligation.</p>'}
    <h2>3. Issues that could breach a regulatory rule</h2>
    ${m.breach.length ? `<table class="table print-table aud-table"><thead><tr><th>Issue</th><th>Obligations affected</th><th>Severity</th><th>Owner</th><th>Target</th><th>Progress</th></tr></thead><tbody>
      ${m.breach.map((x) => `<tr><td>${esc(plainFinding(x.f).title)}</td><td><small>${esc(findingUkAreas(x.f).map(plainArea).join('; '))}</small></td><td>${esc(x.effR || 'Not yet rated')}</td><td>${esc(x.f.controlOwner || 'Not assigned')}</td><td class="nowrap">${x.f.targetDate ? fmtDate(x.f.targetDate) : 'Not set'}</td><td>${esc(progressWord(x))}</td></tr>`).join('')}</tbody></table>`
      : '<p>No open issue has been classed as a possible breach of a regulatory rule. Issues are classed when evidence confirms them, so this can change.</p>'}
    <h2>4. Risks the bank has formally accepted</h2>
    ${m.accepted.length ? `<table class="table print-table aud-table"><thead><tr><th>Risk</th><th>Approved by</th><th>Expires</th><th>Status</th></tr></thead><tbody>
      ${m.accepted.map((x) => `<tr><td>${esc(plainFinding(x.f).title)}</td><td>${esc(x.f.riskAcceptanceRef || 'Not recorded')}</td><td class="nowrap">${x.exp ? fmtDate(x.exp) : '-'}</td><td>${svcTone(x.state === 'Current' ? 'good' : x.state === 'Expired' || x.state === 'No expiry date' ? 'bad' : 'warn', x.state)}</td></tr>`).join('')}</tbody></table>` : '<p>No risks have been formally accepted.</p>'}
    <h2>5. Overdue actions</h2>
    ${m.overdue.length ? `<table class="table print-table aud-table"><thead><tr><th>Issue</th><th>Owner</th><th>Was due</th><th class="num">Days overdue</th></tr></thead><tbody>
      ${m.overdue.map((x) => `<tr><td>${esc(plainFinding(x.f).title)}</td><td>${esc(x.f.controlOwner || 'Not assigned')}</td><td class="nowrap">${fmtDate(x.f.targetDate)}</td><td class="num">${Math.round((new Date(today()) - new Date(x.f.targetDate)) / 864e5)}</td></tr>`).join('')}</tbody></table>` : '<p>No actions are overdue.</p>'}
    <h2>6. Can we prove our controls work?</h2>
    <p>${e.asked ? `Interviewers asked for ${plural(e.asked, 'piece')} of evidence that controls work. ${e.checked} ${e.checked === 1 ? 'has' : 'have'} been seen and checked, ${e.seen} seen but not yet checked, ${e.waiting} ${e.waiting === 1 ? 'is' : 'are'} still awaited (${e.late} overdue), and ${e.missing} ${e.missing === 1 ? 'does' : 'do'} not exist. Until evidence is checked, we cannot show a regulator or auditor that the control works.` : 'No evidence has been requested yet.'}</p>
    ${m.evByDept.length ? `<table class="table print-table aud-table"><thead><tr><th>Department</th><th class="num">Asked for</th><th class="num">Checked</th><th class="num">Awaited</th><th class="num">Does not exist</th></tr></thead><tbody>
      ${m.evByDept.map(([d, v]) => `<tr><td>${esc(d)}</td><td class="num">${v.asked}</td><td class="num">${v.checked}</td><td class="num">${v.waiting}</td><td class="num">${v.missing}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>7. Important business services</h2>
    <p>The bank must keep these services within an agreed limit of disruption and prove it by testing.</p>
    ${audServicesTable(m, true)}
    <h2>8. What is working well</h2>${audGood(m)}
    <h2>9. Matters for the Head of Compliance</h2>${m.doc.decisions ? `<div class="brief-ask">${nl2br(m.doc.decisions)}</div>` : '<p class="hint">None raised in this report.</p>'}
    ${audAbout(m)}</section>`;
}

function technologyHtml(m) {
  const th = m.th, st = th.st;
  const contradictions = th.teams.reduce((a, t) => a + (t.contradictions || 0), 0);
  const unk = st.qaTot.answered ? Math.round((st.qaTot.unknown / st.qaTot.answered) * 100) + '%' : '-';
  return `<section class="brief aud">${audHead(m, 'technology')}
    ${m.doc.message ? `<div class="brief-ask">${nl2br(m.doc.message)}</div>` : ''}
    <h2>1. Summary</h2>
    <div class="aud-figs">
      ${audFig('interviews', m.ivs.length, `${plural(m.teams.length, 'team')}`)}
      ${audFig('open findings', m.open.length, `${m.serious.length} High/Critical`, m.serious.length ? 'bad' : '')}
      ${audFig('overdue remediation', m.overdue.length, '', m.overdue.length ? 'bad' : 'good')}
      ${audFig('contradictions', contradictions, 'Yes vs No in the same team', contradictions ? 'bad' : '')}
      ${audFig('"Don\'t know" rate', unk, 'of quick answers')}
      ${audFig('evidence verified', m.evN.asked ? `${m.evN.checked} / ${m.evN.asked}` : '-', `${m.evN.missing} not available`)}
    </div>
    <h2>2. Open findings</h2>
    ${m.open.length ? `<table class="table print-table"><thead><tr><th>Ref</th><th>Finding</th><th>Category</th><th>Rating</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>
      ${m.open.map((x) => `<tr><td class="nowrap">${esc(x.f.ref)}</td><td>${esc(x.f.title)}</td><td>${esc(x.f.category || '')}</td><td class="nowrap">${ratingChip(x.effR, x.eff)}</td><td>${esc(x.f.controlOwner || '')}</td><td class="nowrap${isOverdue(x.f) ? ' overdue' : ''}">${x.f.targetDate ? fmtDate(x.f.targetDate) : ''}</td><td>${esc(x.f.status)}</td></tr>`).join('')}</tbody></table>` : '<p>No open findings.</p>'}
    <h2>3. Recurring issues across interviews</h2>
    ${th.recurring.filter((g) => g.n >= 2).length ? `<table class="table print-table"><thead><tr><th>Issue (template)</th><th class="num">Interviews</th><th class="num">Open</th><th>Worst</th><th>Teams</th><th>Regulatory reference</th></tr></thead><tbody>
      ${th.recurring.filter((g) => g.n >= 2).map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num">${g.open}</td><td>${esc(g.worst || '-')}</td><td><small>${esc([...g.teams].join(', '))}</small></td><td><small>${esc(templateById(g.key)?.uk || '')}</small></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No finding yet recurs in two or more interviews.</p>'}
    <h2>4. Control areas rated weak</h2>
    ${th.weak.length ? `<table class="table print-table"><thead><tr><th>Control area</th><th class="num">Rated weak</th><th class="num">Assessed</th><th class="num">Ineffective</th></tr></thead><tbody>
      ${th.weak.slice(0, 15).map((w) => `<tr><td>${esc(secLabel(w.s))}</td><td class="num">${w.weak}</td><td class="num">${w.rated}</td><td class="num">${w.ineffective}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No control area rated weak.</p>'}
    <h2>5. Red flags heard</h2>
    ${th.redFlags.length ? `<ul>${th.redFlags.slice(0, 12).map((x) => `<li>“${esc(x.rf.quote)}” - ${plural(x.n, 'interview')} <small class="hint">(${esc([...x.teams].join(', '))})</small></li>`).join('')}</ul>` : '<p class="hint">None recorded.</p>'}
    <h2>6. Consistency between interviewees</h2>
    <table class="table print-table"><thead><tr><th>Team</th><th class="num">Interviews</th><th class="num">Contradictions</th><th class="num">Knowledge gaps</th><th class="num">Evidence outstanding</th><th class="num">Open findings</th></tr></thead><tbody>
      ${th.teams.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.interviews}</td><td class="num">${t.contradictions ?? '-'}</td><td class="num">${t.gaps ?? '-'}</td><td class="num">${t.outstanding}${t.overdue ? ` (${t.overdue} overdue)` : ''}</td><td class="num">${t.open}</td></tr>`).join('')}</tbody></table>
    ${st.topQs.length ? `<h3>Questions most often answered with a concern or "Don't know"</h3><table class="table print-table"><thead><tr><th>Question</th><th>Area</th><th class="num">Asked</th><th class="num">Concern</th><th class="num">Don't know</th></tr></thead><tbody>
      ${st.topQs.slice(0, 10).map((x) => `<tr><td>${esc(x.q.q)}</td><td><small>${esc(secLabel(x.s))}</small></td><td class="num">${x.n}</td><td class="num">${x.concern}</td><td class="num">${x.unknown}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2>7. Important business services</h2>
    ${m.svcs.length ? `<table class="table print-table"><thead><tr><th>Service</th><th>Impact tolerance</th><th>Last scenario test</th><th class="num">Open (H/C)</th><th>Coverage</th><th>Mapped systems not interviewed</th></tr></thead><tbody>
      ${m.svcs.map((x) => `<tr><td>${esc(x.svc.ref)} ${esc(x.svc.name)}</td><td>${esc(x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + 'h' : 'Not set'))}</td><td>${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + ' · ' : ''}${esc(x.svc.scenarioResult || 'Not tested')}</td><td class="num">${x.open.length} (${x.hc.length})</td><td><small>${x.coverage.map((c) => `${esc(qnShort(c.q))}: ${c.ivs.length}`).join(', ')}</small></td><td><small>${esc(x.uncovered.map((u) => u.name).join(', ') || '-')}</small></td></tr>`).join('')}</tbody></table>` : '<p class="hint">The register is empty.</p>'}
    <h2>8. Regulatory areas engaged</h2>
    ${th.areas.length ? `<table class="table print-table"><thead><tr><th>Area</th><th>Regulator</th><th>Source</th><th class="num">Open</th><th>Worst</th></tr></thead><tbody>
      ${th.areas.map((a) => `<tr><td>${esc(a.area)}</td><td>${esc(a.regulator)}</td><td><small>${esc(a.source)}</small></td><td class="num">${a.open}</td><td>${esc(a.worst || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No open findings mapped to a regulatory area.</p>'}
    <p class="hint aud-about">Ratings are residual where assessed, otherwise inherent (likelihood × impact). Contradictions compare quick answers between interviewees on the same team and questionnaire. For the case for change, see the CTO briefing paper.</p></section>`;
}
const AUD_HTML = { board: boardHtml, compliance: complianceHtml, technology: technologyHtml };

// ---------- editor ----------
let audSaveTimer = null;
async function loadAudDoc(kind) {
  const r = await api('GET', `/api/docs/${kind}`);
  state.audDocs = state.audDocs || {}; state.audDocs[kind] = r;
  return { ...audDefaults(kind), ...r.data };
}
function renderAudience(kind, container, ivs, fs, flt) {
  const saved = state.audDocs?.[kind] || { data: {}, version: 0 };
  const doc = { ...audDefaults(kind), ...saved.data };
  const ro = !canEdit();
  const field = (k, label, type = 'text', rows = 3, hint = '') => `<label>${esc(label)}${type === 'area'
    ? `<textarea data-aud="${k}" rows="${rows}" ${ro ? 'disabled' : ''}>${esc(doc[k])}</textarea>`
    : type === 'overall' ? `<select data-aud="${k}" ${ro ? 'disabled' : ''}>${options([['', 'Worked out from the data'], ...OVERALL_LABELS.map((x) => [x, x])], doc[k])}</select>`
      : `<input type="${type}" data-aud="${k}" value="${esc(doc[k])}" ${ro ? 'disabled' : ''}>`}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
  const plainNote = kind === 'technology' ? 'Technical detail for the CTO: finding references, control areas and regulatory sources.' : 'Written in plain English for non-technical readers: no acronyms or technical terms. Issues are described using standard plain wording, so record findings from templates where possible.';
  container.innerHTML = `<div class="brief-layout">
    <form class="card brief-form">
      <h2>Report wording</h2>
      <p class="hint">${esc(plainNote)} The figures come from the interviews and findings (using the filters above). Wording you add is saved for everyone. <span id="audStatus"></span></p>
      ${kind === 'technology' ? '' : '<div id="audWarn" class="notice notice-warn" hidden></div>'}
      ${field('org', 'Organisation')}${field('title', 'Title')}${field('period', 'Period covered', 'text', 3, 'e.g. Quarter to 30 September 2026. Leave blank to use the date filters, or "Position at" today.')}
      ${field('preparedBy', 'Prepared by')}${field('date', 'Date', 'date')}
      ${kind === 'technology' ? field('message', 'Introduction (optional)', 'area', 4) : `${field('overall', 'Overall position', 'overall')}
      ${field('message', 'Summary message (optional)', 'area', 4, 'A short paragraph in plain English, shown under the overall position.')}
      ${field('decisions', kind === 'board' ? 'Decisions and support needed' : 'Matters for the Head of Compliance', 'area', 4)}`}
      <label class="check"><input type="checkbox" data-aud="includeDemo"${doc.includeDemo ? ' checked' : ''} ${ro ? 'disabled' : ''}> Include demo data</label>
    </form>
    <div class="brief-preview-wrap"><p class="hint">Preview</p><article class="doc" id="audPreview"></article></div>
  </div>`;
  const preview = () => {
    $('#audPreview').innerHTML = AUD_HTML[kind](audienceModel(ivs, fs, flt, doc));
    const w = $('#audWarn'); if (!w) return;
    const found = acronymsIn($('#audPreview').innerHTML.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '));
    w.hidden = !found.length;
    w.innerHTML = found.length ? `<p><strong>Plain-English check:</strong> this report contains ${found.map((x) => `“${esc(x)}”`).join(', ')}. These come from details typed into the app (for example owners, approvers or service names). Consider rewording them there, or explaining them in the summary message, before sending this to non-technical readers.</p>` : '';
  };
  const save = () => {
    clearTimeout(audSaveTimer);
    $('#audStatus').textContent = 'Unsaved changes…';
    audSaveTimer = setTimeout(async () => {
      try {
        const r = await api('PUT', `/api/docs/${kind}`, { version: state.audDocs[kind].version, data: doc });
        state.audDocs[kind] = { data: { ...doc }, version: r.version };
        const s = $('#audStatus'); if (s) s.textContent = `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;
      } catch (e) { const s = $('#audStatus'); if (s) s.textContent = 'Not saved: ' + e.message; fail(e); }
    }, 900);
  };
  $$('[data-aud]', container).forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    doc[el.dataset.aud] = el.type === 'checkbox' ? el.checked : el.value; preview(); save();
  }));
  preview();
}
async function loadAudienceInputs(kind) {
  const [ivs, fs, doc] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings'), loadAudDoc(kind), loadServices()]);
  return { ivs, fs, doc };
}
async function viewPrintAudience(kind) {
  const { ivs, fs, doc } = await loadAudienceInputs(kind);
  printFrame(doc.title, AUD_HTML[kind](audienceModel(ivs, fs, lastReportFilters, doc)), `#/reports/${kind}`, () => wordAudience(kind));
}

// ---------- Word ----------
async function wordAudience(kind) {
  const { ivs, fs, doc } = await loadAudienceInputs(kind);
  const m = audienceModel(ivs, fs, lastReportFilters, doc);
  const d = m.doc;
  let n = 0; const H1 = (t) => D.h(1, `${++n}. ${t}`);
  const bl = (arr) => arr.map((x) => D.bullet(x)).join('');
  const toneFill = { bad: 'F4CCCC', warn: 'FFF2CC', good: 'E2EFDA', none: 'F2F4F7' };
  const head = [
    D.p(`${d.org || 'The bank'} · CONFIDENTIAL · for the ${AUD_KINDS[kind].label}`, { style: 'Subtle' }),
    D.p(d.title || '', { style: 'Title' }), D.p(audPeriod(m), { run: { italic: true, color: '404040' } }),
    D.p(`Prepared by ${d.preparedBy || ''} · ${d.date ? fmtDate(d.date) : ''}`, { style: 'Subtle' }),
    m.demo ? D.p('This report includes demonstration data. Exclude it before sharing.', { run: { bold: true, color: 'C0302F' } }) : '',
  ];
  const figs = (list) => D.table([list.slice(0, 3), list.slice(3, 6)].filter((r) => r.length).map((row) => row.map(([l, v, s]) => ({ content: [{ text: String(v), bold: true, size: 16 }, `\n${l}`, ...(s ? [{ text: `\n${s}`, size: 8, color: '595959' }] : [])] }))), { widths: [1, 1, 1] });
  const overall = D.table([[{ content: [{ text: 'Overall position: ', bold: true }, { text: m.overall, bold: true }, `\n${m.overallText}`, ...(d.message ? [`\n${d.message}`] : [])], fill: toneFill[m.tone] }]], { widths: [1] });
  const good = m.good.length ? bl(m.good) : D.p('It is too early to identify strengths: more interviews and evidence are needed.');
  const concerns = m.concerns.length ? m.concerns.slice(0, 6).map((g, i) => D.bullet([{ text: g.title, bold: true }, ` (${m.sevWord(g.worst)})`, ...(g.why ? [`. ${g.why}`] : []), ...(g.items.length ? [{ text: ` ${plural(g.items.length, 'open issue')}${g.depts.size ? '; ' + [...g.depts].join(', ') : ''}.`, color: '595959' }] : [])], i + 1)).join('') : D.p('No open issues.');
  const svcTable = (withOwner) => (m.svcs.length ? D.table([['Service', 'Agreed limit of disruption', 'Recovery within the limit proven?', ...(withOwner ? ['Accountable senior manager'] : []), 'Serious issues', 'Overall'],
    ...m.svcs.map((x) => [{ content: [{ text: x.svc.name, bold: true }] }, x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not yet set'), m.recovery(x.svc), ...(withOwner ? [plainRole(x.svc.accountableSmf) || 'Not recorded'] : []), String(x.hc.length),
      { content: [{ text: svcHealthWord(x), bold: true }, ...(x.flags.length ? [{ text: `\n${plainService(briefSvcGaps(x)[0])}`, size: 8 }] : [])], fill: toneFill[x.tone] }])], { header: true, widths: withOwner ? [1.3, 1.3, 1, 1, 0.6, 1.4] : [1.4, 1.5, 1.1, 0.6, 1.5] }) : D.p('No important business services are recorded in the register yet.'));
  const about = D.p(`About this report: it is based on ${plural(m.ivs.length, 'structured interview')}${m.range ? ` held ${m.range}` : ''}, the issues recorded from them and the evidence collected. Issues are rated critical, high, medium or low; "serious" means high or critical. An issue is only marked resolved when the fix has been checked. Regulatory statements summarise our understanding at the date of this report and are not legal advice.`, { style: 'Subtle' });
  let body;
  if (kind === 'board') {
    body = [...head, H1('Summary'), overall,
      figs([['people interviewed', m.ivs.length, `${plural(m.depts.length, 'department')}, ${plural(m.teams.length, 'team')}`], ['issues open', m.open.length], ['serious issues open', m.serious.length, 'rated high or critical'], ['actions overdue', m.overdue.length], ['issues resolved', m.resolved90.length, 'in the last three months'], ['evidence checked', m.evN.asked ? `${m.evN.checked} of ${m.evN.asked}` : '-', 'items proven to work']]),
      H1('What is working well'), good, H1('Main concerns'), concerns,
      H1('What is being done'), D.p(`${plural(m.open.length, 'issue')} ${m.open.length === 1 ? 'is' : 'are'} open. ${m.unplanned.length ? `${m.unplanned.length} still ${m.unplanned.length === 1 ? 'needs' : 'need'} an owner or a target date; ` : 'Every open issue has an owner and a target date; '}${m.overdue.length ? `${m.overdue.length} ${m.overdue.length === 1 ? 'is' : 'are'} overdue.` : 'none is overdue.'}`),
      m.serious.length ? D.table([['Serious issue', 'Department', 'Target', 'Progress'], ...m.serious.slice(0, 10).map((x) => { const iv = m.ivs.find((i) => i.id === x.f.interviewId); return [plainFinding(x.f).title, iv ? plainDeptOf(iv) : '', monthYear(x.f.targetDate) || 'Not set', progressWord(x)]; })], { header: true, widths: [3, 1.3, 1, 1] }) : D.p('There are no serious open issues.'),
      H1('Our most important services'), D.p('These are the services whose disruption would most harm customers or the bank. For each, the bank has agreed the most disruption it can tolerate and must show, by testing, that it can recover within that limit.'), svcTable(false),
      H1('Is it getting better?'), D.table([['Measure', 'Now', 'Three months ago', 'Direction'], ...m.trend.map((t) => [t.l, String(t.now), String(t.then), { content: t.dir, fill: t.dir === 'Better' ? toneFill.good : t.dir === 'Worse' ? toneFill.bad : toneFill.warn }]),
        ['Issues raised in the last three months', String(m.raised90.length), '', ''], ['Issues resolved in the last three months', String(m.resolved90.length), '', '']], { header: true, widths: [2.4, 0.8, 1.2, 1] }),
      H1('Decisions and support needed'), d.decisions ? D.table([[{ content: d.decisions, fill: 'E6EEF8' }]], { widths: [1] }) : D.p('None requested in this report.'), about];
  } else if (kind === 'compliance') {
    const soon = m.accepted.filter((x) => x.state !== 'Current').length;
    body = [...head, H1('Summary'), overall,
      figs([['issues open', m.open.length], ['could breach a regulatory rule', m.breach.length, 'open issues'], ['serious issues open', m.serious.length, 'rated high or critical'], ['actions overdue', m.overdue.length], ['accepted risks', m.accepted.length, soon ? `${soon} expired or expiring within 30 days` : 'none expiring soon'], ['evidence checked', m.evN.asked ? `${m.evN.checked} of ${m.evN.asked}` : '-', `${m.evN.missing} do not exist`]]),
      H1('Regulatory obligations affected'), m.obligations.length ? D.table([['Obligation', 'Regulator', 'What it requires', 'Open', 'Serious', 'Overdue', 'Position'], ...m.obligations.map((o) => [{ content: [{ text: o.plainName, bold: true }] }, o.reg, { content: [{ text: o.means, size: 8 }] }, String(o.open), String(o.serious), String(o.overdue), { content: o.serious ? 'Concern' : 'Watch', fill: o.serious ? toneFill.bad : toneFill.warn }])], { header: true, widths: [1.4, 1, 2.2, 0.5, 0.6, 0.6, 0.7] }) : D.p('No open issues are linked to a regulatory obligation.'),
      H1('Issues that could breach a regulatory rule'), m.breach.length ? D.table([['Issue', 'Obligations affected', 'Severity', 'Owner', 'Target', 'Progress'], ...m.breach.map((x) => [plainFinding(x.f).title, { content: [{ text: findingUkAreas(x.f).map(plainArea).join('; '), size: 8 }] }, x.effR || 'Not yet rated', x.f.controlOwner || 'Not assigned', x.f.targetDate ? fmtDate(x.f.targetDate) : 'Not set', progressWord(x)])], { header: true, widths: [2, 1.6, 0.7, 1, 0.8, 0.8] }) : D.p('No open issue has been classed as a possible breach of a regulatory rule. Issues are classed when evidence confirms them, so this can change.'),
      H1('Risks the bank has formally accepted'), m.accepted.length ? D.table([['Risk', 'Approved by', 'Expires', 'Status'], ...m.accepted.map((x) => [plainFinding(x.f).title, x.f.riskAcceptanceRef || 'Not recorded', x.exp ? fmtDate(x.exp) : '-', { content: x.state, fill: x.state === 'Current' ? toneFill.good : x.state === 'Expired' || x.state === 'No expiry date' ? toneFill.bad : toneFill.warn }])], { header: true, widths: [2.6, 1.4, 0.9, 1.1] }) : D.p('No risks have been formally accepted.'),
      H1('Overdue actions'), m.overdue.length ? D.table([['Issue', 'Owner', 'Was due', 'Days overdue'], ...m.overdue.map((x) => [plainFinding(x.f).title, x.f.controlOwner || 'Not assigned', fmtDate(x.f.targetDate), String(Math.round((new Date(today()) - new Date(x.f.targetDate)) / 864e5))])], { header: true, widths: [2.8, 1.4, 0.9, 0.8] }) : D.p('No actions are overdue.'),
      H1('Can we prove our controls work?'), D.p(m.evN.asked ? `Interviewers asked for ${plural(m.evN.asked, 'piece')} of evidence that controls work. ${m.evN.checked} ${m.evN.checked === 1 ? 'has' : 'have'} been seen and checked, ${m.evN.seen} seen but not yet checked, ${m.evN.waiting} ${m.evN.waiting === 1 ? 'is' : 'are'} still awaited (${m.evN.late} overdue), and ${m.evN.missing} ${m.evN.missing === 1 ? 'does' : 'do'} not exist. Until evidence is checked, we cannot show a regulator or auditor that the control works.` : 'No evidence has been requested yet.'),
      m.evByDept.length ? D.table([['Department', 'Asked for', 'Checked', 'Awaited', 'Does not exist'], ...m.evByDept.map(([dp, v]) => [dp, String(v.asked), String(v.checked), String(v.waiting), String(v.missing)])], { header: true, widths: [2, 1, 1, 1, 1] }) : '',
      H1('Important business services'), D.p('The bank must keep these services within an agreed limit of disruption and prove it by testing.'), svcTable(true),
      H1('What is working well'), good,
      H1('Matters for the Head of Compliance'), d.decisions ? D.table([[{ content: d.decisions, fill: 'E6EEF8' }]], { widths: [1] }) : D.p('None raised in this report.'), about];
  } else {
    const th = m.th, st = th.st;
    const contradictions = th.teams.reduce((a, t) => a + (t.contradictions || 0), 0);
    const rec = th.recurring.filter((g) => g.n >= 2);
    body = [...head, d.message ? D.table([[{ content: d.message, fill: 'E6EEF8' }]], { widths: [1] }) : '',
      H1('Summary'), figs([['interviews', m.ivs.length, plural(m.teams.length, 'team')], ['open findings', m.open.length, `${m.serious.length} High/Critical`], ['overdue remediation', m.overdue.length], ['contradictions', contradictions], ['"Don\'t know" rate', st.qaTot.answered ? Math.round((st.qaTot.unknown / st.qaTot.answered) * 100) + '%' : '-'], ['evidence verified', m.evN.asked ? `${m.evN.checked} / ${m.evN.asked}` : '-', `${m.evN.missing} not available`]]),
      H1('Open findings'), m.open.length ? D.table([['Ref', 'Finding', 'Category', 'Rating', 'Owner', 'Target', 'Status'], ...m.open.map((x) => [x.f.ref, x.f.title, x.f.category || '', ratingCell(x.effR, x.eff), x.f.controlOwner || '', x.f.targetDate ? fmtDate(x.f.targetDate) : '', x.f.status])], { header: true, widths: [0.9, 2.6, 1.2, 0.8, 1.1, 0.8, 0.8] }) : D.p('No open findings.'),
      H1('Recurring issues across interviews'), rec.length ? D.table([['Issue (template)', 'Interviews', 'Open', 'Worst', 'Regulatory reference'], ...rec.map((g) => [g.label, String(g.n), String(g.open), ratingCell(g.worst), { content: [{ text: templateById(g.key)?.uk || '', size: 8 }] }])], { header: true, widths: [2.2, 0.7, 0.6, 0.8, 2.2] }) : D.p('No finding yet recurs in two or more interviews.'),
      H1('Control areas rated weak'), th.weak.length ? D.table([['Control area', 'Rated weak', 'Assessed', 'Ineffective'], ...th.weak.slice(0, 15).map((w) => [secLabel(w.s), String(w.weak), String(w.rated), String(w.ineffective)])], { header: true, widths: [3, 0.8, 0.8, 0.8] }) : D.p('No control area rated weak.'),
      H1('Red flags heard'), th.redFlags.length ? bl(th.redFlags.slice(0, 12).map((x) => `"${x.rf.quote}" - ${plural(x.n, 'interview')} (${[...x.teams].join(', ')})`)) : D.p('None recorded.'),
      H1('Consistency between interviewees'), D.table([['Team', 'Interviews', 'Contradictions', 'Knowledge gaps', 'Evidence outstanding', 'Open findings'], ...th.teams.map((t) => [t.name, String(t.interviews), String(t.contradictions ?? '-'), String(t.gaps ?? '-'), String(t.outstanding), String(t.open)])], { header: true, widths: [1.6, 0.8, 1, 1, 1, 0.8] }),
      st.topQs.length ? D.h(2, 'Questions most often answered with a concern or "Don\'t know"') + D.table([['Question', 'Area', 'Asked', 'Concern', "Don't know"], ...st.topQs.slice(0, 10).map((x) => [x.q.q, secLabel(x.s), String(x.n), String(x.concern), String(x.unknown)])], { header: true, widths: [3, 1.6, 0.6, 0.6, 0.7] }) : '',
      H1('Important business services'), m.svcs.length ? D.table([['Service', 'Impact tolerance', 'Last scenario test', 'Open (H/C)', 'Mapped systems not interviewed'], ...m.svcs.map((x) => [`${x.svc.ref} ${x.svc.name}`, x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + 'h' : 'Not set'), `${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + ' · ' : ''}${x.svc.scenarioResult || 'Not tested'}`, `${x.open.length} (${x.hc.length})`, x.uncovered.map((u) => u.name).join(', ') || '-'])], { header: true, widths: [1.6, 1.6, 1.2, 0.7, 1.5] }) : D.p('The register is empty.'),
      H1('Regulatory areas engaged'), th.areas.length ? D.table([['Area', 'Regulator', 'Source', 'Open', 'Worst'], ...th.areas.map((a) => [a.area, a.regulator, { content: [{ text: a.source, size: 8 }] }, String(a.open), ratingCell(a.worst)])], { header: true, widths: [1.4, 0.7, 2.6, 0.5, 0.8] }) : D.p('No open findings mapped to a regulatory area.'),
      D.p('Ratings are residual where assessed, otherwise inherent (likelihood × impact). Contradictions compare quick answers between interviewees on the same team and questionnaire. For the case for change, see the CTO briefing paper.', { style: 'Subtle' })];
  }
  saveDocx(D.build({ title: d.title, author: state.user.fullName, footer: `${d.title} · ${wordFooter()}` }, body.join('')), `${d.title.replace(/:\s*/g, ' - ').replace(/[\\/*?"<>|]/g, '-')} ${today()}.docx`);
}
