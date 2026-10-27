// 配布の窓の案（1 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-release-modal.mjs --states release
//
// 今の窓の困りごと（ui-check.mjs の release-1728・1536・1280 を見て）:
//  1. 窓が小さい（1728 で 約 1000×300px。画面の上 1/4 に寄り、後ろの画像一覧がほとんど見えたまま）。字も 13px で、表の行が詰まる
//  2. 手順（① ZIP から版を置く → ② 試す → ③ この版を配る）が書かれていない。「置いただけ」「配っている」の違いを、札から推し量らせる
//  3. 新しい PC へ渡すアドレスが、窓のいちばん下の灰色 12px の字。写すボタンが無い
//  4. 「確かめる」が何を確かめるのか分からない。置き場のアドレスは等幅 12px で目立たない
//  5. この PC の版・ショートカットを作る所が無い（利用者: 「ショートカットは何回でも作れる道は残してほしい」）
// 見せる物（どの案も同じ中身）: 置き場 \\server\share\90_Releases\DefectTrace・版 4.0.2（置いただけ）・4.0.1（配っている・推奨: 画像の読み込みの直し）・
//   4.0.0（この PC）・この PC は 4.0.1 を取り込み済み（開き直すと入れ替わる）・ショートカットあり
// 案の方向: 大きさ（窓・面・引き出し）／まとまり（手順の段・状態のカード・左右 2 列・タブ・時系列）／流れ（表で選ぶ・選んでから詳しく・手順に沿う）

const SRC = "\\\\server\\share\\90_Releases\\DefectTrace";
const ENTRY = SRC + "\\DefectTrace.exe";
const NOTE = "画像の読み込みの直し";

/** どの案も使う部品の見た目 */
const BASE = `
#relModal{align-items:center;padding-top:0}
#relModal .mbox{max-width:none;max-height:none;display:flex;flex-direction:column;gap:12px;font-size:14px}
#relModal .mhead{margin:0}#relModal .mhead b{font-size:18px}
.x-tag{display:inline-flex;align-items:center;border-radius:11px;padding:1px 9px;font-size:12.5px;border:1px solid;white-space:nowrap}
.x-dist{color:#1b5e20;border-color:#9ccc9c;background:#e8f5e9}.x-rec{color:#8a5a00;border-color:#ecd9a8;background:#fff6e0}
.x-me{color:var(--acc);border-color:#b7cbe6;background:var(--accbg)}.x-new{color:#5b6573;border-color:#c9d1db;background:#f6f8fa}
.x-btn{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:5px 12px;font-size:13.5px;white-space:nowrap}
.x-pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.x-del{color:var(--ng);border-color:#e6b4b4}
.x-path{font:13px Consolas,monospace;color:var(--txt);background:#f3f5f8;border:1px solid var(--line2);border-radius:4px;padding:3px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.x-sec{border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--pane)}
.x-sec>h4{margin:0;font-size:14px;color:var(--sub);font-weight:600}
.x-sec .x-row{flex-wrap:wrap}.x-sec .x-row>.x-grow{min-width:220px}
.x-row{display:flex;align-items:center;gap:8px;min-width:0}.x-row>.x-grow{flex:1;min-width:0}
.x-sub{color:var(--sub);font-size:12.5px}
.x-t{width:100%;border-collapse:collapse;font-size:14px}.x-t th{text-align:left;font-size:12.5px;color:var(--sub);font-weight:600;border-bottom:1px solid var(--line);padding:6px 8px}
.x-t td{padding:9px 8px;border-bottom:1px solid var(--line2);white-space:nowrap;vertical-align:middle}.x-t td.acts{text-align:right}.x-t td.acts .x-btn{margin-left:6px}
.x-t tr.on td{background:#eef6ee}.x-t td b{font-size:15px}
`;

