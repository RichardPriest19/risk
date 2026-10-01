// Compare interviewees: answers from several interviews side by side, with contradictions and knowledge gaps highlighted.
'use strict';

// Questions about the individual (their role, their own access and training): differences between people are expected.
const PERSONAL_SECTIONS = T.personalSections;
const MAX_COMPARE = 6;
const appTokens = (iv) => (iv.data.header?.applications || '').split(/[,;/]+/).map((x) => x.trim()).filter(Boolean);

// How the selected interviews' quick answers relate on one question.
//   contradiction - someone said Yes and someone said No (about the team or system)
//   difference    - definite answers differ otherwise (e.g. Yes vs Partly)
//   gap           - someone knew, someone said "Don't know" (or Clear vs Vague on an open question)
function compareKind(s, q, answers) {
  if (PERSONAL_SECTIONS.includes(s.id)) return null;
  const qas = answers.map((a) => a?.qa).filter((x) => x && x !== 'N/A');
  const definite = qas.filter((x) => x !== "Don't know");
  if (q.type === 'yn') {
    if (definite.includes('Yes') && definite.includes('No')) return 'contradiction';
    if (new Set(definite).size > 1) return 'difference';
  }
  if (definite.length && qas.includes("Don't know")) return 'gap';
  if (q.type === 'open' && qas.includes('Clear') && qas.includes('Vague')) return 'gap';
  return null;
}
const KIND_LABEL = { contradiction: 'Contradiction', difference: 'Partial disagreement', gap: 'Knowledge gap' };

function compareModel(ivs, opts) {
  const sections = [];
  const totals = { contradiction: 0, difference: 0, gap: 0, rows: 0 };
  (ivs.length ? qnOf(ivs[0]) : T.qnById(T.DEFAULT_QN)).sections.forEach((s) => {
    if (!opts.personal && PERSONAL_SECTIONS.includes(s.id)) return;
    const rows = [];
    [s.opener, ...s.questions].forEach((q) => {
      const answers = ivs.map((iv) => iv.data.sections?.[s.id]?.answers?.[q.id]);
      if (!answers.some((a) => a && ((a.r || '').trim() || a.qa))) return;
      const kind = compareKind(s, q, answers);
      if (opts.diffOnly && !kind) return;
      rows.push({ q, answers, kind });
      totals.rows++; if (kind) totals[kind]++;
    });
    if (rows.length) sections.push({ s, rows, ratings: ivs.map((iv) => iv.data.sections?.[s.id]?.rating || 'Not assessed') });
  });
  return { sections, totals };
}

function compareTableHtml(ivs, model, forPrint) {
  const cell = (q, a) => {
    if (!a || !((a.r || '').trim() || a.qa)) return '<td class="cmp-cell empty">-</td>';
    const note = (a.r || '').trim();
    const short = forPrint || note.length <= 180 ? note : note.slice(0, 180) + '…';
    return `<td class="cmp-cell">${a.qa ? `<span class="qa-print qa-${T.answerSignal(q, a.qa)}">${esc(a.qa)}</span> ` : ''}${a.flag ? '<span class="flag-tag" title="Red flag">⚑</span> ' : ''}${note ? `<span title="${esc(note)}">${nl2br(short)}</span>` : ''}</td>`;
  };
  return `<div class="table-scroll"><table class="table cmp-table"><thead><tr><th class="cmp-q">Question</th>
    ${ivs.map((iv) => `<th><a href="#/interview/${iv.id}">${esc(iv.data.header?.developerName || iv.ref)}</a><br><small>${esc(iv.data.header?.developerRole || '')}${iv.data.header?.developerRole ? ' · ' : ''}${esc(iv.ref)}${iv.data.header?.date ? ' · ' + fmtDate(iv.data.header.date) : ''}</small></th>`).join('')}</tr></thead><tbody>
    ${model.sections.map(({ s, rows, ratings }) => `
      <tr class="cmp-sec"><th>${s.no}. ${esc(s.title)}${PERSONAL_SECTIONS.includes(s.id) ? ' <small class="hint">(about the individual - differences expected)</small>' : ''}</th>${ratings.map((r) => `<td><small>${esc(r)}</small></td>`).join('')}</tr>
      ${rows.map(({ q, answers, kind }, i) => `<tr class="${kind ? 'cmp-' + kind : ''}" id="cmp-${s.id}-${q.id}">
        <td class="cmp-q">${kind ? `<span class="cmp-badge cmp-badge-${kind}">${KIND_LABEL[kind]}</span> ` : ''}${q.id === 'opener' ? '★ ' : ''}${esc(q.q)}
          ${kind && !forPrint && canEdit() ? `<br><button type="button" class="btn btn-small btn-ghost" data-raise="${s.id}|${q.id}">+ Raise finding</button>` : ''}</td>
        ${answers.map((a) => cell(q, a)).join('')}</tr>`).join('')}`).join('')}
  </tbody></table></div>`;
}

