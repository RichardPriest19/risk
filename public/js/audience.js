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
  finance: { label: 'Chief Financial Officer', tab: 'Chief Financial Officer', defaults: { title: 'Technology risk: accounts and finance report' } },
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
  Object.values(groups).forEach((g) => { g.impact = (P.impacts[g.raw] || P.impacts.Other)[0]; });
  const concerns = Object.values(groups).sort((a, b) => b.worst - a.worst || b.teams.size - a.teams.size || b.items.length - a.items.length);
  const coveredCats = new Set(concerns.map((g) => plainCat(g.raw)));
  Object.entries(cat).filter(([name, c]) => c.weak >= 2 && !coveredCats.has(name)).forEach(([name, c]) =>
    concerns.push({ key: 'weak:' + name, title: `${name}: controls rated weak`, why: `Rated weak in ${c.weak} of ${c.n} assessments of this area, although no specific issue has yet been recorded.`, items: [], teams: new Set(), depts: new Set(), worst: 2, impact: (P.impacts[c.raw] || P.impacts.Other)[0] }));
  const sevWord = (w) => ({ 4: 'Critical', 3: 'High', 2: 'Medium', 1: 'Low' }[w] || 'Not yet rated');
  // Good points.
  const depts = [...new Set(ivs.map(plainDeptOf))];
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))];
  const teamsClear = teams.filter((t) => !serious.some((x) => ivs.find((i) => i.id === x.f.interviewId)?.data.header?.team === t));
  // Each strength says why it is good for the bank.
  const good = [
    ...Object.entries(cat).filter(([, c]) => c.n >= 2 && c.good / c.n >= 0.6).sort((a, b) => b[1].good - a[1].good).slice(0, 4)
      .map(([name, c]) => ({ text: `${name}: controls rated effective in ${c.good} of ${c.n} assessments of this area.`, why: (P.impacts[c.raw] || P.impacts.Other)[1] })),
    resolved90.length ? { text: `${plural(resolved90.length, 'issue')} resolved in the last three months, each with the fix checked before closing.`, why: 'This shows the bank is reducing risk, not just finding it - which is what regulators and auditors look for.' } : null,
    evN.checked ? { text: `${plural(evN.checked, 'piece')} of evidence ${evN.checked === 1 ? 'has' : 'have'} been seen and checked.`, why: 'Checked evidence is what auditors and regulators rely on: it proves these controls work, rather than simply claiming that they do.' } : null,
    teams.length && teamsClear.length ? { text: `${teamsClear.length} of ${plural(teams.length, 'team')} interviewed ${teamsClear.length === 1 ? 'has' : 'have'} no serious open issues.`, why: 'Those areas present a lower risk of serious disruption, loss or regulatory concern.' } : null,
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
  const model = { doc, th, ivs, fs, open, serious, overdue, unplanned, resolved90, raised90, evN, evByDept, cat, concerns, sevWord, good, depts, teams, overall, tone, overallText, svcs, recovery, trend, accepted, breach, obligations, range,
    demo: doc.includeDemo && (ivsAll.some((i) => i.data.demo) || fsAll.some((f) => f.demo)) };
  model.interp = interpretRows(model, false);
  model.interpTech = interpretRows(model, true);
  return model;
}
const audPeriod = (m) => m.doc.period || (lastReportFilters.from || lastReportFilters.to ? `${lastReportFilters.from ? fmtDate(lastReportFilters.from) : 'start'} to ${lastReportFilters.to ? fmtDate(lastReportFilters.to) : 'date'}` : `Position at ${fmtDate(m.doc.date || today())}`);
const progressWord = (x) => (x.f.status === 'Risk accepted' ? 'Risk accepted' : isOverdue(x.f) ? 'Overdue' : !x.f.targetDate ? 'No target date yet' : x.f.status === 'In remediation' ? 'Being fixed' : 'Not started');
const svcHealthWord = (x) => ({ bad: 'Needs attention', warn: 'Gaps to address', good: 'No issues found' }[x.tone]);

