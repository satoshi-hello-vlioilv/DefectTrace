// 欠陥のフィルタの案（2 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-defect-filter-2.mjs
//
// 1 回目は 1 位 F1 が 68.5 点で 80 点に届かなかった。採点で低かった所と、この回で直す所（どの案も）:
//  - 画面左下の帯が「24 枚」のままで、絞った 8 枚と食い違う（−3）→ 左下の帯も「8 / 24 枚を表示（フィルタ 2 つ）」に
//  - 帯が 2 段・「8 / 24 枚」の位置が幅で動く → 帯は 1 段。数と「外す」はいつも右端。あふれたら「＋ 他 n」
//  - チップに中身（長さ ≥ 10 mm など）が出ない → チップに条件も書く
//  - 作る所の「置き場」が 2 段に折れる・作る所が一覧を覆って当てはまる画像が見えない → 作る所は一覧を押し下げて出す（覆わない）か、
//    一覧の横に出す。見出しは折れない幅に
//  - 開発者でない人に「既定」がどう出るかが無い → edit は開発者でない人の画面で撮る（既定は選べず、理由を書く）
//  - F4 の良い所（「A」かつ「B」で 8 / 24 枚 の 1 行・分布の棒）は持ち越す
// 持ち越し: F1（帯のチップ）・F4（窓）。新しい案: F7（右の引き出し）・F8（使っている条件の文＋選ぶ小窓）・F9（一覧の左の絞り込みの欄）
// 状態: lot（2 つ重ねて 24 → 8 枚）・edit（新しい条件を作っている。開発者でない人）

const SC = { def: "既定", share: "共有", mine: "自分" };
const LIB = [
  ["def", "大きい欠陥", "長さ ≥ 10 mm"], ["def", "穴だけ", "分類 = 穴"],
  ["share", "面積 5mm² 以上", "面積 ≥ 5 mm²", true], ["share", "表面のキズ", "面 = 表 かつ 分類 = キズ"],
  ["mine", "長くて細い", "縦横比 ≥ 3", true],
];
const BASE = `
.f-sc{display:inline-flex;align-items:center;border-radius:3px;padding:0 5px;font-size:11px;font-weight:700;border:1px solid;margin-right:5px;line-height:16px;white-space:nowrap}
.f-sc.def{color:#3f4a5a;border-color:#9aa6b6;background:#eef1f5}.f-sc.share{color:#0b6b62;border-color:#8fd0c8;background:#e6f6f4}.f-sc.mine{color:#5a3fa0;border-color:#c3b3ea;background:#f3effc}
.f-chip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--acc);border-radius:14px;padding:2px 4px 2px 4px;font-size:12.5px;background:var(--accbg);color:var(--acc);white-space:nowrap}
.f-chip{flex:none}.f-chip .c{color:#36506f;font-weight:400}.f-chip b{font-weight:600}.f-chip .x{border:none;background:none;color:var(--acc);padding:0 4px;font-size:13px}
.f-btn{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:12.5px;white-space:nowrap}
.f-pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.f-n{font-size:13px;white-space:nowrap}.f-n b{font-size:15px;color:var(--acc)}
.f-hint{color:var(--sub);font-size:12px}
.f-bar{display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc;min-width:0}
.f-bar .lab{font-size:12.5px;color:var(--sub);font-weight:600;white-space:nowrap}.f-bar .f-chips{display:flex;gap:6px;min-width:0;overflow:hidden;flex:1}
.f-ed{background:var(--pane);border:1px solid var(--line);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column;gap:9px;font-size:13px}
.f-ed h4{margin:0;font-size:14px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:13px;padding:2px 6px;border:1px solid var(--line);border-radius:4px}
.f-r{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.f-r .x{color:var(--sub);border:none;background:none}
.f-k{width:48px;flex:none;color:var(--sub);font-size:12px;white-space:nowrap}
.f-scope{display:flex;gap:14px;flex-wrap:wrap}.f-scope label{display:inline-flex;align-items:center;gap:4px;white-space:nowrap}.f-scope label.no{color:#9aa3ad}
.f-hist{display:flex;align-items:flex-end;gap:2px;height:46px;border-bottom:1px solid var(--line);padding:0 2px;width:260px}.f-hist i{flex:1;background:#c3d3ea}.f-hist i.in{background:var(--acc)}
body:not([data-state=edit]) .f-ed{display:none}`;
const HIST = (w = 260) => `<div class="f-hist" style="width:${w}px">${[3, 9, 22, 30, 26, 18, 12, 8, 6, 4, 3, 2, 2, 1, 1].map((h, i) => `<i class="${i >= 6 ? "in" : ""}" style="height:${h * 1.5}px"></i>`).join("")}</div>`;
const scope = `<div class="f-r"><span class="f-k">置き場</span><span class="f-scope"><label><input type="radio" name="sc" checked><span class="f-sc mine">自分</span>この PC だけ</label>
  <label><input type="radio" name="sc"><span class="f-sc share">共有</span>だれでも使える</label>
  <label class="no" title="既定の条件は開発者だけが保存できます"><input type="radio" name="sc" disabled><span class="f-sc def">既定</span>開発者だけが保存できます</label></span></div>`;
