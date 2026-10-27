// 欠陥のフィルタの案（1 回目）。node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-defect-filter.mjs
//
// 依頼: 欠陥の長さ・面積など様々な項目で、ロットの中の画像一覧そのものを絞る。条件に名前を付けて登録し、組み合わせて使い回す。
//   既定の条件は開発者だけが決める。共有の条件はだれでも保存できる。自分だけの条件も作れる
// 今の困りごと（ui-check.mjs の lot-1728 を見て）: 絞る手段が無い（24 枚・7,016 枚を全部送って見る）。何を見ているか（全部か一部か）を示す所も無い
// 見せる物（どの案も同じ中身）: 登録した条件 5 つ（既定: 大きい欠陥〈長さ ≥ 10mm〉・穴だけ／共有: 面積 5mm² 以上・表面のキズ／自分: 長くて細い〈縦横比 ≥ 3〉）。
//   「面積 5mm² 以上」と「長くて細い」を重ねて、24 枚 → 8 枚。作る所（edit）: 名前・置き場（自分／共有／既定〈開発者だけ〉）・条件の行・当てはまる数
// 案の方向: 置き場（一覧の上の帯・左の木の下・右の列の箱・大きな窓・つまみ・式）／組み合わせ方（押して重ねる・チェック・式の & ）／作り方（行・分布・字）
// 状態: lot（2 つ重ねて絞った画像一覧）・edit（新しい条件を作っている）

const SCOPES = { def: "既定", share: "共有", mine: "自分" };
const LIB = [
  ["def", "大きい欠陥", "長さ ≥ 10 mm"], ["def", "穴だけ", "分類 = 穴"],
  ["share", "面積 5mm² 以上", "面積 ≥ 5 mm²", true], ["share", "表面のキズ", "面 = 表・分類 = キズ"],
  ["mine", "長くて細い", "縦横比 ≥ 3", true],
];
const BASE = `
.f-sc{display:inline-flex;align-items:center;border-radius:3px;padding:0 5px;font-size:11px;font-weight:700;border:1px solid;margin-right:5px;line-height:16px}
.f-sc.def{color:#3f4a5a;border-color:#9aa6b6;background:#eef1f5}.f-sc.share{color:#0b6b62;border-color:#8fd0c8;background:#e6f6f4}.f-sc.mine{color:#5a3fa0;border-color:#c3b3ea;background:#f3effc}
.f-chip{display:inline-flex;align-items:center;gap:2px;border:1px solid var(--line);border-radius:14px;padding:2px 10px 2px 4px;font-size:12.5px;background:var(--pane);white-space:nowrap;cursor:pointer}
.f-chip.on{border-color:var(--acc);background:var(--accbg);color:var(--acc);font-weight:600;box-shadow:inset 0 0 0 1px var(--acc)}
.f-chip.on:before{content:"✓";margin:0 3px 0 2px}
.f-btn{border:1px solid #b7cbe6;background:var(--pane);color:var(--acc);border-radius:5px;padding:3px 10px;font-size:12.5px;white-space:nowrap}
.f-pri{background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.f-n{font-size:13px;white-space:nowrap}.f-n b{font-size:15px;color:var(--acc)}
.f-ed{background:var(--pane);border:1px solid var(--line);border-radius:8px;box-shadow:0 12px 32px rgba(0,0,0,.2);padding:12px 14px;display:flex;flex-direction:column;gap:9px;font-size:13px;z-index:40}
.f-ed h4{margin:0;font-size:14px}.f-ed input[type=text],.f-ed input[type=number],.f-ed select{font-size:13px;padding:2px 6px;border:1px solid var(--line);border-radius:4px}
.f-rows{display:flex;flex-direction:column;gap:6px}.f-r{display:flex;align-items:center;gap:6px}.f-r .x{color:var(--sub);border:none;background:none}
.f-scope{display:flex;gap:12px;flex-wrap:wrap}.f-scope label{display:inline-flex;align-items:center;gap:4px}
.f-hint{color:var(--sub);font-size:12px}
body:not([data-state=edit]) .f-ed{display:none}`;
const editor = (cls = "", extra = "") => `<div class="f-ed ${cls}">
  <h4>条件を作る</h4>
  <div class="f-r"><span class="f-hint" style="width:44px">名前</span><input type="text" value="長い穴" style="flex:1"></div>
  <div class="f-rows">
    <div class="f-r"><select><option>長さ (mm)</option></select><select><option>≥</option></select><input type="number" value="8" style="width:70px"><button class="x">×</button></div>
    <div class="f-r"><select><option>分類</option></select><select><option>=</option></select><select><option>穴</option></select><button class="x">×</button></div>
    <div class="f-r"><button class="f-btn">＋ 条件</button><select><option>すべて満たす（かつ）</option><option>どれか（または）</option></select></div>
  </div>${extra}
  <div class="f-r"><span class="f-hint">置き場</span><span class="f-scope"><label><input type="radio" name="sc" checked><span class="f-sc mine">自分</span>この PC だけ</label>
    <label><input type="radio" name="sc"><span class="f-sc share">共有</span>だれでも使える</label>
    <label><input type="radio" name="sc"><span class="f-sc def">既定</span>開発者だけ（あなたは開発者）</label></span></div>
  <div class="f-r"><span class="f-n" style="flex:1">当てはまる画像 <b>5</b> / 24 枚（欠陥 7 / 58）</span><button class="f-btn">絞るだけ（保存しない）</button><button class="f-btn f-pri">保存</button></div>
</div>`;
const chips = (sep = "") => LIB.map(([sc, n, c, on]) => `<span class="f-chip ${on ? "on" : ""}" title="${c}"><span class="f-sc ${sc}">${SCOPES[sc]}</span>${n}</span>`).join(sep);
// 画像一覧を 24 → 8 枚に（3 枚に 1 枚を残す）・見出しの枚数を直す
const narrow = ["script", `document.querySelectorAll("#grid .th").forEach((t, i) => { if (i % 3) t.style.display = "none"; });
  document.querySelectorAll("#grid *").forEach((e) => { if (e.children.length === 0 && /^\\d+枚$/.test(e.textContent.trim())) e.textContent = Math.ceil(parseInt(e.textContent) / 3) + "枚"; });`];
