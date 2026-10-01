// Meeting mode: full-screen, one question at a time, with section timers and keyboard shortcuts.
'use strict';

const meet = { steps: [], i: 0, timer: null, panel: null, iv: null };

// The running order: each included section's opener and questions at this interview's depth, then the final questions.
function meetingSteps(d) {
  const steps = [];
  const depth = depthOf(d), Q = qnOf(d);
  Q.sections.filter((s) => sectionIncluded(s, d)).forEach((s) => {
    [s.opener, ...visibleQuestions(s, d.sections[s.id], depth)].forEach((q) => steps.push({ s, q, key: `${s.id}|${q.id}` }));
  });
  Q.finalQuestions.forEach((text, i) => steps.push({ final: i, q: { id: 'final' + i, q: text, fu: [], type: 'open' }, key: `final|${i}` }));
  return steps;
}
const finalLabel = () => { const n = qnOf(meet.iv).finalNo; return `${n ? n + '. ' : ''}Final questions`; };
const fmtClock = (sec) => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

function sectionBudgetSec(d, sid) {
  const planned = (Number(d.header.plannedMinutes) || T.depths.find((x) => x.id === depthOf(d)).minutes) * 60;
  const qSteps = meet.steps.filter((x) => x.s);
  const inSec = qSteps.filter((x) => x.s.id === sid).length;
  return qSteps.length ? (planned * inSec) / qSteps.length : 0;
}

async function viewMeeting(id) {
  await loadInterview(id);
  const d = state.iv.data;
  d.meeting = d.meeting || {};
  d.meeting.sectionTime = d.meeting.sectionTime || {};
  meet.iv = state.iv;
  meet.steps = meetingSteps(d);
  const pos = meet.steps.findIndex((x) => x.key === d.meeting.pos);
  meet.i = pos >= 0 ? pos : 0;
  document.body.classList.add('meeting-mode');
  view().innerHTML = `
    <div class="meet" id="meet">
      <header class="meet-bar">
        <button class="btn btn-small" id="meetExit" title="Exit meeting mode (Q)">✕ Exit</button>
        <div class="meet-where"><span id="meetSection"></span><span class="meet-progress"><span id="meetProgBar"></span></span><span id="meetCount" class="hint"></span></div>
        <div class="meet-timers" aria-live="off">
          <span title="Time in this section / time planned for it">Section <strong id="tSec">0:00</strong> / <span id="tSecBudget"></span></span>
          <span title="Total interview time / planned">Total <strong id="tAll">0:00</strong> / <span id="tAllBudget"></span></span>
          <button class="btn btn-small" id="meetPause" title="Pause or resume the timers (P)"></button>
        </div>
        <div class="row">
          <button class="btn btn-small" id="meetLaterBtn" title="Questions marked to come back to (L)">⚑ Marked</button>
          <button class="btn btn-small" id="meetGuideBtn" title="Assessor guide for this section (G)">Guide</button>
          <button class="btn btn-small" id="meetHelpBtn" title="Keyboard shortcuts (?)">?</button>
          <span id="saveStatus" class="save-status" aria-live="polite"></span>
        </div>
      </header>
      <div class="meet-body">
        <main class="meet-main" id="meetMain"></main>
        <aside class="meet-drawer" id="meetDrawer" hidden></aside>
      </div>
      <footer class="meet-foot">
        <button class="btn" id="meetPrev" title="Previous (Ctrl+Shift+Enter, or ← when not typing)">← Previous</button>
        <select id="meetJump" aria-label="Jump to section"></select>
        <button class="btn btn-primary" id="meetNext" title="Next (Ctrl+Enter, or → when not typing)">Next →</button>
      </footer>
    </div>`;
  $('#meetExit').onclick = exitMeeting;
  $('#meetPrev').onclick = () => meetGo(-1);
  $('#meetNext').onclick = () => meetGo(1);
  $('#meetPause').onclick = toggleMeetTimer;
  $('#meetGuideBtn').onclick = () => toggleDrawer('guide');
  $('#meetLaterBtn').onclick = () => toggleDrawer('later');
  $('#meetHelpBtn').onclick = () => toggleDrawer('help');
  const jump = $('#meetJump');
  const firsts = [];
  meet.steps.forEach((x, i) => { const k = x.s ? x.s.id : 'final'; if (!firsts.some((f) => f.k === k)) firsts.push({ k, i, label: x.s ? `${x.s.no}. ${x.s.title}` : finalLabel() }); });
  jump.innerHTML = firsts.map((f) => `<option value="${f.i}">${esc(f.label)}</option>`).join('') + `<option value="${meet.steps.length}">Finish - summary</option>`;
  jump.onchange = () => meetShow(Number(jump.value));
  if (!canEdit()) d.meeting.running = false;
  else if (d.meeting.running === undefined) d.meeting.running = true;
  meetShow(meet.i);
  startMeetTimer();
}