/** 版の行（表の案が使う） */
const rows = (acts = true) => `
<tr><td><b>4.0.2</b></td><td><span class="x-tag x-new">置いただけ（まだ配っていない）</span></td><td>10/26 09:00 maint</td><td>6.1 MB</td>${acts ? `<td class="acts"><button class="x-btn x-pri">この版を配る</button><button class="x-btn x-del">消す</button></td>` : ""}</tr>
<tr class="on"><td><b>4.0.1</b></td><td><span class="x-tag x-dist">配っている</span> <span class="x-tag x-rec">推奨: ${NOTE}</span></td><td>10/25 17:30 maint</td><td>6.1 MB</td>${acts ? `<td class="acts"><button class="x-btn">推奨を外す</button></td>` : ""}</tr>
<tr><td><b>4.0.0</b></td><td><span class="x-tag x-me">この PC が使っている</span></td><td>10/24 10:00 maint</td><td>6.1 MB</td>${acts ? `<td class="acts"><button class="x-btn">この版に戻す</button><button class="x-btn x-del">消す</button></td>` : ""}</tr>`;
const table = (acts = true) => `<table class="x-t"><thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>大きさ</th>${acts ? "<th></th>" : ""}</tr></thead><tbody>${rows(acts)}</tbody></table>`;
const newPc = `<div class="x-sec"><h4>新しい PC へ</h4><div class="x-row"><span class="x-path x-grow" title="${ENTRY}">${ENTRY}</span><button class="x-btn">アドレスをコピー</button></div>
  <div class="x-sub">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div>`;
const thisPc = `<div class="x-sec"><h4>この PC</h4><div class="x-row"><span class="x-grow">版 <b>4.0.0</b> → <b>4.0.1</b> を取り込み済み（開き直すと入れ替わります）</span><button class="x-btn" style="background:#e6a52e;border-color:#e6a52e;color:#1b2733;font-weight:700">↻ 開き直して更新</button></div>
  <div class="x-row"><span class="x-grow">ショートカット: デスクトップ・スタートにあります</span><button class="x-btn">⌂ ショートカットを作る</button></div></div>`;
const place = `<div class="x-row"><span class="x-sub">置き場</span><span class="x-path x-grow">${SRC}</span><button class="x-btn" title="置き場を読み直して、版の一覧を新しくする">↻ 読み直す</button></div>`;
const body = (html) => ["script", `document.getElementById("relBody").innerHTML = ${JSON.stringify(html)};`];

export const STATES = { release: "document.getElementById(\"relModal\").hidden = false;" };

