// ロット表（リスト表示）の置き場と入口の案（2 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-lot-table-2.mjs
//
// 1 回目（2026-10-27-lot-table.json）の採点で低かった所と、2 回目での直し方:
//  - B（1 位 79.2）: 左上の「画像を見る｜ロット表」と中央の「画像一覧…」が同じ青い塗りの切り替えで上下に並び、どちらが上の段か分からない
//    → 画面全体の切り替えは、字の大きい下線のタブ（主）にし、中央の画像の見方（塗りの切り替え・従）と形を分ける（B2・G・H・I）
//  - C: 選ばれた側が暗い帯の上の白い塗りで、ほかの切り替えと形と色が違う → 青い塗りにそろえる（C2）
//  - どの案も視覚化が 6〜7: 表がどこの何ロットかが入口に出ない → 入口のタブに範囲のロットの数の札を付け、表の窓では木の上で範囲の節を光らせる
//    （範囲の節の光りは本物の画面〈app.js の setListScope〉がする）
// 新しい案: G（いちばん左に縦の切り替えの帯）・H（作業域の上いっぱいのタブの段）・I（B2 に、木の節の行から 1 手で表を開くボタン）
//
// 状態: grid（画像を見ている。入口がどう見えるか）・list（表を開いて、読み終えた所）

const OPEN = `
document.querySelector('#viewSeg [data-v=list]').click();
document.body.dataset.state = 'list';
document.querySelectorAll('[data-mode]').forEach((e) => e.classList.toggle('on', e.dataset.mode === 'list'));
for (let i = 0; i < 100 && !(document.querySelector('#lvLoad').hidden && document.querySelector('#lvBody tr')); i++) await new Promise((r) => setTimeout(r, 100));
document.querySelectorAll('.ltn').forEach((e) => (e.textContent = document.querySelectorAll('#lvBody tr').length));
await new Promise((r) => setTimeout(r, 200));`;

export const STATES = {
  grid: "document.querySelectorAll('[data-mode]').forEach((e) => e.classList.toggle('on', e.dataset.mode === 'grid'))",
  list: `return (async () => {${OPEN}})()`,
};

// 表の窓では、表と関わらない物（サマリ・右の列・画像の見方の段）を出さず、表を木の右いっぱいに広げる
const WIDE = `
body[data-state=list] #summary,body[data-state=list] #infoPane,body[data-state=list] .split[data-split=infoPane],body[data-state=list] #center>.toolbar{display:none!important}
.lv-bar{flex-wrap:nowrap}`;
// 画面全体の切り替え（主）: 字の大きい下線のタブ。中央の画像の見方（塗りの切り替え・従）と形を分ける
const MTAB = `.mtabs{display:flex;gap:2px;border-bottom:1px solid var(--line)}
.mtabs button{border:0;border-radius:0;background:transparent;border-bottom:3px solid transparent;padding:6px 12px 5px;font:700 14px "Yu Gothic UI",sans-serif;color:var(--sub);display:inline-flex;align-items:center;gap:6px}
.mtabs button.on{color:var(--acc);border-bottom-color:var(--acc)}
.mtabs .ic{font-size:15px}
.ltn{font:700 11px "Yu Gothic UI",sans-serif;min-width:18px;padding:0 5px;border-radius:9px;background:var(--line2);color:var(--sub);text-align:center}
.mtabs button.on .ltn{background:var(--acc);color:#fff}
.ltn:empty{display:none}`;
const hideTab = ["script", "document.querySelector('#viewSeg [data-v=list]').style.display = 'none'"];
const TABS = (cls = "mtabs") => `<div class="${cls}" role="tablist"><button type="button" data-mode="grid" class="on"><span class="ic">▣</span>画像を見る</button><button type="button" data-mode="list"><span class="ic">▦</span>ロット表<span class="ltn"></span></button></div>`;