// ---------- interpretation: why each result is good or a concern, and what it means ----------
// Every row: { label, value, tone: 'good' | 'concern' | 'watch', why, effect }. "effect" is what a concern could lead to,
// or why a good result helps the business. tech = wording for the CTO; otherwise plain English for the board.
const TONE_WORD = { good: 'Good', concern: 'Concern', watch: 'Keep an eye on' };
const TONE_CLASS = { good: 'good', concern: 'bad', watch: 'warn' };
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
function interpretRows(m, tech) {
  const rows = [];
  const add = (label, value, tone, why, effect) => rows.push({ label, value: String(value), tone, why, effect });
  // Nothing reviewed yet: no result can be called good or bad.
  if (!m.ivs.length && !m.fs.length) {
    add(tech ? 'Results' : 'Results', 'None yet', 'watch', tech ? 'No interviews or findings are in scope.' : 'No interviews are included in this report yet.',
      tech ? 'No assessment is possible; absence of findings is not evidence of effective control.' : 'There is nothing yet to assess. Having no issues recorded does not mean controls are working - it means they have not yet been reviewed.');
    return rows;
  }
  const S = m.serious.length, O = m.open.length, e = m.evN;
  if (S) add(tech ? 'Open High/Critical findings' : 'Serious issues open', S, 'concern',
    tech ? `${plural(S, 'finding')} rated High or Critical (residual where assessed) remain open.` : `${plural(S, 'serious weakness', 'serious weaknesses')} ${S === 1 ? 'is' : 'are'} known and not yet fixed.`,
    tech ? 'Each is a credible path to a material incident: outage of an important business service, data compromise or financial loss. Known, unremediated High/Critical gaps weigh heavily in PRA supervisory judgement and in any s166 review, and undermine the "reasonable steps" position of the accountable SMF.'
      : 'Each is a realistic route to a serious incident: customers unable to use services, data exposed or money lost. Our regulators expect known serious weaknesses to be fixed promptly. If one led to an incident, the fact that it was already known would count against the bank and against the senior managers accountable for it.');
  else add(tech ? 'Open High/Critical findings' : 'Serious issues open', 0, 'good',
    tech ? 'No High or Critical findings are open in the scope reviewed.' : 'No serious weaknesses are known in the areas reviewed.',
    tech ? 'Lower probability of a material incident in scope, and supports the firm\'s position with the PRA that technology risk is managed within appetite.' : 'This lowers the chance of a major incident and supports the bank\'s position with its regulators that technology risk is under control.');
  if (m.overdue.length) add(tech ? 'Overdue remediation' : 'Actions overdue', m.overdue.length, 'concern',
    tech ? `${plural(m.overdue.length, 'finding')} past target date.` : `${plural(m.overdue.length, 'agreed fix', 'agreed fixes')} ${m.overdue.length === 1 ? 'has' : 'have'} missed ${m.overdue.length === 1 ? 'its' : 'their'} deadline.`,
    tech ? 'Exposure persists beyond the period the firm accepted. Slipping remediation is a recurring theme in PRA and internal audit findings and is read as weak governance and capacity planning.'
      : 'The risk stays open for longer than the bank accepted. Missed deadlines are a common sign of weak control to auditors and regulators, and can call into question whether senior managers are taking reasonable steps.');
  else if (O) add(tech ? 'Overdue remediation' : 'Actions overdue', 0, 'good', tech ? 'All open remediation is within target date.' : 'Agreed fixes are on schedule.',
    tech ? 'Demonstrates delivery against commitments, which builds supervisory and audit confidence.' : 'This shows the bank does what it says it will, which builds confidence with auditors and regulators.');
  const actionable = m.open.filter((x) => x.f.status !== 'Risk accepted').length;
  if (m.unplanned.length) add(tech ? 'Findings without owner or target date' : 'Issues without an owner or a date', m.unplanned.length, 'concern',
    tech ? 'Remediation is not yet assigned or scheduled.' : 'No one is yet accountable for these, or no deadline has been agreed.',
    tech ? 'Unowned findings rarely close; SM&CR accountability cannot be evidenced for them.' : 'Issues without an owner or a date tend not to get fixed, and the board cannot hold anyone to account for them.');
  else if (actionable) add(tech ? 'Findings without owner or target date' : 'Issues without an owner or a date', 0, 'good',
    tech ? 'Every open finding has an owner and a target date.' : 'Every open issue has a named owner and a target date.',
    tech ? 'Clear accountability supports SM&CR evidence and makes delivery trackable.' : 'Clear accountability makes fixes more likely and lets the board track progress.');
  const rate = pctOf(e.checked, e.asked);
  if (!e.asked) add(tech ? 'Evidence verified' : 'Controls proven by evidence', 'None requested yet', 'watch',
    tech ? 'No evidence has yet been requested.' : 'No evidence has been asked for yet.',
    tech ? 'Results rest on interview statements only; operating effectiveness is unverified.' : 'The results rely on what people told us. Until evidence is checked they are not proof that controls work.');
  else if (rate >= 75) add(tech ? 'Evidence verified' : 'Controls proven by evidence', `${e.checked} of ${e.asked} (${rate}%)`, 'good',
    tech ? 'Most evidence requested has been verified.' : 'Most of the controls we looked at have been proven by checked evidence.',
    tech ? 'Operating effectiveness is demonstrable to internal audit and the PRA - the standard supervisors apply.' : 'The bank can prove, not just claim, that these controls work, which is what auditors and regulators require.');
  else add(tech ? 'Evidence verified' : 'Controls proven by evidence', `${e.checked} of ${e.asked} (${rate}%)`, rate < 40 ? 'concern' : 'watch',
    tech ? `Only ${rate}% of requested evidence has been verified.` : rate < 40 ? 'Few of the controls we looked at have been proven by evidence.' : 'Some controls have been proven by evidence, but many have not yet.',
    tech ? 'Unverified controls cannot be relied on; the true position may be worse than reported, and the firm could not currently evidence these controls on request.'
      : 'Controls that have not been proven may not work as described, so the real position could be worse than this report shows, and the bank could not yet demonstrate them to a regulator.');
  if (e.missing) add(tech ? 'Evidence not available' : 'Evidence that does not exist', e.missing, 'concern',
    tech ? `${plural(e.missing, 'item')} of expected evidence do not exist.` : 'Records that should exist to show a control works do not exist.',
    tech ? 'Either the control is not operating or it leaves no audit trail; in supervisory terms, undocumented is treated as not done.' : 'Either the control is not happening, or it leaves no record. In both cases the bank cannot show it works, and regulators treat that as if it were not done.');
  if (m.resolved90.length) add(tech ? 'Findings closed (last 3 months)' : 'Issues resolved in the last three months', m.resolved90.length, 'good',
    tech ? 'Findings have been closed with verified closure evidence.' : 'Problems are being fixed, and each fix has been checked.',
    tech ? 'Demonstrates risk reduction rather than accumulation, with closure evidence that will stand up to audit.' : 'This shows the programme is reducing risk, not just finding it, and the checked fixes will stand up to an auditor.');
  else if (O) add(tech ? 'Findings closed (last 3 months)' : 'Issues resolved in the last three months', 0, 'concern',
    tech ? 'No findings closed in the last three months.' : 'No issues have been resolved in the last three months.',
    tech ? 'Exposure is accumulating; without throughput the same gaps will recur in the next report and in supervisory dialogue.' : 'Risk is building up rather than reducing. Without progress, the same weaknesses will be reported again.');
  const tr = m.trend.find((t) => t.l === 'Serious open issues');
  if (tr && (tr.now || tr.then)) {
    if (tr.dir === 'Worse') add(tech ? 'High/Critical trend (3 months)' : 'Serious issues compared with three months ago', `${tr.then} → ${tr.now}`, 'concern',
      tech ? 'High/Critical exposure has increased.' : 'There are more serious issues now than three months ago.',
      tech ? 'Partly a detection effect as coverage grows, but remediation capacity is not keeping pace; requires prioritisation and resourcing decisions.' : 'Some of this is because more is being found, which is useful, but fixing is not keeping pace. It needs priority and resources.');
    else if (tr.dir === 'Better') add(tech ? 'High/Critical trend (3 months)' : 'Serious issues compared with three months ago', `${tr.then} → ${tr.now}`, 'good',
      tech ? 'High/Critical exposure has reduced.' : 'There are fewer serious issues than three months ago.',
      tech ? 'Evidence that remediation is effective.' : 'Risk is reducing, which shows the work is having an effect.');
    else add(tech ? 'High/Critical trend (3 months)' : 'Serious issues compared with three months ago', `${tr.then} → ${tr.now}`, 'watch',
      tech ? 'No net change in High/Critical exposure.' : 'No change in the number of serious issues.',
      tech ? 'Closures are only offsetting new findings; exposure is not falling.' : 'Fixes are only keeping pace with new problems; the overall risk is not yet falling.');
  }
  if (m.svcs.length) {
    const ibs = m.svcs.filter((x) => x.ibs), notProven = ibs.filter((x) => m.recovery(x.svc) !== 'Yes');
    if (!ibs.length) add(tech ? 'Important business services' : 'Important services', 'None confirmed', 'watch', tech ? 'Only candidate services are recorded.' : 'Only candidate services are recorded so far.', tech ? 'SS1/21 mapping and testing cannot yet be assessed.' : 'The board cannot yet see which important services are at risk.');
    else if (notProven.length) add(tech ? 'IBS recovery within tolerance demonstrated' : 'Important services proven to recover in time', `${ibs.length - notProven.length} of ${ibs.length}`, 'concern',
      tech ? `${plural(notProven.length, 'important business service')} not shown, by a test in the last 12 months, to remain within impact tolerance.` : `${plural(notProven.length, 'important service')} ${notProven.length === 1 ? 'has' : 'have'} not been shown to recover within ${notProven.length === 1 ? 'its' : 'their'} agreed limit of disruption.`,
      tech ? 'A core requirement of the PRA Operational Resilience Part and SS1/21. Untested or breached tolerances expose the firm to supervisory action and, in an outage, to customer harm, redress and Consumer Duty consequences.'
        : 'If one were disrupted, customers might be unable to pay, withdraw money or open accounts for longer than the bank has agreed is tolerable. Our regulators require this to be proven by testing; an outage would bring customer harm, compensation and damage to the bank\'s reputation.');
    else add(tech ? 'IBS recovery within tolerance demonstrated' : 'Important services proven to recover in time', `${ibs.length} of ${ibs.length}`, 'good',
      tech ? 'All important business services have been tested within tolerance in the last 12 months.' : 'All important services have been shown, by recent testing, to recover within their agreed limits.',
      tech ? 'Meets a central SS1/21 requirement and evidences resilience to the PRA.' : 'This is a central regulatory requirement, and it protects customers when things go wrong.');
  } else add(tech ? 'Important business services' : 'Important services', 'Not recorded', 'watch', tech ? 'The register is empty.' : 'No important services are in the register yet.', tech ? 'Findings cannot be related to SS1/21 services and tolerances.' : 'The board cannot yet see which important services are at risk.');
  const expired = m.accepted.filter((x) => x.state === 'Expired' || x.state === 'No expiry date').length;
  if (expired) add(tech ? 'Risk acceptances expired or open-ended' : 'Accepted risks past their expiry', expired, 'concern',
    tech ? 'Risk acceptances have lapsed or have no expiry.' : 'Risks the bank formally accepted have passed their review date, or have none.',
    tech ? 'The firm is carrying unapproved residual risk; undermines the risk acceptance framework.' : 'The bank is carrying risks no one has re-approved, which undermines how it decides what risk it is willing to take.');
  if (tech) {
    const th = m.th, st = th.st;
    const contra = th.teams.reduce((a, t) => a + (t.contradictions || 0), 0);
    const pairs = th.teams.filter((t) => t.interviews >= 2).length;
    if (contra) add('Contradictory answers within teams', contra, 'concern', 'Interviewees on the same team gave opposite Yes/No answers about the same control.', 'At least one account is wrong: controls are not consistently understood or applied, so documented controls may not be operating as described.');
    else if (pairs) add('Contradictory answers within teams', 0, 'good', 'Answers are consistent within teams.', 'Indicates controls are commonly understood, which increases confidence in what was reported.');
    if (st.qaTot.answered) {
      const u = pctOf(st.qaTot.unknown, st.qaTot.answered);
      add('"Don\'t know" rate', `${u}%`, u > 15 ? 'concern' : u >= 5 ? 'watch' : 'good', u > 15 ? 'A high share of answers were "Don\'t know".' : u >= 5 ? 'Some answers were "Don\'t know".' : 'Interviewees could answer almost all questions.',
        u > 15 ? 'Knowledge gaps about controls in one\'s own area indicate weak ownership and training; controls nobody knows about are unlikely to be operated reliably.' : u >= 5 ? 'Target training and documentation where the gaps cluster.' : 'Good awareness of controls supports their consistent operation.');
    }
    const rec = th.recurring.filter((g) => g.n >= 2 && g.open);
    if (rec.length) add('Recurring findings (2+ interviews)', rec.length, 'concern', 'The same weakness appears in several interviews.', 'Systemic rather than local: fix once at platform, standard or tooling level instead of team by team.');
    const unc = m.svcs.reduce((a, x) => a + (x.linked.length ? x.uncovered.length : 0), 0);
    if (unc) add('Mapped IBS systems not yet interviewed', unc, 'watch', 'Systems mapped to important business services have not been covered by any interview.', 'Coverage gap: control effectiveness for these systems is unknown, which limits the SS1/21 view.');
  }
  const covered = m.depts.length, total = T.questionnaires.length;
  if (m.ivs.length < 3 || covered < 3) add(tech ? 'Coverage' : 'How much of the bank is covered', `${plural(m.ivs.length, 'interview')}, ${covered} of ${total} areas`, 'watch',
    tech ? 'Coverage is still narrow.' : 'Only a small part of the bank has been reviewed so far.',
    tech ? 'Results are indicative; unreviewed areas may hold further findings.' : 'The results may not represent the whole bank; areas not yet reviewed could hold further issues.');
  else add(tech ? 'Coverage' : 'How much of the bank is covered', `${plural(m.ivs.length, 'interview')}, ${covered} of ${total} areas`, 'good',
    tech ? 'Coverage spans several functions.' : 'The results draw on a broad range of people and areas.',
    tech ? 'Cross-functional coverage allows systemic issues to be distinguished from local ones.' : 'A broad base makes the results a fair picture of the bank.');
  return rows;
}
// How far the results can be relied on.
function reliability(m) {
  const rate = pctOf(m.evN.checked, m.evN.asked);
  const level = m.ivs.length >= 10 && m.depts.length >= 4 && rate >= 50 ? 'High' : m.ivs.length >= 4 && m.depts.length >= 2 ? 'Moderate' : 'Limited';
  return { level, rate };
}
const AUD_PURPOSE = {
  board: [
    ['Purpose', 'To give the board an independent, evidence-based view of how well the bank controls the risks in how its technology is built, run, protected and supported, including by the people and suppliers it depends on.'],
    ['Why the board needs it', 'The board is responsible for how the bank manages risk. Our main regulator, the Prudential Regulation Authority, expects boards to understand and oversee technology and operational risk, and to be able to show that they have done so. The Financial Conduct Authority expects the same wherever customers could be harmed.'],
    ['How the results were obtained', 'Through structured interviews with the people who do the work. What they told us was compared with written procedures, with what our systems actually enforce, and with evidence that controls really operate - rather than relying on self-assessment or assurance alone.'],
    ['Why the results should be noted', 'Formally noting this report records that the board has been told about these risks and what is being done about them. If a serious incident happens, our regulators will ask what the board knew and how it responded, and the senior managers accountable for these areas are personally answerable for having taken reasonable steps.'],
    ['What the board is asked to do', 'Note the results and what they mean; agree the decisions and support requested at the end of this report; and ask for progress to be reported at the next meeting.'],
  ],
  technology: [
    ['Purpose', 'An evidence-based assessment of control design and operating effectiveness across software development, technology operations, information security and the business functions technology depends on - to prioritise remediation and investment.'],
    ['Regulatory basis', 'PRA Fundamental Rules 5 (effective risk strategies and risk management systems) and 6 (organise and control affairs responsibly and effectively); the PRA Operational Resilience Part and SS1/21 (important business services, impact tolerances, mapping and scenario testing); SS2/21 (outsourcing and third-party risk, including cloud); SM&CR - the SMF holding the Prescribed Responsibility for operational resilience and technology (commonly SMF24) must be able to evidence reasonable steps; Fundamental Rule 7 (open dealing with the PRA).'],
    ['Method', 'Structured interviews with a four-way comparison for each control area: what interviewees say, what is documented, what the technology enforces, and what evidence shows actually occurred. Findings are rated likelihood × impact; ratings shown are residual where assessed, otherwise inherent.'],
    ['Why it should be noted', 'Once a control gap is recorded, the firm is on notice. Failure to remediate known gaps weighs heavily in supervisory judgement, in any FSMA s166 skilled person review and in enforcement (the PRA and FCA fined TSB £48.65m in 2022 over IT change governance). The findings are also the evidence base for engineering prioritisation and budget.'],
    ['Action requested', 'Review the High/Critical findings and their implications; confirm owners and target dates; sponsor platform-level fixes for recurring findings; and track the indicators below to the next report.'],
  ],
};
function audPurposeHtml(kind) {
  return `<dl class="aud-purpose">${AUD_PURPOSE[kind].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
}
function interpHtml(rows, tech) {
  return `<table class="table print-table aud-table aud-interp"><thead><tr><th>${tech ? 'Indicator' : 'Measure'}</th><th>Result</th><th>Assessment</th><th>Why</th><th>${tech ? 'Implication' : 'What this means for the bank'}</th></tr></thead><tbody>
    ${rows.map((r) => `<tr><td><strong>${esc(r.label)}</strong></td><td>${esc(r.value)}</td><td>${svcTone(TONE_CLASS[r.tone], TONE_WORD[r.tone])}</td><td>${esc(r.why)}</td><td>${esc(r.effect)}</td></tr>`).join('')}</tbody></table>`;
}
// Method, thresholds, confidence and limitations as [heading, text or list] - rendered on screen and in Word.
function reliabilityItems(m, tech) {
  const r = reliability(m);
  const conf = { High: tech ? 'High: broad coverage and most evidence verified.' : 'High: many interviews across most areas, with most evidence checked.',
    Moderate: tech ? 'Moderate: reasonable coverage, but material evidence remains unverified.' : 'Moderate: a reasonable number of interviews, but much of the evidence is not yet checked. Treat the results as a sound indication rather than proof.',
    Limited: tech ? 'Limited: early-stage coverage; treat results as indicative.' : 'Limited: based on only a few interviews or areas so far. Treat the results as early indications, not a complete picture.' }[r.level];
  const rules = tech
    ? ['Any open High/Critical finding is a concern.', 'Any overdue remediation is a concern.', 'Evidence verified: 75% or more is good; below 40% is a concern.', 'No findings closed in three months while findings are open is a concern.', 'Any important business service not shown within tolerance by a test in the last 12 months is a concern.', '"Don\'t know" above 15% of answers is a concern; 5-15% should be watched.', 'Any Yes/No contradiction within a team is a concern.']
    : ['Any serious issue still open is a concern.', 'Any agreed fix past its deadline is a concern.', 'Controls proven by evidence: three quarters or more is good; under two fifths is a concern.', 'No issues resolved in three months, while issues are open, is a concern.', 'Any important service not shown, by a test in the last year, to recover within its agreed limit is a concern.'];
  const evidence = m.evN.asked ? (tech ? ` ${r.rate}% of requested evidence verified.` : ` ${r.rate} in every hundred pieces of evidence asked for have been checked.`) : '';
  return [
    [tech ? 'Basis of the results' : 'How the results were produced', `${plural(m.ivs.length, 'structured interview')}${m.range ? ` held ${m.range}` : ''}, across ${m.depts.length} of ${T.questionnaires.length} areas (${m.depts.join(', ') || 'none yet'}) and ${plural(m.teams.length, 'team')}. ${tech ? 'Findings are rated likelihood × impact; "serious" means High or Critical. Findings close only with verified closure evidence.' : 'Each issue is rated critical, high, medium or low from how likely it is and how much harm it could do; "serious" means high or critical. An issue is only marked resolved when the fix has been checked.'}`],
    [tech ? 'Assessment thresholds' : 'How we judge good and concern', rules],
    [tech ? 'Confidence' : 'How far to rely on these results', conf + evidence],
    ['Limitations', tech ? 'Interview statements are indicative until evidence is verified; unreviewed areas may hold further findings; thresholds are programme conventions, not regulatory limits; regulatory references summarise our understanding and are not legal advice.'
      : 'Interviews show what people know and do; until evidence is checked, results are indications rather than proof. Areas not yet reviewed may hold further issues. The thresholds above are our own working rules, not regulatory limits. Statements about regulation summarise our understanding and are not legal advice.'],
  ];
}
function reliabilityHtml(m, tech) {
  return `<dl class="aud-purpose">${reliabilityItems(m, tech).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${Array.isArray(v) ? `<ul>${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(v)}</dd>`).join('')}</dl>`;
}

// For the CTO: what each serious finding could lead to, and what the regulator would expect.
function seriousImplications(m) {
  return m.serious.slice(0, 8).map((x) => {
    const t = templateById(x.f.templateId);
    return { x, risk: String(t?.description || x.f.description || '').slice(0, 400), consequence: plainFinding(x.f).why || (P.impacts[x.f.category] || P.impacts.Other)[0], impact: (P.impacts[x.f.category] || P.impacts.Other)[0],
      exposure: x.f.ukRelevance || t?.uk || findingUkAreas(x.f).join('; ') || 'Not recorded', control: t?.control || x.f.remediation || 'Not recorded' };
  });
}
function seriousImplHtml(m) {
  const list = seriousImplications(m);
  if (!list.length) return '<p>No High or Critical findings are open.</p>';
  return list.map(({ x, risk, consequence, impact, exposure, control }) => `<div class="aud-impl"><h3>${esc(x.f.ref)} · ${esc(x.f.title)} ${ratingChip(x.effR, x.eff)}</h3>
    <dl class="aud-purpose"><dt>Risk</dt><dd>${esc(risk)}</dd><dt>Potential consequence</dt><dd>${esc(consequence)}</dd>${impact !== consequence ? `<dt>Wider business impact</dt><dd>${esc(impact)}</dd>` : ''}<dt>Regulatory exposure</dt><dd>${esc(exposure)}</dd>
    <dt>Expected control</dt><dd>${esc(control)}</dd><dt>Status</dt><dd>${esc(x.f.status)} · owner ${esc(x.f.controlOwner || 'not assigned')} · target ${x.f.targetDate ? fmtDate(x.f.targetDate) : 'not set'}${isOverdue(x.f) ? ' (overdue)' : ''}</dd></dl></div>`).join('');
}
const servicesImplication = (m) => {
  const notProven = m.svcs.filter((x) => x.ibs && m.recovery(x.svc) !== 'Yes');
  return notProven.length ? `What this means: ${notProven.map((x) => x.svc.name).join(', ')} ${notProven.length === 1 ? 'has' : 'have'} not been shown to recover within the agreed limit. If disrupted, customers could be without ${notProven.length === 1 ? 'this service' : 'these services'} for longer than the bank has agreed is tolerable, and our regulators require recovery to be proven by testing.`
    : m.svcs.some((x) => x.ibs) ? 'What this means: every important service has been shown, by recent testing, to recover within its agreed limit - a central regulatory requirement and a protection for customers.' : '';
};
const trendImplication = (m) => {
  const t = m.trend.find((x) => x.l === 'Serious open issues');
  if (!t || (!t.now && !t.then)) return 'There are no serious issues now or three months ago.';
  return t.dir === 'Worse' ? 'Serious issues have increased. Part of this is because the review is finding more, which is useful, but fixing is not keeping pace and needs priority and resources.'
    : t.dir === 'Better' ? 'Serious issues have fallen, which shows the work is reducing risk.' : 'The number of serious issues is unchanged: fixes are only keeping pace with new problems.';
};

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
const audGood = (m) => (m.good.length ? `<ul class="aud-goodlist">${m.good.map((g) => `<li><strong>${esc(g.text)}</strong><br><span class="aud-why">Why this is good: ${esc(g.why)}</span></li>`).join('')}</ul>` : '<p class="hint">It is too early to identify strengths: more interviews and evidence are needed.</p>');
function audServicesTable(m, withOwner) {
  if (!m.svcs.length) return '<p class="hint">No important business services are recorded in the register yet.</p>';
  return `<table class="table print-table aud-table"><thead><tr><th>Service</th><th>Agreed limit of disruption</th><th>Recovery within the limit proven?</th>${withOwner ? '<th>Accountable senior manager</th>' : ''}<th class="num">Serious issues</th><th>Overall</th></tr></thead><tbody>
    ${m.svcs.map((x) => `<tr><td><strong>${esc(x.svc.name)}</strong>${x.ibs ? '' : '<br><small>Under review - may become an important service</small>'}</td><td>${esc(x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not yet set'))}</td>
      <td>${esc(m.recovery(x.svc))}</td>${withOwner ? `<td>${esc(plainRole(x.svc.accountableSmf) || 'Not recorded')}</td>` : ''}<td class="num">${x.hc.length}</td><td>${svcTone(x.tone, svcHealthWord(x))}${x.flags.length ? `<br><small>${esc(plainService(briefSvcGaps(x)[0]))}</small>` : ''}</td></tr>`).join('')}</tbody></table>`;
}
function audConcerns(m, max = 6) {
  if (!m.concerns.length) return '<p>No open issues.</p>';
  return `<ol class="aud-concerns">${m.concerns.slice(0, max).map((g) => `<li><strong>${esc(g.title)}</strong> <span class="aud-sev aud-sev-${g.worst}">${esc(m.sevWord(g.worst))}</span>
    ${g.why ? `<br>${esc(g.why)}` : ''}${g.impact ? `<br><span class="aud-why">If not addressed: ${esc(g.impact)}</span>` : ''}${g.items.length ? `<br><small>${plural(g.items.length, 'open issue')}${g.depts.size ? ` · ${[...g.depts].join(', ')}` : ''}${g.teams.size > 1 ? ` · found in ${g.teams.size} teams` : ''}</small>` : ''}</li>`).join('')}</ol>
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
  let n = 0; const H = (t) => `<h2>${++n}. ${esc(t)}</h2>`;
  return `<section class="brief aud">${audHead(m, 'board')}
    ${H('Why this report has been produced')}${audPurposeHtml('board')}
    ${H('Summary')}${audOverall(m)}
    <div class="aud-figs">
      ${audFig('people interviewed', m.ivs.length, `${plural(m.depts.length, 'department')}, ${plural(m.teams.length, 'team')}`)}
      ${audFig('issues open', m.open.length)}
      ${audFig('serious issues open', m.serious.length, 'rated high or critical', m.serious.length ? 'bad' : 'good')}
      ${audFig('actions overdue', m.overdue.length, 'past their target date', m.overdue.length ? 'bad' : 'good')}
      ${audFig('issues resolved', m.resolved90.length, 'in the last three months', m.resolved90.length ? 'good' : '')}
      ${audFig('evidence checked', e.asked ? `${e.checked} of ${e.asked}` : '-', 'items proven to work')}
    </div>
    ${H('What the results mean')}<p>Each result below is assessed as good, a concern, or something to keep an eye on, with the reason and what it could mean for the bank.</p>${interpHtml(m.interp, false)}
    ${H('What is working well, and why it matters')}${audGood(m)}
    ${H('Main concerns, and what could happen if they are not addressed')}${audConcerns(m)}
    ${H('What is being done')}
    <p>${plural(m.open.length, 'issue')} ${m.open.length === 1 ? 'is' : 'are'} open. ${m.unplanned.length ? `${m.unplanned.length} still ${m.unplanned.length === 1 ? 'needs' : 'need'} an owner or a target date; ` : 'Every open issue has an owner and a target date; '}${m.overdue.length ? `${m.overdue.length} ${m.overdue.length === 1 ? 'is' : 'are'} overdue.` : 'none is overdue.'}</p>
    ${m.serious.length ? `<table class="table print-table aud-table"><thead><tr><th>Serious issue</th><th>Department</th><th>Target</th><th>Progress</th></tr></thead><tbody>
      ${m.serious.slice(0, 10).map((x) => { const iv = m.ivs.find((i) => i.id === x.f.interviewId); return `<tr><td>${esc(plainFinding(x.f).title)}</td><td>${esc(iv ? plainDeptOf(iv) : '')}</td><td class="nowrap">${esc(monthYear(x.f.targetDate) || 'Not set')}</td><td>${esc(progressWord(x))}</td></tr>`; }).join('')}</tbody></table>` : '<p>There are no serious open issues.</p>'}
    ${H('Our most important services')}
    <p>These are the services whose disruption would most harm customers or the bank. For each, the bank has agreed the most disruption it can tolerate and must show, by testing, that it can recover within that limit.</p>
    ${audServicesTable(m, false)}${servicesImplication(m) ? `<p class="aud-means">${esc(servicesImplication(m))}</p>` : ''}
    ${H('Is it getting better?')}${audTrend(m)}<p class="aud-means">${esc(trendImplication(m))}</p>
    ${H('How these results were produced, and how far to rely on them')}${reliabilityHtml(m, false)}
    ${H('Decisions and support needed')}${m.doc.decisions ? `<div class="brief-ask">${nl2br(m.doc.decisions)}</div>` : '<p class="hint">None requested in this report.</p>'}
    </section>`;
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
  let n = 0; const H = (t) => `<h2>${++n}. ${esc(t)}</h2>`;
  return `<section class="brief aud">${audHead(m, 'technology')}
    ${m.doc.message ? `<div class="brief-ask">${nl2br(m.doc.message)}</div>` : ''}
    ${H('Purpose and basis of this report')}${audPurposeHtml('technology')}
    ${H('Summary')}
    <div class="aud-figs">
      ${audFig('interviews', m.ivs.length, `${plural(m.teams.length, 'team')}`)}
      ${audFig('open findings', m.open.length, `${m.serious.length} High/Critical`, m.serious.length ? 'bad' : '')}
      ${audFig('overdue remediation', m.overdue.length, '', m.overdue.length ? 'bad' : 'good')}
      ${audFig('contradictions', contradictions, 'Yes vs No in the same team', contradictions ? 'bad' : '')}
      ${audFig('"Don\'t know" rate', unk, 'of quick answers')}
      ${audFig('evidence verified', m.evN.asked ? `${m.evN.checked} / ${m.evN.asked}` : '-', `${m.evN.missing} not available`)}
    </div>
    ${H('Interpretation of the indicators')}${interpHtml(m.interpTech, true)}
    ${H('Implications of the High/Critical findings')}${seriousImplHtml(m)}
    ${H('All open findings')}
    ${m.open.length ? `<table class="table print-table"><thead><tr><th>Ref</th><th>Finding</th><th>Category</th><th>Rating</th><th>Owner</th><th>Target</th><th>Status</th></tr></thead><tbody>
      ${m.open.map((x) => `<tr><td class="nowrap">${esc(x.f.ref)}</td><td>${esc(x.f.title)}</td><td>${esc(x.f.category || '')}</td><td class="nowrap">${ratingChip(x.effR, x.eff)}</td><td>${esc(x.f.controlOwner || '')}</td><td class="nowrap${isOverdue(x.f) ? ' overdue' : ''}">${x.f.targetDate ? fmtDate(x.f.targetDate) : ''}</td><td>${esc(x.f.status)}</td></tr>`).join('')}</tbody></table>` : '<p>No open findings.</p>'}
    ${H('Recurring issues across interviews')}
    ${th.recurring.filter((g) => g.n >= 2).length ? `<p class="aud-means">Recurring findings are systemic: they are best fixed once, at platform, standard or tooling level, rather than team by team.</p><table class="table print-table"><thead><tr><th>Issue (template)</th><th class="num">Interviews</th><th class="num">Open</th><th>Worst</th><th>Teams</th><th>Regulatory reference</th></tr></thead><tbody>
      ${th.recurring.filter((g) => g.n >= 2).map((g) => `<tr><td>${esc(g.label)}</td><td class="num">${g.n}</td><td class="num">${g.open}</td><td>${esc(g.worst || '-')}</td><td><small>${esc([...g.teams].join(', '))}</small></td><td><small>${esc(templateById(g.key)?.uk || '')}</small></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No finding yet recurs in two or more interviews.</p>'}
    ${H('What is working, and why it matters')}${audGood(m)}
    ${H('Control areas rated weak')}
    ${th.weak.length ? `<table class="table print-table"><thead><tr><th>Control area</th><th class="num">Rated weak</th><th class="num">Assessed</th><th class="num">Ineffective</th><th>If not addressed</th></tr></thead><tbody>
      ${th.weak.slice(0, 15).map((w) => `<tr><td>${esc(secLabel(w.s))}</td><td class="num">${w.weak}</td><td class="num">${w.rated}</td><td class="num">${w.ineffective}</td><td><small>${esc((P.impacts[T.sectionCategory[w.s.id]] || P.impacts.Other)[0])}</small></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No control area rated weak.</p>'}
    ${H('Red flags heard')}
    ${th.redFlags.length ? `<ul>${th.redFlags.slice(0, 12).map((x) => `<li>“${esc(x.rf.quote)}” - ${plural(x.n, 'interview')} <small class="hint">(${esc([...x.teams].join(', '))})</small><br><small>${esc(x.rf.risk)}</small></li>`).join('')}</ul>` : '<p class="hint">None recorded.</p>'}
    ${H('Consistency between interviewees')}
    <table class="table print-table"><thead><tr><th>Team</th><th class="num">Interviews</th><th class="num">Contradictions</th><th class="num">Knowledge gaps</th><th class="num">Evidence outstanding</th><th class="num">Open findings</th></tr></thead><tbody>
      ${th.teams.map((t) => `<tr><td>${esc(t.name)}</td><td class="num">${t.interviews}</td><td class="num">${t.contradictions ?? '-'}</td><td class="num">${t.gaps ?? '-'}</td><td class="num">${t.outstanding}${t.overdue ? ` (${t.overdue} overdue)` : ''}</td><td class="num">${t.open}</td></tr>`).join('')}</tbody></table>
    ${st.topQs.length ? `<h3>Questions most often answered with a concern or "Don't know"</h3><table class="table print-table"><thead><tr><th>Question</th><th>Area</th><th class="num">Asked</th><th class="num">Concern</th><th class="num">Don't know</th></tr></thead><tbody>
      ${st.topQs.slice(0, 10).map((x) => `<tr><td>${esc(x.q.q)}</td><td><small>${esc(secLabel(x.s))}</small></td><td class="num">${x.n}</td><td class="num">${x.concern}</td><td class="num">${x.unknown}</td></tr>`).join('')}</tbody></table>` : ''}
    ${H('Important business services')}
    ${m.svcs.length ? `<table class="table print-table"><thead><tr><th>Service</th><th>Impact tolerance</th><th>Last scenario test</th><th class="num">Open (H/C)</th><th>Coverage</th><th>Mapped systems not interviewed</th></tr></thead><tbody>
      ${m.svcs.map((x) => `<tr><td>${esc(x.svc.ref)} ${esc(x.svc.name)}</td><td>${esc(x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + 'h' : 'Not set'))}</td><td>${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + ' · ' : ''}${esc(x.svc.scenarioResult || 'Not tested')}</td><td class="num">${x.open.length} (${x.hc.length})</td><td><small>${x.coverage.map((c) => `${esc(qnShort(c.q))}: ${c.ivs.length}`).join(', ')}</small></td><td><small>${esc(x.uncovered.map((u) => u.name).join(', ') || '-')}</small></td></tr>`).join('')}</tbody></table>${servicesImplication(m) ? `<p class="aud-means">${esc(servicesImplication(m))}</p>` : ''}` : '<p class="hint">The register is empty.</p>'}
    ${H('Regulatory areas engaged')}
    ${th.areas.length ? `<table class="table print-table"><thead><tr><th>Area</th><th>Regulator</th><th>Source</th><th class="num">Open</th><th>Worst</th></tr></thead><tbody>
      ${th.areas.map((a) => `<tr><td>${esc(a.area)}</td><td>${esc(a.regulator)}</td><td><small>${esc(a.source)}</small></td><td class="num">${a.open}</td><td>${esc(a.worst || '-')}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">No open findings mapped to a regulatory area.</p>'}
    ${H('Method, confidence and limitations')}${reliabilityHtml(m, true)}
    <p class="hint aud-about">Contradictions compare quick answers between interviewees on the same team and questionnaire. For the case for change, see the CTO briefing paper.</p></section>`;
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
      ${field('decisions', kind === 'board' ? 'Decisions and support needed' : kind === 'finance' ? 'Matters for the Chief Financial Officer' : 'Matters for the Head of Compliance', 'area', 4)}`}
      <label class="check"><input type="checkbox" data-aud="includeDemo"${doc.includeDemo ? ' checked' : ''} ${ro ? 'disabled' : ''}> Include demo data</label>
    </form>
    <div class="brief-preview-wrap"><p class="hint">Preview</p><article class="doc" id="audPreview"></article></div>
  </div>`;
  const preview = () => {
    $('#audPreview').innerHTML = AUD_HTML[kind](audModelFor(kind, ivs, fs, flt, doc));
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
  printFrame(doc.title, AUD_HTML[kind](audModelFor(kind, ivs, fs, lastReportFilters, doc)), `#/reports/${kind}`, () => wordAudience(kind));
}

// ---------- Word ----------
async function wordAudience(kind) {
  const { ivs, fs, doc } = await loadAudienceInputs(kind);
  const m = audModelFor(kind, ivs, fs, lastReportFilters, doc);
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
  const good = m.good.length ? m.good.map((g) => D.bullet([{ text: g.text, bold: true }, { text: ` Why this is good: ${g.why}`, color: '404040' }])).join('') : D.p('It is too early to identify strengths: more interviews and evidence are needed.');
  const concerns = m.concerns.length ? m.concerns.slice(0, 6).map((g, i) => D.bullet([{ text: g.title, bold: true }, ` (${m.sevWord(g.worst)})`, ...(g.why ? [`. ${g.why}`] : []), ...(g.items.length ? [{ text: ` ${plural(g.items.length, 'open issue')}${g.depts.size ? '; ' + [...g.depts].join(', ') : ''}.`, color: '595959' }] : []), ...(g.impact ? [{ text: ` If not addressed: ${g.impact}`, italic: true }] : [])], i + 1)).join('') : D.p('No open issues.');
  const svcTable = (withOwner) => (m.svcs.length ? D.table([['Service', 'Agreed limit of disruption', 'Recovery within the limit proven?', ...(withOwner ? ['Accountable senior manager'] : []), 'Serious issues', 'Overall'],
    ...m.svcs.map((x) => [{ content: [{ text: x.svc.name, bold: true }] }, x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + ' hours' : 'Not yet set'), m.recovery(x.svc), ...(withOwner ? [plainRole(x.svc.accountableSmf) || 'Not recorded'] : []), String(x.hc.length),
      { content: [{ text: svcHealthWord(x), bold: true }, ...(x.flags.length ? [{ text: `\n${plainService(briefSvcGaps(x)[0])}`, size: 8 }] : [])], fill: toneFill[x.tone] }])], { header: true, widths: withOwner ? [1.3, 1.3, 1, 1, 0.6, 1.4] : [1.4, 1.5, 1.1, 0.6, 1.5] }) : D.p('No important business services are recorded in the register yet.'));
  const about = D.p(`About this report: it is based on ${plural(m.ivs.length, 'structured interview')}${m.range ? ` held ${m.range}` : ''}, the issues recorded from them and the evidence collected. Issues are rated critical, high, medium or low; "serious" means high or critical. An issue is only marked resolved when the fix has been checked. Regulatory statements summarise our understanding at the date of this report and are not legal advice.`, { style: 'Subtle' });
  const purpose = (k) => D.table(AUD_PURPOSE[k].map(([a, b]) => [{ content: a, bold: true, fill: 'F2F4F7' }, b]), { widths: [1.1, 4] });
  const interp = (rows, tech) => D.table([[tech ? 'Indicator' : 'Measure', 'Result', 'Assessment', 'Why', tech ? 'Implication' : 'What this means for the bank'],
    ...rows.map((r) => [{ content: [{ text: r.label, bold: true }] }, r.value, { content: TONE_WORD[r.tone], fill: toneFill[{ good: 'good', concern: 'bad', watch: 'warn' }[r.tone]] }, { content: [{ text: r.why, size: 8 }] }, { content: [{ text: r.effect, size: 8 }] }])],
  { header: true, widths: [1.1, 0.8, 0.8, 1.6, 2.2] });
  const reliab = (tech) => D.table(reliabilityItems(m, tech).map(([k, v]) => [{ content: k, bold: true, fill: 'F2F4F7' }, Array.isArray(v) ? v.map((x) => '• ' + x).join('\n') : v]), { widths: [1.1, 4] });
  const means = (t) => (t ? D.p(t, { run: { italic: true } }) : '');
  let body;
  if (kind === 'board') {
    body = [...head, H1('Why this report has been produced'), purpose('board'), H1('Summary'), overall,
      figs([['people interviewed', m.ivs.length, `${plural(m.depts.length, 'department')}, ${plural(m.teams.length, 'team')}`], ['issues open', m.open.length], ['serious issues open', m.serious.length, 'rated high or critical'], ['actions overdue', m.overdue.length], ['issues resolved', m.resolved90.length, 'in the last three months'], ['evidence checked', m.evN.asked ? `${m.evN.checked} of ${m.evN.asked}` : '-', 'items proven to work']]),
      H1('What the results mean'), D.p('Each result below is assessed as good, a concern, or something to keep an eye on, with the reason and what it could mean for the bank.'), interp(m.interp, false),
      H1('What is working well, and why it matters'), good, H1('Main concerns, and what could happen if they are not addressed'), concerns,
      H1('What is being done'), D.p(`${plural(m.open.length, 'issue')} ${m.open.length === 1 ? 'is' : 'are'} open. ${m.unplanned.length ? `${m.unplanned.length} still ${m.unplanned.length === 1 ? 'needs' : 'need'} an owner or a target date; ` : 'Every open issue has an owner and a target date; '}${m.overdue.length ? `${m.overdue.length} ${m.overdue.length === 1 ? 'is' : 'are'} overdue.` : 'none is overdue.'}`),
      m.serious.length ? D.table([['Serious issue', 'Department', 'Target', 'Progress'], ...m.serious.slice(0, 10).map((x) => { const iv = m.ivs.find((i) => i.id === x.f.interviewId); return [plainFinding(x.f).title, iv ? plainDeptOf(iv) : '', monthYear(x.f.targetDate) || 'Not set', progressWord(x)]; })], { header: true, widths: [3, 1.3, 1, 1] }) : D.p('There are no serious open issues.'),
      H1('Our most important services'), D.p('These are the services whose disruption would most harm customers or the bank. For each, the bank has agreed the most disruption it can tolerate and must show, by testing, that it can recover within that limit.'), svcTable(false), means(servicesImplication(m)),
      H1('Is it getting better?'), D.table([['Measure', 'Now', 'Three months ago', 'Direction'], ...m.trend.map((t) => [t.l, String(t.now), String(t.then), { content: t.dir, fill: t.dir === 'Better' ? toneFill.good : t.dir === 'Worse' ? toneFill.bad : toneFill.warn }]),
        ['Issues raised in the last three months', String(m.raised90.length), '', ''], ['Issues resolved in the last three months', String(m.resolved90.length), '', '']], { header: true, widths: [2.4, 0.8, 1.2, 1] }), means(trendImplication(m)),
      H1('How these results were produced, and how far to rely on them'), reliab(false),
      H1('Decisions and support needed'), d.decisions ? D.table([[{ content: d.decisions, fill: 'E6EEF8' }]], { widths: [1] }) : D.p('None requested in this report.')];
  } else if (kind === 'finance') {
    body = [...head, ...wordFinanceBody(m, { H1, purpose, overall, figs, interp, good, concerns, svcTable, reliab, means, toneFill })];
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
    const impl = seriousImplications(m);
    body = [...head, d.message ? D.table([[{ content: d.message, fill: 'E6EEF8' }]], { widths: [1] }) : '',
      H1('Purpose and basis of this report'), purpose('technology'),
      H1('Summary'), figs([['interviews', m.ivs.length, plural(m.teams.length, 'team')], ['open findings', m.open.length, `${m.serious.length} High/Critical`], ['overdue remediation', m.overdue.length], ['contradictions', contradictions], ['"Don\'t know" rate', st.qaTot.answered ? Math.round((st.qaTot.unknown / st.qaTot.answered) * 100) + '%' : '-'], ['evidence verified', m.evN.asked ? `${m.evN.checked} / ${m.evN.asked}` : '-', `${m.evN.missing} not available`]]),
      H1('Interpretation of the indicators'), interp(m.interpTech, true),
      H1('Implications of the High/Critical findings'), impl.length ? impl.map(({ x, risk, consequence, impact, exposure, control }) => D.h(2, `${x.f.ref} · ${x.f.title} (${x.effR})`) + D.table([['Risk', risk], ['Potential consequence', consequence], ...(impact !== consequence ? [['Wider business impact', impact]] : []), ['Regulatory exposure', exposure], ['Expected control', control], ['Status', `${x.f.status} · owner ${x.f.controlOwner || 'not assigned'} · target ${x.f.targetDate ? fmtDate(x.f.targetDate) : 'not set'}${isOverdue(x.f) ? ' (overdue)' : ''}`]].map(([k, v]) => [{ content: k, bold: true, fill: 'F2F4F7' }, v]), { widths: [1.1, 4] })).join('') : D.p('No High or Critical findings are open.'),
      H1('All open findings'), m.open.length ? D.table([['Ref', 'Finding', 'Category', 'Rating', 'Owner', 'Target', 'Status'], ...m.open.map((x) => [x.f.ref, x.f.title, x.f.category || '', ratingCell(x.effR, x.eff), x.f.controlOwner || '', x.f.targetDate ? fmtDate(x.f.targetDate) : '', x.f.status])], { header: true, widths: [0.9, 2.6, 1.2, 0.8, 1.1, 0.8, 0.8] }) : D.p('No open findings.'),
      H1('Recurring issues across interviews'), rec.length ? means('Recurring findings are systemic: they are best fixed once, at platform, standard or tooling level, rather than team by team.') + D.table([['Issue (template)', 'Interviews', 'Open', 'Worst', 'Regulatory reference'], ...rec.map((g) => [g.label, String(g.n), String(g.open), ratingCell(g.worst), { content: [{ text: templateById(g.key)?.uk || '', size: 8 }] }])], { header: true, widths: [2.2, 0.7, 0.6, 0.8, 2.2] }) : D.p('No finding yet recurs in two or more interviews.'),
      H1('What is working, and why it matters'), good,
      H1('Control areas rated weak'), th.weak.length ? D.table([['Control area', 'Rated weak', 'Assessed', 'Ineffective', 'If not addressed'], ...th.weak.slice(0, 15).map((w) => [secLabel(w.s), String(w.weak), String(w.rated), String(w.ineffective), { content: [{ text: (P.impacts[T.sectionCategory[w.s.id]] || P.impacts.Other)[0], size: 8 }] }])], { header: true, widths: [1.8, 0.6, 0.6, 0.7, 2.2] }) : D.p('No control area rated weak.'),
      H1('Red flags heard'), th.redFlags.length ? bl(th.redFlags.slice(0, 12).map((x) => `"${x.rf.quote}" - ${plural(x.n, 'interview')} (${[...x.teams].join(', ')}). ${x.rf.risk}`)) : D.p('None recorded.'),
      H1('Consistency between interviewees'), D.table([['Team', 'Interviews', 'Contradictions', 'Knowledge gaps', 'Evidence outstanding', 'Open findings'], ...th.teams.map((t) => [t.name, String(t.interviews), String(t.contradictions ?? '-'), String(t.gaps ?? '-'), String(t.outstanding), String(t.open)])], { header: true, widths: [1.6, 0.8, 1, 1, 1, 0.8] }),
      st.topQs.length ? D.h(2, 'Questions most often answered with a concern or "Don\'t know"') + D.table([['Question', 'Area', 'Asked', 'Concern', "Don't know"], ...st.topQs.slice(0, 10).map((x) => [x.q.q, secLabel(x.s), String(x.n), String(x.concern), String(x.unknown)])], { header: true, widths: [3, 1.6, 0.6, 0.6, 0.7] }) : '',
      H1('Important business services'), m.svcs.length ? D.table([['Service', 'Impact tolerance', 'Last scenario test', 'Open (H/C)', 'Mapped systems not interviewed'], ...m.svcs.map((x) => [`${x.svc.ref} ${x.svc.name}`, x.svc.toleranceText || (x.svc.toleranceHours ? x.svc.toleranceHours + 'h' : 'Not set'), `${x.svc.scenarioTestDate ? fmtDate(x.svc.scenarioTestDate) + ' · ' : ''}${x.svc.scenarioResult || 'Not tested'}`, `${x.open.length} (${x.hc.length})`, x.uncovered.map((u) => u.name).join(', ') || '-'])], { header: true, widths: [1.6, 1.6, 1.2, 0.7, 1.5] }) + means(servicesImplication(m)) : D.p('The register is empty.'),
      H1('Regulatory areas engaged'), th.areas.length ? D.table([['Area', 'Regulator', 'Source', 'Open', 'Worst'], ...th.areas.map((a) => [a.area, a.regulator, { content: [{ text: a.source, size: 8 }] }, String(a.open), ratingCell(a.worst)])], { header: true, widths: [1.4, 0.7, 2.6, 0.5, 0.8] }) : D.p('No open findings mapped to a regulatory area.'),
      H1('Method, confidence and limitations'), reliab(true),
      D.p('Contradictions compare quick answers between interviewees on the same team and questionnaire. For the case for change, see the CTO briefing paper.', { style: 'Subtle' })];
  }
  saveDocx(D.build({ title: d.title, author: state.user.fullName, footer: `${d.title} · ${wordFooter()}` }, body.join('')), `${d.title.replace(/:\s*/g, ' - ').replace(/[\\/*?"<>|]/g, '-')} ${today()}.docx`);
}

// ---------- Chief Financial Officer: accounts, regulatory reports, payments and fraud ----------
// Plain English. Scope: Accounts and finance interviews, plus findings from anywhere in the bank whose category or
// regulatory area affects the accounts, regulatory reports, payments or fraud.
const FIN_CATS = ['Financial and regulatory reporting', 'Fraud and financial crime'];
const FIN_AREAS = ['Regulatory reporting', 'Financial crime & fraud'];
const isFinancial = (f) => FIN_CATS.includes(f.category) || findingUkAreas(f).some((a) => FIN_AREAS.includes(a));
const affectsFigures = (f) => f.category === 'Financial and regulatory reporting' || findingUkAreas(f).includes('Regulatory reporting');
const affectsMoney = (f) => f.category === 'Fraud and financial crime' || findingUkAreas(f).includes('Financial crime & fraud');
// What each finance control area protects, in plain words.
const FIN_PROTECTS = {
  'fin-s1': 'Clear responsibility for finance processes and the systems behind them.',
  'fin-s2': 'Knowing which systems produce the bank\'s numbers, and who owns them.',
  'fin-s3': 'Stopping any one person from making, and hiding, an error or a fraudulent payment.',
  'fin-s4': 'Keeping errors and deliberate changes out of the accounts.',
  'fin-s5': 'Making sure the accounts are complete and that differences are found and explained.',
  'fin-s6': 'Making sure figures calculated in spreadsheets are right and can be relied on.',
  'fin-s7': 'Stopping system changes from altering the figures unnoticed.',
  'fin-s8': 'Protecting the bank\'s own payments from fraud and mistakes.',
  'fin-s9': 'Producing accurate accounts on time.',
  'fin-s10': 'Accurate, on-time reports to our regulators.',
  'fin-s11': 'Meeting payment and reporting deadlines even if a supplier fails.',
  'fin-s12': 'Preventing and detecting fraud in finance.',
  'fin-s13': 'Being able to prove to auditors and regulators what happened.',
};
// Builds the model for any audience; the finance report narrows the scope first.
function audModelFor(kind, ivsAll, fsAll, flt, doc) {
  if (kind !== 'finance') return audienceModel(ivsAll, fsAll, flt, doc);
  const finIvs = ivsAll.filter((i) => qnIdOf(i) === 'fin');
  const ids = new Set(finIvs.map((i) => i.id));
  const fsIn = fsAll.filter((f) => ids.has(f.interviewId) || isFinancial(f));
  const m = audienceModel(finIvs, fsIn, flt, doc);
  m.allIvs = ivsAll;
  m.finIds = ids;
  const fin = T.qnById('fin');
  m.finAreas = fin.sections.map((s) => {
    const rated = m.ivs.map((i) => i.data.sections?.[s.id]?.rating).filter((r) => r && r !== 'Not assessed' && r !== 'Not applicable');
    const eff = rated.filter((r) => r === 'Effective').length, part = rated.filter((r) => r === 'Partially effective').length, ineff = rated.filter((r) => r === 'Ineffective').length;
    const tone = !rated.length ? 'none' : ineff ? 'concern' : part ? 'watch' : 'good';
    return { s, n: rated.length, eff, part, ineff, tone, protects: FIN_PROTECTS[s.id] || '' };
  });
  m.figures = m.open.filter((x) => affectsFigures(x.f));
  m.money = m.open.filter((x) => affectsMoney(x.f));
  m.elsewhere = m.open.filter((x) => !ids.has(x.f.interviewId));
  // Evidence by finance area.
  const ev = m.ivs.flatMap((i) => evidenceRows(i, [])).filter((r) => r.status && r.status !== 'Not requested');
  m.evByArea = fin.sections.map((s) => { const rs = ev.filter((r) => r.s.id === s.id); return { s, asked: rs.length, checked: rs.filter((r) => r.status === 'Seen - verified').length, waiting: rs.filter((r) => r.status === 'Requested').length, missing: rs.filter((r) => r.status === 'Not available').length }; }).filter((x) => x.asked);
  // Finance-specific interpretation first, then the general measures (without the bank-wide coverage row).
  const rows = [];
  const add = (label, value, tone, why, effect) => rows.push({ label, value: String(value), tone, why, effect });
  if (m.ivs.length || m.fs.length) {
    if (m.figures.length) add('Issues affecting the accounts or regulatory reports', m.figures.length, 'concern', `${plural(m.figures.length, 'open issue')} could affect the accuracy of our accounts or of our reports to regulators.`,
      'Wrong figures could mislead the board, our auditors and our regulators. Reports to the Prudential Regulation Authority may have to be resubmitted, which it treats seriously, and the senior manager responsible for financial information is personally accountable. Auditors may also extend their testing, adding cost.');
    else add('Issues affecting the accounts or regulatory reports', 0, 'good', 'No open issues are known to affect the accounts or our reports to regulators.', 'Supports confidence that the figures the board, auditors and regulators rely on are accurate.');
    if (m.money.length) add('Payment and fraud issues', m.money.length, 'concern', `${plural(m.money.length, 'open issue')} could let money be paid wrongly or fraudulently.`,
      'The bank could lose money through fraudulent or mistaken payments. Under the new legal duty to prevent fraud, a known weak control could also expose the bank to prosecution as well as loss.');
    else add('Payment and fraud issues', 0, 'good', 'No open issues are known in payment or fraud controls.', 'Protects the bank\'s money and reduces its exposure under the legal duty to prevent fraud.');
    const weakAreas = m.finAreas.filter((a) => a.ineff);
    if (weakAreas.length) add('Finance control areas rated ineffective', weakAreas.length, 'concern', `${plural(weakAreas.length, 'finance control area')} ${weakAreas.length === 1 ? 'was' : 'were'} rated ineffective in at least one interview.`,
      'Where a control is not working, errors or fraud in that area may go undetected until they surface in the accounts, an audit or a regulatory report.');
    if (m.ivs.length < 2) add('Finance interviews held', m.ivs.length, 'watch', m.ivs.length ? 'Only one finance interview so far.' : 'No finance interviews held yet; this report shows only issues raised elsewhere in the bank.',
      'Results may not represent the whole finance function; other teams and processes could hold further issues.');
  }
  m.interpFin = [...rows, ...interpretRows(m, false).filter((r) => r.label !== 'How much of the bank is covered')];
  return m;
}
AUD_PURPOSE.finance = [
  ['Purpose', 'To give the Chief Financial Officer an evidence-based view of the controls over the systems, data, spreadsheets and payments behind the bank\'s accounts and its reports to regulators, and of technology issues elsewhere in the bank that could affect them.'],
  ['Why the Chief Financial Officer needs it', 'The Chief Financial Officer is the senior manager responsible for the integrity of the bank\'s financial information and its regulatory reporting, and is personally accountable for taking reasonable steps to keep them accurate. Most of the bank\'s figures are produced, moved or calculated by technology - systems, data feeds and spreadsheets - so weaknesses in those controls are weaknesses in the figures.'],
  ['Legal and regulatory basis', 'The bank must keep adequate accounting records (Companies Act 2006); report accurately and on time to the Prudential Regulation Authority and deal openly with it; and, as a large organisation, may be liable under the new offence of failing to prevent fraud (in force from 1 September 2025 - scope to be confirmed). Our external auditors also rely on these controls when auditing the accounts.'],
  ['How the results were obtained', 'Through structured interviews with the finance team, comparing what they told us with written procedures, with what our systems actually enforce, and with evidence that controls really operate.'],
  ['Why the results should be noted', 'Formally noting this report records that these risks have been reported to the accountable senior manager. If figures later prove wrong, or a fraud happens through a known weakness, the bank and the Chief Financial Officer will be asked what was known and what was done about it.'],
  ['What the Chief Financial Officer is asked to do', 'Note the results; confirm owners and target dates for the serious issues; and consider the matters raised at the end of this report.'],
];
const finAreaTone = (t) => (t === 'none' ? '<span class="hint">Not yet assessed</span>' : svcTone(TONE_CLASS[t], TONE_WORD[t]));
function financeHtml(m) {
  const e = m.evN;
  let n = 0; const H = (t) => `<h2>${++n}. ${esc(t)}</h2>`;
  const deptOf = (x) => { const iv = (m.allIvs || m.ivs).find((i) => i.id === x.f.interviewId); return iv ? plainDeptOf(iv) : 'Not linked to an interview'; };
  return `<section class="brief aud">${audHead(m, 'finance')}
    ${H('Why this report has been produced')}${audPurposeHtml('finance')}
    ${H('Summary')}${audOverall(m)}
    <div class="aud-figs">
      ${audFig('finance interviews', m.ivs.length, plural(m.teams.length, 'team'))}
      ${audFig('issues open', m.open.length, m.elsewhere.length ? `${m.elsewhere.length} raised elsewhere in the bank` : '')}
      ${audFig('serious issues open', m.serious.length, 'rated high or critical', m.serious.length ? 'bad' : 'good')}
      ${audFig('affecting the accounts or regulatory reports', m.figures.length, 'open issues', m.figures.length ? 'bad' : 'good')}
      ${audFig('payment and fraud issues', m.money.length, 'open issues', m.money.length ? 'bad' : 'good')}
      ${audFig('evidence checked', e.asked ? `${e.checked} of ${e.asked}` : '-', 'items proven to work')}
    </div>
    ${H('What the results mean')}<p>Each result below is assessed as good, a concern, or something to keep an eye on, with the reason and what it could mean for the bank.</p>${interpHtml(m.interpFin, false)}
    ${H('Finance control areas')}
    <p>How each area was rated across the finance interviews, and what the controls in it protect.</p>
    <table class="table print-table aud-table"><thead><tr><th>Area</th><th>What it protects</th><th class="num">Rated</th><th class="num">Effective</th><th class="num">Partly</th><th class="num">Not working</th><th>Position</th></tr></thead><tbody>
      ${m.finAreas.map((a) => `<tr><td><strong>${esc(a.s.title)}</strong></td><td><small>${esc(a.protects)}</small></td><td class="num">${a.n}</td><td class="num">${a.eff}</td><td class="num">${a.part}</td><td class="num">${a.ineff}</td><td>${finAreaTone(a.tone)}</td></tr>`).join('')}</tbody></table>
    ${H('What is working well, and why it matters')}${audGood(m)}
    ${H('Main concerns, and what could happen if they are not addressed')}${audConcerns(m)}
    ${H('Technology issues elsewhere that could affect the accounts or payments')}
    ${m.elsewhere.length ? `<p>These were raised in interviews outside finance, but could affect the figures, the regulatory reports or the bank's payments.</p><table class="table print-table aud-table"><thead><tr><th>Issue</th><th>Raised in</th><th>Severity</th><th>Progress</th></tr></thead><tbody>
      ${m.elsewhere.map((x) => `<tr><td>${esc(plainFinding(x.f).title)}<br><small class="aud-why">${esc(plainFinding(x.f).why)}</small></td><td>${esc(deptOf(x))}</td><td>${esc(x.effR || 'Not yet rated')}</td><td>${esc(progressWord(x))}</td></tr>`).join('')}</tbody></table>` : '<p>None found.</p>'}
    ${H('What is being done')}
    <p>${plural(m.open.length, 'issue')} ${m.open.length === 1 ? 'is' : 'are'} open. ${m.unplanned.length ? `${m.unplanned.length} still ${m.unplanned.length === 1 ? 'needs' : 'need'} an owner or a target date; ` : 'Every open issue has an owner and a target date; '}${m.overdue.length ? `${m.overdue.length} ${m.overdue.length === 1 ? 'is' : 'are'} overdue.` : 'none is overdue.'}</p>
    ${m.open.length ? `<table class="table print-table aud-table"><thead><tr><th>Issue</th><th>Severity</th><th>Owner</th><th>Target</th><th>Progress</th></tr></thead><tbody>
      ${m.open.slice(0, 15).map((x) => `<tr><td>${esc(plainFinding(x.f).title)}</td><td>${esc(x.effR || 'Not yet rated')}</td><td>${esc(x.f.controlOwner || 'Not assigned')}</td><td class="nowrap">${x.f.targetDate ? fmtDate(x.f.targetDate) : 'Not set'}</td><td>${esc(progressWord(x))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${H('Can we prove our controls work?')}
    <p>${e.asked ? `Interviewers asked the finance team for ${plural(e.asked, 'piece')} of evidence that controls work. ${e.checked} ${e.checked === 1 ? 'has' : 'have'} been seen and checked, ${e.waiting} ${e.waiting === 1 ? 'is' : 'are'} still awaited and ${e.missing} ${e.missing === 1 ? 'does' : 'do'} not exist. Our auditors and regulators rely on evidence: a control that cannot be evidenced is treated as if it did not operate.` : 'No evidence has been requested from the finance team yet.'}</p>
    ${m.evByArea.length ? `<table class="table print-table aud-table"><thead><tr><th>Area</th><th class="num">Asked for</th><th class="num">Checked</th><th class="num">Awaited</th><th class="num">Does not exist</th></tr></thead><tbody>
      ${m.evByArea.map((x) => `<tr><td>${esc(x.s.title)}</td><td class="num">${x.asked}</td><td class="num">${x.checked}</td><td class="num">${x.waiting}</td><td class="num">${x.missing}</td></tr>`).join('')}</tbody></table>` : ''}
    ${H('Our most important services')}${audServicesTable(m, true)}${servicesImplication(m) ? `<p class="aud-means">${esc(servicesImplication(m))}</p>` : ''}
    ${H('Is it getting better?')}${audTrend(m)}<p class="aud-means">${esc(trendImplication(m))}</p>
    ${H('How these results were produced, and how far to rely on them')}${reliabilityHtml(m, false)}
    ${H('Matters for the Chief Financial Officer')}${m.doc.decisions ? `<div class="brief-ask">${nl2br(m.doc.decisions)}</div>` : '<p class="hint">None raised in this report.</p>'}
    </section>`;
}
AUD_HTML.finance = financeHtml;
// Word body for the finance report (the shared pieces are built in wordAudience).
function wordFinanceBody(m, k) {
  const { H1, purpose, overall, figs, interp, good, concerns, svcTable, reliab, means, toneFill } = k;
  const deptOf = (x) => { const iv = (m.allIvs || m.ivs).find((i) => i.id === x.f.interviewId); return iv ? plainDeptOf(iv) : 'Not linked to an interview'; };
  const e = m.evN;
  return [H1('Why this report has been produced'), purpose('finance'), H1('Summary'), overall,
    figs([['finance interviews', m.ivs.length, plural(m.teams.length, 'team')], ['issues open', m.open.length, m.elsewhere.length ? `${m.elsewhere.length} raised elsewhere in the bank` : ''], ['serious issues open', m.serious.length, 'rated high or critical'], ['affecting the accounts or regulatory reports', m.figures.length, 'open issues'], ['payment and fraud issues', m.money.length, 'open issues'], ['evidence checked', e.asked ? `${e.checked} of ${e.asked}` : '-', 'items proven to work']]),
    H1('What the results mean'), D.p('Each result below is assessed as good, a concern, or something to keep an eye on, with the reason and what it could mean for the bank.'), interp(m.interpFin, false),
    H1('Finance control areas'), D.table([['Area', 'What it protects', 'Rated', 'Effective', 'Partly', 'Not working', 'Position'], ...m.finAreas.map((a) => [{ content: [{ text: a.s.title, bold: true }] }, { content: [{ text: a.protects, size: 8 }] }, String(a.n), String(a.eff), String(a.part), String(a.ineff), a.tone === 'none' ? 'Not yet assessed' : { content: TONE_WORD[a.tone], fill: toneFill[TONE_CLASS[a.tone]] }])], { header: true, widths: [1.5, 2.2, 0.5, 0.6, 0.5, 0.7, 0.9] }),
    H1('What is working well, and why it matters'), good, H1('Main concerns, and what could happen if they are not addressed'), concerns,
    H1('Technology issues elsewhere that could affect the accounts or payments'), m.elsewhere.length ? D.table([['Issue', 'Raised in', 'Severity', 'Progress'], ...m.elsewhere.map((x) => [{ content: [{ text: plainFinding(x.f).title, bold: true }, { text: `\n${plainFinding(x.f).why}`, size: 8 }] }, deptOf(x), x.effR || 'Not yet rated', progressWord(x)])], { header: true, widths: [3, 1.3, 0.8, 1] }) : D.p('None found.'),
    H1('What is being done'), m.open.length ? D.table([['Issue', 'Severity', 'Owner', 'Target', 'Progress'], ...m.open.slice(0, 15).map((x) => [plainFinding(x.f).title, x.effR || 'Not yet rated', x.f.controlOwner || 'Not assigned', x.f.targetDate ? fmtDate(x.f.targetDate) : 'Not set', progressWord(x)])], { header: true, widths: [2.8, 0.8, 1.2, 0.8, 0.9] }) : D.p('No open issues.'),
    H1('Can we prove our controls work?'), D.p(e.asked ? `Interviewers asked the finance team for ${plural(e.asked, 'piece')} of evidence that controls work. ${e.checked} ${e.checked === 1 ? 'has' : 'have'} been seen and checked, ${e.waiting} ${e.waiting === 1 ? 'is' : 'are'} still awaited and ${e.missing} ${e.missing === 1 ? 'does' : 'do'} not exist. Our auditors and regulators rely on evidence: a control that cannot be evidenced is treated as if it did not operate.` : 'No evidence has been requested from the finance team yet.'),
    m.evByArea.length ? D.table([['Area', 'Asked for', 'Checked', 'Awaited', 'Does not exist'], ...m.evByArea.map((x) => [x.s.title, String(x.asked), String(x.checked), String(x.waiting), String(x.missing)])], { header: true, widths: [2.4, 0.8, 0.8, 0.8, 1] }) : '',
    H1('Our most important services'), svcTable(true), means(servicesImplication(m)),
    H1('Is it getting better?'), D.table([['Measure', 'Now', 'Three months ago', 'Direction'], ...m.trend.map((t) => [t.l, String(t.now), String(t.then), { content: t.dir, fill: t.dir === 'Better' ? toneFill.good : t.dir === 'Worse' ? toneFill.bad : toneFill.warn }])], { header: true, widths: [2.4, 0.8, 1.2, 1] }), means(trendImplication(m)),
    H1('How these results were produced, and how far to rely on them'), reliab(false),
    H1('Matters for the Chief Financial Officer'), m.doc.decisions ? D.table([[{ content: m.doc.decisions, fill: 'E6EEF8' }]], { widths: [1] }) : D.p('None raised in this report.')];
}
