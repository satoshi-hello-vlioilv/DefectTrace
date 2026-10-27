// ロット単位の表（リスト表示）の置き場と入口の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-lot-table.mjs
//
// 今の困りごと（今の画面 lotlist-check の list-1728.png・list-1280.png で見えたこと）:
//  - 表が中央の列だけに入り、右の列（画像情報・MAP・ロット情報）とサマリが表と関わらないまま場所を取る。1280 では 15 列のうち 7 列しか見えない
//  - 1280 では「Excel に出力」が 2 段目に落ちる
//  - 入口が「画像一覧・転写候補・ピッチ候補」と同じ段（画像を見る画面の切り替え）に混ざり、ロットの表なのか画像の見方なのかが分からない
//  - 名前「ロット一覧」が、左の木の各行に出す項目の置き場（一覧）と同じ言葉で、どちらの事か推測させる
// 案の方向（何で解くか）: 置き場（中央のタブ・左の板のタブ・見出しの切り替え・左の板を広げる・重ねる窓・下の引き出し）×
//   見せ方（表を広げる・画像と並べる）。名前はどの案も「ロット表」（木の「一覧」と分ける）
//
// 状態: grid（画像を見ている。入口がどう見えるか）・list（表を開いて、読み終えた所）

const OPEN = `
document.querySelector('#viewSeg [data-v=list]').click();
document.body.dataset.state = 'list';
document.querySelectorAll('[data-mode]').forEach((e) => e.classList.toggle('on', e.dataset.mode === 'list'));
for (let i = 0; i < 100 && !(document.querySelector('#lvLoad').hidden && document.querySelector('#lvBody tr')); i++) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 200));`;

export const STATES = {
  grid: "document.querySelectorAll('[data-mode]').forEach((e) => e.classList.toggle('on', e.dataset.mode === 'grid'))",
  list: `return (async () => {${OPEN}})()`,
};

// 表を広げる（表と関わらない物を隠す）。どの案も、表の窓では画像の読み込みの帯・サマリ・右の列を出さない
const WIDE = `
body[data-state=list] #summary,body[data-state=list] #infoPane,body[data-state=list] .split[data-split=infoPane],body[data-state=list] .cardzone,body[data-state=list] #groupTabs{display:none!important}
.lv-bar{flex-wrap:nowrap}`;
const SEG = `.mseg{display:flex}.mseg button{border-radius:0;margin-left:-1px;padding:3px 12px}.mseg button:first-child{border-radius:4px 0 0 4px;margin-left:0}.mseg button:last-child{border-radius:0 4px 4px 0}
.mseg button.on{background:var(--acc);color:#fff;border-color:var(--acc)}`;
// 画面全体を切り替える案（B・C）は、表の窓で画像の見方の段（画像一覧〜ピッチ候補・img/fm_img）も出さない
const NOTOOL = `body[data-state=list] #center>.toolbar{display:none!important}`;
const rename = ["script", "document.querySelector('#viewSeg [data-v=list]').textContent = 'ロット表'"];
const hideTab = ["script", "document.querySelector('#viewSeg [data-v=list]').style.display = 'none'"];

