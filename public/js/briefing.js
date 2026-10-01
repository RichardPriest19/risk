// Leadership briefing (by default for the CTO): a persuasive, evidence-based report on why PRA expectations must apply.
// Title, subtitle and audience are editable, so the same report can be addressed to the CRO, a committee or the board.
// Built from the programme's own data (interviews, findings, evidence); wording that needs judgement is editable
// and saved on the server so everyone sees the same version.
'use strict';

const BRIEFING_DEFAULTS = () => ({
  org: 'Atom bank', audience: 'Chief Technology Officer', audienceShort: 'CTO', preparedBy: state.user.fullName, date: today(),
  title: 'Software development and PRA expectations', subtitle: 'Why banking controls must apply to how we build and change software - and what we propose',
  decision: 'Agree that software development will operate to a defined set of banking controls - owned by engineering, built into our tools, evidenced by default and proportionate to how critical each system is - so that we can show the PRA, our board and our auditors that change to our systems is controlled. Specifically: approve the 0-30 day actions below, nominate an engineering owner for each theme, and sponsor the 180-day plan.',
  keyMessages: '', additionalActions: '', closingNote: '', includeDemo: false, showNames: false, showServices: true,
});
const BRIEF_WHY = ['Fundamental Rules', 'Operational resilience', 'Outsourcing and third parties (including cloud)', 'Senior Managers & Certification Regime', 'Operational risk and capital', 'Supervisory review and enforcement'];
const BRIEF_NOT = (m) => [
  'A return to heavyweight change boards. Most controls can run automatically in the pipeline - independent approval, tests, security scans, secrets detection - so engineers keep their pace.',
  'Paperwork for its own sake. The evidence the PRA and auditors need is what our tools already produce: merge requests, pipeline runs, deployment logs, access records. The work is to keep it and be able to find it.',
  'The same controls everywhere. Controls should be proportionate: strongest for systems that support important business services, lighter for internal tools.',
  `Blame. The interview findings describe how the system works today, not individual failings. ${m.Subjects} raised many of these issues themselves.`,
];
const BRIEF_INACTION = [
  ['Supervisory review', 'The PRA can require an independent skilled person review (FSMA s166) at the bank\'s expense if it doubts that controls operate - and supervisors test evidence, not intentions.'],
  ['Enforcement precedent', 'In 2022 the PRA and FCA fined TSB a combined £48.65m over risk management and governance failings in its 2018 IT migration: a failure in how software change was governed at a UK bank.'],
  ['Capital', 'Technology risk is operational risk. Weak or unevidenced controls feed the bank\'s ICAAP and the PRA\'s view when setting Pillar 2A capital.'],
  ['Personal accountability', 'Under SM&CR, the senior manager responsible for operational resilience must be able to show they took reasonable steps. Today they would have to rely on assurances rather than evidence.'],
  ['Operational resilience', 'The bank must be able to stay within impact tolerances for its important business services (PRA SS1/21). Untested recovery, key-person dependencies and uncontrolled change put that at risk.'],
  ['Customers', 'Outages, incorrect balances and failed payments are also customer harm under the FCA Consumer Duty, with remediation and redress costs.'],
];
const BRIEF_GOVERNANCE = (m) => [
  'Name an engineering owner for each control area, with accountability traced to the responsible senior manager (SM&CR).',
  'Build evidence into the pipeline and tools: approvals, test and scan results and deployment records retained automatically and easy to retrieve (PRA Fundamental Rules 6 and 7).',
  'Map every system to the important business services it supports, and design and test recovery against the impact tolerances (PRA SS1/21).',
  'Bring software and cloud suppliers into the third-party register, with materiality assessments and exit plans (PRA SS2/21).',
  `Report control health monthly to the ${m.doc.audienceShort || 'CTO'} and the accountable senior manager: overdue vulnerabilities, bypasses and exceptions, evidence gaps.`,
  'Repeat the interviews every six months to measure progress, using this report as the baseline.',
];
const briefingShort = (doc) => (doc && doc.audienceShort) || 'CTO';
const briefingTitle = (doc) => `${briefingShort(doc)} briefing`;
const briefingTabLabel = () => briefingTitle({ ...BRIEFING_DEFAULTS(), ...(state.briefingDoc?.data || {}) });

