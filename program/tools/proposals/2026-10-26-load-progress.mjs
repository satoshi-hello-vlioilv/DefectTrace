// 大きなロットを読み込む間の「進み」の見せ方の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-load-progress.mjs
//
// 今の困りごと（測った数: program/tools/open-check.mjs。3,000 枚のロットで、開いてから 21.5 秒、進みの字が画面に 1 つも出なかった。
// 画面が固まり、ツールバーの小さな進み〈幅 170px・縮小画像の数だけ〉も描き直されなかった）。固まりは直した（2 万枚で最長 0.2 秒）。
// 残る問い: 何を・どこまで・あとどれくらい待つのか、待つ間に使えるのかを、見てすぐ分かるように出す。
// 案の方向: 置き場（ツールバー・一覧の上の帯・下の帯・中央・見出しの線・CAB の見出し）× 見せ方（段階の一覧・1 本の棒・位置）
//
// 状態: early（開いて 0.5 秒。CAB の一覧を読み、欠陥データを読んでいる）・mid（使える。縮小画像を作っている 39%）
// 数は 2 万枚のロット（CAB 200 個）を開いたときの本物の進みから取った（open-check.mjs の控え）。

const STEPS = {
  early: [["names", "画像の一覧", "run", "CAB 120 / 200"], ["info", "欠陥データ", "run", "読込中"], ["cards", "画像の枠", "wait", ""], ["link", "画像と欠陥の対応", "wait", ""],
    ["analysis", "MAP・転写・ピッチ", "wait", ""], ["thumbs", "縮小画像", "wait", ""]],
  mid: [["names", "画像の一覧", "done", "CAB 200"], ["info", "欠陥データ", "done", "20,000 件"], ["cards", "画像の枠", "done", "20,000 枚"], ["link", "画像と欠陥の対応", "done", ""],
    ["analysis", "MAP・転写・ピッチ", "done", ""], ["thumbs", "縮小画像", "run", "7,898 / 20,000"]],
};
const PCT = { early: 6, mid: 39 };
const ETA = { early: "計算中", mid: "約 8 秒" };
const NOW = { early: "画像の一覧を読んでいます（CAB 120 / 200）", mid: "縮小画像を作っています 7,898 / 20,000" };
const USE = { early: "", mid: "操作できます（見ている所から先に作っています）" };

const COMMON = `
const S = ${JSON.stringify(STEPS)}, PCT = ${JSON.stringify(PCT)}, ETA = ${JSON.stringify(ETA)}, NOW = ${JSON.stringify(NOW)}, USE = ${JSON.stringify(USE)};
const st = document.body.dataset.state || "mid", steps = S[st];
const icon = (s) => ({ done: "✓", run: "●", wait: "○" })[s];
const stepsHtml = (cls) => steps.map(([k, l, s, n]) => '<span class="' + cls + ' ' + s + '"><i>' + icon(s) + "</i>" + l + (n ? ' <b>' + n + "</b>" : "") + "</span>").join("");
document.querySelectorAll(".lp").forEach((e) => e.remove());
document.getElementById("prog").hidden = true;
document.body.classList.toggle("early", st === "early");
document.getElementById("status").textContent = st === "early" ? "ロットを開いています..." : "読み込み中";
`;
const render = (body) => ["script", `window.__lp = () => { ${COMMON} ${body} }; window.__lp();`];
export const STATES = {
  early: "document.body.dataset.state='early';window.__lp&&window.__lp()",
  mid: "document.body.dataset.state='mid';window.__lp&&window.__lp()",
};

