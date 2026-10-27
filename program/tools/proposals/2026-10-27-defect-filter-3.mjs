// 欠陥のフィルタの案（3 回目・最後の回）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-defect-filter-3.mjs
//
// 2 回目は 1 位 F4b が 64.4 点（加点だけなら F1b が 79.2 点）で 80 点に届かなかった。採点で低かった所と、この回で直す所（どの案も）:
//  - 絞った後も右の列の「画像情報 (1/24)」「MAP 58件」が全部の数のまま（−3）→ 「(1/8)」「8件（絞り込み中・全 58）」に
//  - 1280 で帯のチップの枠が切れる・2 つ目が「＋他 1」に畳まれて中身が消える → 帯の 1 段を保ったまま、畳んだ物の名前を出す（「＋他 1: 長くて細い」）。
//    チップの中身（面積 ≥ 5 など）は、入りきらないときだけ畳む（名前は切らない）
//  - 1280 で作る所を開くと道具の列（画像表示）が押されて切れる → 道具の列は縮めない。作る所は低く（2 列・1 行に 1 条件）
//  - 置き場の選び方が 2 段に折れる → 短い言葉（自分（この PC）・共有（だれでも）・既定（開発者だけ））で 1 段に
//  - F4b: 条件を重ねる・外すたびに窓を開く・帯に中身が無い → 帯のチップで外せる・中身つき。窓は作る・選ぶときだけ
// 持ち越し: F1b → F1c・F4b → F4c。新しい案: F10（作る所を一覧の右に並べ、当てはまる画像を見ながら作る）・
//   F11（条件は 1 行の組み立て〈項目・比べ方・値を横に〉で帯のすぐ下に、低く）・F12（登録した条件をタブにして各条件の枚数を出す）
// 状態: lot（2 つ重ねて 24 → 8 枚）・edit（開発者でない人が新しい条件を作っている）

const SC = { def: "既定", share: "共有", mine: "自分" };
const LIB = [
  ["def", "大きい欠陥", "長さ ≥ 10 mm", false, 9], ["def", "穴だけ", "分類 = 穴", false, 6],
  ["share", "面積 5mm² 以上", "面積 ≥ 5 mm²", true, 14], ["share", "表面のキズ", "面 = 表 かつ 分類 = キズ", false, 4],
  ["mine", "長くて細い", "縦横比 ≥ 3", true, 11],
];
const BASE = `
.f-sc{display:inline-flex;align-items:center;border-radius:3px;padding:0 5px;font-size:11px;font-weight:700;border:1px solid;line-height:16px;white-space:nowrap}
.f-sc.def{color:#3f4a5a;border-color:#9aa6b6;background:#eef1f5}.f-sc.share{color:#0b6b62;border-color:#8fd0c8;background:#e6f6f4}.f-sc.mine{color:#5a3fa0;border-color:#c3b3ea;background:#f3effc}
.f-chip{flex:none;display:inline-flex;align-items:center;gap:4px;border:1px solid var(--acc);border-radius:14px;padding:1px 2px 1px 4px;font-size:12.5px;background:var(--accbg);color:var(--acc);white-space:nowrap}
.f-chip .c{color:#36506f}.f-chip b{font-weight:600}.f-chip .x{border:none;background:none;color:var(--acc);padding:0 5px;font-size:13px}
.f-btn{flex:none;border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:12.5px;white-space:nowrap}
.f-pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.f-n{flex:none;font-size:13px;white-space:nowrap}.f-n b{font-size:15px;color:var(--acc)}
.f-hint{color:var(--sub);font-size:12px}
.f-bar{flex:none;display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc;min-width:0}
.f-bar .lab{flex:none;font-size:12.5px;color:var(--sub);font-weight:600}.f-chips{display:flex;gap:6px;min-width:0;flex:1;overflow:hidden;padding:1px 3px 1px 1px}
.f-more{flex:none;font-size:12.5px;color:var(--acc);border:1px dashed var(--acc);border-radius:14px;padding:1px 9px;white-space:nowrap}
#center>.toolbar{flex:none}
.f-ed{background:var(--pane);border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:8px;font-size:13px}
.f-ed h4{margin:0;font-size:14px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:13px;padding:2px 6px;border:1px solid var(--line);border-radius:4px}
.f-r{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.f-r .x{color:var(--sub);border:none;background:none}
.f-k{flex:none;width:44px;color:var(--sub);font-size:12px;white-space:nowrap}
.f-scope{display:flex;gap:12px;flex-wrap:wrap}.f-scope label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.f-scope label.no{color:#9aa3ad}
.f-hist{display:flex;align-items:flex-end;gap:2px;height:40px;border-bottom:1px solid var(--line);padding:0 2px}.f-hist i{flex:1;background:#c3d3ea}.f-hist i.in{background:var(--acc)}
body:not([data-state=edit]) .f-ed,body:not([data-state=edit]) .f-edit-only{display:none}`;
const HIST = (w = 240) => `<div class="f-hist" style="width:${w}px">${[3, 9, 22, 30, 26, 18, 12, 8, 6, 4, 3, 2, 2, 1, 1].map((h, i) => `<i class="${i >= 6 ? "in" : ""}" style="height:${h * 1.3}px"></i>`).join("")}</div>`;
const scope = `<div class="f-r"><span class="f-k">置き場</span><span class="f-scope"><label><input type="radio" name="sc" checked><span class="f-sc mine">自分</span>この PC</label>
  <label><input type="radio" name="sc"><span class="f-sc share">共有</span>だれでも</label>
  <label class="no" title="既定の条件は開発者だけが保存できます"><input type="radio" name="sc" disabled><span class="f-sc def">既定</span>開発者だけ</label></span></div>`;