export const PROPOSALS = [
  {
    key: "R1", name: "大きな窓＋手順の段（① 置く → ② 試す → ③ 配る）",
    css: BASE + `
#relModal .mbox{width:min(1180px,92vw);height:min(760px,86vh);padding:20px 24px;overflow:auto}
.x-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.x-step{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
.x-step .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;margin-right:6px}
.x-step b{font-size:14.5px}.x-step .x-sub{line-height:1.5}
.x-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}`,
    ops: [body(`${place}
<div class="x-steps">
  <div class="x-step"><div><span class="n">1</span><b>ZIP から版を置く</b></div><div class="x-sub">GitHub の Releases の ZIP を選ぶと、中身を確かめて置き場の versions に置きます。置いただけでは配りません</div><div><button class="x-btn x-pri">ZIP から版を置く…</button></div></div>
  <div class="x-step"><div><span class="n">2</span><b>試す</b></div><div class="x-sub">配る前に、ZIP を展開した DefectTrace.exe を開いて試せます（各 PC へは届きません）</div></div>
  <div class="x-step"><div><span class="n">3</span><b>この版を配る</b></div><div class="x-sub">表の「この版を配る」。各 PC は起動したとき・30 分ごとに取り込み、開き直したときにその版になります</div></div>
</div>
${table()}
<div class="x-two">${newPc}${thisPc}</div>`)],
  },
  {
    key: "R2", name: "左右 2 列: 版の一覧（左）＋選んだ版の説明と操作（右）",
    css: BASE + `
#relModal .mbox{width:min(1180px,92vw);height:min(760px,86vh);padding:20px 24px}
.x-split{flex:1;display:grid;grid-template-columns:380px 1fr;gap:14px;min-height:0}
.x-list{display:flex;flex-direction:column;gap:8px;overflow:auto}
.x-card{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:5px;cursor:pointer}
.x-card.sel{border:2px solid var(--acc);background:var(--accbg)}.x-card b{font-size:16px}
.x-detail{display:flex;flex-direction:column;gap:12px;overflow:auto}
.x-big{font-size:22px;font-weight:700}`,
    ops: [body(`${place}
<div class="x-row"><span class="x-grow x-sub">版を選ぶと、右にその版の状態とできることが出ます</span><button class="x-btn x-pri">＋ ZIP から版を置く…</button></div>
<div class="x-split">
  <div class="x-list">
    <div class="x-card sel"><div class="x-row"><b class="x-grow">4.0.2</b><span class="x-tag x-new">置いただけ</span></div><span class="x-sub">10/26 09:00 maint ・ 6.1 MB</span></div>
    <div class="x-card"><div class="x-row"><b class="x-grow">4.0.1</b><span class="x-tag x-dist">配っている</span></div><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span><span class="x-sub">10/25 17:30 maint ・ 6.1 MB</span></div>
    <div class="x-card"><div class="x-row"><b class="x-grow">4.0.0</b><span class="x-tag x-me">この PC</span></div><span class="x-sub">10/24 10:00 maint ・ 6.1 MB</span></div>
  </div>
  <div class="x-detail">
    <div class="x-sec"><div class="x-row"><span class="x-big x-grow">版 4.0.2</span><span class="x-tag x-new">置いただけ（まだ配っていない）</span></div>
      <div>置き場に置いてありますが、まだどの PC にも配っていません。試してから配ってください。</div>
      <div class="x-row"><button class="x-btn x-pri">この版を配る</button><span class="x-sub x-grow">各 PC は起動したとき・30 分ごとに取り込み、開き直したときに 4.0.2 になります</span></div>
      <div class="x-row"><button class="x-btn x-del">この版を消す</button><span class="x-sub">配っている版は消せません</span></div></div>
    ${newPc}${thisPc}
  </div>
</div>`)],
  },
  {
    key: "R3", name: "上に今の状態のカード 3 枚（配っている・新しく置いた・この PC）＋下に全部の版",
    css: BASE + `
#relModal .mbox{width:min(1180px,92vw);height:min(780px,88vh);padding:20px 24px;overflow:auto}
.x-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.x-state{border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.x-state .lab{font-size:12.5px;color:var(--sub);font-weight:600}.x-state .v{font-size:26px;font-weight:700;line-height:1.1}
.x-state.dist{border-color:#9ccc9c;background:#f3faf3}.x-state.new{border-style:dashed}.x-state.me{border-color:#b7cbe6;background:#f5f8fd}
.x-two{display:grid;grid-template-columns:1fr 1fr;gap:12px}`,
    ops: [body(`${place}
<div class="x-cards">
  <div class="x-state dist"><span class="lab">各 PC に配っている版</span><span class="v">4.0.1</span><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span><div><button class="x-btn">推奨を外す</button></div></div>
  <div class="x-state new"><span class="lab">新しく置いた版（まだ配っていない）</span><span class="v">4.0.2</span><span class="x-sub">10/26 09:00 maint</span><div class="x-row"><button class="x-btn x-pri">この版を配る</button><button class="x-btn">＋ ZIP から版を置く…</button></div></div>
  <div class="x-state me"><span class="lab">この PC の版</span><span class="v">4.0.0 → 4.0.1</span><span class="x-sub">取り込み済み。開き直すと入れ替わります</span><div class="x-row"><button class="x-btn" style="background:#e6a52e;border-color:#e6a52e;color:#1b2733;font-weight:700">↻ 開き直して更新</button><button class="x-btn">⌂ ショートカットを作る</button></div></div>
</div>
<div class="x-sec"><h4>置き場の版（全部）</h4>${table()}</div>
${newPc}`)],
  },
  {
    key: "R4", name: "大きな窓の中のタブ（配る版・版を置く・新しい PC へ・この PC）",
    css: BASE + `
#relModal .mbox{width:min(1100px,92vw);height:min(720px,84vh);padding:20px 24px}
.x-tabs{display:flex;gap:4px;border-bottom:2px solid var(--line)}
.x-tabs button{border:none;background:none;padding:8px 16px;font-size:14.5px;color:var(--sub);border-bottom:3px solid transparent;margin-bottom:-2px;border-radius:0}
.x-tabs button.on{color:var(--acc);border-bottom-color:var(--acc);font-weight:700}
.x-pane{flex:1;overflow:auto;display:flex;flex-direction:column;gap:12px}`,
    ops: [body(`<div class="x-tabs"><button class="on">配る版</button><button>版を置く</button><button>新しい PC へ</button><button>この PC</button></div>
<div class="x-pane">${place}
  <div class="x-sub">表の「この版を配る」で配る版を選びます。各 PC は起動したとき・30 分ごとに取り込み、開き直したときにその版になります。前の版に戻すのも同じ操作です</div>
  ${table()}</div>`)],
  },
  {
    key: "R5", name: "右から出る背の高い引き出し（後ろの画面を半分残す）＋縦に積んだ節",
    css: BASE + `
#relModal{justify-content:flex-end;align-items:stretch}
#relModal .mbox{width:min(760px,60vw);height:100vh;border-radius:0;padding:20px 22px;overflow:auto}
.x-t td.acts{white-space:normal}`,
    ops: [body(`${place}
<div class="x-sec"><h4>版（新しい順）</h4><div class="x-row"><span class="x-grow x-sub">置いただけでは配りません。試してから「この版を配る」</span><button class="x-btn x-pri">＋ ZIP から版を置く…</button></div>${table()}</div>
${newPc}${thisPc}`)],
  },
  {
    key: "R6", name: "時系列（版を縦の線に並べ、点の色で状態）＋右に新しい PC・この PC",
    css: BASE + `
#relModal .mbox{width:min(1180px,92vw);height:min(760px,86vh);padding:20px 24px}
.x-split{flex:1;display:grid;grid-template-columns:1fr 400px;gap:16px;min-height:0;margin-top:4px}
.x-tl{position:relative;padding-left:26px;display:flex;flex-direction:column;gap:12px;overflow:auto}
.x-tl:before{content:"";position:absolute;left:9px;top:8px;bottom:8px;width:2px;background:var(--line)}
.x-node{position:relative;border:1px solid var(--line);border-radius:8px;padding:10px 14px;display:flex;flex-direction:column;gap:6px}
.x-node:before{content:"";position:absolute;left:-23px;top:14px;width:14px;height:14px;border-radius:50%;background:#fff;border:3px solid #9aa7b6}
.x-node.dist:before{border-color:#2e7d32;background:#2e7d32}.x-node.me:before{border-color:var(--acc)}
.x-node.dist{border-color:#9ccc9c;background:#f3faf3}.x-node b{font-size:17px}
.x-side{display:flex;flex-direction:column;gap:12px}`,
    ops: [body(`${place}
<div class="x-row"><span class="x-grow x-sub">① ZIP から版を置く → ② 試す → ③ この版を配る（各 PC は開き直したときにその版になります）</span><button class="x-btn x-pri">＋ ZIP から版を置く…</button></div>
<div class="x-split">
  <div class="x-tl">
    <div class="x-node"><div class="x-row"><b class="x-grow">4.0.2</b><span class="x-tag x-new">置いただけ</span></div><span class="x-sub">10/26 09:00 maint ・ 6.1 MB</span><div class="x-row"><button class="x-btn x-pri">この版を配る</button><button class="x-btn x-del">消す</button></div></div>
    <div class="x-node dist"><div class="x-row"><b class="x-grow">4.0.1</b><span class="x-tag x-dist">配っている</span><span class="x-tag x-rec">推奨: ${NOTE}</span></div><span class="x-sub">10/25 17:30 maint ・ 6.1 MB</span><div class="x-row"><button class="x-btn">推奨を外す</button></div></div>
    <div class="x-node me"><div class="x-row"><b class="x-grow">4.0.0</b><span class="x-tag x-me">この PC</span></div><span class="x-sub">10/24 10:00 maint ・ 6.1 MB</span><div class="x-row"><button class="x-btn">この版に戻す</button><button class="x-btn x-del">消す</button></div></div>
  </div>
  <div class="x-side">${newPc}${thisPc}</div>
</div>`)],
  },
];