const afterToolbar = (html) => ["insert", html, "afterend", "#center>.toolbar"];

export const STATES = { lot: "", edit: "document.body.dataset.state='edit'" };

export const PROPOSALS = [
  {
    key: "F1", name: "画像一覧の上の帯: 登録した条件のチップ（押して重ねる＝両方満たす）＋「＋ 条件を作る」",
    css: BASE + `.f-bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc;position:relative}
.f-bar .lab{font-size:12.5px;color:var(--sub);font-weight:600}.f-bar .f-ed{position:absolute;left:12px;top:calc(100% + 4px);width:560px}`,
    ops: [afterToolbar(`<div class="f-bar"><span class="lab">フィルタ</span>${chips()}<button class="f-btn">＋ 条件を作る…</button>
      <span class="spacer" style="flex:1"></span><span class="f-n">表示 <b>8</b> / 24 枚（2 つを両方満たす）</span><button class="f-btn">外す</button>${editor()}</div>`), narrow],
  },
  {
    key: "F2", name: "左の木の下に「フィルタ」の棚（既定・共有・自分の 3 節）＋チェックで組み合わせ",
    css: BASE + `#treePane{display:flex;flex-direction:column}#tree{flex:1;min-height:0}
.f-shelf{border-top:2px solid var(--line);padding:8px 10px;display:flex;flex-direction:column;gap:4px;font-size:13px;background:#f8fafc;position:relative}
.f-shelf .hd{display:flex;align-items:center;gap:6px}.f-shelf .hd b{flex:1}
.f-shelf .sec{font-size:11.5px;color:var(--sub);margin-top:4px}.f-shelf label{display:flex;align-items:center;gap:6px;padding:1px 2px}
.f-shelf .f-ed{position:fixed;left:360px;bottom:40px;width:540px}
.f-tag{display:inline-block;margin-left:8px;border-radius:10px;padding:0 8px;font-size:12px;background:var(--accbg);color:var(--acc);border:1px solid #b7cbe6}`,
    ops: [["insert", `<div class="f-shelf"><div class="hd"><b>フィルタ</b><span class="f-n"><b>8</b>/24 枚</span><button class="f-btn">＋ 作る</button></div>
      ${["def", "share", "mine"].map((sc) => `<div class="sec">${{ def: "既定（開発者が決めた）", share: "共有（だれでも）", mine: "自分（この PC）" }[sc]}</div>` +
        LIB.filter((x) => x[0] === sc).map(([s, n, c, on]) => `<label title="${c}"><input type="checkbox" ${on ? "checked" : ""}>${n}<span class="f-hint" style="margin-left:auto">${c}</span></label>`).join("")).join("")}
      <div class="f-hint">チェックした条件を、すべて満たす画像だけを出します</div>${editor()}</div>`, "beforeend", "#treePane"],
      ["insert", `<span class="f-tag">フィルタ 2 つ・8/24 枚</span>`, "beforeend", "#center>.toolbar"], narrow],
  },
  {
    key: "F3", name: "右の列の箱「フィルタ」（MAP の上）: いま当てている条件の行を直に直す＋登録した条件を呼ぶ",
    css: BASE + `.f-box{padding:8px 10px;display:flex;flex-direction:column;gap:8px;font-size:13px}
.f-box .f-r select,.f-box .f-r input{font-size:12.5px}.f-box .f-ed{box-shadow:none;border:none;padding:0}
.f-box .f-r{flex-wrap:wrap}.f-box .f-scope{flex-direction:column;gap:4px}.f-box .f-ed input[type=text]{min-width:0}
body[data-state=edit] .f-now{display:none}`,
    ops: [["insert", `<details class="box" open><summary>フィルタ <span class="sub">8 / 24 枚</span></summary><div class="f-box">
      <div class="f-now"><div class="f-r" style="flex-wrap:wrap;gap:4px">${chips(" ")}</div>
      <div class="f-rows" style="margin-top:6px"><div class="f-r"><span class="f-sc share">共有</span>面積 (mm²) ≥ <input type="number" value="5" style="width:60px"></div>
        <div class="f-r"><span class="f-sc mine">自分</span>縦横比 ≥ <input type="number" value="3" style="width:60px"></div></div>
      <div class="f-r"><span class="f-n" style="flex:1">表示 <b>8</b> / 24 枚</span><button class="f-btn">＋ 条件を作る</button><button class="f-btn">外す</button></div></div>
      ${editor()}</div></details>`, "afterbegin", "#infoPane"], narrow],
  },
  {
    key: "F4", name: "フィルタの窓（大きな窓）: 左に登録した条件の一覧、右に条件の組み立てと項目の分布（棒）",
    css: BASE + `.f-modal{position:fixed;inset:0;background:rgba(15,25,40,.45);display:flex;align-items:center;justify-content:center;z-index:50}
body:not([data-state=edit]) .f-modal{display:none}
.f-win{background:var(--pane);border-radius:10px;width:min(1100px,92vw);height:min(680px,84vh);display:grid;grid-template-columns:300px 1fr;overflow:hidden;box-shadow:0 20px 50px rgba(0,0,0,.35)}
.f-lib{border-right:1px solid var(--line);padding:14px;display:flex;flex-direction:column;gap:6px;background:#f8fafc;font-size:13px}.f-lib label{display:flex;gap:6px;align-items:center}
.f-win .f-ed{box-shadow:none;border:none;padding:16px 20px;display:flex}
.f-hist{display:flex;align-items:flex-end;gap:2px;height:60px;border-bottom:1px solid var(--line);padding:0 2px}.f-hist i{flex:1;background:#9db8dc}.f-hist i.in{background:var(--acc)}
.f-bar2{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc}`,
    ops: [afterToolbar(`<div class="f-bar2"><button class="f-btn">⚲ フィルタ…</button><span class="f-n">「面積 5mm² 以上」かつ「長くて細い」で <b>8</b> / 24 枚</span><button class="f-btn">外す</button></div>`),
      ["insert", `<div class="f-modal"><div class="f-win"><div class="f-lib"><b>登録した条件</b>${["def", "share", "mine"].map((sc) => `<div class="f-hint" style="margin-top:6px">${SCOPES[sc]}</div>` +
        LIB.filter((x) => x[0] === sc).map(([s, n, c, on]) => `<label><input type="checkbox" ${on ? "checked" : ""}>${n}</label>`).join("")).join("")}</div>
        ${editor("", `<div class="f-hint">長さ (mm) の分布（このロット・濃い所が当てはまる）</div><div class="f-hist">${[3, 9, 22, 30, 26, 18, 12, 8, 6, 4, 3, 2, 2, 1, 1].map((h, i) => `<i class="${i >= 6 ? "in" : ""}" style="height:${h * 2}px"></i>`).join("")}</div>`)}</div></div>`, "beforeend", "body"], narrow],
  },
  {
    key: "F5", name: "よく使う項目の範囲つまみ（長さ・幅・面積）を一覧の上に常に＋「保存 ▾」で名前を付けて呼ぶ",
    css: BASE + `.f-rng{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc;position:relative;font-size:12.5px}
.f-rng .r{display:inline-flex;align-items:center;gap:6px}.f-rng input[type=range]{width:110px}.f-rng .v{font-weight:700;color:var(--acc);min-width:58px}
.f-rng .f-ed{position:absolute;right:12px;top:calc(100% + 4px);width:520px}`,
    ops: [afterToolbar(`<div class="f-rng"><span class="r">長さ <input type="range" value="0"><span class="v">0〜∞ mm</span></span>
      <span class="r">幅 <input type="range" value="0"><span class="v">0〜∞ mm</span></span><span class="r">面積 <input type="range" value="30"><span class="v">≥ 5 mm²</span></span>
      <span class="r">縦横比 <input type="range" value="20"><span class="v">≥ 3</span></span><span style="flex:1"></span>
      <span class="f-n">表示 <b>8</b> / 24 枚</span><button class="f-btn">呼ぶ ▾</button><button class="f-btn">保存…</button><button class="f-btn">外す</button>${editor()}</div>`), narrow],
  },
  {
    key: "F6", name: "式の欄（長さ>=10 & 分類=穴）＋項目の候補を出す＋登録した条件の名前も式に使える（{大きい欠陥} & {穴だけ}）",
    css: BASE + `.f-expr{display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--line);background:#f8fafc;position:relative}
.f-expr input{flex:1;font:13px Consolas,monospace;padding:4px 8px;border:1px solid var(--line);border-radius:5px}
.f-sug{position:absolute;left:84px;top:calc(100% + 2px);width:420px;background:var(--pane);border:1px solid var(--line);border-radius:6px;box-shadow:0 8px 20px rgba(0,0,0,.15);font-size:12.5px;z-index:40}
.f-sug div{padding:4px 10px;display:flex;gap:8px}.f-sug div.on{background:var(--accbg)}.f-sug .f-hint{margin-left:auto}
body:not([data-state=edit]) .f-sug{display:none}`,
    ops: [afterToolbar(`<div class="f-expr"><span class="lab f-hint" style="font-weight:600">フィルタ</span><input value="{面積 5mm² 以上} &amp; {長くて細い}">
      <span class="f-n">表示 <b>8</b> / 24 枚</span><button class="f-btn">保存…</button><button class="f-btn">外す</button>
      <div class="f-sug"><div class="on"><b>長さ (mm)</b><span class="f-hint">length_mm・0.5〜96</span></div><div><b>{大きい欠陥}</b><span class="f-sc def">既定</span><span class="f-hint">長さ ≥ 10</span></div>
      <div><b>{穴だけ}</b><span class="f-sc def">既定</span></div><div><b>面積 (mm²)</b><span class="f-hint">area_mm</span></div><div><b>縦横比</b><span class="f-hint">vh_rate</span></div></div></div>`), narrow],
  },
];
