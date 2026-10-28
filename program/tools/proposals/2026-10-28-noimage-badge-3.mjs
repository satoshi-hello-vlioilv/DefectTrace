// ロット一覧（左の木）の「画像なし」の札の案（3 回目）。画像なしのロット（DL2）を開き、画像のあるロット（LS3 10/25）も開いて撮る:
//   DT_UI_LOT=DL2/2026/2026_10/2026_10_23/2026_10_23_21_27_46 node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-28-noimage-badge-3.mjs
//
// 2 回目の採点（1 位 T 77.4・2 位 S 77.1。S は札が 2 つ付く行の切れ −5 が無ければ 82 点前後）から:
//  - 意味の直し: 多量は「検査計の処理落ち（画像の未保存など）の可能性」の札。多量のロットで画像が無いのは良品だからとは限らない
//    → 多量のロットには「画像なし（確かめなくてよい）」を付けない（札が 2 つ並んで材質が切れる行も無くなる）
//  - S（340px）は 1280 でも画像一覧の列 1〜4 が残る。日の行の「画像なし n」は効いた → 持ち越す
//  - T（札のある行だけ 2 段）は切れないが行の高さがばらつく → 2 段にするのは収まらない行だけにする案を試す
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
    if (f.no_image && !(f.overload > 0)) { li.insertAdjacentHTML("beforeend", ${JSON.stringify(html)}); ${dim ? 'li.classList.add("nimg");' : ""} } }
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
const NB = '<span class="fl nb" title="画像なし: 検出画像が 0 件（良品などで画像を残していない）。確かめる画像はありません。多量のロットには付けません（画像を残せなかった可能性があるため）">画像なし</span>';
const LEGEND = ["script", `document.getElementById("tree").insertAdjacentHTML("afterend", '<div class="nb-leg"><span><span class="fl nb">画像なし</span> 確かめる画像なし（良品など）</span><span><span class="fl ovl">多量</span> 処理落ちの可能性（要確認）</span></div>');`];
const LEG_CSS = `.nb-leg{padding:6px 10px;border-top:1px solid var(--line);font-size:12px;color:var(--sub);display:flex;flex-wrap:wrap;gap:4px 14px;align-items:center}.nb-leg>span{white-space:nowrap}`;
const FIT = ["script", `const m0 = window.__mark; window.__mark = async () => { await m0(); document.querySelectorAll("#tree li.lot").forEach((li) => li.classList.toggle("wrap2", li.scrollWidth > li.clientWidth + 1)); };`];
export const PROPOSALS = [
  {
    key: "V", name: "（S の直し）木 340px・多量のロットには画像なしを付けない・札 11px・日の行に「画像なし n」",
    css: BASE + `#treePane{width:340px}`, ops: [MARK(NB, false, true)],
  },
  {
    key: "W", name: "（新）木は 300px のまま・多量のロットには付けない・札の余白を詰める（左右 3px・間 2px）",
    css: BASE + `.lot{gap:4px}.lot>.fl{padding:0 3px}.lot>.fl+.fl{margin-left:2px}`, ops: [MARK(NB, false, true)],
  },
  {
    key: "X", name: "（新）木は 300px のまま・多量には付けない・1 行に収まらない行だけ札を 2 段目の右へ（収まる行は今と同じ 1 段）",
    css: BASE + `#tree li.lot.wrap2{flex-wrap:wrap;align-items:center;row-gap:1px}#tree li.lot.wrap2>.fl{order:6}#tree li.lot.wrap2::after{content:"";flex-basis:100%;order:5;height:0}#tree li.lot.wrap2>.fl:first-of-type{margin-left:auto}`,
    ops: [MARK(NB, false, true), FIT],
  },
  {
    key: "Y", name: "（新）V＋木の下に札の見本（画像なし＝確かめる画像なし・多量＝処理落ちの可能性）。言葉の意味を推測させない",
    css: BASE + LEG_CSS + `#treePane{width:340px}`, ops: [MARK(NB, false, true), LEGEND],
  },
  {
    key: "Z", name: "（新）X＋木の下に札の見本（300px のまま・収まらない行だけ 2 段・見本で意味）",
    css: BASE + LEG_CSS + `#tree li.lot.wrap2{flex-wrap:wrap;align-items:center;row-gap:1px}#tree li.lot.wrap2>.fl{order:6}#tree li.lot.wrap2::after{content:"";flex-basis:100%;order:5;height:0}#tree li.lot.wrap2>.fl:first-of-type{margin-left:auto}`,
    ops: [MARK(NB, false, true), FIT, LEGEND],
  },
];