function compareSummaryHtml(model) {
  const t = model.totals;
  const flagged = model.sections.flatMap(({ s, rows }) => rows.filter((r) => r.kind === 'contradiction').map((r) => ({ s, ...r })));
  return `<div class="tiles">
      <div class="tile"><span class="tile-label">Contradictions</span><span class="tile-value">${t.contradiction}</span><span class="tile-sub">one said Yes, another said No</span></div>
      <div class="tile"><span class="tile-label">Partial disagreements</span><span class="tile-value">${t.difference}</span><span class="tile-sub">e.g. Yes vs Partly</span></div>
      <div class="tile"><span class="tile-label">Knowledge gaps</span><span class="tile-value">${t.gap}</span><span class="tile-sub">one knew, another did not</span></div>
      <div class="tile"><span class="tile-label">Questions compared</span><span class="tile-value">${t.rows}</span><span class="tile-sub">answered by at least one</span></div>
    </div>
    ${flagged.length ? `<div class="notice notice-warn"><p><strong>Contradictions to resolve:</strong></p><ul>${flagged.map((r) => `<li><a href="#cmp-${r.s.id}-${r.q.id}" data-jump="cmp-${r.s.id}-${r.q.id}">${r.s.no}. ${esc(r.q.q)}</a></li>`).join('')}</ul>
      <p class="hint">A contradiction does not show who is right. Check it against the documented process and the evidence - the four-way comparison.</p></div>` : ''}`;
}

let cmpOpts = { diffOnly: false, personal: true };
async function viewCompare(params) {
  setActiveNav('compare');
  const all = await api('GET', '/api/interviews?full=1');
  const byId = Object.fromEntries(all.map((i) => [i.id, i]));
  let ids = (params.get('ids') || '').split(',').map(Number).filter((x) => byId[x]);
  const withId = Number(params.get('with'));
  // Answers can only be compared within one questionnaire.
  const cmpQn = params.get('qn') && T.qnById(params.get('qn')) ? params.get('qn') : qnIdOf(byId[ids[0]] || byId[withId] || { questionnaireId: getPref('cmpQn', T.DEFAULT_QN) });
  setPref('cmpQn', cmpQn);
  const ivs = all.filter((i) => qnIdOf(i) === cmpQn);
  ids = ids.filter((x) => qnIdOf(byId[x]) === cmpQn);
  if (!ids.length && byId[withId]) {
    const base = byId[withId], toks = appTokens(base);
    ids = [withId, ...ivs.filter((i) => i.id !== withId && ((base.data.header?.team && i.data.header?.team === base.data.header.team) || appTokens(i).some((t) => toks.includes(t)))).map((i) => i.id)].slice(0, MAX_COMPARE);
  }
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))].sort();
  const apps = [...new Set(ivs.flatMap(appTokens))].sort();
  view().innerHTML = `
    <div class="page-head"><h1>Compare interviewees</h1>
      <div class="row"><button class="btn" id="cmpPrint" disabled>Print comparison</button></div></div>
    <p class="intro">Put answers from different ${esc(qnOf({ questionnaireId: cmpQn }).subjects)} on the same team or application side by side. Where one says a control exists and another says it does not, at least one of them is wrong - and that is often where the real risk is. ${helpBtn('compareKinds')}</p>
    <div class="card cmp-pick">
      <div class="filters">
        ${MULTI_QN ? `<label>Questionnaire <select id="cmpQn">${options(T.questionnaires.map((q) => [q.id, q.title]), cmpQn)}</select></label>` : ''}
        <label>Select a team <select id="cmpTeam">${options(teams.map((t) => [t, `${t} (${ivs.filter((i) => i.data.header?.team === t).length})`]), '', 'Choose…')}</select></label>
        <label>or an application <select id="cmpApp">${options(apps.map((a) => [a, `${a} (${ivs.filter((i) => appTokens(i).includes(a)).length})`]), '', 'Choose…')}</select></label>
        <label class="check"><input type="checkbox" id="cmpDiff"${cmpOpts.diffOnly ? ' checked' : ''}> Only show contradictions, disagreements and gaps</label>
        <label class="check"><input type="checkbox" id="cmpPersonal"${cmpOpts.personal ? ' checked' : ''}> Include questions about the individual</label>
      </div>
      <details${ids.length ? '' : ' open'}><summary>Choose interviews (${ids.length} selected, up to ${MAX_COMPARE})</summary>
        <div class="cmp-list">${ivs.map((i) => `<label class="check"><input type="checkbox" value="${i.id}"${ids.includes(i.id) ? ' checked' : ''}> ${esc(i.ref)} · ${esc(i.data.header?.developerName || 'unnamed')} · ${esc(i.data.header?.team || 'no team')} · ${esc(i.data.header?.applications || '')}</label>`).join('')}</div>
      </details>
    </div>
    <div id="cmpOut"></div>`;
  const setIds = (next) => {
    ids = next.slice(0, MAX_COMPARE);
    if (next.length > MAX_COMPARE) toast(`Showing the first ${MAX_COMPARE}. Untick some to compare others.`);
    history.replaceState(null, '', `#/compare?qn=${cmpQn}&ids=${ids.join(',')}`);
    $$('.cmp-list input').forEach((c) => { c.checked = ids.includes(Number(c.value)); });
    $('.cmp-pick summary').textContent = `Choose interviews (${ids.length} selected, up to ${MAX_COMPARE})`;
    draw();
  };
  const draw = () => {
    const sel = ids.map((x) => byId[x]);
    $('#cmpPrint').disabled = sel.length < 2;
    if (sel.length < 2) { $('#cmpOut').innerHTML = '<div class="card"><p class="empty">Choose at least two interviews - pick a team or application above, or tick interviews in the list.</p></div>'; return; }
    const model = compareModel(sel, cmpOpts);
    $('#cmpOut').innerHTML = compareSummaryHtml(model) + `<div class="card">${model.sections.length ? compareTableHtml(sel, model, false) : '<p class="empty">Nothing to show with these options.</p>'}</div>`;
    $$('[data-jump]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); document.getElementById(a.dataset.jump)?.scrollIntoView({ block: 'center' }); }; });
    $$('[data-raise]').forEach((b) => { b.onclick = () => raiseFromComparison(sel, b.dataset.raise); });
  };
  $('#cmpTeam').onchange = (e) => { $('#cmpApp').value = ''; if (e.target.value) setIds(ivs.filter((i) => i.data.header?.team === e.target.value).map((i) => i.id)); };
  $('#cmpApp').onchange = (e) => { $('#cmpTeam').value = ''; if (e.target.value) setIds(ivs.filter((i) => appTokens(i).includes(e.target.value)).map((i) => i.id)); };
  $('.cmp-list').addEventListener('change', () => setIds($$('.cmp-list input:checked').map((c) => Number(c.value))));
  if ($('#cmpQn')) $('#cmpQn').onchange = (e) => { location.hash = `#/compare?qn=${e.target.value}`; };
  $('#cmpDiff').onchange = (e) => { cmpOpts.diffOnly = e.target.checked; draw(); };
  $('#cmpPersonal').onchange = (e) => { cmpOpts.personal = e.target.checked; draw(); };
  $('#cmpPrint').onclick = () => { location.hash = `#/print/compare?ids=${ids.join(',')}`; };
  draw();
}