const BASE = `
body.early #grid .th{display:none}
body.early #grid .cabsep .st{color:var(--sub)}
.lp{font-size:13px}
.lp .ok{color:var(--ok)}
.lpbar{height:8px;border-radius:4px;background:var(--line2);overflow:hidden}.lpbar>i{display:block;height:100%;background:var(--acc);border-radius:4px}
.lpst{display:inline-flex;align-items:center;gap:4px;white-space:nowrap;color:var(--sub)}
.lpst i{font-style:normal;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;border:1.5px solid #c5ccd6;color:#c5ccd6}
.lpst.done{color:var(--txt)}.lpst.done i{background:var(--ok);border-color:var(--ok);color:#fff}
.lpst.run{color:var(--acc);font-weight:700}.lpst.run i{border-color:var(--acc);color:var(--acc);animation:none}
.lpst b{font-weight:400;font-family:Consolas,monospace;font-size:12px;color:var(--sub)}
.lpeta{font-weight:700;color:var(--txt);white-space:nowrap}
`;

export const PROPOSALS = [
  { key: "now", name: "今（ツールバーの小さな棒・縮小画像の数だけ）",
    ops: [["script", `window.__lp = () => { const st=document.body.dataset.state; const p=document.getElementById('prog'); p.hidden = st==='early'; document.getElementById('progBar').style.width='39%'; document.getElementById('progTxt').textContent='縮小画像 7898/20000'; document.body.classList.toggle('early', st==='early'); if(st==='early'){ document.querySelector('#grid').insertAdjacentHTML('afterbegin','<div class="empty lp" style="flex-basis:100%">展開中...</div>'); } else document.querySelectorAll('.lp').forEach(e=>e.remove()); document.getElementById('status').textContent= st==='early' ? 'ロットを開いています...' : 'ロットを開いています...'; }; window.__lp();`]], css: "body.early #grid .th,body.early #grid .cabsep{display:none}" },
  {
    key: "P1", name: "ツールバーの進みを広げる（いまの段階・数・残り時間）", css: BASE + `
.lptb{display:flex;align-items:center;gap:10px;padding:3px 10px;border:1px solid #b7cbe6;border-radius:6px;background:var(--accbg);min-width:420px}
.lptb .lpbar{flex:1;min-width:120px}.lptb .t{white-space:nowrap;color:var(--acc);font-weight:700}`,
    ops: [render(`document.querySelector(".cardzone").insertAdjacentHTML("afterend", '<div class="lp lptb" data-progress><span class="t">' + NOW[st].replace("を作っています", "") + '</span><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><span class="lpeta">あと ' + ETA[st] + "</span></div>");`)],
  },
  {
    key: "P2", name: "画像一覧の上に全幅の帯（段階の並び＋全体の棒＋残り時間）。済んだら畳む", css: BASE + `
.lpband{margin:0;padding:8px 14px 9px;background:var(--pane);border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
.lpband .r1{display:flex;align-items:baseline;gap:12px}.lpband .now{font-size:14px;font-weight:700;color:var(--acc)}.lpband .use{color:var(--ok);font-size:12.5px}
.lpband .r3{display:flex;gap:16px;overflow:hidden}
.lpband .now{white-space:nowrap}.lpband .use{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.lpband .r1 .sub,.lpband .lpeta{white-space:nowrap}
.lpband .r3 .lpsum{display:none}
@media (max-width:1500px){.lpband .r3 .lpst.done{display:none}.lpband .r3 .lpst.lpsum{display:inline-flex}}`,
    ops: [render(`document.querySelector(".toolbar").insertAdjacentHTML("afterend", '<div class="lp lpband" data-progress><div class="r1"><span class="now">' + NOW[st] + '</span><span class="use">' + USE[st] + '</span><span class="spacer"></span><span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span></div><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><div class="r3">' + (steps.some((x) => x[2] === "done") ? '<span class="lpst done lpsum" title="済んだ段階"><i>✓</i>済み ' + steps.filter((x) => x[2] === "done").length + " / " + steps.length + "</span>" : "") + stepsHtml("lpst") + "</div></div>");`)],
  },
  {
    key: "P3", name: "下の帯（状態の帯）に進み（いつもの場所・小さく）", css: BASE + `
footer{align-items:center}.lpft{display:flex;align-items:center;gap:10px}.lpft .lpbar{width:260px}.lpft .t{white-space:nowrap}`,
    ops: [render(`document.getElementById("status").textContent = ""; document.getElementById("status").insertAdjacentHTML("afterbegin", '<span class="lp lpft" data-progress><span class="t">' + NOW[st] + '</span><span class="lpbar"><i style="width:' + PCT[st] + '%"></i></span><span class="lpeta">あと ' + ETA[st] + "</span></span>");`)],
  },
  {
    key: "P4", name: "画像一覧の真ん中に読み込みの札（段階の一覧）。使えるようになったら右下へ小さく退く", css: BASE + `
#center{position:relative}
.lpcard{position:absolute;z-index:6;background:var(--pane);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:14px 18px;display:flex;flex-direction:column;gap:8px}
.lpcard.big{left:50%;top:46%;transform:translate(-50%,-50%);width:440px}.lpcard.small{right:18px;bottom:18px;width:430px;padding:10px 14px}.lpcard h3{white-space:nowrap}
.lpcard h3{margin:0;font-size:15px}.lpcard .lst{display:flex;flex-direction:column;gap:5px}.lpcard .r{display:flex;align-items:baseline;gap:8px}`,
    ops: [render(`const big = st === "early";
      document.getElementById("center").insertAdjacentHTML("beforeend", '<div class="lp lpcard ' + (big ? "big" : "small") + '" data-progress><div class="r"><h3>' + (big ? "ロットを読み込んでいます" : NOW[st]) + '</h3><span class="spacer"></span><span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span></div><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div>' +
      (big ? '<div class="lst">' + stepsHtml("lpst") + "</div>" : '<div class="sub" style="color:var(--ok)">' + USE[st] + "</div>") + "</div>");`)],
  },
  {
    key: "P5", name: "CAB の見出しごとに進み（位置で見せる）＋ツールバーに全体", css: BASE + `
.cabsep .lpc{display:inline-flex;align-items:center;gap:6px;font-weight:400}.cabsep .lpc .lpbar{width:120px;height:6px}
.lptb2{display:flex;align-items:center;gap:8px;white-space:nowrap}.lptb2 .lpbar{width:200px}`,
    ops: [render(`document.querySelectorAll(".cabsep").forEach((c, i) => c.insertAdjacentHTML("beforeend", '<span class="lp lpc">' + (st === "early" ? "読込中" : '<span class="lpbar"><i style="width:' + [100, 60, 0][i % 3] + '%"></i></span>' + ["縮小 済み", "縮小 60/100", "待ち"][i % 3]) + "</span>"));
      document.querySelector(".cardzone").insertAdjacentHTML("afterend", '<span class="lp lptb2" data-progress><b>' + NOW[st] + '</b><span class="lpbar"><i style="width:' + PCT[st] + '%"></i></span>あと <span class="lpeta">' + ETA[st] + "</span></span>");`)],
  },
  {
    key: "P6", name: "見出しの下に細い全幅の進み線＋見出しの中に段階と残り時間（ブラウザの読み込み線の型）", css: BASE + `
.lpline{position:absolute;left:0;right:0;top:0;height:3px;background:transparent;z-index:5}.lpline>i{display:block;height:100%;background:#e6a52e}
.lphd{display:inline-flex;align-items:center;gap:8px;color:#e8eef5;font-size:12.5px;white-space:nowrap}.lphd .lpeta{color:#fff}`,
    ops: [render(`document.querySelector("main").style.position = "relative";
      document.querySelector("main").insertAdjacentHTML("afterbegin", '<div class="lp lpline"><i style="width:' + PCT[st] + '%"></i></div>');
      document.getElementById("crumb").insertAdjacentHTML("afterend", '<span class="lp lphd" data-progress>｜ ' + NOW[st] + ' ・ あと <span class="lpeta">' + ETA[st] + "</span></span>");`)],
  },
];