export const PROPOSALS = [
  { key: "now", name: "今（中央のタブ「ロット一覧」）", css: "", ops: [] },
  {
    key: "A", name: "中央のタブのまま・表の窓は右の列とサマリを隠して広げる",
    css: WIDE,
    ops: [rename],
  },
  {
    key: "B", name: "左の板の上に「画像を見る｜ロット表」・木は範囲を選ぶのに残す",
    css: WIDE + SEG + NOTOOL + `.modebar{display:flex;align-items:center;gap:8px;padding:6px 8px 2px}.modebar .mseg{flex:1}.modebar .mseg button{flex:1}`,
    ops: [hideTab,
      ["insert", `<div class="modebar"><div class="mseg" role="tablist"><button type="button" data-mode="grid" class="on">画像を見る</button><button type="button" data-mode="list">ロット表</button></div></div>`, "afterbegin", "#treePane"],
    ],
  },
  {
    key: "C", name: "見出しの帯に「画像｜ロット表」の切り替え（画面全体の切り替え）",
    css: WIDE + SEG + NOTOOL + `header .mseg{margin-left:14px}header .mseg button{background:transparent;color:#cfd6df;border-color:#3d4d66;padding:2px 14px}header .mseg button.on{background:#fff;color:#1f2a3a;border-color:#fff}`,
    ops: [hideTab,
      ["insert", `<div class="mseg" role="tablist"><button type="button" data-mode="grid" class="on">画像</button><button type="button" data-mode="list">ロット表</button></div>`, "afterend", "header .logo"]],
  },
  {
    key: "D", name: "左の板のタブ「ツリー｜リスト」・リストは左の板を画面の幅まで広げる",
    css: SEG + `.ttabs{display:flex;padding:6px 8px 0;gap:0;border-bottom:1px solid var(--line)}.ttabs button{border:0;border-bottom:3px solid transparent;border-radius:0;background:transparent;padding:4px 14px;font-weight:700;color:var(--sub)}
.ttabs button.on{color:var(--acc);border-bottom-color:var(--acc)}
body[data-state=list] #treePane{flex:1;width:auto!important}body[data-state=list] #treePane>.pane-head,body[data-state=list] #tree{display:none}
body[data-state=list] #center,body[data-state=list] #infoPane,body[data-state=list] .split{display:none!important}
#treePane>#listView{flex:1;min-height:0}`,
    ops: [hideTab,
      ["insert", `<div class="ttabs" role="tablist"><button type="button" data-mode="grid" class="on">ツリー</button><button type="button" data-mode="list">リスト</button></div>`, "afterbegin", "#treePane"],
      ["move", "#listView", "append", "#treePane"]],
  },
  {
    key: "E", name: "木の上の「⊞ ロット表」から大きな窓で開く（画像の画面はそのまま）",
    css: `.lvmodal{position:fixed;inset:44px 24px 24px;z-index:30;background:var(--pane);border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.35);display:none;flex-direction:column;overflow:hidden}
.lvmodal .mh{display:flex;align-items:center;gap:8px;background:#1f2a3a;color:#fff;padding:7px 12px;font-weight:700}.lvmodal .mh .sp{flex:1}.lvmodal .mh button{background:transparent;color:#fff;border-color:#3d4d66}
.lvback{position:fixed;inset:0;background:rgba(10,20,30,.35);z-index:29;display:none}
body[data-state=list] .lvmodal{display:flex}body[data-state=list] .lvback{display:block}
.lvmodal #listView{flex:1;min-height:0;display:flex!important}
body[data-state=list] #center>#grid{display:flex!important}body[data-state=list] #viewSeg [data-v=grid]{background:var(--acc);color:#fff}body[data-state=list] #sizerWrap,body[data-state=list] .cardzone{display:flex!important}
.topen{margin:6px 8px 0;width:calc(100% - 16px)}`,
    ops: [hideTab,
      ["insert", `<button type="button" class="topen" title="木で選んだ設備・年・月・日の下のロットを表にして書き出す">⊞ ロット表で見る・書き出す</button>`, "beforeend", "#treePane .pane-head"],
      ["insert", `<div class="lvback"></div><div class="lvmodal"><div class="mh">ロット表<span class="sp"></span><button type="button">閉じる（Esc）</button></div></div>`, "beforeend", "body"],
      ["move", "#listView", "append", ".lvmodal"]],
  },
  {
    key: "F", name: "中央の下の引き出し（画像の上に表をせり上げ、画像と並べて見る）",
    css: `body[data-state=list] #grid{display:flex!important;flex:1 1 40%}body[data-state=list] #listView{flex:1 1 60%;border-top:3px solid var(--acc);min-height:0}
body[data-state=list] #viewSeg [data-v=grid]{background:var(--acc);color:#fff}body[data-state=list] #sizerWrap{display:flex!important}
.dbtn{margin-left:auto}`,
    ops: [hideTab,
      ["insert", `<button type="button" class="dbtn" data-mode="list" title="選んだ範囲のロットを表で見る・書き出す（下にせり上がる）">▴ ロット表</button>`, "beforeend", "footer"]],
  },
];
