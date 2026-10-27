// 読み込みの進みの見せ方（3 回目・最後の回）。2 回目（2026-10-26-load-progress-2.mjs）は 1 位 Q1 が 79.2 点で 80 点に届かなかった。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-load-progress-3.mjs
//
// 2 回目の採点で低かった所と、この回で直す所:
//  - まだ何も済んでいないのに緑の ✓「済み 0 / 6」が出る（形と色 7）→ 済んだ段階が無いときは出さない
//  - 帯がツールバーと同じ白で控えめ（階層 7）→ 帯の地を薄い青にし、左に色の線
//  - 広い幅でも済んだ段階が畳まれ、どれが済んだか見えない → 1500px より広ければ済んだ段階も名前で並べる
//  - 中央の札が 1280 で CAB の見出しに被る（−5）→ 札を画像一覧の流れの中（見出しの上）に置き、何にも被らない
//  - 札と帯で段階の名前が違う（言葉 6）→ 同じ名前（画像の一覧・欠陥データ・画像の枠・画像と欠陥の対応・MAP・転写・ピッチ・縮小画像）
// 持ち越し: Q1（直した R1）。新しい案: R2（R1 ＋開いた直後の札）・R3（開いた直後の札 ＋ 1 行の帯〈段階は ✓ の並び〉）・
// R4（同じ帯が、開いた直後は大きく、使えると小さく）・R5（R4 ＋開いた直後の札）
import { STEPS, PCT, ETA, BASE } from "./2026-10-26-load-progress.mjs";

const NOW = { early: "画像の一覧<em>を読んでいます</em>", mid: "縮小画像<em>を作っています</em>" };
const NUM = { early: "CAB 120 / 200", mid: "7,898 / 20,000" };
const USE = { early: "", mid: "操作できます" };

const COMMON = `
const S = ${JSON.stringify(STEPS)}, PCT = ${JSON.stringify(PCT)}, ETA = ${JSON.stringify(ETA)}, NOW = ${JSON.stringify(NOW)}, NUM = ${JSON.stringify(NUM)}, USE = ${JSON.stringify(USE)};
const st = document.body.dataset.state || "mid", steps = S[st];
const icon = (s) => ({ done: "✓", run: "●", wait: "○" })[s];
document.querySelectorAll(".lp").forEach((e) => e.remove());
document.getElementById("prog").hidden = true;
document.body.classList.toggle("early", st === "early");
const plain = (t) => t.split("<em>").join("").split("</em>").join("");
const doneN = steps.filter((x) => x[2] === "done").length, waitN = steps.filter((x) => x[2] === "wait").length;
document.getElementById("status").textContent = plain(NOW[st]) + " " + NUM[st] + " ・ あと " + ETA[st];
// 段階の並び: 済んだ段階は広い幅では名前で、狭い幅では「✓ 済み n / 6」に畳む（0 のときは出さない）
const stepsLine = (cls = "") => (doneN ? '<span class="lpst done lpsum"><i>✓</i>済み ' + doneN + " / 6</span>" : "") +
  steps.map(([k, l, s]) => '<span class="lpst ' + s + (s === "done" ? " lpdn" : s === "wait" ? " lpwt" : "") + '"><i>' + icon(s) + "</i>" + l + "</span>").join("") +
  (waitN ? '<span class="lpst wait lpwsum" title="' + steps.filter((x) => x[2] === "wait").map((x) => x[1]).join("・") + '"><i>○</i>残り ' + waitN + " 段階</span>" : "");
const head1 = () => '<span class="now">' + NOW[st] + '</span><span class="num">' + NUM[st] + '</span><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><span class="sub">あと</span><span class="lpeta">' + ETA[st] + "</span>" + (USE[st] ? '<span class="use">✓ ' + USE[st] + "</span>" : "");
const band = (big) => '<div class="lp lpband3' + (big ? " big" : "") + '" data-progress><div class="r1">' + head1() + '</div><div class="r2">' + stepsLine() + "</div></div>";
const ticks = () => '<span class="ticks" title="' + steps.map(([k, l, s]) => icon(s) + " " + l).join(" / ") + '">' + steps.map(([k, l, s]) => '<i class="' + s + '">' + icon(s) + "</i>").join("") + '<span class="sub">段階 ' + (doneN + (steps.some((x) => x[2] === "run") ? 1 : 0)) + " / 6</span></span>";
const line1 = () => '<div class="lp lpband3 one" data-progress><div class="r1">' + head1() + ticks() + "</div></div>";
const card = () => '<div class="lp lpcard3" data-progress><div class="r"><h3>ロットを読み込んでいます</h3><span class="spacer"></span><span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span></div><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><div class="lst">' +
  steps.map(([k, l, s, n]) => '<span class="lpst ' + s + '"><i>' + icon(s) + "</i>" + l + (n ? " <b>" + n + "</b>" : "") + "</span>").join("") + '</div><div class="sub">画像の一覧と欠陥データがそろうと、操作できるようになります</div></div>';
const toolbarAfter = (h) => document.querySelector(".toolbar").insertAdjacentHTML("afterend", h);
const gridFirst = (h) => document.getElementById("grid").insertAdjacentHTML("afterbegin", h);
`;
const render = (body) => ["script", `window.__lp = () => { ${COMMON} ${body} }; window.__lp();`];
export const STATES = {
  early: "document.body.dataset.state='early';window.__lp&&window.__lp()",
  mid: "document.body.dataset.state='mid';window.__lp&&window.__lp()",
};
const C = BASE + `
.lpbar{height:8px}
.lpband3{display:flex;flex-direction:column;gap:5px;padding:7px 14px 8px;background:#eef4fc;border-bottom:1px solid #c9d9ee;border-left:4px solid var(--acc)}
.lpband3 .r1,.lpband3 .r2{display:flex;align-items:center;gap:12px;white-space:nowrap;min-width:0}
.lpband3 .now{font-weight:700;color:var(--acc)}.lpband3 .num{font-family:Consolas,monospace;color:var(--txt)}.lpband3 .use{color:var(--ok);font-weight:700}
.lpband3 .lpbar{flex:1;min-width:80px;background:#d9e3f0}
.lpband3.big{padding:12px 16px 12px}.lpband3.big .now{font-size:16px}.lpband3.big .lpbar{height:10px}.lpband3.big .r2{font-size:13.5px}
.lpband3 .lpsum,.lpband3 .lpwsum{display:none}
@media (max-width:1500px){.lpband3 .lpdn,.lpband3 .lpwt,.ticks .sub{display:none}.lpband3 .lpsum,.lpband3 .lpwsum{display:inline-flex}.lpband3 .now em{display:none}}
.ticks{display:inline-flex;align-items:center;gap:3px}.ticks i{font-style:normal;width:16px;height:16px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:10px;border:1.5px solid #c5ccd6;color:#c5ccd6}
.ticks i.done{background:var(--ok);border-color:var(--ok);color:#fff}.ticks i.run{border-color:var(--acc);color:var(--acc)}.ticks .sub{margin-left:4px;font-size:12px}
.lpcard3{flex-basis:100%;max-width:560px;margin:28px auto 8px;background:var(--pane);border:1px solid var(--line);border-left:4px solid var(--acc);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.10);padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.lpcard3 h3{margin:0;font-size:16px}.lpcard3 .r{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.lpcard3 .lst{display:flex;flex-direction:column;gap:6px}`;

