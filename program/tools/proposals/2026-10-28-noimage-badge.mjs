// ロット一覧（左の木）の「画像なし」の札の案（1 回目）。画像なしのロット（DL2）を開き、画像のあるロット（LS3 10/25）も開いて撮る:
//   DT_UI_LOT=DL2/2026/2026_10/2026_10_23/2026_10_23_21_27_46 node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-28-noimage-badge.mjs
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

const BASE = `.fl.nb,.fl.nbd{background:#eef1f4;color:#4b5563;border:1px solid #cfd6de}`;
export const PROPOSALS = [
  {
    key: "A", name: "行の右に灰の字の札「画像なし」（多量の赤と並ぶ置き場・落ち着いた色で『確かめなくてよい』）",
    css: BASE, ops: [MARK('<span class="fl nb" title="画像なし: 検出画像が 0 件（良品などで画像を残していない）。確かめる画像はありません">画像なし</span>', false, false)],
  },
  {
    key: "C", name: "記号だけ「∅」（灰）＋日の行の数「∅ n」。幅を取らない。押さえると説明",
    css: BASE + `.fl.nb.sym{font-size:12px;padding:0 5px;font-weight:700}`,
    ops: [MARK('<span class="fl nb sym" title="画像なし: 検出画像が 0 件。確かめる画像はありません">∅</span>', false, true)],
  },
  {
    key: "D", name: "A＋日の行の数に「画像なし n」（多量 n の隣）: 開かなくても日ごとに分かる",
    css: BASE, ops: [MARK('<span class="fl nb" title="画像なし: 検出画像が 0 件。確かめる画像はありません">画像なし</span>', false, true)],
  },
  {
    key: "G", name: "D＋木の幅を 300 → 380px に（材質・欠陥数と札が 1 行に収まる）",
    css: BASE + `#treePane{width:380px}`, ops: [MARK('<span class="fl nb" title="画像なし: 検出画像が 0 件。確かめる画像はありません">画像なし</span>', false, true)],
  },
  {
    key: "H", name: "D＋行を 2 段に: 1 段目にロット No・時刻・札、2 段目に材質・欠陥数（小さな灰の字）。木の幅はそのまま",
    css: BASE + `#tree li.lot{flex-wrap:wrap;row-gap:0}#tree li.lot::after{content:"";flex-basis:100%;order:4}#tree li.lot>.v{order:5;font-size:12px;color:var(--sub)}#tree li.lot>.v:first-of-type{margin-left:7.5ch}`,
    ops: [MARK('<span class="fl nb" title="画像なし: 検出画像が 0 件。確かめる画像はありません">画像なし</span>', false, true)],
  },
  {
    key: "F", name: "B＋日の行の数＋木の上に「画像なしを隠す」の切り替え（見るべきロットだけにできる）",
    css: BASE + `#tree li.nimg>.row,#tree li.nimg>span{color:#8b95a1}#tree li.nimg .ln{color:#8b95a1}.nb-tog{font-size:12px;color:var(--sub);display:flex;gap:4px;align-items:center;white-space:nowrap}`,
    ops: [MARK('<span class="fl nb" title="画像なし">画像なし</span>', true, true),
      ["script", `document.getElementById("treeFilter").parentElement.insertAdjacentHTML("beforeend", '<label class="nb-tog"><input type="checkbox"> 画像なしを隠す</label>');`]],
  },
];