function briefingModel(ivsAll, fsAll, flt, doc) {
  const ivsIn = doc.includeDemo ? ivsAll : ivsAll.filter((i) => !i.data.demo);
  const fsIn = doc.includeDemo ? fsAll : fsAll.filter((f) => !f.demo);
  const th = themesModel(ivsIn, fsIn, flt);
  const ivs = th.ivs, fs = th.fs;
  const open = fs.filter((f) => f.status !== 'Closed').map((f) => ({ f, ...findingScores(f) })).sort((a, b) => b.eff - a.eff);
  const nR = (r) => open.filter((x) => x.effR === r).length;
  const ev = ivs.flatMap((i) => evidenceRows(i, []));
  const evRequested = ev.filter((r) => r.status && r.status !== 'Not requested').length;
  const evVerified = ev.filter((r) => r.status === 'Seen - verified').length;
  const evMissing = ev.filter((r) => r.status === 'Not available').length;
  const evOutstanding = ev.filter((r) => r.status === 'Requested').length;
  const contradictions = th.teams.reduce((a, t) => a + (t.contradictions || 0), 0);
  const unknownPct = th.st.qaTot.answered ? Math.round((th.st.qaTot.unknown / th.st.qaTot.answered) * 100) : null;
  const dates = ivs.map((i) => i.data.header?.date).filter(Boolean).sort();
  const range = dates.length ? (dates[0] === dates[dates.length - 1] ? ` on ${fmtDate(dates[0])}` : ` between ${fmtDate(dates[0])} and ${fmtDate(dates[dates.length - 1])}`) : '';
  const praAreas = th.areas.filter((a) => a.regulator === 'PRA');

  // What good looks like: recurring templated findings first, then control areas often rated weak.
  const praOnly = (txt) => { const parts = String(txt || '').split(/;\s*/).filter((p) => /PRA/.test(p)); return parts.length ? parts.join('; ') : txt; };
  const tplOpen = th.recurring.filter((g) => g.open > 0).map((g) => ({ g, t: templateById(g.key) })).filter((x) => x.t);
  const coveredCats = new Set(tplOpen.map((x) => x.t.category));
  const weakExtra = th.weak.filter((w) => !coveredCats.has(SECTION_CATEGORY[w.s.id])); // avoid repeating an area a template already covers
  const good = [];
  tplOpen.forEach(({ g, t }) => good.push({ issue: t.title, n: g.n, worst: g.worst, good: t.control, pra: praOnly(t.uk) }));
  weakExtra.forEach((w) => { if (good.length < 8) good.push({ issue: `${w.s.title} - rated weak in ${w.weak} of ${w.rated} interviews`, n: w.weak, worst: '', good: w.s.control, pra: w.s.reg.pra }); });

  // Plan: urgent findings, then fixes for recurring themes, then standing governance.
  const phase1 = open.filter((x) => ['Critical', 'High'].includes(x.effR)).slice(0, 10)
    .map((x) => ({ ref: x.f.ref, what: x.f.remediation || `Agree remediation: ${x.f.title}`, owner: x.f.controlOwner, due: x.f.targetDate, rating: x.effR }));
  const phase2 = [];
  tplOpen.forEach(({ g, t }) => { if (!phase2.some((p) => p.what === t.remediation)) phase2.push({ what: t.remediation, why: `${t.title} (${g.n} interview${g.n === 1 ? '' : 's'})` }); });
  weakExtra.forEach((w) => { if (phase2.length < 8) phase2.push({ what: `Put in place: ${w.s.control}`, why: `${w.s.title} rated weak in ${w.weak} of ${w.rated} interviews` }); });
  const extra = String(doc.additionalActions || '').split('\n').map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);

  // Distinct headline issues: a red flag already represented by a recurring finding (same template), or a weak area
  // already covered by a template of the same category, is not repeated.
  const tplTitles = new Set(tplOpen.filter((x) => x.g.n >= 2).map((x) => x.t.title));
  const topIssues = [];
  th.top.forEach((t) => {
    if (t.kind === 'Concerning answers') return; // shown in "What we found"; a question reads badly as a headline
    if (t.kind === 'Red flag') { const rf = T.redFlags.find((r) => `“${r.quote}”` === t.label); const tt = rf && templateById(T.redFlagTemplate[rf.id]); if (tt && tplTitles.has(tt.title)) return; }
    if (t.kind === 'Weak control area') { const sec = T.sections.find((x) => secLabel(x) === t.label); if (sec && coveredCats.has(SECTION_CATEGORY[sec.id])) return; }
    const label = t.kind === 'Weak control area' ? `weak ${t.label.replace(/^(.* - )?\d+\.\s*/, '').toLowerCase()} controls` : t.label.replace(/^“|”$/g, '').replace(/\.$/, '');
    if (!topIssues.includes(label)) topIssues.push(label);
  });
  // Important business services (and candidates) from the register, with what the filtered programme found about each.
  const svcIn = (state.services || []).filter((x) => (doc.includeDemo || !x.demo) && (!flt.svc || x.id === Number(flt.svc)))
    .filter((x) => isIbs(x) || x.designation === 'Candidate - under review');
  const svcModels = svcIn.map((x) => serviceModel(x, ivs, fs)).sort((a, b) => (b.ibs - a.ibs) || (b.hc.length - a.hc.length) || (b.open.length - a.open.length));
  const ibsModels = svcModels.filter((x) => x.ibs);
  const notShown = (x) => !x.svc.scenarioResult || x.svc.scenarioResult === 'Not tested' || x.svc.scenarioResult === 'Breached tolerance' || monthsSince(x.svc.scenarioTestDate) > 12;
  const services = {
    show: doc.showServices !== false && svcModels.length > 0, models: svcModels, ibs: ibsModels.length,
    withHc: ibsModels.filter((x) => x.hc.length).length, notShown: ibsModels.filter(notShown).length,
    breached: ibsModels.filter((x) => x.svc.scenarioResult === 'Breached tolerance').length,
    uncoveredSystems: ibsModels.reduce((a, x) => a + (x.linked.length ? x.uncovered.length : 0), 0),
    noInterviews: ibsModels.filter((x) => !x.linked.length).length,
  };
  const subjects = subjectsFor(ivs), subject = qnsIn(ivs).length === 1 ? qnsIn(ivs)[0].subject : 'interviewee';
  const auto = [
    ivs.length ? `We interviewed ${ivs.length} ${ivs.length === 1 ? subject : subjects} across ${th.teams.length} team${th.teams.length === 1 ? '' : 's'}${range}. ${open.length} finding${open.length === 1 ? ' is' : 's are'} open, ${nR('Critical') + nR('High')} rated High or Critical.` : 'No interviews are included yet - run the programme to produce the evidence for this briefing.',
    services.show && services.ibs ? briefSvcMessage(services) : '',
    topIssues.length ? `The most widespread issues are: ${topIssues.slice(0, 3).join('; ')}.` : '',
    praAreas.length ? `The findings engage PRA requirements on ${praAreas.map((a) => a.area.toLowerCase()).join(', ')}.` : '',
    evRequested ? `Of ${evRequested} pieces of evidence requested, ${evVerified} ${evVerified === 1 ? 'has' : 'have'} been verified${evMissing ? `, and ${evMissing} ${evMissing === 1 ? 'does' : 'do'} not exist at all` : ''}.${evVerified < evRequested ? ' Until the rest is verified, controls we believe operate cannot be shown to operate - which is what the PRA and auditors will ask for.' : ''}` : '',
    contradictions ? `${contradictions} question${contradictions === 1 ? '' : 's'} drew contradictory answers from ${subjects} on the same team - controls are not consistently understood or applied.` : '',
    unknownPct ? `${unknownPct}% of quick answers were "Don't know".` : '',
  ].filter(Boolean);
  const manual = String(doc.keyMessages || '').split('\n').map((l) => l.replace(/^\s*[-•]\s*/, '').trim()).filter(Boolean);
  const depthCount = {}; ivs.forEach((i) => { const d = (T.depths.find((x) => x.id === depthOf(i.data)) || {}).label; depthCount[d] = (depthCount[d] || 0) + 1; });
  return {
    doc, th, ivs, fs, open, nR, subjects, Subjects: subjects.replace(/^./, (c) => c.toUpperCase()), keyMessages: manual.length ? manual : auto, keyAuto: !manual.length,
    figures: [['Interviews', ivs.length], ['Teams', th.teams.length], ['Open findings', open.length], ['High / critical', nR('Critical') + nR('High')],
      ['Evidence verified', `${evVerified} of ${evRequested}`], ['Evidence not available', evMissing], ['Contradictions', contradictions], ['"Don\'t know"', unknownPct == null ? '-' : unknownPct + '%']],
    why: BRIEF_WHY.map((a) => T.praMap.find((p) => p.area === a)).filter(Boolean),
    services, good: good.slice(0, 8), phase1, phase2: phase2.slice(0, 8), extra, praAreas,
    method: { depths: Object.entries(depthCount).map(([k, v]) => `${v} ${k}`).join(', '), range, evOutstanding, demo: doc.includeDemo && (ivsAll.some((i) => i.data.demo)) },
    appendix: ivs.map((i) => ({ ref: i.ref, name: i.data.header?.developerName, role: i.data.header?.developerRole, team: i.data.header?.team, date: i.data.header?.date, status: i.status, demo: !!i.data.demo }))
      .sort((a, b) => (a.date || '').localeCompare(b.date || '')),
  };
}

