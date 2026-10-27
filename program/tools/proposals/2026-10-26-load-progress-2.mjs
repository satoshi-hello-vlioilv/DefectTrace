// 読み込みの進みの見せ方（2 回目）。1 回目（2026-10-26-load-progress.mjs）は 1 位 P2 が 63.1 点で 80 点に届かなかった。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-26-load-progress-2.mjs
//
// 1 回目の採点で低かった所と、この回で直す所:
//  - 狭い幅で段階の並び・走っている段階・案内が切れる（−5 ×3）→ どの幅でも 1 行に収まる形（短い名前・数は棒の上・案内は短く）
//  - 帯が高い（約 90px）→ 使える状態では 1 行（約 36px）
//  - 左下の状態の字が「読み込み中」のまま、進みと 2 か所で言葉が違う → 左下も同じ言葉（いまの段階と残り時間）
//  - 中央の札（P4）は最初に見る物がはっきりしていて良いが、使える状態でカードを覆う → 使える状態では札をやめ、帯に縮む
// 持ち越し: P2（直した Q1）。新しい案: Q2（開いた直後は中央の札 → 使えると 1 行の帯）・Q3（6 段階を区切った 1 本の棒）・
// Q4（1 行だけ。段階の一覧は「詳細▾」に畳む）・Q5（Q2 の札 ＋ Q3 の区切った棒）
import { STEPS, PCT, ETA, BASE } from "./2026-10-26-load-progress.mjs";

const SHORT = { names: "一覧", info: "欠陥データ", cards: "画像の枠", link: "対応付け", analysis: "MAP・転写", thumbs: "縮小画像" };
const NOW = { early: "画像の一覧<em>を読んでいます</em>", mid: "縮小画像<em>を作っています</em>" };
const NUM = { early: "CAB 120 / 200", mid: "7,898 / 20,000" };
const USE = { early: "", mid: "操作できます" };

const COMMON = `
const S = ${JSON.stringify(STEPS)}, PCT = ${JSON.stringify(PCT)}, ETA = ${JSON.stringify(ETA)}, NOW = ${JSON.stringify(NOW)}, NUM = ${JSON.stringify(NUM)}, USE = ${JSON.stringify(USE)}, SHORT = ${JSON.stringify(SHORT)};
const st = document.body.dataset.state || "mid", steps = S[st];
const icon = (s) => ({ done: "✓", run: "●", wait: "○" })[s];
document.querySelectorAll(".lp").forEach((e) => e.remove());
document.getElementById("prog").hidden = true;
document.body.classList.toggle("early", st === "early");
const doneN = steps.filter((x) => x[2] === "done").length;
// 左下の状態も、進みと同じ言葉で
document.getElementById("status").textContent = NOW[st].split("<em>").join("").split("</em>").join("") + " " + NUM[st] + " ・ あと " + ETA[st];
// 済んだ区切りは名前の長さだけ。走っている区切り（いまの段階と数）が残りの幅を取って伸びる
const segs = () => '<div class="lseg">' + steps.map(([k, l, s, n]) => '<div class="sg ' + s + '"><i style="width:' + (s === "done" ? 100 : s === "run" ? (k === "thumbs" ? PCT[st] : 30) : 0) + '%"></i><span title="' + l + '">' + icon(s) + "<em> " + SHORT[k] + "</em>" + (s === "run" ? " " + NUM[st] : "") + "</span></div>").join("") + "</div>";
const stepsLine = () => '<span class="lpst done"><i>✓</i>済み ' + doneN + " / 6</span>" + steps.filter((x) => x[2] !== "done").map(([k, l, s]) => '<span class="lpst ' + s + '"><i>' + icon(s) + "</i>" + SHORT[k] + "</span>").join("");
`;
const render = (body) => ["script", `window.__lp = () => { ${COMMON} ${body} }; window.__lp();`];
export const STATES = {
  early: "document.body.dataset.state='early';window.__lp&&window.__lp()",
  mid: "document.body.dataset.state='mid';window.__lp&&window.__lp()",
};
const B2 = BASE + `
.lpbar{height:8px}
.lpline1{display:flex;align-items:center;gap:12px;padding:6px 14px;background:var(--pane);border-bottom:1px solid var(--line);white-space:nowrap;min-height:36px}
.lpline1 .now{font-weight:700;color:var(--acc)}.lpline1 .num{font-family:Consolas,monospace;color:var(--txt)}.lpline1 .use{color:var(--ok);font-weight:700}
.lpline1 .lpbar{flex:1;min-width:80px}
.lseg{display:flex;gap:3px;flex:1;min-width:0}.sg{position:relative;height:24px;border-radius:4px;background:var(--line2);overflow:hidden;flex:0 0 auto}.sg.run{flex:1 1 auto;min-width:170px}.sg.wait{flex:0 0 auto}
.sg i{position:absolute;inset:0 auto 0 0;background:#cfe0f6}.sg.done i{background:#d6ecd8}.sg.run i{background:#9fc0ea}
.sg span{position:relative;display:block;padding:0 7px;font-size:12px;line-height:24px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--sub)}
.sg.done span{color:var(--ok)}.sg.run span{color:var(--acc);font-weight:700}
#center{position:relative}
.lpcard{position:absolute;z-index:6;left:50%;top:62%;transform:translate(-50%,-50%);width:min(520px,90%);background:var(--pane);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 32px rgba(0,0,0,.18);padding:16px 20px;display:flex;flex-direction:column;gap:10px}
.lpcard h3{margin:0;font-size:16px}.lpcard .r{display:flex;align-items:baseline;gap:8px;white-space:nowrap}.lpcard .lst{display:flex;flex-direction:column;gap:6px}
.sg em,.lpdet em{font-style:normal}
@media (max-width:1500px){.lpline1 .now em{display:none}.sg.done em,.sg.wait em,.lpdet em{display:none}.sg.done span,.sg.wait span{padding:0 6px}}
.lpdet{white-space:nowrap;border:1px solid var(--line);background:var(--pane);border-radius:4px;padding:1px 8px;font-size:12px;color:var(--sub)}`;
const line = (inner) => `document.querySelector(".toolbar").insertAdjacentHTML("afterend", '<div class="lp lpline1" data-progress>' + ${inner} + "</div>");`;
const card = `document.getElementById("center").insertAdjacentHTML("beforeend", '<div class="lp lpcard" data-progress><div class="r"><h3>ロットを読み込んでいます</h3><span class="spacer"></span><span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span></div><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><div class="lst">' + steps.map(([k, l, s, n]) => '<span class="lpst ' + s + '"><i>' + icon(s) + "</i>" + l + (n ? " <b>" + n + "</b>" : "") + "</span>").join("") + '</div><div class="sub">一覧と欠陥データがそろうと、操作できるようになります</div></div>');`;

