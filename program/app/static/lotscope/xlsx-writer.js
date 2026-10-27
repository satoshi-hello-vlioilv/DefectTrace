"use strict";
/* =========================================================================
   Excel（.xlsx）を組む（一覧の「Excel に出力」: lotlist.js）。部品は使わない（アプリは標準の部品だけで動く決まり）。
   .xlsx は XML を zip にまとめた物（Office Open XML）。ここでは要る物だけを書く:
     [Content_Types].xml・_rels/.rels・xl/workbook.xml・xl/_rels/workbook.xml.rels・xl/styles.xml・xl/worksheets/sheetN.xml
   - 字はセルに直に書く（inlineStr。共有の字の表を作らない）。数に読める字（先頭の 0 の無い・15 桁まで）は数で書く（Excel で計算できる）
   - 見出しの行は太字・淡い地・固定（スクロールしても残る）・オートフィルター。列の幅は字の長さから
   - zip は CompressionStream（deflate-raw）で縮める。無い所では縮めずに入れる（stored）
   build(sheets) は DOM を使わない（評価関数 program/tools/xlsx-check.mjs が node で確かめる）
   sheets: [{ name, rows: [[値, …], …], header: true|false, widths?: [字数, …], paint?: (行, 列) → 色, digits?: [列 → 小数の桁 0〜6 か null] }]（1 行目が見出し）
     digits（版 3.50.1）: その列の数を、桁の表示形式（#,##0・#,##0.0 …）で書く。値は丸めない（Excel で計算すると元の値）。色付けのあるセルは色を先に
     paint: 色付け（条件付き書式。lotlist-marks.js）を写す。答えは { tone: 色の名前, whole: 行全体か } か null。
       色は画面と同じ 6 色（TONES）。セルの色付けは塗り＋濃い太字、行全体は塗りだけ（画面と同じ見え方）
   ========================================================================= */