export const PROPOSALS = [
  { key: "now", name: "今（ツールバーの小さな棒・縮小画像の数だけ）",
    ops: [["script", `window.__lp = () => { const st=document.body.dataset.state; const p=document.getElementById('prog'); p.hidden = st==='early'; document.getElementById('progBar').style.width='39%'; document.getElementById('progTxt').textContent='縮小画像 7898/20000'; document.body.classList.toggle('early', st==='early'); if(st==='early'){ document.querySelector('#grid').insertAdjacentHTML('afterbegin','<div class="empty lp" style="flex-basis:100%">展開中...</div>'); } else document.querySelectorAll('.lp').forEach(e=>e.remove()); document.getElementById('status').textContent='ロットを開いています...'; }; window.__lp();`]], css: "body.early #grid .th,body.early #grid .cabsep{display:none}" },
  { key: "R1", name: "Q1 を直した（済み 0 は出さない・帯は薄い青で左に線・広い幅では済んだ段階も名前で）", css: C, ops: [render(`toolbarAfter(band(false));`)] },
  { key: "R2", name: "R1 ＋ 開いた直後は画像一覧の流れの中に札（段階の一覧。何にも被らない）", css: C, ops: [render(`toolbarAfter(band(false)); if (st === "early") gridFirst(card());`)] },
  { key: "R3", name: "開いた直後は流れの中の札 ＋ いつも 1 行の帯（段階は ✓●○ の並び、名前は指すと出る）", css: C, ops: [render(`toolbarAfter(line1()); if (st === "early") gridFirst(card());`)] },
  { key: "R4", name: "同じ帯が、開いた直後は大きく（段階を強く）、使えると小さく（場所は変えない）", css: C, ops: [render(`toolbarAfter(band(st === "early"));`)] },
  { key: "R5", name: "R4 ＋ 開いた直後は流れの中の札（使えると札は消え、帯は小さく）", css: C, ops: [render(`toolbarAfter(band(st === "early")); if (st === "early") gridFirst(card());`)] },
];