export const PROPOSALS = [
  { key: "now", name: "今（ツールバーの小さな棒・縮小画像の数だけ）",
    ops: [["script", `window.__lp = () => { const st=document.body.dataset.state; const p=document.getElementById('prog'); p.hidden = st==='early'; document.getElementById('progBar').style.width='39%'; document.getElementById('progTxt').textContent='縮小画像 7898/20000'; document.body.classList.toggle('early', st==='early'); if(st==='early'){ document.querySelector('#grid').insertAdjacentHTML('afterbegin','<div class="empty lp" style="flex-basis:100%">展開中...</div>'); } else document.querySelectorAll('.lp').forEach(e=>e.remove()); document.getElementById('status').textContent='ロットを開いています...'; }; window.__lp();`]], css: "body.early #grid .th,body.early #grid .cabsep{display:none}" },
  { key: "Q1", name: "P2 を直した（1 行目: いま・数・棒・残り時間・操作できます／2 行目: ✓済み n/6 ＋ 残りの段階を短い名前で）", css: B2 + `.lpq1{display:flex;flex-direction:column;gap:4px;padding:6px 14px;background:var(--pane);border-bottom:1px solid var(--line)}.lpq1 .r1,.lpq1 .r2{display:flex;align-items:center;gap:12px;white-space:nowrap}.lpq1 .lpbar{flex:1;min-width:80px}.lpq1 .now{font-weight:700;color:var(--acc)}.lpq1 .use{color:var(--ok);font-weight:700}.lpq1 .num{font-family:Consolas,monospace}`,
    ops: [render(`document.querySelector(".toolbar").insertAdjacentHTML("afterend", '<div class="lp lpq1" data-progress><div class="r1"><span class="now">' + NOW[st] + '</span><span class="num">' + NUM[st] + '</span><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><span class="sub">あと</span><span class="lpeta">' + ETA[st] + "</span>" + (USE[st] ? '<span class="use">✓ ' + USE[st] + "</span>" : "") + '</div><div class="r2">' + stepsLine() + "</div></div>");`)] },
  { key: "Q2", name: "開いた直後は中央の札（段階の一覧）→ 使えると 1 行の帯に縮む（カードを覆わない）", css: B2,
    ops: [render(`if (st === "early") { ${card} } else { ${line(`'<span class="now">' + NOW[st] + '</span><span class="num">' + NUM[st] + '</span><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span><span class="use">✓ ' + USE[st] + "</span>"`)} }`)] },
  { key: "Q3", name: "6 段階を区切った 1 本の棒（各区切りに ✓・● と短い名前、縮小画像の区切りは % で伸びる）＋残り時間", css: B2,
    ops: [render(line(`segs() + '<span class="sub">あと</span><span class="lpeta">' + ETA[st] + "</span>" + (USE[st] ? '<span class="use">✓ ' + USE[st] + "</span>" : "")`))] },
  { key: "Q4", name: "1 行だけ（いま・数・棒・残り時間・操作できます）。段階の一覧は「詳細▾」に畳む", css: B2,
    ops: [render(line(`'<span class="now">' + NOW[st] + '</span><span class="num">' + NUM[st] + '</span><div class="lpbar"><i style="width:' + PCT[st] + '%"></i></div><span class="sub">あと</span><span class="lpeta">' + ETA[st] + "</span>" + (USE[st] ? '<span class="use">✓ ' + USE[st] + "</span>" : "") + '<button type="button" class="lpdet"><em>段階 ' + doneN + "/6 </em>詳細▾</button>"`))] },
  { key: "Q5", name: "開いた直後は中央の札 → 使えると 6 段階の区切った棒の 1 行（Q2 ＋ Q3）", css: B2,
    ops: [render(`if (st === "early") { ${card} } else { ${line(`segs() + '<span class="sub">あと</span><span class="lpeta">' + ETA[st] + '</span><span class="use">✓ ' + USE[st] + "</span>"`)} }`)] },
];