(function (root) {
  const enc = new TextEncoder();
  const BAD_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
  const xml = (s) => String(s).replace(BAD_XML, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const NUM = /^-?(0|[1-9]\d{0,14})(\.\d+)?([eE][+-]?\d{1,3})?$/;
  /** A1 の列の字（0 → A・26 → AA） */
  function colName(i) { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; }
  /** シートの名前: 31 字まで・使えない字（[]:*?/\）を除く・同じ名前は (2) を付ける */
  function sheetNames(list) {
    const seen = new Set();
    return list.map((n, i) => {
      let base = String(n || `Sheet${i + 1}`).replace(/[[\]:*?/\\]/g, "").trim().slice(0, 31) || `Sheet${i + 1}`, name = base, k = 2;
      while (seen.has(name.toLowerCase())) name = `${base.slice(0, 27)}(${k++})`;
      seen.add(name.toLowerCase());
      return name;
    });
  }
  /** 色付けの色（画面の lotlist-marks.css と同じ）: [名前, 地, 字] */
  const TONES = [["red", "FDE4E1", "A52A1F"], ["amber", "FFF1CF", "7A5200"], ["green", "DDF3E4", "1D6B3A"], ["blue", "E1ECFB", "1F4F8A"],
    ["violet", "EFE6FB", "5A3592"], ["gray", "EEF1F4", "5F6B77"]];
  /** 書式の番号: 0 ふつう・1 見出し・2〜 色付けのセル（塗り＋字）・2+色の数〜 色付けの行（塗りだけ） */
  const toneStyle = (p) => {
    const i = p ? TONES.findIndex((t) => t[0] === p.tone) : -1;
    return i < 0 ? 0 : 2 + i + (p.whole ? TONES.length : 0);
  };
  function cellXml(v, r, c, style, text = false) {
    const ref = colName(c) + (r + 1), s = style ? ` s="${style}"` : "";
    if (v == null || v === "") return style ? `<c r="${ref}"${s}/>` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
    const t = String(v);
    if (!text && NUM.test(t)) return `<c r="${ref}"${s}><v>${t}</v></c>`;
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xml(t)}</t></is></c>`;
  }
  /** 字の見た目の幅（全角は 2）→ 列の幅（Excel の字数）。8〜60 */
  const textWidth = (s) => [...String(s ?? "")].reduce((n, ch) => n + (/[\u0000-ÿ｡-ﾟ]/.test(ch) ? 1 : 2), 0);
  function sheetXml(sh) {
    const rows = sh.rows || [], ncol = Math.max(1, ...rows.map((r) => r.length)), head = sh.header !== false && rows.length;
    const widths = (sh.widths || []).length ? sh.widths
      : Array.from({ length: ncol }, (_, c) => Math.min(60, Math.max(8, ...rows.slice(0, 300).map((r) => textWidth(r[c]) + 2))));
    const cols = `<cols>${widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${Math.round(w * 10) / 10}" customWidth="1"/>`).join("")}</cols>`;
    const paint = typeof sh.paint === "function" ? sh.paint : null;
    const data = rows.map((r, i) => {
      const top = head && i === 0;
      const dg = (c) => (sh.digits && typeof r[c] === "number" ? decStyle(sh.digits[c]) : 0);
      if (top || !paint) return `<row r="${i + 1}">${r.map((v, c) => cellXml(v, i, c, top ? 1 : dg(c), top)).join("")}</row>`;
      return `<row r="${i + 1}">${Array.from({ length: Math.max(r.length, ncol) }, (_, c) => cellXml(r[c], i, c, toneStyle(paint(i, c)) || dg(c))).join("")}</row>`;
    }).join("");
    const pane = head ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    const filter = head && rows.length > 1 ? `<autoFilter ref="A1:${colName(ncol - 1)}${rows.length}"/>` : "";
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + `${pane}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${data}</sheetData>${filter}</worksheet>`;
  }
  /** 桁の表示形式の書式の番号（0〜6 桁。無ければ 0＝標準）。0 桁は組み込みの #,##0（番号 3）、1〜6 桁は 165〜170 */
  const DECS = 7, DEC0 = 2 + TONES.length * 2;
  const decStyle = (d) => (d == null || !(d >= 0) ? 0 : DEC0 + Math.min(DECS - 1, Math.round(d)));
  const decFmtId = (d) => (d ? 164 + d : 3);
  const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + `<numFmts count="${DECS - 1}">${Array.from({ length: DECS - 1 }, (_, i) => `<numFmt numFmtId="${165 + i}" formatCode="#,##0.${"0".repeat(i + 1)}"/>`).join("")}</numFmts>`
    + `<fonts count="${2 + TONES.length}"><font><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font><font><b/><sz val="11"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>`
    + TONES.map(([, , ink]) => `<font><b/><sz val="11"/><color rgb="FF${ink}"/><name val="Yu Gothic"/><family val="3"/><charset val="128"/></font>`).join("") + "</fonts>"
    + `<fills count="${3 + TONES.length}"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6EE"/><bgColor indexed="64"/></patternFill></fill>`
    + TONES.map(([, bg]) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${bg}"/><bgColor indexed="64"/></patternFill></fill>`).join("") + "</fills>"
    + '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF8EA3B4"/></bottom><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + `<cellXfs count="${2 + TONES.length * 2 + DECS}"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>`
    + TONES.map((_, i) => `<xf numFmtId="0" fontId="${2 + i}" fillId="${3 + i}" borderId="0" xfId="0" applyFont="1" applyFill="1"/>`).join("")
    + TONES.map((_, i) => `<xf numFmtId="0" fontId="0" fillId="${3 + i}" borderId="0" xfId="0" applyFill="1"/>`).join("")
    + Array.from({ length: DECS }, (_, d) => `<xf numFmtId="${decFmtId(d)}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`).join("") + "</cellXfs>"
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  function files(sheets) {
    const names = sheetNames(sheets.map((s) => s.name));
    const out = [
      ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") + "</Types>"],
      ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + `<sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
        + (sheets.some((s) => s.header !== false && (s.rows || []).length > 1)
          ? `<definedNames>${sheets.map((s, i) => (s.header !== false && (s.rows || []).length > 1
            ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xml(names[i].replace(/'/g, "''"))}'!$A$1:$${colName(Math.max(1, ...s.rows.map((r) => r.length)) - 1)}$${s.rows.length}</definedName>` : "")).join("")}</definedNames>` : "")
        + "</workbook>"],
      ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")
        + `<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", STYLES],
    ];
    sheets.forEach((s, i) => out.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]));
    return out;
  }

  /* ---------------- zip（ローカルヘッダー＋中央ディレクトリ。名前は UTF-8 の印付き） ---------------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  async function deflate(b) {
    if (typeof CompressionStream === "undefined") return null;
    try {
      const s = new Blob([b]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(s).arrayBuffer());
    } catch (_) { return null; }
  }
  async function zip(entries) {
    const parts = [], central = [];
    let off = 0;
    const now = new Date(), dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF,
      dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    for (const [name, text] of entries) {
      const raw = enc.encode(text), packed = await deflate(raw), method = packed ? 8 : 0, body = packed || raw, nm = enc.encode(name), crc = crc32(raw);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
      h.setUint16(10, dt, true); h.setUint16(12, dd, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true); h.setUint32(22, raw.length, true);
      h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
      c.setUint16(12, dt, true); c.setUint16(14, dd, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true); c.setUint32(24, raw.length, true);
      c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + body.length;
    }
    const size = central.reduce((n, x) => n + x.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true); e.setUint32(12, size, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((n, x) => n + x.length, 0));
    let p = 0; for (const x of all) { out.set(x, p); p += x.length; }
    return out;
  }

  /** シートの並び → .xlsx のバイト列（Uint8Array） */
  const build = (sheets) => zip(files(sheets));
  const MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  root.XlsxWriter = { build, MIME, colName, sheetNames, TONES };
})(typeof window !== "undefined" ? window : globalThis);