const cond1 = `<div class="f-r"><select><option>長さ (mm)</option></select><select><option>≥</option></select><input type="number" value="8" style="width:64px"><span class="f-hint">このロット 0.5〜96</span><button class="x">×</button></div>`;
const cond2 = `<div class="f-r"><select><option>分類</option></select><select><option>=</option></select><select><option>穴</option></select><button class="x">×</button></div>`;
const more = `<div class="f-r"><button class="f-btn">＋ 条件</button><select><option>すべて満たす（かつ）</option><option>どれか（または）</option></select></div>`;
const name = `<div class="f-r"><span class="f-k">名前</span><input type="text" value="長い穴" style="width:200px"></div>`;
const live = `<span class="f-n">当てはまる画像 <b>5</b> / 24 枚</span>`;
const save = `<button class="f-btn">絞るだけ（保存しない）</button><button class="f-btn f-pri">保存</button>`;
const chipsOn = LIB.filter((x) => x[3]).map(([sc, n, c]) => `<span class="f-chip" title="${c}"><span class="f-sc ${sc}">${SC[sc]}</span><b>${n}</b><span class="c">（${c}）</span><button class="x" title="外す">×</button></span>`).join("");
const count = `<span class="f-n" title="表示している画像 / ロットの画像"><b>8</b> / 24 枚</span><button class="f-btn" title="フィルタをすべて外す">外す</button>`;
const narrow = ["script", `document.querySelectorAll("#grid .th").forEach((t, i) => { if (i % 3) t.style.display = "none"; });
  document.querySelectorAll("#grid *").forEach((e) => { if (e.children.length === 0 && /^\\d+枚$/.test(e.textContent.trim())) e.textContent = Math.ceil(parseInt(e.textContent) / 3) + "枚"; });
  document.getElementById("status").textContent = "8 / 24 枚を表示（フィルタ 2 つ）・CAB 3・フォルダ 1";
  const it = document.getElementById("imgTitle"); it.textContent = it.textContent.replace(/\\((\\d+)\\/24\\)/, "($1/8)");
  document.getElementById("mapTitle").textContent = "8件（絞り込み中・全 58）";`];
// 入りきらなければ、まずチップの中身の字を畳み、それでも入らなければ後ろのチップを「＋他 n: 名前」に畳む
const fit = ["script", `document.querySelectorAll(".f-chips").forEach((box) => { const cs = [...box.querySelectorAll(".f-chip")];
  const over = () => box.scrollWidth > box.clientWidth - 2;
  if (over()) box.querySelectorAll(".f-chip .c").forEach((c) => { c.style.display = "none"; });
  const hid = []; while (over() && cs.length - hid.length > 1) { const c = cs[cs.length - 1 - hid.length]; c.style.display = "none"; hid.unshift(c.querySelector("b").textContent);
    box.parentNode.querySelector(".f-more")?.remove(); box.insertAdjacentHTML("afterend", '<span class="f-more" title="' + hid.join("・") + '">＋他 ' + hid.length + ': ' + hid.join("・") + '</span>'); } });`];
const afterToolbar = (html) => ["insert", html, "afterend", "#center>.toolbar"];
const libList = () => ["def", "share", "mine"].map((sc) => `<div class="f-hint" style="margin-top:6px;font-weight:600">${{ def: "既定（開発者が決めた）", share: "共有（だれでも）", mine: "自分（この PC）" }[sc]}</div>` +
  LIB.filter((x) => x[0] === sc).map(([s, n, c, on, k]) => `<label style="display:flex;align-items:center;gap:6px;padding:2px 0"><input type="checkbox" ${on ? "checked" : ""}><span>${n}</span><span class="f-hint" style="margin-left:auto">${c}・${k} 枚</span></label>`).join("")).join("");