const rows = `<div class="f-r"><select><option>長さ (mm)</option></select><select><option>≥</option></select><input type="number" value="8" style="width:70px"><span class="f-hint">このロット 0.5〜96</span><button class="x">×</button></div>
  <div class="f-r"><select><option>分類</option></select><select><option>=</option></select><select><option>穴</option></select><button class="x">×</button></div>
  <div class="f-r"><button class="f-btn">＋ 条件</button><select><option>すべて満たす（かつ）</option><option>どれか（または）</option></select></div>`;
const name = `<div class="f-r"><span class="f-k">名前</span><input type="text" value="長い穴" style="width:220px"></div>`;
const live = `<span class="f-n">当てはまる画像 <b>5</b> / 24 枚（欠陥 7 / 58）</span>`;
const save = `<button class="f-btn">絞るだけ（保存しない）</button><button class="f-btn f-pri">保存</button>`;
const active = LIB.filter((x) => x[3]).map(([sc, n, c]) => `<span class="f-chip"><span class="f-sc ${sc}">${SC[sc]}</span><b>${n}</b><span class="c">（${c}）</span><button class="x" title="外す">×</button></span>`).join("");
const count = `<span class="f-n">表示 <b>8</b> / 24 枚</span><button class="f-btn">すべて外す</button>`;
// 画像一覧を 24 → 8 枚に（3 枚に 1 枚を残す）・CAB の見出しと左下の帯の枚数を直す
const narrow = ["script", `document.querySelectorAll("#grid .th").forEach((t, i) => { if (i % 3) t.style.display = "none"; });
  document.querySelectorAll("#grid *").forEach((e) => { if (e.children.length === 0 && /^\\d+枚$/.test(e.textContent.trim())) e.textContent = Math.ceil(parseInt(e.textContent) / 3) + "枚"; });
  const st = document.getElementById("status"); st.textContent = "8 / 24 枚を表示（フィルタ 2 つ）・CAB 3・フォルダ 1";`];
const afterToolbar = (html) => ["insert", html, "afterend", "#center>.toolbar"];
// 入りきらないチップは隠し、「＋他 n」に畳む（帯を 1 段に保つ）
const fit = ["script", `document.querySelectorAll(".f-chips").forEach((box) => { const cs = [...box.querySelectorAll(".f-chip")]; let hid = 0;
  if (box.scrollWidth > box.clientWidth + 1) box.querySelectorAll(".f-chip .c").forEach((c) => { c.style.display = "none"; });   // 狭ければ、まず中身の字を畳む（名前に当てると出る）
  while (box.scrollWidth > box.clientWidth + 1 && cs.length - hid > 1) { cs[cs.length - 1 - hid].style.display = "none"; hid++;
    box.parentNode.querySelector(".f-more")?.remove(); box.insertAdjacentHTML("afterend", '<span class="f-more f-btn" title="ほかに使っている条件">＋他 ' + hid + '</span>'); } });`];
const libList = (inputs = true) => ["def", "share", "mine"].map((sc) => `<div class="f-hint" style="margin-top:6px;font-weight:600">${{ def: "既定（開発者が決めた）", share: "共有（だれでも）", mine: "自分（この PC）" }[sc]}</div>` +
  LIB.filter((x) => x[0] === sc).map(([s, n, c, on]) => `<label style="display:flex;align-items:center;gap:6px;padding:2px 0">${inputs ? `<input type="checkbox" ${on ? "checked" : ""}>` : ""}<span>${n}</span><span class="f-hint" style="margin-left:auto">${c}</span></label>`).join("")).join("");

