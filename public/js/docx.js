// Minimal Word (.docx) writer with no libraries, plus the app's Word exports.
// A .docx file is a zip of XML parts; this writes an uncompressed ("stored") zip, which Word opens normally.
'use strict';

const Docx = (() => {
  const enc = new TextEncoder();
  const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = (u8) => { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = enc.encode(f.xml), crc = crc32(data), size = data.length;
      const lh = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, size, 4], [22, size, 4], [26, name.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? lh.setUint32(o, v, true) : lh.setUint16(o, v, true)));
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, size, 4], [24, size, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, offset, 4]]
        .forEach(([o, v, n]) => (n === 4 ? ch.setUint32(o, v, true) : ch.setUint16(o, v, true)));
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, offset, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
    let pos = 0; all.forEach((p) => { out.set(p, pos); pos += p.length; });
    return out;
  }

  // Escape text for XML, dropping characters XML does not allow.
  const x = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // content: string | [string | {text, bold, italic, color, size}]
  function runs(content, base = {}) {
    return (Array.isArray(content) ? content : [content]).map((sg) => {
      const s = sg !== null && typeof sg === 'object' ? { ...base, ...sg } : { ...base, text: sg };
      const pr = (s.bold ? '<w:b/>' : '') + (s.italic ? '<w:i/>' : '') + (s.color ? `<w:color w:val="${s.color}"/>` : '') + (s.size ? `<w:sz w:val="${s.size * 2}"/><w:szCs w:val="${s.size * 2}"/>` : '');
      return String(s.text ?? '').split('\n').map((line, i) => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(line)}</w:t></w:r>`).join('');
    }).join('');
  }
  const p = (content, o = {}) => `<w:p><w:pPr>${o.style ? `<w:pStyle w:val="${o.style}"/>` : ''}${o.keepNext ? '<w:keepNext/>' : ''}${o.pageBreakBefore ? '<w:pageBreakBefore/>' : ''}${o.after != null ? `<w:spacing w:after="${o.after}"/>` : ''}${o.indent ? `<w:ind w:left="${o.indent}" w:hanging="${o.hanging || 0}"/>` : ''}${o.align ? `<w:jc w:val="${o.align}"/>` : ''}</w:pPr>${runs(content, o.run)}</w:p>`;
  const h = (level, text, o = {}) => p(text, { ...o, style: `Heading${level}` });
  const bullet = (content, n) => p(n ? [`${n}. `, ...(Array.isArray(content) ? content : [content])] : ['• ', ...(Array.isArray(content) ? content : [content])], { indent: 360, hanging: 260, after: 60 });
  // Free text where lines beginning "- " become bullets.
  const textBlock = (str, empty = 'Not completed.') => {
    const lines = String(str || '').split('\n');
    if (!lines.some((l) => l.trim())) return p(empty, { run: { italic: true, color: '666666' } });
    return lines.filter((l) => l.trim()).map((l) => (/^\s*[-•]\s+/.test(l) ? bullet(l.replace(/^\s*[-•]\s+/, '')) : p(l))).join('');
  };
  const pageWidth = (landscape) => (landscape ? 16838 : 11906) - 2 * 1134;
  // rows: array of arrays of cell content; cells may be {content, fill, bold}. o: {header, widths, landscape, firstColShade}
  function table(rows, o = {}) {
    if (!rows.length) return '';
    const n = Math.max(...rows.map((r) => r.length));
    const ws = o.widths || Array(n).fill(1), sum = ws.reduce((a, b) => a + b, 0), total = pageWidth(o.landscape);
    const tw = ws.map((w) => Math.floor((total * w) / sum));
    return `<w:tbl><w:tblPr><w:tblStyle w:val="TRTable"/><w:tblW w:w="${tw.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr>
      <w:tblGrid>${tw.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
      ${rows.map((r, ri) => `<w:tr>${o.header && ri === 0 ? '<w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}${Array.from({ length: n }, (_, ci) => {
        const c = r[ci]; const cell = c !== null && typeof c === 'object' && !Array.isArray(c) && 'content' in c ? c : { content: c ?? '' };
        const head = o.header && ri === 0, shade = head ? 'DCE6F2' : cell.fill || (o.firstColShade && ci === 0 ? 'F2F4F7' : '');
        return `<w:tc><w:tcPr><w:tcW w:w="${tw[ci]}" w:type="dxa"/>${shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${shade}"/>` : ''}</w:tcPr>${p(cell.content, { style: 'TableText', run: head || cell.bold || (o.firstColShade && ci === 0) ? { bold: true } : {} })}</w:tc>`;
      }).join('')}</w:tr>`).join('')}</w:tbl><w:p><w:pPr><w:spacing w:after="0" w:line="140" w:lineRule="exact"/></w:pPr></w:p>`;
  }
  const kv = (pairs, o = {}) => table(pairs.map(([k, v]) => [k, v ?? '']), { widths: [1, 2.6], firstColShade: true, ...o });
  const pageBreak = () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:color w:val="1C4F8A"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1C4F8A"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="1C4F8A"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Subtle"><w:name w:val="Subtle"/><w:basedOn w:val="Normal"/><w:rPr><w:color w:val="595959"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="TableText"><w:name w:val="Table Text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TRTable"><w:name w:val="TR Table"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

  // Build the whole document. Returns the file bytes.
  function build({ title, author, footer, landscape }, body) {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    const created = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const pg = landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
    return zip([
      { name: '[Content_Types].xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>` },
      { name: '_rels/.rels', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>` },
      { name: 'docProps/core.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dc:creator>${x(author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created></cp:coreProperties>` },
      { name: 'word/_rels/document.xml.rels', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>` },
      { name: 'word/styles.xml', xml: STYLES },
      { name: 'word/footer1.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr ${W}><w:p><w:pPr><w:pStyle w:val="Subtle"/><w:jc w:val="right"/></w:pPr><w:r><w:t xml:space="preserve">${x(footer)} · Page </w:t></w:r><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p></w:ftr>` },
      { name: 'word/document.xml', xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document ${W} xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/>${pg}<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>` },
    ]);
  }
  return { build, p, h, bullet, textBlock, table, kv, pageBreak };
})();

// ---------- the app's Word exports ----------
const WORD_FILL = { Critical: 'F4CCCC', High: 'FCE4D6', Medium: 'FFF2CC', Low: 'E2EFDA' };
const D = Docx;
function saveDocx(bytes, name) { saveBlob(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), name); }
const wordFooter = () => `Technology Risk · CONFIDENTIAL · generated ${fmtDateTime(new Date().toISOString())} by ${state.user.fullName}`;
const ratingCell = (r, s) => ({ content: r ? `${r}${s ? ` (${s})` : ''}` : 'Not rated', fill: WORD_FILL[r] || '' });
function wordFindingsTable(fs, landscape) {
  return D.table([['Ref', 'Finding', 'Category', 'Classification', 'Inherent', 'Residual', 'Owner', 'Target', 'Status'],
    ...fs.map((f) => { const s = findingScores(f); return [f.ref, f.title, f.category, f.classification, ratingCell(s.inhR, s.inh), ratingCell(s.resR, s.res), f.controlOwner, f.targetDate ? fmtDate(f.targetDate) : '', f.status]; })],
  { header: true, widths: [0.9, 2.6, 1.3, 1.2, 0.9, 0.9, 1.2, 0.9, 0.9], landscape });
}
function wordIvHeader(iv) {
  const h = iv.data.header || {};
  return D.kv([['Reference', iv.ref], ['Interviewee', `${h.developerName || ''}${h.developerRole ? ', ' + h.developerRole : ''}`], ['Team', h.team], ['Application(s)', h.applications],
    ['Business service(s)', h.businessService], ['Criticality', h.criticality], ['Data classification', h.dataClassification],
    ['Interview', `${h.date ? fmtDate(h.date) : ''}${h.interviewer ? ' · ' + h.interviewer : ''} · ${(T.depths.find((x) => x.id === depthOf(iv.data)) || {}).label || ''} depth`], ['Status', iv.status]]);
}
function wordExecSummaryBody(m) {
  const tone = { good: '13810F', warn: '955800', bad: 'C0302F' }[m.tone] || '595959';
  return [
    D.p('Executive summary', { style: 'Title' }),
    D.p(`${m.h.developerName || ''}${m.h.team ? ' · ' + m.h.team : ''} · ${m.iv.ref}`, { style: 'Subtle' }),
    D.table([[{ content: 'Application(s)', fill: 'F2F4F7', bold: true }, m.h.applications || '', { content: 'Criticality', fill: 'F2F4F7', bold: true }, m.h.criticality || 'not recorded'],
      [{ content: 'Business service(s)', fill: 'F2F4F7', bold: true }, m.h.businessService || '', { content: 'Interview', fill: 'F2F4F7', bold: true }, `${m.h.date ? fmtDate(m.h.date) : ''} · ${m.h.interviewer || ''}`]], { widths: [0.9, 1.6, 0.8, 1.6] }),
    D.h(2, `Overall assessment${m.overall === m.auto ? ' (indicative)' : ''}`),
    D.p({ text: m.overall, bold: true, color: tone, size: 13 }),
    D.p(m.headline),
    m.ukAffected.length ? D.p([{ text: 'Regulatory areas affected: ', bold: true }, m.ukAffected.map(([a, n]) => `${a} - ${areaRegulator(a)} (${n})`).join(' · ')]) : '',
    D.table([m.figures.slice(0, 4), m.figures.slice(4)].map((row) => row.map(([l, v]) => ({ content: [`${l}: `, { text: String(v), bold: true }] }))), { widths: [1, 1, 1, 1] }),
    D.h(2, 'Top risks'),
    m.open.length ? D.table([['Ref', 'Finding', 'Rating', 'Owner', 'Target'], ...m.open.slice(0, 5).map((x) => [x.f.ref, x.f.title, ratingCell(x.effR), x.f.controlOwner, x.f.targetDate ? fmtDate(x.f.targetDate) : ''])], { header: true, widths: [0.9, 3.4, 1, 1.4, 1] }) : D.p('No open findings.'),
    D.h(2, 'Control areas'),
    // Compact four-column grid so the summary stays on one page; colour shows the rating, the text names it.
    ...(() => { const assessed = m.ratings.filter((x) => x.r !== 'Not assessed'); const rest = m.ratings.length - assessed.length;
      return [!assessed.length ? D.p('No control areas assessed yet.') : '', rest ? D.p(`${rest} of ${m.ratings.length} areas in scope not yet assessed.`, { style: 'Subtle', after: 40 }) : '']; })(),
    D.table(Array.from({ length: Math.ceil(m.ratings.filter((x) => x.r !== 'Not assessed').length / 4) }, (_, r) => m.ratings.filter((x) => x.r !== 'Not assessed').slice(r * 4, r * 4 + 4).map((x) => ({
      content: [{ text: `${x.s.no}. ${x.s.title}\n`, bold: true }, { text: x.r, color: '404040' }],
      fill: { Effective: 'E2EFDA', 'Partially effective': 'FFF2CC', Ineffective: 'F4CCCC' }[x.r] || '',
    }))), { widths: [1, 1, 1, 1] }),
    D.table([['Strengths', 'Immediate actions'], [
      m.strengths.length ? m.strengths.slice(0, 6).map((s) => `• ${s}`).join('\n') : 'None rated effective yet.',
      m.actions.length ? m.actions.map((a, i) => `${i + 1}. ${a}`).join('\n') : 'None identified.',
    ]], { header: true, widths: [1, 2] }),
    D.p(`${T.APPLIES} Overall assessment ${m.overall === m.auto ? 'is derived from ratings and findings - assessor to confirm' : 'set by the assessor'}.`, { style: 'Subtle' }),
  ].join('');
}
async function wordExecSummary(ivId) {
  const iv = await api('GET', `/api/interviews/${ivId}`), fs = await api('GET', `/api/findings?interview=${ivId}`);
  saveDocx(D.build({ title: `Executive summary ${iv.ref}`, author: state.user.fullName, footer: `${iv.ref} executive summary · ${wordFooter()}` }, wordExecSummaryBody(execSummaryModel(iv, fs))), `${iv.ref} executive summary.docx`);
}
async function wordInterviewReport(ivId) {
  const iv = await api('GET', `/api/interviews/${ivId}`), fs = await api('GET', `/api/findings?interview=${ivId}`);
  const r = iv.data.report || {}, Q = qnOf(iv);
  const body = [
    D.p(`${Q.guideTitle} - Report`, { style: 'Title' }),
    D.p(`${iv.ref} · ${Q.title} questionnaire, version ${iv.data.questionnaireVersion || 'n/a'}`, { style: 'Subtle' }),
    wordIvHeader(iv),
    D.pageBreak(), wordExecSummaryBody(execSummaryModel(iv, fs)), D.pageBreak(),
    D.h(1, 'Interview report'),
    ...Q.reportSections.map(([k, l], i) => D.h(2, `${i + 1}. ${l}`) + D.textBlock(r[k])),
    D.h(1, 'Findings'), fs.length ? wordFindingsTable(fs) : D.p('No findings recorded.'),
    D.h(1, 'Final questions'),
    ...Q.finalQuestions.map((q, i) => D.p({ text: q, bold: true }) + D.textBlock(iv.data.final?.['q' + i], '-')),
    D.h(1, 'Sign-off'),
    D.table([['', 'Name', 'Signature', 'Date'], ['Prepared by', iv.data.header?.interviewer || '', '', ''], ['Reviewed by', '', '', '']], { header: true, widths: [1.2, 2, 2, 1.2] }),
  ].join('');
  saveDocx(D.build({ title: `Interview report ${iv.ref}`, author: state.user.fullName, footer: `${iv.ref} · ${wordFooter()}` }, body), `${iv.ref} interview report.docx`);
}
async function wordFindingsRegister() {
  const [fs, ivs] = await Promise.all([api('GET', '/api/findings'), api('GET', '/api/interviews')]);
  const ref = Object.fromEntries(ivs.map((i) => [i.id, i.ref]));
  const open = fs.filter((f) => f.status !== 'Closed');
  const body = [
    D.p('Technology Risk Findings Register', { style: 'Title' }),
    D.p(`${fs.length} findings · ${open.length} open · ${fs.filter(isOverdue).length} overdue`, { style: 'Subtle' }),
    wordFindingsTable(fs, true),
    ...fs.map((f) => { const s = findingScores(f); return D.pageBreak() + D.h(2, `${f.ref} - ${f.title}`) + D.kv([
      ['Interview', ref[f.interviewId] || ''], ['Application / system', f.application], ['Interviewee / team', f.developerTeam], ['Category', f.category], ['Template', templateById(f.templateId)?.title || ''],
      ['Description', f.description], ['Evidence', f.evidence], ['Existing control', f.existingControl], ['Control effectiveness', f.controlEffectiveness],
      ['Inherent risk', s.inhR ? `${s.inhR} (${f.likelihood} × ${f.impact} = ${s.inh})` : 'Not rated'], ['Residual risk', s.resR ? `${s.resR} (${f.residualLikelihood} × ${f.residualImpact} = ${s.res})` : 'Not rated'],
      ['Classification', f.classification], ['Regulatory areas', findingUkAreas(f).map((a) => `${a} (${areaRegulator(a)})`).join(', ')], ['Specific rules', f.ukRelevance], ['Regulatory relevance', f.regulatoryRelevance],
      ['Recommended remediation', f.remediation], ['Control owner', f.controlOwner], ['Target date', f.targetDate ? fmtDate(f.targetDate) : ''],
      ['Risk acceptance', [f.riskAcceptance, f.riskAcceptanceRef, f.riskAcceptanceExpiry && `expires ${fmtDate(f.riskAcceptanceExpiry)}`].filter(Boolean).join(' - ')], ['Escalation', [f.escalation, f.escalatedTo].filter(Boolean).join(' - ')], ['Status', `${f.status}${f.closedAt ? ' (closed ' + fmtDate(f.closedAt) + ')' : ''}`],
      ['Closure evidence', [f.closureEvidence, f.closureVerifiedBy && `verified by ${f.closureVerifiedBy}`].filter(Boolean).join('\n')], ['Progress notes', f.progressNotes],
    ], { landscape: true }); }),
  ].join('');
  saveDocx(D.build({ title: 'Findings register', author: state.user.fullName, footer: `Findings register · ${wordFooter()}`, landscape: true }, body), `findings register ${today()}.docx`);
}
async function wordThemes(flt) {
  const [ivs, fs] = await Promise.all([api('GET', '/api/interviews?full=1'), api('GET', '/api/findings')]);
  const m = themesModel(ivs, fs, flt);
  const fl = [flt.from && 'from ' + flt.from, flt.to && 'to ' + flt.to, flt.team && 'team ' + flt.team, flt.app && `application "${flt.app}"`].filter(Boolean).join(', ') || 'all data';
  const body = [
    D.p('Technology Risk Interview Programme - Themes', { style: 'Title' }),
    D.p(`${m.ivs.length} interview(s) across ${m.teams.length} team(s), ${m.fs.length} finding(s) · filters: ${fl}`, { style: 'Subtle' }),
    D.h(1, 'Top themes'),
    m.top.length ? m.top.map((t, i) => D.bullet([{ text: `${t.label} `, bold: true }, `(${t.kind}, ${t.n} interviews) - ${t.detail}`], i + 1)).join('') : D.p('No theme yet affects two or more interviews.'),
    D.h(1, 'Regulatory areas affected'),
    m.areas.length ? D.table([['Area', 'Regulator', 'Source', 'Open findings', 'Interviews', 'Worst'], ...m.areas.map((a) => [a.area, a.regulator, a.source, String(a.open), String(a.interviews), ratingCell(a.worst)])], { header: true, widths: [1.6, 0.7, 2.6, 0.8, 0.8, 0.9] }) : D.p('No open findings linked to regulatory areas.'),
    D.p('PRA areas are listed first: the PRA is the bank\'s prudential regulator. FCA and ICO areas follow.', { style: 'Subtle' }),
    D.h(1, 'Recurring findings'),
    m.recurring.length ? D.table([['Finding', 'Interviews', 'Findings', 'Open', 'Worst', 'Teams'], ...m.recurring.map((g) => [g.label, String(g.n), String(g.findings.length), String(g.open), ratingCell(g.worst), [...g.teams].join(', ')])], { header: true, widths: [2.7, 1.05, 0.95, 0.7, 0.9, 1.8] }) : D.p('No findings.'),
    D.h(1, 'Red flags heard'),
    m.redFlags.length ? D.table([['Red flag', 'Interviews', 'Teams'], ...m.redFlags.map((x) => [`“${x.rf.quote}”`, String(x.n), [...x.teams].join(', ')])], { header: true, widths: [3, 0.8, 2] }) : D.p('None recorded.'),
    D.h(1, 'Control areas most often rated weak'),
    m.weak.length ? D.table([['Section', 'Rated weak', 'Assessed', 'Ineffective'], ...m.weak.map((x) => [secLabel(x.s), String(x.weak), String(x.rated), String(x.ineffective)])], { header: true, widths: [3, 1, 1, 1] }) : D.p('None.'),
    D.h(1, 'By team'),
    D.table([['Team', 'Interviews', 'Open findings', 'Contradictions', 'Knowledge gaps', 'Evidence outstanding', 'Overdue'], ...m.teams.map((t) => [t.name, String(t.interviews), String(t.open), t.contradictions == null ? '-' : String(t.contradictions), t.gaps == null ? '-' : String(t.gaps), String(t.outstanding), String(t.overdue)])], { header: true, widths: [1.7, 1.05, 1.05, 1.3, 1.1, 1.15, 0.85] }),
    D.h(1, 'Questions most often answered with a concern or “Don\'t know”'),
    m.st.topQs.length ? D.table([['Question', 'Section', 'Interviews', 'Concern', "Don't know"], ...m.st.topQs.map((x) => [x.q.q, secLabel(x.s), String(x.n), String(x.concern), String(x.unknown)])], { header: true, widths: [3.2, 1.8, 0.8, 0.8, 0.8] }) : D.p('No quick answers recorded.'),
    D.p(T.APPLIES, { style: 'Subtle' }),
  ].join('');
  saveDocx(D.build({ title: 'Programme themes', author: state.user.fullName, footer: `Programme themes · ${wordFooter()}` }, body), `programme themes ${today()}.docx`);
}