const bar = (right = `<button class="f-btn">条件 ▾</button><button class="f-btn">＋ 作る</button>`) => `<div class="f-bar"><span class="lab">フィルタ</span><div class="f-chips">${chipsOn}</div>${right}${count}</div>`;

export const STATES = { lot: "", edit: "document.body.dataset.state='edit'" };

export const PROPOSALS = [
  {
    key: "F1c", name: "F1b を直した: 帯（1 段・中身つきチップ・畳んだら名前も）＋作る所は帯の下に低く 2 列（左に条件、右に分布・置き場・保存）",
    css: BASE + `.f-under{flex:none;padding:8px 12px;border-bottom:1px solid var(--line);background:#fbfcfd}.f-under .f-ed{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 18px}
.f-under .col{display:flex;flex-direction:column;gap:6px;min-width:0}body:not([data-state=edit]) .f-under{display:none}`,
    ops: [afterToolbar(`${bar()}<div class="f-under"><div class="f-ed"><div class="col"><h4>条件を作る</h4>${name}${cond1}${cond2}${more}</div>
      <div class="col"><span class="f-hint">長さ (mm) の分布（濃い所が当てはまる）</span>${HIST()}${scope}<div class="f-r">${live}${save}</div></div></div></div>`), narrow, fit],
  },
  {
    key: "F4c", name: "F4b を直した: 帯は中身つきのチップ（その場で外せる）＋「フィルタ…」で窓（左に登録した条件と各条件の枚数、右に作る所・分布・当てはまる見本）",
    css: BASE + `.f-modal{position:fixed;inset:0;background:rgba(15,25,40,.35);display:flex;align-items:center;justify-content:center;z-index:50}
body:not([data-state=edit]) .f-modal{display:none}
.f-win{background:var(--pane);border-radius:10px;width:min(1040px,90vw);max-height:84vh;display:grid;grid-template-columns:320px 1fr;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.f-lib{border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:2px;background:#f8fafc;font-size:13px;overflow:auto}
.f-win .f-ed{border:none;border-radius:0;padding:14px 18px;overflow:auto}
.f-prev{display:flex;gap:6px;overflow:hidden}.f-prev i{width:60px;height:44px;flex:none;border-radius:3px;background:repeating-linear-gradient(45deg,#8a8f96,#8a8f96 2px,#9aa0a7 2px,#9aa0a7 4px);border:2px solid #c62828}`,
    ops: [afterToolbar(bar(`<button class="f-btn">⚲ フィルタ…</button>`)),
      ["insert", `<div class="f-modal"><div class="f-win"><div class="f-lib"><b>登録した条件（チェックで重ねる）</b>${libList()}<div class="f-hint" style="margin-top:10px">チェックした条件を、すべて満たす画像だけを出します</div></div>
        <div class="f-ed"><div class="f-r"><h4 style="flex:1">新しい条件を作る</h4><button class="f-btn">閉じる ×</button></div>${name}${cond1}${cond2}${more}<span class="f-hint">長さ (mm) の分布（このロット・濃い所が当てはまる）</span>${HIST(400)}${scope}
        <div class="f-r">${live}</div><div class="f-prev">${"<i></i>".repeat(5)}</div><div class="f-r" style="justify-content:flex-end">${save}</div></div></div></div>`, "beforeend", "body"], narrow, fit],
  },
  {
    key: "F10", name: "作る所を一覧の右に並べる（一覧を左へ縮め、当てはまる画像を見ながら作る）＋帯は F1c と同じ",
    css: BASE + `body[data-state=edit] #center{display:grid!important;grid-template-columns:minmax(0,1fr) 360px;grid-auto-rows:auto;align-content:start}
body[data-state=edit] #center>*{grid-column:1/3}body[data-state=edit] #center>#grid{grid-column:1;min-height:0}
body[data-state=edit] #center>.f-side{grid-column:2;grid-row:span 1;align-self:start}
.f-side{border-left:1px solid var(--line);padding:10px 12px;background:#fbfcfd;display:flex;flex-direction:column;gap:6px}body:not([data-state=edit]) .f-side{display:none}
.f-side .f-ed{padding:8px 10px}`,
    ops: [afterToolbar(bar()), ["script", `const s = document.createElement("div"); s.className = "f-side";
        s.innerHTML = ${JSON.stringify(`<div class="f-ed"><h4>条件を作る</h4>${name}${cond1}${cond2}${more}<span class="f-hint">長さ (mm) の分布</span>${HIST(300)}${scope}<div class="f-r">${live}</div><div class="f-r">${save}</div></div>`)};
        const g = document.getElementById("grid"); g.after(s); g.style.gridRow = "auto"; s.style.gridRow = "auto";
        const rows = [...document.getElementById("center").children].indexOf(g) + 1; g.style.gridRow = rows; s.style.gridRow = rows;`], narrow, fit],
  },
  {
    key: "F11", name: "帯＋その下に 1 行の組み立て（項目・比べ方・値を横に並べ、条件を足すと 1 行ずつ増える。分布は項目の横に小さく）。一覧はほとんど押し下げない",
    css: BASE + `.f-line{flex:none;display:flex;flex-direction:column;gap:6px;padding:6px 12px;border-bottom:1px solid var(--line);background:#fbfcfd;font-size:13px}
body:not([data-state=edit]) .f-line{display:none}.f-line .f-r{flex-wrap:nowrap}.f-line .f-hist{height:22px;width:110px}
.f-line .f-r.build{flex-wrap:wrap}.f-line select,.f-line input{font-size:13px;padding:1px 6px;border:1px solid var(--line);border-radius:4px}`,
    ops: [afterToolbar(`${bar()}<div class="f-line"><div class="f-r build"><b style="flex:none">新しい条件</b><input type="text" value="長い穴" style="width:120px">
        <select><option>長さ (mm)</option></select><select><option>≥</option></select><input type="number" value="8" style="width:56px">${HIST(110)}<span class="f-hint" style="flex:none">かつ</span>
        <select><option>分類</option></select><select><option>=</option></select><select><option>穴</option></select><button class="f-btn">＋</button></div>
        <div class="f-r build">${scope}<span style="flex:1"></span>${live}${save}</div></div>`), narrow, fit],
  },
  {
    key: "F12", name: "登録した条件をタブに（全部 24・面積 5mm² 以上 14・長くて細い 11…。各条件の枚数つき）。押して重ね、重ねた結果を右端に。作る所は「＋」のタブから帯の下に",
    css: BASE + `.f-tabs{flex:none;display:flex;align-items:stretch;gap:0;border-bottom:1px solid var(--line);background:#f8fafc;padding:0 12px;min-width:0}
.f-tabs .t{flex:none;display:flex;align-items:center;gap:5px;padding:6px 10px;font-size:12.5px;border-bottom:3px solid transparent;color:var(--txt);white-space:nowrap}
.f-tabs .t.on{border-bottom-color:var(--acc);color:var(--acc);font-weight:600;background:var(--accbg)}.f-tabs .t i{font-style:normal;color:var(--sub);font-size:11.5px}
.f-tabs .sc{display:flex;overflow:hidden;min-width:0;flex:1}.f-tabs .end{flex:none;display:flex;align-items:center;gap:6px;padding-left:8px}
.f-under{flex:none;padding:8px 12px;border-bottom:1px solid var(--line);background:#fbfcfd}.f-under .f-ed{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 18px}
.f-under .col{display:flex;flex-direction:column;gap:6px;min-width:0}body:not([data-state=edit]) .f-under{display:none}`,
    ops: [afterToolbar(`<div class="f-tabs"><div class="sc"><span class="t">全部 <i>24</i></span>${LIB.map(([sc, n, c, on, k]) => `<span class="t ${on ? "on" : ""}" title="${c}"><span class="f-sc ${sc}">${SC[sc]}</span>${n} <i>${k}</i></span>`).join("")}<span class="t">＋</span></div>
        <div class="end">${count}</div></div>
        <div class="f-under"><div class="f-ed"><div class="col"><h4>条件を作る</h4>${name}${cond1}${cond2}${more}</div><div class="col"><span class="f-hint">長さ (mm) の分布</span>${HIST()}${scope}<div class="f-r">${live}${save}</div></div></div></div>`), narrow,
      ["script", `const sc = document.querySelector(".f-tabs .sc"); const ts = [...sc.querySelectorAll(".t")].slice(1, -1); const hid = [];
        while (sc.scrollWidth > sc.clientWidth + 1 && ts.length - hid.length > 0) { const t = ts.find((x) => !x.classList.contains("on") && x.style.display !== "none" && !hid.includes(x)) ; if (!t) break; t.style.display = "none"; hid.push(t);
          sc.querySelector(".f-hidn")?.remove(); sc.lastElementChild.insertAdjacentHTML("beforebegin", '<span class="t f-hidn" title="' + hid.map((x) => x.textContent.trim()).join("・") + '">ほか ' + hid.length + ' ▾</span>'); }`]],
  },
];