export const STATES = { lot: "", edit: "document.body.dataset.state='edit'" };

export const PROPOSALS = [
  {
    key: "F1b", name: "一覧の上の帯（1 段）: 使っている条件のチップ（中身つき）＋「条件 ▾」で登録した条件を選ぶ＋「＋ 作る」。作る所は帯の下に開き、一覧を押し下げる",
    css: BASE + `.f-under{padding:10px 12px;border-bottom:1px solid var(--line);background:#fbfcfd}.f-under .f-ed{flex-direction:row;gap:18px;align-items:flex-start;flex-wrap:wrap}
.f-under .col{display:flex;flex-direction:column;gap:8px}body:not([data-state=edit]) .f-under{display:none}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span><div class="f-chips">${active}</div><button class="f-btn">条件 ▾</button><button class="f-btn">＋ 作る</button>${count}</div>
      <div class="f-under"><div class="f-ed"><div class="col"><h4>条件を作る</h4>${name}${rows}</div><div class="col"><span class="f-hint">長さ (mm) の分布（濃い所が当てはまる）</span>${HIST()}${scope}<div class="f-r">${live}${save}</div></div></div></div>`), narrow, fit],
  },
  {
    key: "F4b", name: "使っている条件を 1 行の文（「A」かつ「B」で 8 / 24 枚）＋「フィルタ…」で大きな窓（左に一覧、右に組み立て・分布、下に当てはまる画像の見本）",
    css: BASE + `.f-modal{position:fixed;inset:0;background:rgba(15,25,40,.45);display:flex;align-items:center;justify-content:center;z-index:50}
body:not([data-state=edit]) .f-modal{display:none}
.f-win{background:var(--pane);border-radius:10px;width:min(1120px,92vw);max-height:86vh;display:grid;grid-template-columns:300px 1fr;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.f-lib{border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:2px;background:#f8fafc;font-size:13px;overflow:auto}
.f-win .f-ed{border:none;border-radius:0;padding:16px 20px;overflow:auto}
.f-prev{display:flex;gap:6px;overflow:hidden}.f-prev i{width:64px;height:48px;flex:none;border-radius:3px;background:repeating-linear-gradient(45deg,#8a8f96,#8a8f96 2px,#9aa0a7 2px,#9aa0a7 4px);border:2px solid #c62828}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span><span class="f-chips" style="font-size:13px;align-items:center">「<b>面積 5mm² 以上</b>」かつ「<b>長くて細い</b>」で絞っています</span><button class="f-btn">⚲ フィルタ…</button>${count}</div>`),
      ["insert", `<div class="f-modal"><div class="f-win"><div class="f-lib"><b>登録した条件（チェックで重ねる）</b>${libList()}</div>
        <div class="f-ed"><div class="f-r"><h4 style="flex:1">条件を作る</h4><button class="f-btn">閉じる ×</button></div>${name}${rows}<span class="f-hint">長さ (mm) の分布（このロット・濃い所が当てはまる）</span>${HIST(420)}${scope}
        <div class="f-r">${live}</div><div class="f-prev">${"<i></i>".repeat(5)}</div><div class="f-r" style="justify-content:flex-end">${save}</div></div></div></div>`, "beforeend", "body"], narrow, fit],
  },
  {
    key: "F7", name: "右の引き出し（右の列の上に重ねる）: 登録した条件（3 節・チェック）と作る所。一覧はそのまま見え、チェックするたびに絞られる",
    css: BASE + `.f-drawer{position:fixed;top:118px;right:0;bottom:24px;width:430px;background:var(--pane);border-left:1px solid var(--line);box-shadow:-10px 0 28px rgba(0,0,0,.15);z-index:30;display:flex;flex-direction:column;gap:10px;padding:12px 14px;overflow:auto;font-size:13px}
.f-drawer .f-ed{padding:10px 12px}body:not([data-state=edit]) .f-drawer .f-new{display:none}body[data-state=edit] .f-drawer .f-lib2{display:none}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span><div class="f-chips">${active}</div><button class="f-btn">☰ 条件</button>${count}</div>`),
      ["insert", `<div class="f-drawer"><div class="f-r"><b style="flex:1;font-size:14.5px">フィルタ</b><span class="f-n"><b>8</b> / 24 枚</span><button class="f-btn">閉じる ×</button></div>
        <div class="f-lib2">${libList()}<div class="f-r" style="margin-top:8px"><button class="f-btn">＋ 条件を作る</button><span class="f-hint">チェックした条件を、すべて満たす画像だけを出します</span></div></div>
        <div class="f-new"><div class="f-ed"><h4>条件を作る</h4>${name}${rows}<span class="f-hint">長さ (mm) の分布</span>${HIST(380)}${scope}<div class="f-r">${live}</div><div class="f-r">${save}</div></div></div></div>`, "beforeend", "body"], narrow, fit],
  },
  {
    key: "F8", name: "帯は 1 行の文と「条件を選ぶ ▾」だけ。▾ の小窓に 3 節のチェック一覧（中身つき）。作る所は小窓の中で、一覧を覆わない右寄せ",
    css: BASE + `.f-pop{position:absolute;right:12px;top:calc(100% + 4px);width:520px;background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 30px rgba(0,0,0,.18);padding:12px 14px;z-index:30;font-size:13px;display:flex;flex-direction:column;gap:8px;max-height:70vh;overflow:auto}
.f-bar{position:relative}body:not([data-state=edit]) .f-pop{display:none}.f-pop .f-ed{border:none;padding:0}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span><span class="f-chips" style="font-size:13px;align-items:center">「<b>面積 5mm² 以上</b>」かつ「<b>長くて細い</b>」</span><button class="f-btn">条件を選ぶ ▾</button>${count}
      <div class="f-pop"><b>登録した条件（チェックで重ねる）</b>${libList()}<div style="border-top:1px solid var(--line2);padding-top:8px"><div class="f-ed"><h4>＋ 新しい条件</h4>${name}${rows}${scope}<div class="f-r">${live}${save}</div></div></div></div></div>`), narrow, fit],
  },
  {
    key: "F9", name: "一覧の左に絞り込みの欄（店の品の絞り込みの型）: 登録した条件（3 節・チェック）＋よく使う項目の範囲（分布つき）＋「今の条件を保存」",
    css: BASE + `#center{display:grid!important;grid-template-columns:250px 1fr;grid-template-rows:auto auto auto 1fr;align-content:start}
#center>#summary,#center>.toolbar,#center>.f-bar{grid-column:1/3}#center>#loadBand{grid-column:1/3}#center>#grid{grid-column:2;grid-row:4;min-height:0}
#center>#pairView,#center>#pitchView,#center>#listView{grid-column:1/3}
.f-facet{grid-column:1;grid-row:4;border-right:1px solid var(--line);padding:10px 12px;display:flex;flex-direction:column;gap:4px;font-size:13px;overflow:auto;background:#fbfcfd}
.f-facet h5{margin:8px 0 2px;font-size:12.5px;color:var(--sub)}.f-facet .rg{display:flex;flex-direction:column;gap:2px;margin-bottom:6px}
.f-facet .f-ed{padding:10px}body:not([data-state=edit]) .f-facet .f-save{display:none}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span><div class="f-chips">${active}</div>${count}</div>`),
      ["insert", `<aside class="f-facet"><b style="font-size:14px">絞り込み</b><h5>登録した条件</h5>${libList()}
        <h5>範囲で（このロットの分布）</h5><div class="rg"><span>長さ (mm) <b>0〜96</b></span>${HIST(220)}</div><div class="rg"><span>面積 (mm²) <b>≥ 5</b></span>${HIST(220)}</div>
        <button class="f-btn" style="align-self:flex-start">今の条件を保存…</button>
        <div class="f-save"><div class="f-ed"><h4>今の条件を保存</h4>${name}<span class="f-hint">面積 ≥ 5 mm² かつ 縦横比 ≥ 3</span>${scope.replace('<span class="f-scope">', '<span class="f-scope" style="flex-direction:column;gap:4px">')}<div class="f-r">${save}</div></div></div></aside>`, "afterend", "#grid"], narrow, fit],
  },
];
