// 配布の窓の案（2 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-release-modal-2.mjs
//
// 1 回目は 1 位 R3 が 68.5 点で 80 点に届かなかった。採点で低かった所と、この回で直す所（どの案も）:
//  - 窓の高さを固定し、下 1/4〜1/2 が空白 → 高さは中身に合わせる（画面の 88% まで。超えたら窓の中で送る）
//  - 節と節がすき間なく付く（中身の入れ物 #relBody が縦並びでなかった）→ #relBody を縦並び・すき間 14px に
//  - 同じ操作（この版を配る・推奨を外す）が 2 か所 → 操作は版の行だけ。上の節は状態だけ
//  - 「ZIP から版を置く…」の置き場が案で違い、置いた版が無いと見つからない → 窓の頭の段の右に決める（いつも同じ所）
//  - この PC のショートカットが今あるかが出ない → 「デスクトップ・スタートにあります／ありません」を書き、作るボタンは常に
//  - 手順（① 置く → ② 試す → ③ 配る）を目立つ形で見せたのは R1 だけ → どの案も手順を見せる
//  - 新しい PC のアドレスが切れる（R1・R6）→ 窓の幅いっぱいに全部
// 持ち越し: R3（状態のカード）・R1（手順の段）。新しい案: R7・R8・R9

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
.x-flow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:13.5px}
.x-flow .s{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:16px;padding:3px 12px 3px 4px;background:#f8fafc}
.x-flow .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:12.5px}
.x-flow .ar{color:var(--sub)}
`;
const head = `<div class="x-head"><span class="x-sub">置き場</span><span class="x-path">${SRC}</span><button class="x-btn" title="置き場を読み直して、版の一覧を新しくする">↻ 読み直す</button><button class="x-btn x-pri">＋ ZIP から版を置く…</button></div>`;
const flow = `<div class="x-flow"><span class="s"><span class="n">1</span>ZIP から版を置く（右上）</span><span class="ar">→</span><span class="s"><span class="n">2</span>ZIP を展開した exe で試す</span><span class="ar">→</span><span class="s"><span class="n">3</span>表の「この版を配る」</span><span class="x-sub">各 PC は起動したとき・30 分ごとに取り込み、開き直すとその版になります</span></div>`;
const rows = `
<tr><td><b>4.0.2</b></td><td><span class="x-tag x-new">置いただけ（まだ配っていない）</span></td><td>10/26 09:00 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn x-pri">この版を配る</button><button class="x-btn x-del">消す</button></td></tr>
<tr class="on"><td><b>4.0.1</b></td><td><span class="x-tag x-dist">配っている</span> <span class="x-tag x-rec">推奨: ${NOTE}</span></td><td>10/25 17:30 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn">推奨を外す</button></td></tr>
<tr><td><b>4.0.0</b></td><td><span class="x-tag x-me">この PC が使っている</span></td><td>10/24 10:00 maint</td><td>6.1 MB</td><td class="acts"><button class="x-btn">この版に戻す</button><button class="x-btn x-del">消す</button></td></tr>`;
const table = `<table class="x-t"><thead><tr><th>版</th><th>状態</th><th>置いた日時・人</th><th>大きさ</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
const newPc = `<div class="x-sec"><h4>新しい PC へ</h4><div class="x-row"><span class="x-path x-grow">${ENTRY}</span><button class="x-btn">アドレスをコピー</button></div>
  <div class="x-sub">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div>`;
const thisPc = `<div class="x-sec"><h4>この PC</h4>
  <div class="x-row"><span class="x-grow">版 <b>4.0.0</b> → <b>4.0.1</b> を取り込み済み（開き直すと入れ替わります）</span><button class="x-btn x-amber">↻ 開き直して更新</button></div>
  <div class="x-row"><span class="x-grow">ショートカット: <b>デスクトップ・スタートにあります</b>（消したときも、ここから何度でも作れます）</span><button class="x-btn">⌂ ショートカットを作る</button></div></div>`;
const body = (html) => ["script", `document.getElementById("relBody").innerHTML = ${JSON.stringify(html)};`];

export const STATES = { release: "document.getElementById(\"relModal\").hidden = false;" };

