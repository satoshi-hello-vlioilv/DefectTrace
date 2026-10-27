// 配布の窓の案（3 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-release-modal-3.mjs
//
// 2 回目は 1 位 R3b が 79.8 点で 80 点に 0.2 点届かなかった。採点で低かった所と、この回で直す所（どの案も）:
//  - この PC のショートカットが「ショートカット あり」と「⌂ 作る」だけで、どこにあるか・消しても何度でも作れることが無い（考えさせない 7）
//    → 「ショートカット: デスクトップ・スタートにあります（消したときも、ここから何度でも作れます）」と「⌂ ショートカットを作る」に揃える
//  - 手順の ① ② ③ が丸い枠で、押せそうに見える（直感的 7）→ 枠を外し、細い輪の番号と字だけに
//  - 主ボタンが 2 つ（ZIP から版を置く・この版を配る が同じ青の塗り）→ ZIP は枠だけ（太字）。塗りは「この版を配る」だけ
//  - 表の「状態」と「置いた日時」の間が大きく空く → 版・置いた日時・大きさの幅を決め、状態に残りを渡す
//  - 語の途中の折れ（R9・R7 の この PC の文・R1b の段）、1280×720 での切れ（R1b・R8）→ この PC の文は全幅の行に
// 持ち越し: R3b → R3c・R9 → R9b。新しい案: R10・R11・R12

const SRC = "\\\\server\\share\\90_Releases\\DefectTrace";
const ENTRY = SRC + "\\DefectTrace.exe";
const NOTE = "画像の読み込みの直し";