// Key message on important business services, worded for one service or several.
function briefSvcMessage(v) {
  const toleranceText = 'stay within its impact tolerance (never tested, tested over a year ago, or breached)';
  if (v.ibs === 1) {
    const parts = [v.withHc ? 'has open High or Critical findings' : 'has no open High or Critical findings', v.notShown ? `has not been shown to ${toleranceText}` : 'has been shown to stay within its impact tolerance in the last year'];
    return `Our one important business service in the register ${parts.join(', and ')}.`;
  }
  return `${v.withHc} of our ${v.ibs} important business services ${v.withHc === 1 ? 'has' : 'have'} open High or Critical findings, and ${v.notShown} ${v.notShown === 1 ? 'has' : 'have'} not been shown to ${v.notShown === 1 ? toleranceText : toleranceText.replace('its', 'their')}.`;
}
// Main gaps for one service in the briefing (most serious first, two at most).
const briefSvcGaps = (x) => [...x.flags.filter((f) => f[0] === 'bad'), ...x.flags.filter((f) => f[0] !== 'bad')].slice(0, 2).map((f) => f[1]);
const briefSvcIntro = 'The PRA judges operational resilience service by service: each important business service must be able to stay within its impact tolerance in severe but plausible scenarios (SS1/21). This shows where the programme\'s findings land on those services.';
function briefingHtml(m) {
  const d = m.doc;
  let n = 0; const H = (t) => `<h2>${++n}. ${esc(t)}</h2>`;
  const li = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  return `<section class="brief">
    <header class="brief-head"><p class="brief-kicker">${esc(d.org || 'The bank')} · CONFIDENTIAL · for the ${esc(d.audience || briefingShort(d))}</p>
      <h1>${esc(d.title)}</h1>
      ${d.subtitle ? `<p class="brief-sub">${esc(d.subtitle)}</p>` : ''}
      <p class="hint">Prepared by ${esc(d.preparedBy || '')} · ${d.date ? fmtDate(d.date) : ''}</p></header>
    ${m.method.demo ? '<div class="notice demo-notice"><p><span class="demo-tag">DEMO</span> This briefing includes demonstration data. Untick “Include demo data” before sharing it.</p></div>' : ''}
    ${H('Decision requested')}<div class="brief-ask">${nl2br(d.decision)}</div>
    ${H('Key messages')}${li(m.keyMessages)}
    <div class="es-figs">${m.figures.map(([l, v]) => `<div><span>${esc(l)}</span><strong>${esc(String(v))}</strong></div>`).join('')}</div>
    ${H('Why this matters: the PRA')}
    <p>The Prudential Regulation Authority is our prudential regulator. Its rules apply to the bank directly - and to software development because that is where our systems, and the controls over them, are built and changed.</p>
    <table class="table print-table brief-table"><thead><tr><th>PRA requirement</th><th>What it means for software development</th></tr></thead><tbody>
      ${m.why.map((p) => `<tr><td><strong>${esc(p.area)}</strong><br><small>${esc(p.source)}</small></td><td>${esc(p.means)}</td></tr>`).join('')}</tbody></table>
    ${H('What we found')}
    ${m.th.top.length ? `<h3>Most widespread issues</h3><ol>${m.th.top.slice(0, 6).map((t) => `<li><strong>${esc(t.label)}</strong> <span class="hint">(${esc(t.kind)}, ${t.n} interviews)</span><br><span class="hint">${esc(t.detail)}</span></li>`).join('')}</ol>` : '<p class="hint">No issue yet appears in two or more interviews.</p>'}
    ${m.th.areas.length ? `<h3>Regulatory areas affected (open findings)</h3><table class="table print-table"><thead><tr><th>Area</th><th>Regulator</th><th class="num">Open findings</th><th class="num">Interviews</th><th>Worst</th></tr></thead><tbody>
      ${m.th.areas.map((a) => `<tr><td>${esc(a.area)}</td><td>${esc(a.regulator)}</td><td class="num">${a.open}</td><td class="num">${a.interviews}</td><td>${esc(a.worst || '-')}</td></tr>`).join('')}</tbody></table>` : ''}
    ${m.open.length ? `<h3>Top risks</h3><table class="table print-table"><thead><tr><th>Ref</th><th>Finding</th><th>Rating</th><th>Owner</th><th>Target</th></tr></thead><tbody>
      ${m.open.slice(0, 8).map((x) => `<tr><td>${esc(x.f.ref)}</td><td>${esc(x.f.title)}</td><td class="nowrap">${esc(x.effR || 'Not rated')}</td><td>${esc(x.f.controlOwner || '')}</td><td class="nowrap">${x.f.targetDate ? fmtDate(x.f.targetDate) : ''}</td></tr>`).join('')}</tbody></table>` : ''}
    ${m.services.show ? `${H('Important business services')}<p>${esc(briefSvcIntro)}</p>
      <table class="table print-table brief-svc"><thead><tr><th>Service</th><th>Impact tolerance</th><th>Last test</th><th class="num">Open findings</th><th>Interviewed</th><th>Main gaps</th></tr></thead><tbody>
      ${m.services.models.map((x) => `<tr><td><strong>${esc(x.svc.name)}</strong>${x.ibs ? '' : '<br><small>Candidate - under review</small>'}${x.svc.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</td>
        <td>${esc(x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not set'))}</td>
        <td class="nowrap">${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + '<br>' : ''}${esc(x.svc.scenarioResult || 'Not tested')}</td>
        <td class="num">${x.open.length}${x.hc.length ? `<br><small>${x.hc.length} high/critical</small>` : ''}</td>
        <td>${x.coverage.filter((c) => c.ivs.length).map((c) => esc(qnShort(c.q))).join(', ') || 'None yet'}</td>
        <td><small>${briefSvcGaps(x).map(esc).join('<br>') || 'None found'}</small></td></tr>`).join('')}</tbody></table>
      ${m.services.uncoveredSystems ? `<p class="hint">${m.services.uncoveredSystems} system${m.services.uncoveredSystems === 1 ? '' : 's'} mapped to important business services ${m.services.uncoveredSystems === 1 ? 'has' : 'have'} not yet been covered by any interview.</p>` : ''}` : ''}
    ${H('What good looks like')}
    ${m.good.length ? `<table class="table print-table brief-table"><thead><tr><th>Issue found</th><th>What good looks like</th><th>PRA requirement it meets</th></tr></thead><tbody>
      ${m.good.map((g) => `<tr><td>${esc(g.issue)}</td><td>${esc(g.good)}</td><td><small>${esc(g.pra)}</small></td></tr>`).join('')}</tbody></table>` : '<p class="hint">Record findings (ideally from templates) and section ratings to populate this.</p>'}
    ${H('What we are not proposing')}${li(BRIEF_NOT(m))}
    ${H('Proposed plan')}
    <h3>0-30 days: fix the urgent</h3>${m.phase1.length ? `<table class="table print-table"><thead><tr><th>Ref</th><th>Action</th><th>Owner</th><th>Due</th></tr></thead><tbody>
      ${m.phase1.map((p) => `<tr><td>${esc(p.ref)}<br><small>${esc(p.rating)}</small></td><td>${esc(p.what)}</td><td>${esc(p.owner || 'To assign')}</td><td class="nowrap">${p.due ? fmtDate(p.due) : 'To agree'}</td></tr>`).join('')}</tbody></table>` : '<p>No High or Critical findings are open.</p>'}
    <h3>30-90 days: fix the recurring themes in our tools</h3>${m.phase2.length ? `<ul>${m.phase2.map((p) => `<li>${esc(p.what)} <span class="hint">- ${esc(p.why)}</span></li>`).join('')}</ul>` : '<p class="hint">No recurring themes yet.</p>'}
    <h3>90-180 days: make it how we work</h3>${li([...BRIEF_GOVERNANCE(m), ...m.extra])}
    ${H('The risk of doing nothing')}
    <table class="table print-table brief-table"><tbody>${BRIEF_INACTION.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
    ${d.closingNote ? `<div class="brief-ask">${nl2br(d.closingNote)}</div>` : ''}
    ${H('Method and limitations')}
    <p>One-to-one interviews with ${esc(m.subjects)} using a structured questionnaire${m.method.range}${m.method.depths ? ` (${esc(m.method.depths)})` : ''}. Answers were compared across ${esc(m.subjects)} and against documented processes and evidence. Findings are indicative until their evidence is verified; ${m.method.evOutstanding} evidence request(s) are still outstanding. Individual ${esc(m.subjects)} are ${d.showNames ? 'named' : 'not named'} in this briefing. Regulatory references summarise PRA material as understood at the date of this report; they are not legal advice.</p>
    <h2>Appendix: interviews covered</h2>
    ${m.appendix.length ? `<table class="table print-table"><thead><tr><th>Ref</th>${d.showNames ? '<th>Interviewee</th>' : ''}<th>Role</th><th>Team</th><th>Date</th><th>Status</th></tr></thead><tbody>
      ${m.appendix.map((a) => `<tr><td>${esc(a.ref)}${a.demo ? ' <span class="demo-tag">DEMO</span>' : ''}</td>${d.showNames ? `<td>${esc(a.name || '')}</td>` : ''}<td>${esc(a.role || '')}</td><td>${esc(a.team || '')}</td><td class="nowrap">${a.date ? fmtDate(a.date) : ''}</td><td>${esc(a.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">None.</p>'}
  </section>`;
}

// ---------- editor (Reports -> briefing) ----------
let briefSaveTimer = null;
function renderBriefing(container, ivs, fs, flt) {
  const saved = state.briefingDoc || { data: {}, version: 0 };
  const doc = { ...BRIEFING_DEFAULTS(), ...saved.data };
  const ro = !canEdit();
  const field = (k, label, type = 'text', rows = 3, hint = '') => `<label>${esc(label)}${type === 'area'
    ? `<textarea data-brief="${k}" rows="${rows}" ${ro ? 'disabled' : ''}>${esc(doc[k])}</textarea>`
    : `<input type="${type}" data-brief="${k}" value="${esc(doc[k])}" ${ro ? 'disabled' : ''}>`}${hint ? `<span class="hint">${esc(hint)}</span>` : ''}</label>`;
  container.innerHTML = `<div class="brief-layout">
    <form class="card brief-form">
      <h2>Briefing wording</h2>
      <p class="hint">The report is built from the interviews and findings (using the filters above). Edit the wording that needs your judgement - it is saved for everyone. <span id="briefStatus"></span></p>
      ${field('org', 'Organisation')}${field('audience', 'Audience', 'text', 3, 'For example Chief Technology Officer, Chief Risk Officer, Board Risk Committee.')}${field('audienceShort', 'Audience - short form', 'text', 3, 'Used in the tab and file names, e.g. CTO, CRO, BRC.')}
      ${field('title', 'Title')}${field('subtitle', 'Subtitle')}${field('preparedBy', 'Prepared by')}${field('date', 'Date', 'date')}
      ${field('decision', 'Decision requested', 'area', 6, 'Lead with the ask. Keep it to what you need the audience to agree.')}
      ${field('keyMessages', 'Key messages (optional)', 'area', 5, 'Leave blank to use the messages generated from the data; one message per line to write your own.')}
      ${field('additionalActions', 'Additional actions for the plan (optional)', 'area', 3, 'One per line - added to the 90-180 day phase.')}
      ${field('closingNote', 'Closing note (optional)', 'area', 3)}
      <label class="check"><input type="checkbox" data-brief="showNames"${doc.showNames ? ' checked' : ''} ${ro ? 'disabled' : ''}> Name individual interviewees in the appendix</label>
      <label class="check"><input type="checkbox" data-brief="showServices"${doc.showServices !== false ? ' checked' : ''} ${ro ? 'disabled' : ''}> Include the important business services section${(state.services || []).length ? '' : ' <span class="hint">(the register is empty)</span>'}</label>
      <label class="check"><input type="checkbox" data-brief="includeDemo"${doc.includeDemo ? ' checked' : ''} ${ro ? 'disabled' : ''}> Include demo data</label>
      ${!doc.keyMessages ? '' : '<button type="button" class="btn btn-small btn-ghost" id="briefAutoKm">Use generated key messages instead</button>'}
    </form>
    <div class="brief-preview-wrap"><p class="hint">Preview</p><article class="doc" id="briefPreview"></article></div>
  </div>`;
  const preview = () => { $('#briefPreview').innerHTML = briefingHtml(briefingModel(ivs, fs, flt, doc)); };
  const save = () => {
    clearTimeout(briefSaveTimer);
    $('#briefStatus').textContent = 'Unsaved changes…';
    briefSaveTimer = setTimeout(async () => {
      try {
        const r = await api('PUT', '/api/docs/briefing', { version: state.briefingDoc.version, data: doc });
        state.briefingDoc = { data: { ...doc }, version: r.version };
        const st = $('#briefStatus'); if (st) st.textContent = `Saved ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.`;
      } catch (e) { const st = $('#briefStatus'); if (st) st.textContent = 'Not saved: ' + e.message; fail(e); }
    }, 900);
  };
  $$('[data-brief]', container).forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
    doc[el.dataset.brief] = el.type === 'checkbox' ? el.checked : el.value; preview(); save();
  }));
  const ak = $('#briefAutoKm'); if (ak) ak.onclick = () => { doc.keyMessages = ''; $('[data-brief=keyMessages]').value = ''; preview(); save(); ak.remove(); };
  preview();
}