export const PROPOSALS = [
  {
    key: "R3b", name: "状態のカード 3 枚（状態だけ）＋手順の 1 行＋全部の版（操作はここだけ）＋新しい PC（全幅）",
    css: BASE + `.x-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
.x-state{border:1px solid var(--line);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:5px}
.x-state .lab{font-size:12.5px;color:var(--sub);font-weight:600}.x-state .v{font-size:26px;font-weight:700;line-height:1.1}
.x-state.dist{border-color:#9ccc9c;background:#f3faf3}.x-state.new{border-style:dashed}.x-state.me{border-color:#b7cbe6;background:#f5f8fd}`,
    ops: [body(`${head}
<div class="x-cards">
  <div class="x-state dist"><span class="lab">各 PC に配っている版</span><span class="v">4.0.1</span><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span></div>
  <div class="x-state new"><span class="lab">新しく置いた版（まだ配っていない）</span><span class="v">4.0.2</span><span class="x-sub">試してから、下の表の「この版を配る」</span></div>
  <div class="x-state me"><span class="lab">この PC</span><span class="v">4.0.0 → 4.0.1</span><div class="x-row"><button class="x-btn x-amber">↻ 開き直して更新</button><span class="x-sub">ショートカット あり</span><button class="x-btn">⌂ 作る</button></div></div>
</div>
${flow}
${table}
${newPc}`)],
  },
  {
    key: "R1b", name: "手順の段（① 置く ② 試す ③ 配る。各段に今の版）＋全部の版＋新しい PC（全幅）＋この PC",
    css: BASE + `.x-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.x-step{border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}
.x-step .n{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;margin-right:6px}
.x-step b{font-size:14.5px}.x-step .now{font-size:13px}`,
    ops: [body(`${head}
<div class="x-steps">
  <div class="x-step"><div><span class="n">1</span><b>ZIP から版を置く</b></div><span class="x-sub">右上のボタン。中身を確かめて置き場の versions に置きます（置いただけでは配りません）</span><span class="now">いちばん新しく置いた版: <b>4.0.2</b>（10/26）</span></div>
  <div class="x-step"><div><span class="n">2</span><b>試す</b></div><span class="x-sub">ZIP を展開した DefectTrace.exe を開くと、配る前に試せます（各 PC へは届きません）</span></div>
  <div class="x-step"><div><span class="n">3</span><b>この版を配る</b></div><span class="x-sub">下の表で押します。各 PC は起動したとき・30 分ごとに取り込み、開き直すとその版になります</span><span class="now">いま配っている版: <b>4.0.1</b>（推奨の札つき）</span></div>
</div>
${table}
${newPc}${thisPc}`)],
  },
  {
    key: "R7", name: "一文の状態（いま何がどうなっているかを文で）＋手順の 1 行＋全部の版＋下に 2 列（新しい PC・この PC）",
    css: BASE + `.x-say{font-size:15.5px;line-height:1.7;border-left:4px solid var(--acc);background:#f5f8fd;padding:8px 14px;border-radius:0 8px 8px 0}
.x-say b{font-size:16.5px}.x-two{display:grid;grid-template-columns:3fr 2fr;gap:12px}`,
    ops: [body(`${head}
<div class="x-say">各 PC には <b>4.0.1</b> を配っています（推奨: ${NOTE}）。<b>4.0.2</b> は置いただけで、まだ配っていません。この PC は <b>4.0.0</b>（4.0.1 を取り込み済み）。</div>
${flow}
${table}
<div class="x-two">${newPc}${thisPc}</div>`)],
  },
  {
    key: "R8", name: "左に手順の縦の流れ（① 置く ② 試す ③ 配る ④ 新しい PC へ）、右にその中身を並べる（版の表は ③ の中）",
    css: BASE + `.x-stepper{display:grid;grid-template-columns:42px 1fr;gap:0 12px}
.x-stepper .n{display:flex;flex-direction:column;align-items:center}.x-stepper .n i{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-style:normal}
.x-stepper .n:after{content:"";flex:1;width:2px;background:var(--line);margin:4px 0}.x-stepper .n.last:after{display:none}
.x-stepper .c{padding-bottom:14px;display:flex;flex-direction:column;gap:8px}.x-stepper .c>b{font-size:15px;line-height:28px}`,
    ops: [body(`${head}
<div class="x-stepper">
  <div class="n"><i>1</i></div><div class="c"><b>ZIP から版を置く</b><span class="x-sub">右上の「＋ ZIP から版を置く…」。GitHub の Releases の ZIP を選ぶと、中身を確かめて置き場の versions に置きます（置いただけでは配りません）</span></div>
  <div class="n"><i>2</i></div><div class="c"><b>試す</b><span class="x-sub">ZIP を展開した DefectTrace.exe を開くと、配る前に試せます（各 PC へは届きません）</span></div>
  <div class="n"><i>3</i></div><div class="c"><b>配る版を選ぶ</b>${table}</div>
  <div class="n last"><i>4</i></div><div class="c"><b>新しい PC へ</b><div class="x-row"><span class="x-path x-grow">${ENTRY}</span><button class="x-btn">アドレスをコピー</button></div></div>
</div>
${thisPc}`)],
  },
  {
    key: "R9", name: "版ごとの横長の札（大きな版の数字・状態の文・その版の操作）を縦に並べる＋手順の 1 行＋下に 2 列",
    css: BASE + `.x-cards2{display:flex;flex-direction:column;gap:8px}
.x-v{display:grid;grid-template-columns:110px 1fr auto;align-items:center;gap:14px;border:1px solid var(--line);border-radius:10px;padding:10px 14px}
.x-v .num{font-size:26px;font-weight:700}.x-v .st{display:flex;flex-direction:column;gap:4px}.x-v .st .t{font-size:14.5px}
.x-v.dist{border-color:#9ccc9c;background:#f3faf3}.x-v.new{border-style:dashed}.x-v.me{border-color:#b7cbe6}
.x-two{display:grid;grid-template-columns:3fr 2fr;gap:12px}`,
    ops: [body(`${head}
${flow}
<div class="x-cards2">
  <div class="x-v new"><span class="num">4.0.2</span><div class="st"><span class="t"><span class="x-tag x-new">置いただけ</span> まだどの PC にも配っていません</span><span class="x-sub">10/26 09:00 maint ・ 6.1 MB</span></div><div><button class="x-btn x-pri">この版を配る</button> <button class="x-btn x-del">消す</button></div></div>
  <div class="x-v dist"><span class="num">4.0.1</span><div class="st"><span class="t"><span class="x-tag x-dist">配っている</span> 各 PC はこの版になります</span><span class="x-tag x-rec" style="align-self:flex-start">推奨: ${NOTE}</span></div><div><button class="x-btn">推奨を外す</button></div></div>
  <div class="x-v me"><span class="num">4.0.0</span><div class="st"><span class="t"><span class="x-tag x-me">この PC</span> 前に配っていた版</span><span class="x-sub">10/24 10:00 maint ・ 6.1 MB</span></div><div><button class="x-btn">この版に戻す</button> <button class="x-btn x-del">消す</button></div></div>
</div>
<div class="x-two">${newPc}${thisPc}</div>`)],
  },
];
