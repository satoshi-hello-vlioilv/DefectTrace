// ロット一覧（左の木）の「画像なし」の札の案（2 回目）。画像なしのロット（DL2）を開き、画像のあるロット（LS3 10/25）も開いて撮る:
//   DT_UI_LOT=DL2/2026/2026_10/2026_10_23/2026_10_23_21_27_46 node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-28-noimage-badge-2.mjs
//
// 1 回目の採点（1 位 H 75.1 点。合格点に届かず）から:
//  - 灰の字の札「画像なし」は、赤の多量と区別でき『確かめなくてよい』と読める → 持ち越す
//  - 300px の木では、札を足すと材質・欠陥数が切れる（今は切れない → 後退）。木を 380px にすると 1280 で画像一覧の 4 列が消える（−10）
//  - 札が 10px で読みにくい（多量の札も同じ）→ 札はみな 11px に
//  - H（2 段）は切れないが縦に伸び、2 段目の字下げが時刻とそろわない
//
// 今の困りごと（ui-check で木を撮って見て）:
//  1. 多量の札（赤）はあるが、画像の無いロット（良品などで検出画像を残していない。確かめる画像が無い）は、開くまで分からない
//  2. 日の行の「n ロット 多量 n」にも、画像の無いロットの数が出ない
//  3. 一覧の行の項目に材質と欠陥数を足した（裏の既定）ので、300px の木では札と並ぶと材質が「A !」のように切れ、札も右で切れる
//     → 札の形だけでなく、行の組み方（木を広げる・行を 2 段に）の案も入れる
// 案の方向: 札の形（字の札・記号・行を薄く）× 置き場（行の右・日の行の数）× 減らし方（隠す切り替え）
// 印はロットの答え（/api/lotsum の flags.no_image）から付ける（作るときは flagHtml）

const MARK = (html, dim, day) => ["script", `window.__mark = async () => {
  const lis = [...document.querySelectorAll("#tree li.lot")];
  const r = await (await fetch("/api/lotsum", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths: lis.map((l) => l.dataset.path) }) })).json();
  for (const li of lis) { const f = (r[li.dataset.path] || {}).flags || {}; li.querySelectorAll(".nb").forEach((x) => x.remove());
    if (f.no_image) { li.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); ${dim ? 'li.classList.add("nimg");' : ""} } }
  ${day ? `document.querySelectorAll("#tree li").forEach((d) => { const ul = d.querySelector(":scope>ul"); if (!ul) return; const lots = [...ul.querySelectorAll(":scope>li.lot")]; const n = lots.filter((l) => l.querySelector(".nb")).length;
    const cnt = d.querySelector(":scope>.row .cnt"); if (cnt && lots.length && n && !cnt.querySelector(".nbd")) cnt.insertAdjacentHTML("beforeend", ' <span class="fl nbd" title="画像なしのロット数">画像なし ' + n + '</span>'); });` : ""}
};`];

// 撮る前に LS3 の 10/25 も開く（画像のあるロット・多量の札と並べて見る）
const OPEN_LS3 = `return (async () => {
  const step = async (re) => { const li = [...document.querySelectorAll("#tree li")].find((l) => re.test(l.querySelector(":scope>.row .nm")?.textContent || "") && !l.querySelector(":scope>ul:not([hidden]) > li"));
    if (li) { li.querySelector(":scope>.row").click(); await new Promise((r) => setTimeout(r, 500)); } };
  for (const re of [/^LS3$/, /^2026$/, /^2026\\/10$/, /^10\\/25/]) await step(re);
  await new Promise((r) => setTimeout(r, 1200));
  if (window.__mark) await window.__mark();
})()`;
export const STATES = { tree: OPEN_LS3 };

const BASE = `.fl{font-size:11px;line-height:16px}.fl.nb,.fl.nbd{background:#eef1f4;color:#4b5563;border:1px solid #cfd6de;font-weight:700}`;
const NB = '<span class="fl nb" title="画像なし: 検出画像が 0 件（良品などで画像を残していない）。確かめる画像はありません">画像なし</span>';
export const PROPOSALS = [
  {
    key: "P", name: "（新）幅を取らない印: 画像なしのロットは左の縁を灰の破線に（形でも分かる）＋日の行に「画像なし n」の札（同じ灰の破線の見本付き）。札は 11px",
    css: BASE + `#tree li.lot.nimg{border-left:3px dashed #9aa5b1}#tree li.lot.nimg .nb{display:none}.fl.nbd:before{content:"";display:inline-block;width:0;height:9px;border-left:3px dashed #9aa5b1;margin-right:4px;vertical-align:-1px}`,
    ops: [MARK(NB, true, true)],
  },
  {
    key: "Q", name: "（H の直し）行を 2 段に: 2 段目（材質・欠陥数）を時刻の位置にそろえ、行の間を詰める（縦の伸びを抑える）＋札 11px・日の行の数",
    css: BASE + `#tree li.lot{flex-wrap:wrap;row-gap:0;padding-top:1px;padding-bottom:1px;line-height:1.25}#tree li.lot::after{content:"";flex-basis:100%;order:4;height:0}
#tree li.lot>.v{order:5;font-size:12px;color:var(--sub)}#tree li.lot>.v:first-of-type{margin-left:calc(7.5ch + 6px)}`,
    ops: [MARK(NB, false, true)],
  },
  {
    key: "S", name: "（新）木を 340px に（+40px。1280 でも画像一覧の 4 列が残るか）＋札 11px・日の行の数",
    css: BASE + `#treePane{width:340px}`,
    ops: [MARK(NB, false, true)],
  },
  {
    key: "T", name: "（新）札のある行だけ 2 段: 1 段目はロット No・時刻・材質・欠陥数（今と同じ）、札（多量・画像なし・上限）は 2 段目の右へ。札の無い行は 1 段のまま",
    css: BASE + `#tree li.lot{flex-wrap:wrap;align-items:center;row-gap:1px}#tree li.lot>.fl{order:6;align-self:auto}#tree li.lot.hasfl::after{content:"";flex-basis:100%;order:5;height:0}#tree li.lot.hasfl>.fl:first-of-type{margin-left:auto}`,
    ops: [MARK(NB, false, true), ["script", `const m0 = window.__mark; window.__mark = async () => { await m0(); document.querySelectorAll("#tree li.lot").forEach((li) => li.classList.toggle("hasfl", !!li.querySelector(".fl"))); };`]],
  },
  {
    key: "U", name: "（新）短い言葉の札「画像 0」（数で言う。幅は「画像なし」の 6 割）＋日の行「画像 0: n」。札 11px",
    css: BASE,
    ops: [MARK('<span class="fl nb" title="画像なし: 検出画像が 0 件（良品などで画像を残していない）。確かめる画像はありません">画像 0</span>', false, true),
      ["script", `const m0 = window.__mark; window.__mark = async () => { await m0(); document.querySelectorAll(".fl.nbd").forEach((x) => { x.textContent = x.textContent.replace("画像なし ", "画像 0: "); }); };`]],
  },
];