export const PROPOSALS = [
  { key: "now", name: "今（中央のタブ「ロット一覧」）", css: "", ops: [] },
  {
    key: "B2", name: "左の板の上に下線のタブ「▣ 画像を見る｜▦ ロット表 n」（主と従の形を分ける）",
    css: WIDE + MTAB + `#treePane>.mtabs{padding:4px 6px 0}#treePane>.mtabs button{flex:1;justify-content:center}`,
    ops: [hideTab, ["insert", TABS(), "afterbegin", "#treePane"]],
  },
  {
    key: "C2", name: "見出しの帯に「画像｜ロット表 n」（選ばれた側は青い塗り＝ほかの切り替えと同じ）",
    css: WIDE + `.hseg{display:flex;margin-left:14px}.hseg button{border-radius:0;margin-left:-1px;padding:2px 14px;background:transparent;color:#cfd6df;border-color:#3d4d66;display:inline-flex;gap:6px;align-items:center}
.hseg button:first-child{border-radius:4px 0 0 4px}.hseg button:last-child{border-radius:0 4px 4px 0}.hseg button.on{background:var(--acc);border-color:var(--acc);color:#fff}
.hseg .ltn{font:700 11px sans-serif;padding:0 5px;border-radius:9px;background:rgba(255,255,255,.2)}.hseg .ltn:empty{display:none}`,
    ops: [hideTab, ["insert", `<div class="hseg" role="tablist"><button type="button" data-mode="grid" class="on">画像</button><button type="button" data-mode="list">ロット表<span class="ltn"></span></button></div>`, "afterend", "header .logo"]],
  },
  {
    key: "G", name: "いちばん左に縦の切り替えの帯（▣ 画像・▦ ロット表）",
    css: WIDE + `.rail{flex:0 0 64px;background:#26303d;display:flex;flex-direction:column;gap:2px;padding-top:6px}
.rail button{border:0;border-radius:0;background:transparent;color:#aeb8c4;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;font:12px "Yu Gothic UI",sans-serif;border-left:3px solid transparent;position:relative}
.rail button .ic{font-size:20px;line-height:22px}.rail button.on{color:#fff;background:#33404f;border-left-color:#6aa5f0}
.rail .ltn{position:absolute;top:4px;right:6px;font:700 11px sans-serif;padding:0 4px;border-radius:8px;background:var(--acc);color:#fff}.rail .ltn:empty{display:none}`,
    ops: [hideTab, ["insert", `<nav class="rail" role="tablist"><button type="button" data-mode="grid" class="on"><span class="ic">▣</span>画像</button><button type="button" data-mode="list"><span class="ic">▦</span>ロット表<span class="ltn"></span></button></nav>`, "afterbegin", "#main"]],
  },
  {
    key: "H", name: "作業域の上いっぱいにタブの段（画像を見る｜ロット表 n）",
    css: WIDE + MTAB + `.mbar{background:var(--pane);padding:2px 10px 0;border-bottom:1px solid var(--line)}.mbar .mtabs{border-bottom:0}`,
    ops: [hideTab, ["insert", `<div class="mbar">${TABS()}</div>`, "beforebegin", "#main"]],
  },
  {
    key: "I", name: "B2 に加え、木の節の行に「▦ 表」（押した節の下を 1 手で表に）",
    css: WIDE + MTAB + `#treePane>.mtabs{padding:4px 6px 0}#treePane>.mtabs button{flex:1;justify-content:center}
.tree .row{position:relative}.ttb{display:none;margin-left:auto;font-size:11px;padding:0 6px;line-height:16px;border-radius:3px}
.tree li.scope>.row .ttb,.tree li.pick>.row .ttb{display:inline-block}.tree li.pick>.row{background:var(--line2)}
body[data-state=list] .tree li.pick>.row{background:transparent}`,
    ops: [hideTab, ["insert", TABS(), "afterbegin", "#treePane"],
      ["script", `document.querySelectorAll('#tree li[data-path]').forEach((li) => { const r = li.querySelector(':scope>.row'); if (r && !li.classList.contains('lot')) { const c = r.querySelector('.cnt'); (c || r).insertAdjacentHTML(c ? 'beforebegin' : 'beforeend', '<button type="button" class="ttb" title="この下のロットを表で見る・書き出す">▦ 表</button>'); } });
        const d = [...document.querySelectorAll('#tree li[data-path]')].find((li) => /10\\/25/.test(li.querySelector(':scope>.row .nm')?.textContent || '')); if (d) d.classList.add('pick');`]],
  },
];