// Pre-fill a finding with every interviewee's answer to the contradicted question.
function raiseFromComparison(ivs, key) {
  const [sid, qid] = key.split('|');
  const s = sectionById(sid), q = qid === 'opener' ? s.opener : s.questions.find((x) => x.id === qid);
  const lines = ivs.map((iv) => { const a = iv.data.sections?.[sid]?.answers?.[qid] || {}; return `- ${iv.data.header?.developerName || iv.ref} (${iv.ref}): ${a.qa || 'no quick answer'}${a.r ? ' - ' + a.r : ''}`; });
  const apps = [...new Set(ivs.flatMap(appTokens))].join(', ');
  const teams = [...new Set(ivs.map((i) => i.data.header?.team).filter(Boolean))].join(', ');
  state.findingPrefill = {
    title: `Conflicting accounts: ${q.q}`.slice(0, 200),
    category: SECTION_CATEGORY[sid], ukAreas: ukAreasForSection(s),
    application: apps, developerTeam: teams, interviewId: ivs[0].id,
    classification: 'Potential risk', sourceSection: secLabel(s), sourceQuestion: q.q,
    description: `${qnOf(ivs[0]).subjects.replace(/^./, (c) => c.toUpperCase())} gave conflicting answers to: "${q.q}"\n${lines.join('\n')}\n\nAt least one account does not reflect how the control actually operates. Establish the documented process, what the technology enforces, and the evidence.`,
    regulatoryRelevance: `PRA: ${s.reg.pra}\nAlso relevant: ${s.reg.also}`,
  };
  location.hash = '#/finding/new';
}

async function viewPrintCompare(params) {
  const ivs = await api('GET', '/api/interviews?full=1');
  const sel0 = (params.get('ids') || '').split(',').map(Number).map((x) => ivs.find((i) => i.id === x)).filter(Boolean);
  const sel = sel0.filter((i) => qnIdOf(i) === qnIdOf(sel0[0] || {}));
  const Q = qnOf(sel[0] || {});
  const model = compareModel(sel, cmpOpts);
  printFrame('Interviewee comparison', `<header class="doc-head"><h1>Interviewee comparison${MULTI_QN ? ' - ' + esc(Q.title) : ''}</h1>
    <p>${sel.map((iv) => `${esc(iv.data.header?.developerName || iv.ref)} (${esc(iv.ref)})`).join(' · ')}</p>
    <p class="hint">${cmpOpts.diffOnly ? 'Showing only contradictions, disagreements and knowledge gaps.' : 'Showing all questions answered by at least one interviewee.'}${Q.personalSections.length ? ` Questions about the individual (sections ${Q.personalSections.map((id) => sectionById(id).no).join(', ')}) are never flagged.` : ''}</p></header>
    ${compareSummaryHtml(model)}${compareTableHtml(sel, model, true)}`, `#/compare?qn=${Q.id}&ids=${sel.map((i) => i.id).join(',')}`);
}