async function loadBriefingInputs() {
  const [ivs, fs, doc] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings'), api('GET', '/api/docs/briefing'), loadServices()]);
  state.briefingDoc = doc;
  return { ivs, fs, doc: { ...BRIEFING_DEFAULTS(), ...doc.data } };
}

// ---------- Word ----------
async function wordBriefing() {
  const { ivs, fs, doc } = await loadBriefingInputs();
  const m = briefingModel(ivs, fs, lastReportFilters, doc);
  const d = m.doc;
  const bl = (arr) => arr.map((x) => D.bullet(x)).join('');
  let n = 0; const H1 = (t) => D.h(1, `${++n}. ${t}`);
  const body = [
    D.p(`${d.org || 'The bank'} · CONFIDENTIAL · for the ${d.audience || briefingShort(d)}`, { style: 'Subtle' }),
    D.p(d.title || '', { style: 'Title' }),
    d.subtitle ? D.p(d.subtitle, { run: { italic: true, color: '404040' } }) : '',
    D.p(`Prepared by ${d.preparedBy || ''} · ${d.date ? fmtDate(d.date) : ''}`, { style: 'Subtle' }),
    m.method.demo ? D.p('This briefing includes demonstration data. Exclude it before sharing.', { run: { bold: true, color: 'C0302F' } }) : '',
    H1('Decision requested'), D.table([[{ content: d.decision, fill: 'E6EEF8' }]], { widths: [1] }),
    H1('Key messages'), bl(m.keyMessages),
    D.table([m.figures.slice(0, 4), m.figures.slice(4)].map((row) => row.map(([l, v]) => ({ content: [`${l}: `, { text: String(v), bold: true }] }))), { widths: [1, 1, 1, 1] }),
    H1('Why this matters: the PRA'),
    D.p('The Prudential Regulation Authority is our prudential regulator. Its rules apply to the bank directly - and to software development because that is where our systems, and the controls over them, are built and changed.'),
    D.table([['PRA requirement', 'What it means for software development'], ...m.why.map((p) => [[{ text: p.area, bold: true }, { text: `\n${p.source}`, size: 8, color: '595959' }], p.means])], { header: true, widths: [1.1, 3] }),
    H1('What we found'),
    m.th.top.length ? D.h(2, 'Most widespread issues') + m.th.top.slice(0, 6).map((t, i) => D.bullet([{ text: `${t.label} `, bold: true }, `(${t.kind}, ${t.n} interviews) - ${t.detail}`], i + 1)).join('') : D.p('No issue yet appears in two or more interviews.'),
    m.th.areas.length ? D.h(2, 'Regulatory areas affected (open findings)') + D.table([['Area', 'Regulator', 'Open findings', 'Interviews', 'Worst'], ...m.th.areas.map((a) => [a.area, a.regulator, String(a.open), String(a.interviews), ratingCell(a.worst)])], { header: true, widths: [2, 0.9, 1, 1, 1] }) : '',
    m.open.length ? D.h(2, 'Top risks') + D.table([['Ref', 'Finding', 'Rating', 'Owner', 'Target'], ...m.open.slice(0, 8).map((x) => [x.f.ref, x.f.title, ratingCell(x.effR), x.f.controlOwner || '', x.f.targetDate ? fmtDate(x.f.targetDate) : ''])], { header: true, widths: [0.9, 3.2, 0.9, 1.4, 1] }) : '',
    m.services.show ? H1('Important business services') + D.p(briefSvcIntro) + D.table([['Service', 'Impact tolerance', 'Last test', 'Open findings', 'Interviewed', 'Main gaps'],
      ...m.services.models.map((x) => [[{ text: x.svc.name, bold: true }, ...(x.ibs ? [] : [{ text: '\nCandidate - under review', size: 8, color: '595959' }]), ...(x.svc.demo ? [{ text: ' (DEMO)', color: 'C0302F' }] : [])],
        x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not set'),
        `${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + '\n' : ''}${x.svc.scenarioResult || 'Not tested'}`,
        `${x.open.length}${x.hc.length ? `\n${x.hc.length} high/critical` : ''}`,
        x.coverage.filter((c) => c.ivs.length).map((c) => qnShort(c.q)).join(', ') || 'None yet',
        { content: [{ text: briefSvcGaps(x).join('\n') || 'None found', size: 8 }] }])], { header: true, widths: [1.3, 1.4, 0.9, 0.8, 1, 1.7] })
      + (m.services.uncoveredSystems ? D.p(`${m.services.uncoveredSystems} system${m.services.uncoveredSystems === 1 ? '' : 's'} mapped to important business services ${m.services.uncoveredSystems === 1 ? 'has' : 'have'} not yet been covered by any interview.`, { style: 'Subtle' }) : '') : '',
    H1('What good looks like'),
    m.good.length ? D.table([['Issue found', 'What good looks like', 'PRA requirement it meets'], ...m.good.map((g) => [g.issue, g.good, { content: [{ text: g.pra, size: 8 }] }])], { header: true, widths: [1.3, 1.8, 1.5] }) : D.p('Record findings and section ratings to populate this.'),
    H1('What we are not proposing'), bl(BRIEF_NOT(m)),
    H1('Proposed plan'),
    D.h(2, '0-30 days: fix the urgent'),
    m.phase1.length ? D.table([['Ref', 'Action', 'Owner', 'Due'], ...m.phase1.map((p) => [`${p.ref}\n${p.rating}`, p.what, p.owner || 'To assign', p.due ? fmtDate(p.due) : 'To agree'])], { header: true, widths: [0.9, 3, 1.3, 0.9] }) : D.p('No High or Critical findings are open.'),
    D.h(2, '30-90 days: fix the recurring themes in our tools'), m.phase2.length ? m.phase2.map((p) => D.bullet([p.what, { text: ` - ${p.why}`, color: '595959' }])).join('') : D.p('No recurring themes yet.'),
    D.h(2, '90-180 days: make it how we work'), bl([...BRIEF_GOVERNANCE(m), ...m.extra]),
    H1('The risk of doing nothing'),
    D.table(BRIEF_INACTION.map(([k, v]) => [{ content: k, bold: true, fill: 'F2F4F7' }, v]), { widths: [1, 3.4] }),
    d.closingNote ? D.table([[{ content: d.closingNote, fill: 'E6EEF8' }]], { widths: [1] }) : '',
    H1('Method and limitations'),
    D.p(`One-to-one interviews with ${m.subjects} using a structured questionnaire${m.method.range}${m.method.depths ? ` (${m.method.depths})` : ''}. Answers were compared across ${m.subjects} and against documented processes and evidence. Findings are indicative until their evidence is verified; ${m.method.evOutstanding} evidence request(s) are still outstanding. Individual ${m.subjects} are ${d.showNames ? 'named' : 'not named'} in this briefing. Regulatory references summarise PRA material as understood at the date of this report; they are not legal advice.`),
    D.h(1, 'Appendix: interviews covered'),
    m.appendix.length ? D.table([['Ref', ...(d.showNames ? ['Interviewee'] : []), 'Role', 'Team', 'Date', 'Status'], ...m.appendix.map((a) => [a.ref + (a.demo ? ' (DEMO)' : ''), ...(d.showNames ? [a.name || ''] : []), a.role || '', a.team || '', a.date ? fmtDate(a.date) : '', a.status])], { header: true, widths: d.showNames ? [1, 1.3, 1.3, 1.3, 0.9, 0.9] : [1, 1.5, 1.5, 0.9, 0.9] }) : D.p('None.'),
  ].join('');
  saveDocx(D.build({ title: `${briefingTitle(d)} - ${d.title || ''}`, author: state.user.fullName, footer: `${briefingTitle(d)} · ${wordFooter()}` }, body), `${briefingTitle(d).replace(/[\\/:*?"<>|]/g, '-')} ${today()}.docx`);
}