const BASE = `
#relModal{align-items:center;padding-top:0}
#relModal .mbox{max-width:none;width:min(1180px,92vw);height:auto;max-height:88vh;overflow:auto;padding:20px 24px;display:flex;flex-direction:column;gap:14px;font-size:14px}
#relModal .mhead{margin:0}#relModal .mhead b{font-size:18px}
#relBody{display:flex;flex-direction:column;gap:14px}
.x-tag{display:inline-flex;align-items:center;border-radius:11px;padding:1px 9px;font-size:12.5px;border:1px solid;white-space:nowrap}
.x-dist{color:#1b5e20;border-color:#9ccc9c;background:#e8f5e9}.x-rec{color:#8a5a00;border-color:#ecd9a8;background:#fff6e0}
.x-me{color:var(--acc);border-color:#b7cbe6;background:var(--accbg)}.x-new{color:#5b6573;border-color:#c9d1db;background:#f6f8fa}
.x-btn{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:5px 12px;font-size:13.5px;white-space:nowrap}
.x-pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}.x-del{color:var(--ng);border-color:#e6b4b4}
.x-amber{background:#e6a52e;border-color:#e6a52e;color:#1b2733;font-weight:700}
.x-path{font:13px Consolas,monospace;color:var(--txt);background:#f3f5f8;border:1px solid var(--line2);border-radius:4px;padding:4px 8px;overflow-wrap:anywhere;min-width:0}
.x-sec{border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--pane)}
.x-sec>h4{margin:0;font-size:14px;color:var(--sub);font-weight:600}
.x-row{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap}.x-row>.x-grow{flex:1;min-width:240px}
.x-sub{color:var(--sub);font-size:12.5px}
.x-t{width:100%;border-collapse:collapse;font-size:14px}.x-t th{text-align:left;font-size:12.5px;color:var(--sub);font-weight:600;border-bottom:1px solid var(--line);padding:6px 8px}
.x-t td{padding:9px 8px;border-bottom:1px solid var(--line2);white-space:nowrap;vertical-align:middle}.x-t td.acts{text-align:right}.x-t td.acts .x-btn{margin-left:6px}
.x-t tr.on td{background:#eef6ee}.x-t td b{font-size:15px}
.x-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.x-head .x-path{flex:1;min-width:260px}
.x-flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13.5px;color:var(--txt)}
.x-flow .s{display:inline-flex;align-items:center;gap:5px}
.x-flow .n{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:50%;border:1.5px solid var(--sub);color:var(--sub);font-weight:700;font-size:11.5px}
.x-t th:nth-child(1),.x-t td:nth-child(1){width:70px}.x-t th:nth-child(3),.x-t td:nth-child(3){width:170px}.x-t th:nth-child(4),.x-t td:nth-child(4){width:80px}
.x-flow .ar{color:var(--sub)}
`;
const head = `<div class="x-head"><span class="x-sub">置き場</span><span class="x-path">${SRC}</span><button class="x-btn" title="置き場を読み直して、版の一覧を新しくする">↻ 読み直す</button><button class="x-btn" style="font-weight:600">＋ ZIP から版を置く…</button></div>`;
const flow = `<div class="x-flow"><span class="s"><span class="n">1</span>ZIP から版を置く（右上）</span><span class="ar">→</span><span class="s"><span class="n">2</span>ZIP を展開した exe で試す</span><span class="ar">→</span><span class="s"><span class="n">3</span>表の「この版を配る」</span><span class="x-sub">各 PC は起動したとき・30 分ごとに取り込み、開き直すとその版になります</span></div>`;
const rows = `
<tr><td><b>4.0.2</b></td><td><span class="x-tag x-new">置いただけ（まだ配っていない）</span></td><td>10/26 09:00 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn x-pri">この版を配る</button><button class="x-btn x-del">消す</button></td></tr>
<tr class="on"><td><b>4.0.1</b></td><td><span class="x-tag x-dist">配っている</span> <span class="x-tag x-rec">推奨: ${NOTE}</span></td><td>10/25 17:30 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn">推奨を外す</button></td></tr>
<tr><td><b>4.0.0</b></td><td><span class="x-tag x-me">この PC が使っている</span></td><td>10/24 10:00 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn">この版に戻す</button><button class="x-btn x-del">消す</button></td></tr>`;
const table = `<table class="x-t"><thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>大きさ</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
const newPc = `<div class="x-sec"><h4>新しい PC へ</h4><div class="x-row"><span class="x-path x-grow">${ENTRY}</span><button class="x-btn">アドレスをコピー</button></div>
  <div class="x-sub">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div>`;
const SC_TXT = `ショートカット: <b>デスクトップ・スタートにあります</b>（消したときも、ここから何度でも作れます）`;
const thisPc = `<div class="x-sec"><h4>この PC</h4>
  <div class="x-row"><span class="x-grow">版 <b>4.0.0</b> → <b>4.0.1</b> を取り込み済み（開き直すと入れ替わります）</span><button class="x-btn x-amber">↻ 開き直して更新</button></div>
  <div class="x-row"><span class="x-grow">${SC_TXT}</span><button class="x-btn">⌂ ショートカットを作る</button></div></div>`;
const body = (html) => ["script", `document.getElementById("relBody").innerHTML = ${JSON.stringify(html)};`];


const CARDS = `.x-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.x-state{border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:5px}
.x-state .lab{font-size:12.5px;color:var(--sub);font-weight:600}.x-state .v{font-size:26px;font-weight:700;line-height:1.1}
.x-state.dist{border-color:#9ccc9c;background:#f3faf3}.x-state.new{border-style:dashed}.x-state.me{border-color:#b7cbe6;background:#f5f8fd}`;

export const STATES = { release: "document.getElementById(\"relModal\").hidden = false;" };

export const PROPOSALS = [
  {
    key: "R3c", name: "R3b を直した: 状態のカード 3 枚（状態だけ）＋手順の 1 行（枠なし）＋全部の版＋新しい PC（全幅）。この PC のカードにショートカットの文",
    css: BASE + CARDS,
    ops: [body(`${head}
<div class="x-cards">
  <div class="x-state dist"><span class="lab">各 PC に配っている版</span><span class="v">4.0.1</span><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span></div>
  <div class="x-state new"><span class="lab">新しく置いた版（まだ配っていない）</span><span class="v">4.0.2</span><span class="x-sub">試してから、下の表の「この版を配る」</span></div>
  <div class="x-state me"><span class="lab">この PC</span><span class="v">4.0.0 → 4.0.1</span><div class="x-row"><button class="x-btn x-amber">↻ 開き直して更新</button></div></div>
</div>
<div class="x-row" style="border:1px solid var(--line);border-radius:8px;padding:8px 12px"><span class="x-grow">${SC_TXT}</span><button class="x-btn">⌂ ショートカットを作る</button></div>
${flow}
${table}
${newPc}`)],
  },
  {
    key: "R9b", name: "R9 を直した: 版ごとの横長の札（大きな版の数字・状態の文・その版の操作）＋手順の 1 行＋新しい PC・この PC は全幅で縦に",
    css: BASE + `.x-cards2{display:flex;flex-direction:column;gap:8px}
.x-v{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:14px;border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.x-v .num{font-size:26px;font-weight:700}.x-v .st{display:flex;flex-direction:column;gap:4px}.x-v .st .t{font-size:14.5px}
.x-v.dist{border-color:#9ccc9c;background:#f3faf3}.x-v.new{border-style:dashed}.x-v.me{border-color:#b7cbe6}`,
    ops: [body(`${head}
${flow}
<div class="x-cards2">
  <div class="x-v new"><span class="num">4.0.2</span><div class="st"><span class="t"><span class="x-tag x-new">置いただけ</span> まだどの PC にも配っていません</span><span class="x-sub">10/26 09:00 maint ・ 6.1 MB</span></div><div><button class="x-btn x-pri">この版を配る</button> <button class="x-btn x-del">消す</button></div></div>
  <div class="x-v dist"><span class="num">4.0.1</span><div class="st"><span class="t"><span class="x-tag x-dist">配っている</span> 各 PC はこの版になります</span><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span></div><div><button class="x-btn">推奨を外す</button></div></div>
  <div class="x-v me"><span class="num">4.0.0</span><div class="st"><span class="t"><span class="x-tag x-me">この PC</span> 前に配っていた版</span><span class="x-sub">10/24 10:00 maint ・ 6.1 MB</span></div><div><button class="x-btn">この版に戻す</button> <button class="x-btn x-del">消す</button></div></div>
</div>
${newPc}${thisPc}`)],
  },
  {
    key: "R10", name: "状態の帯 1 本（配っている・置いただけ・この PC を 1 行に大きな数字で）＋手順の 1 行＋全部の版＋新しい PC・この PC（全幅）",
    css: BASE + `.x-band{display:flex;align-items:stretch;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.x-band>div{flex:1;padding:10px 14px;display:flex;align-items:baseline;gap:10px;border-right:1px solid var(--line)}.x-band>div:last-child{border-right:none}
.x-band .lab{font-size:12.5px;color:var(--sub);font-weight:600}.x-band .v{font-size:22px;font-weight:700}
.x-band .dist{background:#f3faf3}.x-band .me{background:#f5f8fd}`,
    ops: [body(`${head}
<div class="x-band"><div class="dist"><span class="lab">配っている</span><span class="v">4.0.1</span><span class="x-tag x-rec">推奨つき</span></div>
  <div><span class="lab">置いただけ</span><span class="v">4.0.2</span></div><div class="me"><span class="lab">この PC</span><span class="v">4.0.0</span><span class="x-sub">→ 4.0.1 取り込み済み</span></div></div>
${flow}
${table}
${newPc}${thisPc}`)],
  },
  {
    key: "R11", name: "左右 2 列（窓を広く 1280px）: 左に手順の 1 行と全部の版、右に縦に この PC（版・ショートカット）と新しい PC",
    css: BASE + `#relModal .mbox{width:min(1280px,94vw)}
.x-split{display:grid;grid-template-columns:1fr 450px;gap:16px;align-items:start}.x-left{display:flex;flex-direction:column;gap:12px;min-width:0}.x-right{display:flex;flex-direction:column;gap:12px}
.x-right .x-row>.x-grow{min-width:0;flex-basis:100%}.x-t td:nth-child(2){white-space:normal}`,
    ops: [body(`${head}
<div class="x-split"><div class="x-left">${flow}${table}</div>
<div class="x-right"><div class="x-sec"><h4>この PC</h4><div>版 <b>4.0.0</b> → <b>4.0.1</b> を取り込み済み（開き直すと入れ替わります）</div><div><button class="x-btn x-amber">↻ 開き直して更新</button></div>
  <div>${SC_TXT}</div><div><button class="x-btn">⌂ ショートカットを作る</button></div></div>
  <div class="x-sec"><h4>新しい PC へ</h4><span class="x-path">${ENTRY}</span><div><button class="x-btn">アドレスをコピー</button></div><div class="x-sub">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div></div></div>`)],
  },
  {
    key: "R12", name: "表の状態の列を文に（「各 PC に配っている」など）、日時・大きさは版の下に小さく。この PC は窓の頭の段のすぐ下に 1 行",
    css: BASE + `.x-t2{width:100%;border-collapse:collapse}.x-t2 td{padding:10px 8px;border-bottom:1px solid var(--line2);vertical-align:middle}
.x-t2 td.v{width:200px}.x-t2 td.v b{font-size:17px;display:block}.x-t2 td.v span{font-size:12px;color:var(--sub)}
.x-t2 td.s{font-size:14.5px}.x-t2 td.acts{text-align:right;white-space:nowrap}.x-t2 td.acts .x-btn{margin-left:6px}.x-t2 tr.on td{background:#eef6ee}
.x-me-row{display:flex;flex-direction:column;gap:6px;border:1px solid #b7cbe6;background:#f5f8fd;border-radius:8px;padding:10px 14px}`,
    ops: [body(`${head}
<div class="x-me-row"><div class="x-row"><b>この PC</b><span class="x-grow">版 <b>4.0.0</b> → <b>4.0.1</b> を取り込み済み（開き直すと入れ替わります）</span><button class="x-btn x-amber">↻ 開き直して更新</button></div>
  <div class="x-row"><span class="x-grow">${SC_TXT}</span><button class="x-btn">⌂ ショートカットを作る</button></div></div>
${flow}
<table class="x-t2"><tbody>
<tr><td class="v"><b>4.0.2</b><span>10/26 09:00 maint ・ 6.1 MB</span></td><td class="s"><span class="x-tag x-new">置いただけ</span> まだどの PC にも配っていません</td><td class="acts"><button class="x-btn x-pri">この版を配る</button><button class="x-btn x-del">消す</button></td></tr>
<tr class="on"><td class="v"><b>4.0.1</b><span>10/25 17:30 maint ・ 6.1 MB</span></td><td class="s"><span class="x-tag x-dist">配っている</span> 各 PC はこの版になります <span class="x-tag x-rec">推奨: ${NOTE}</span></td><td class="acts"><button class="x-btn">推奨を外す</button></td></tr>
<tr><td class="v"><b>4.0.0</b><span>10/24 10:00 maint ・ 6.1 MB</span></td><td class="s"><span class="x-tag x-me">この PC</span> 前に配っていた版</td><td class="acts"><button class="x-btn">この版に戻す</button><button class="x-btn x-del">消す</button></td></tr>
</tbody></table>
${newPc}`)],
  },
];