function meetShow(i) {
  const d = state.iv.data;
  meet.i = Math.max(0, Math.min(i, meet.steps.length));
  const main = $('#meetMain');
  if (meet.i === meet.steps.length) { meetSummary(main); updateMeetBar(); return; }
  const step = meet.steps[meet.i], q = step.q;
  d.meeting.pos = step.key;
  const p = step.s ? `sections.${step.s.id}.answers.${q.id}` : `final.q${step.final}`;
  const numInSection = step.s ? meet.steps.filter((x) => x.s && x.s.id === step.s.id).indexOf(step) : null;
  main.innerHTML = step.s ? `
    <p class="eyebrow">${step.s.no}. ${esc(step.s.title)} · ${q.id === 'opener' ? 'Opening question' : `Question ${numInSection} · ${esc(T.depths.find((x) => x.id === q.level).label)}`}${q.retired ? ' · retired' : ''}</p>
    <h1 class="meet-q">${esc(q.q)}</h1>
    ${q.fu.length ? `<ul class="meet-probes">${q.fu.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${quickAnswerHtml(p, q, true)}
    <textarea class="meet-notes" data-path="${p}.r" rows="6" placeholder="Notes - what the ${esc(qnOf(meet.iv).subject)} said… (Esc to leave the box and use single-key shortcuts)">${esc(val(p + '.r'))}</textarea>
    <div class="meet-meta">
      <label class="inline">Evidence ${sel(p + '.ev', T.evidenceStatuses)}</label>
      ${chk(p + '.flag', 'Red flag / concern <kbd>F</kbd>', 'flag')}
      ${chk(p + '.later', 'Come back to this <kbd>M</kbd>', 'later')}
      ${canEdit() ? `<a class="btn btn-small btn-ghost" href="#/finding/new?interview=${state.iv.id}&section=${step.s.id}&q=${q.id}">+ Raise finding</a>` : ''}
    </div>` : `
    <p class="eyebrow">${esc(finalLabel())} · ${step.final + 1} of ${qnOf(meet.iv).finalQuestions.length}</p>
    <h1 class="meet-q">${esc(q.q)}</h1>
    <textarea class="meet-notes" data-path="${p}" rows="8" placeholder="Response…">${esc(val(p))}</textarea>`;
  bindFields(main);
  $$('.meet-meta .later input, .meet-meta .flag input', main).forEach((c) => c.addEventListener('change', () => { if ($('#meetDrawer').dataset.kind === 'later') renderDrawer('later'); }));
  const ta = $('.meet-notes', main);
  if (ta && canEdit()) ta.focus({ preventScroll: true });
  updateMeetBar();
  if (!$('#meetDrawer').hidden) renderDrawer($('#meetDrawer').dataset.kind);
  if (canEdit()) scheduleSave();
}

function meetSummary(main) {
  const d = state.iv.data;
  const qSteps = meet.steps.filter((x) => x.s);
  const ans = (x) => d.sections[x.s.id]?.answers?.[x.q.id] || {};
  const answered = qSteps.filter((x) => (ans(x).r || '').trim() || ans(x).qa).length;
  const sig = (x) => ans(x).qa && T.answerSignal(x.q, ans(x).qa);
  const concerns = qSteps.filter((x) => sig(x) === 'concern'), unknown = qSteps.filter((x) => sig(x) === 'unknown');
  const flagged = qSteps.filter((x) => ans(x).flag), later = markedForLater(d);
  const li = (x) => `<li><button type="button" class="link-btn" data-goto="${meet.steps.indexOf(x)}">${x.s.no}. ${esc(x.q.q)}</button></li>`;
  main.innerHTML = `<p class="eyebrow">End of interview</p><h1 class="meet-q">Summary</h1>
    <div class="tiles">
      <div class="tile"><span class="tile-label">Questions answered</span><span class="tile-value">${answered} / ${qSteps.length}</span></div>
      <div class="tile"><span class="tile-label">Concerning answers</span><span class="tile-value">${concerns.length}</span></div>
      <div class="tile"><span class="tile-label">"Don't know"</span><span class="tile-value">${unknown.length}</span></div>
      <div class="tile"><span class="tile-label">Red flags</span><span class="tile-value">${flagged.length}</span></div>
      <div class="tile"><span class="tile-label">Total time</span><span class="tile-value">${fmtClock(d.meeting.elapsed || 0)}</span></div>
    </div>
    ${later.length ? `<h3>Marked to come back to</h3><ul class="flag-list">${later.map(({ s, q }) => { const x = meet.steps.find((st) => st.s && st.s.id === s.id && st.q.id === q.id); return x ? li(x) : `<li>${s.no}. ${esc(q.q)}</li>`; }).join('')}</ul>` : ''}
    ${concerns.length ? `<h3>Concerning answers</h3><ul class="flag-list">${concerns.map(li).join('')}</ul>` : ''}
    ${unknown.length ? `<h3>"Don't know" - follow up</h3><ul class="flag-list">${unknown.map(li).join('')}</ul>` : ''}
    <p class="row"><a class="btn btn-primary" href="#/interview/${state.iv.id}/redflags">Record red flags heard</a>
      <a class="btn" href="#/interview/${state.iv.id}/checklist">Complete the checklist</a>
      <a class="btn" href="#/interview/${state.iv.id}/report">Draft the report</a></p>`;
  $$('[data-goto]', main).forEach((b) => { b.onclick = () => meetShow(Number(b.dataset.goto)); });
}

function updateMeetBar() {
  const d = state.iv.data, step = meet.steps[meet.i];
  const total = meet.steps.length;
  $('#meetSection').textContent = step ? (step.s ? `${step.s.no}. ${step.s.title}` : finalLabel()) : 'Summary';
  $('#meetCount').textContent = step ? `${meet.i + 1} of ${total}` : `${total} of ${total}`;
  $('#meetProgBar').style.width = `${(Math.min(meet.i, total) / total) * 100}%`;
  const sid = step && step.s ? step.s.id : null;
  const secT = sid ? d.meeting.sectionTime[sid] || 0 : 0, budget = sid ? sectionBudgetSec(d, sid) : 0;
  const allBudget = (Number(d.header.plannedMinutes) || T.depths.find((x) => x.id === depthOf(d)).minutes) * 60;
  $('#tSec').textContent = sid ? fmtClock(secT) : '-';
  $('#tSecBudget').textContent = sid ? fmtClock(budget) : '-';
  $('#tSec').parentElement.classList.toggle('over', !!sid && secT > budget);
  $('#tAll').textContent = fmtClock(d.meeting.elapsed || 0);
  $('#tAllBudget').textContent = fmtClock(allBudget);
  $('#tAll').parentElement.classList.toggle('over', (d.meeting.elapsed || 0) > allBudget);
  $('#meetPause').textContent = d.meeting.running ? '❚❚ Pause' : '▶ Resume';
  $('#meetPrev').disabled = meet.i === 0;
  $('#meetNext').textContent = meet.i >= total ? 'Finished' : meet.i === total - 1 ? 'Finish →' : 'Next →';
  $('#meetNext').disabled = meet.i >= total;
  const jump = $('#meetJump');
  const opts = [...jump.options].map((o) => Number(o.value));
  jump.value = String(opts.filter((v) => v <= meet.i).pop() ?? 0);
  const later = markedForLater(d).length;
  $('#meetLaterBtn').textContent = `⚑ Marked${later ? ` (${later})` : ''}`;
}

function startMeetTimer() {
  clearInterval(meet.timer);
  // Clock-based, so time keeps counting while you switch to another window (browsers slow background timers).
  // Each tick adds at most 2 minutes, so a laptop left asleep does not add hours to the interview.
  let ticks = 0, last = Date.now(), carry = 0;
  meet.timer = setInterval(() => {
    if (!document.body.classList.contains('meeting-mode') || !state.iv) { clearInterval(meet.timer); return; }
    const d = state.iv.data, nowMs = Date.now();
    const delta = Math.min(nowMs - last, 120000); last = nowMs;
    if (!d.meeting.running) { carry = 0; return; }
    carry += delta;
    const secs = Math.floor(carry / 1000); if (!secs) return;
    carry -= secs * 1000;
    const step = meet.steps[meet.i];
    d.meeting.elapsed = (d.meeting.elapsed || 0) + secs;
    if (step && step.s) d.meeting.sectionTime[step.s.id] = (d.meeting.sectionTime[step.s.id] || 0) + secs;
    updateMeetBar();
    if (++ticks % 20 === 0) scheduleSave(); // persist timers without saving every second
  }, 1000);
}
function toggleMeetTimer() {
  if (!canEdit()) return;
  state.iv.data.meeting.running = !state.iv.data.meeting.running;
  updateMeetBar(); scheduleSave();
}
function meetGo(delta) { meetShow(meet.i + delta); }

function toggleDrawer(kind) {
  const dr = $('#meetDrawer');
  if (!dr.hidden && dr.dataset.kind === kind) { dr.hidden = true; return; }
  dr.hidden = false; dr.dataset.kind = kind; renderDrawer(kind);
}
function renderDrawer(kind) {
  const dr = $('#meetDrawer'), step = meet.steps[meet.i];
  if (kind === 'guide') {
    const s = step && step.s;
    dr.innerHTML = s ? `<h2>Guide - ${esc(s.title)}</h2><dl class="guide-dl stacked">
      <dt>Risk being assessed</dt><dd>${esc(s.risk)}</dd><dt>Expected control</dt><dd>${esc(s.control)}</dd>
      <dt>Evidence to request</dt><dd><ul>${s.evidence.filter((e) => !e.retired).map((e) => `<li>${esc(e.text)}</li>`).join('')}</ul></dd>
      <dt>Red flags to listen for</dt><dd><ul>${s.redFlags.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></dd></dl>
      <p class="hint">Record evidence status and the four-way comparison afterwards in the section view.</p>` : '<p class="empty">No section guide for this step.</p>';
  } else if (kind === 'later') {
    const list = markedForLater();
    dr.innerHTML = `<h2>Marked to come back to</h2>${list.length ? `<ul class="flag-list">${list.map(({ s, q }) => { const idx = meet.steps.findIndex((x) => x.s && x.s.id === s.id && x.q.id === q.id); return `<li>${idx >= 0 ? `<button type="button" class="link-btn" data-goto="${idx}">${s.no}. ${esc(q.q)}</button>` : `${s.no}. ${esc(q.q)}`}</li>`; }).join('')}</ul>` : '<p class="empty">Nothing marked yet. Press M on a question to mark it.</p>'}`;
    $$('[data-goto]', dr).forEach((b) => { b.onclick = () => meetShow(Number(b.dataset.goto)); });
  } else if (kind === 'help') {
    dr.innerHTML = `<h2>Keyboard shortcuts</h2>
      <h3>Any time</h3><dl class="keys"><dt><kbd>Ctrl</kbd>+<kbd>Enter</kbd></dt><dd>Next question</dd><dt><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></dt><dd>Previous question</dd>
      <dt><kbd>Alt</kbd>+<kbd>1</kbd>…<kbd>5</kbd></dt><dd>Quick answer (in the order shown)</dd><dt><kbd>Esc</kbd></dt><dd>Leave the notes box</dd></dl>
      <h3>When not typing</h3><dl class="keys"><dt><kbd>→</kbd> / <kbd>←</kbd></dt><dd>Next / previous</dd><dt><kbd>1</kbd>…<kbd>5</kbd></dt><dd>Quick answer</dd>
      <dt><kbd>Enter</kbd></dt><dd>Start typing notes</dd><dt><kbd>F</kbd></dt><dd>Red flag on/off</dd><dt><kbd>M</kbd></dt><dd>Mark to come back to</dd>
      <dt><kbd>E</kbd></dt><dd>Next evidence status</dd><dt><kbd>P</kbd></dt><dd>Pause / resume timers</dd><dt><kbd>G</kbd></dt><dd>Section guide</dd>
      <dt><kbd>L</kbd></dt><dd>Marked list</dd><dt><kbd>?</kbd></dt><dd>This help</dd><dt><kbd>Q</kbd></dt><dd>Exit meeting mode</dd></dl>`;
  }
}

function exitMeeting() {
  const step = meet.steps[meet.i];
  location.hash = `#/interview/${state.iv.id}/${step && step.s ? step.s.id : step ? 'final' : 'redflags'}`;
}

function meetToggleCheck(cls) {
  const cb = $(`.meet-meta .${cls} input`); if (!cb || cb.disabled) return;
  cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
}
function meetQuick(n) {
  const btn = $$('#meetMain .qa-btn')[n - 1];
  if (btn && !btn.disabled) btn.click();
}

document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('meeting-mode') || !$('#meet')) return;
  if (document.querySelector('dialog[open]')) return;
  const typing = e.target instanceof Element && e.target.matches('textarea, input:not([type=checkbox]), select');
  if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); meetGo(e.shiftKey ? -1 : 1); return; }
  if (e.altKey && /^[1-5]$/.test(e.key)) { e.preventDefault(); meetQuick(Number(e.key)); return; }
  if (typing) { if (e.key === 'Escape') { e.preventDefault(); e.target.blur(); } return; }
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const actions = {
    ArrowRight: () => meetGo(1), ArrowLeft: () => meetGo(-1),
    Enter: () => { const t = $('.meet-notes'); if (t) t.focus(); },
    f: () => meetToggleCheck('flag'), m: () => meetToggleCheck('later'),
    e: () => { const s = $('.meet-meta select'); if (s && !s.disabled) { s.selectedIndex = (s.selectedIndex + 1) % s.options.length; s.dispatchEvent(new Event('change')); } },
    p: toggleMeetTimer, g: () => toggleDrawer('guide'), l: () => toggleDrawer('later'), '?': () => toggleDrawer('help'),
    q: exitMeeting, Escape: () => { $('#meetDrawer').hidden = true; },
  };
  if (/^[1-5]$/.test(k)) { e.preventDefault(); meetQuick(Number(k)); return; }
  if (actions[k]) { e.preventDefault(); actions[k](); }
});
