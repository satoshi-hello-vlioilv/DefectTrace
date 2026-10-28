// 設定の窓（配布・この PC・使用状況・使用の履歴・表示の初期値）の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-28-settings.mjs
//
// 今の困りごと（ui-check.mjs の release-1728 を見て）:
//  1. 配布の窓の高さが中身（版の数・問題の有無・この PC の状態）で変わる。操作の都度、窓の大きさが動く
//  2. だれが・どの PC で・どの版を使っているか、だれに更新を促すべきかが、どこにも無い（LotScope にはある）
//  3. 管理の入口が見出しに散る（配布・初期値を決める（開発者）・表示設定を初期化）。この PC の名乗り（ログイン名・PC 名）も見えない
// 案の方向: 置き場（左の縦の見出し・上の横の見出し・概要の頁・PC の一覧が主）× 見せ方（数の札・版ごとの PC・表）× 権限（開発者だけの所の示し方）
// 窓の大きさはどの案も決め打ち（幅 min(1480px, 96vw)・高さ min(920px, 92vh)。中だけが送られる）。見本のデータは下の S（7 台の PC）

const S = {
  me: { login: "sato", pc: "仕上PC-07", pcSource: "COMPUTERNAME", version: "4.6.0", developer: true, shortcut: true, place: "\\\\server\\share\\90_Releases\\DefectTrace" },
  latest: "4.6.0", distributed: "4.6.0",
  rows: [
    { pc: "検査PC-03", login: "tanaka", version: "4.5.0", active: false, ago: "2 日前", sessions: 14, hours: "6 時間", behind: true },
    { pc: "仕上PC-11", login: "suzuki", version: "4.5.0", active: true, ago: "いま", sessions: 31, hours: "22 時間", behind: true },
    { pc: "開発PC", login: "maint", version: "4.7.0", active: true, ago: "いま", sessions: 52, hours: "40 時間", dev: true },
    { pc: "検査PC-01", login: "ito", version: "4.6.0", active: true, ago: "いま", sessions: 9, hours: "4 時間" },
    { pc: "仕上PC-07", login: "sato", version: "4.6.0", active: true, ago: "いま", sessions: 20, hours: "11 時間", me: true },
    { pc: "事務PC-02", login: "kato", version: "4.6.0", active: false, ago: "3 時間前", sessions: 5, hours: "2 時間" },
    { pc: "検査PC-05", login: "yamada", version: "4.6.0", active: false, ago: "5 日前", sessions: 3, hours: "1 時間" },
  ],
  versions: [
    { v: "4.7.0", at: "10/28 09:10 maint", size: "6.3 MB", st: "置いただけ" },
    { v: "4.6.0", at: "10/27 17:30 maint", size: "6.2 MB", st: "配っている", rec: "ラベルと桁の直し" },
    { v: "4.5.0", at: "10/26 18:00 maint", size: "6.1 MB", st: "前に配った" },
    { v: "4.4.1", at: "10/25 12:00 maint", size: "6.1 MB", st: "前に配った" },
  ],
  hist: [
    ["10/28", "08:12", "0:48", "仕上PC-07", "sato", "4.6.0", "4.5.0"], ["10/28", "08:05", "1:10", "仕上PC-11", "suzuki", "4.5.0", ""],
    ["10/28", "07:58", "2:02", "検査PC-01", "ito", "4.6.0", "4.5.0"], ["10/27", "17:40", "0:35", "事務PC-02", "kato", "4.6.0", "4.5.0"],
    ["10/27", "13:02", "3:15", "開発PC", "maint", "4.7.0", "4.6.0"], ["10/26", "09:20", "1:44", "検査PC-03", "tanaka", "4.5.0", ""],
    ["10/23", "10:11", "0:20", "検査PC-05", "yamada", "4.6.0", "4.4.1"],
  ],
};

// 共通の部品（窓の枠・札・表）。案はこれを並べ替える
const BASE = `
.sx-mask{position:fixed;inset:0;background:rgba(15,25,40,.45);z-index:70;display:grid;place-items:center}
.sx-win{width:min(1480px,96vw);height:min(920px,92vh);background:var(--pane);border-radius:12px;box-shadow:0 24px 60px rgba(0,0,0,.35);display:grid;grid-template-rows:auto 1fr;overflow:hidden;font-size:13.5px}
.sx-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid var(--line)}.sx-head b{font-size:17px}.sx-head .sub{font-size:12.5px}
.sx-head .sx-me{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--sub)}.sx-x{border:none;background:none;font-size:20px;color:var(--sub)}
.sx-body{min-height:0;overflow:auto;padding:18px 22px}
.sx-sec{font-weight:700;font-size:14px;margin:0 0 8px;display:flex;align-items:center;gap:8px}
.sx-tag{display:inline-block;font-size:11.5px;border-radius:10px;padding:0 8px;line-height:19px;border:1px solid var(--line);white-space:nowrap}
.sx-tag.behind{background:#fdecea;border-color:#f3b4ab;color:#9b2c1f}.sx-tag.ok{background:#e6f4ea;border-color:#a8d5b5;color:#1e6b3a}
.sx-tag.dev{background:#f1f0fb;border-color:#cdc8ef;color:#4b3f9e}.sx-tag.on{background:#e7effa;border-color:#b7cdee;color:#1e5aa8}.sx-tag.me{background:#fff3d6;border-color:#ecd9a8;color:#8a5a00}
.sx-tab{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:none;background:none;padding:9px 12px;border-radius:7px;font-size:13.5px;color:var(--txt)}
.sx-tab.on{background:var(--accbg);color:var(--acc);font-weight:700}.sx-tab .n{margin-left:auto;font-size:11.5px;border-radius:9px;padding:0 7px;background:#fdecea;color:#9b2c1f}
.sx-grp{font-size:11.5px;color:var(--sub);letter-spacing:.06em;padding:12px 12px 4px}
table.sx-t{width:100%;border-collapse:collapse}.sx-t th{font-weight:400;color:var(--sub);font-size:12.5px;text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);white-space:nowrap}
.sx-t td{padding:8px 10px;border-bottom:1px solid var(--line2);vertical-align:middle}.sx-t td.n{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.sx-t tr.behind td{background:#fff7f5}.sx-t .v{font-family:Consolas,monospace;font-weight:700}
.sx-kpi{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.sx-kpi div{border:1px solid var(--line);border-radius:9px;padding:10px 14px}
.sx-kpi b{display:block;font-size:24px;font-variant-numeric:tabular-nums}.sx-kpi span{color:var(--sub);font-size:12.5px}.sx-kpi .warn b{color:#b3412f}
.sx-filter{display:inline-flex;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:8px}.sx-filter button{border:none;border-right:1px solid var(--line);border-radius:0;padding:4px 12px}.sx-filter button:last-child{border-right:none}.sx-filter .on{background:var(--acc);color:#fff}
.sx-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:13.5px}.sx-dl dt{color:var(--sub)}.sx-dl dd{margin:0}
.sx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.sx-act{display:flex;gap:6px;justify-content:flex-end}td.sx-act{display:table-cell;text-align:right;white-space:nowrap}td.sx-act button{margin-left:6px}.sx-act button{font-size:12.5px;padding:3px 10px}
.sx-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#2e7d32;margin-right:5px}.sx-dot.off{background:#b9c1ca}`;

// 共通の中身（案はこれを組み合わせる）
const PARTS = `
const S = ${JSON.stringify(S)};
const tag = (cls, t) => '<span class="sx-tag ' + cls + '">' + t + '</span>';
const verTag = (r) => r.dev ? tag("dev", "対象外（開発者）") : r.behind ? tag("behind", "要更新 → " + S.latest) : tag("ok", "最新");
const state = (r) => '<span class="sx-dot' + (r.active ? '' : ' off') + '"></span>' + (r.active ? "使用中" : "使っていない");
window.SX = {
  fleetTable(cols) {
    return '<table class="sx-t"><tr><th>状態</th><th>PC 名</th><th>ログイン名</th><th>版</th><th>最後</th><th class="n">回数・時間</th>' + (cols === "act" ? '<th></th>' : '') + '</tr>'
      + S.rows.map((r) => '<tr' + (r.behind ? ' class="behind"' : '') + '><td>' + state(r) + '</td><td>' + r.pc + (r.me ? ' ' + tag("me", "あなた") : '') + '</td><td>' + r.login + '</td><td><span class="v">' + r.version + '</span> ' + verTag(r) + '</td><td>' + r.ago + '</td><td class="n">' + r.sessions + ' 回・' + r.hours + '</td>'
        + (cols === "act" ? '<td class="sx-act"><button>履歴</button>' + (r.active ? '' : '<button>記録を消す</button>') + '</td>' : '') + '</tr>').join("") + '</table>';
  },
  kpi() {
    const a = S.rows.filter((r) => r.active).length, b = S.rows.filter((r) => r.behind).length;
    return '<div class="sx-kpi"><div><span>最新版（配っている版）</span><b>' + S.latest + '</b></div><div><span>いま使っている PC</span><b>' + a + ' 台</b></div><div class="warn"><span>要更新の PC</span><b>' + b + ' 台</b></div><div><span>記録のある PC</span><b>' + S.rows.length + ' 台</b></div></div>';
  },
  filter() { return '<div class="sx-filter"><button class="on">すべて 7</button><button>使用中 4</button><button>要更新 2</button></div>'; },
  versions() {
    return '<table class="sx-t"><tr><th>版・置いた日時</th><th>状態</th><th class="n">使っている PC</th><th></th></tr>' + S.versions.map((x) => {
      const n = S.rows.filter((r) => r.version === x.v).length;
      return '<tr><td><span class="v">' + x.v + '</span><div class="sub" style="font-size:12px">' + x.at + '・' + x.size + '</div></td><td>' + (x.st === "配っている" ? tag("ok", "配っている") + (x.rec ? ' ' + tag("me", "推奨: " + x.rec) : '') : tag("", x.st)) + '</td><td class="n">' + (n ? n + ' 台' : '—') + '</td><td class="sx-act">'
        + (x.st === "配っている" ? '<button>推奨を外す</button>' : '<button class="primary">この版を配る</button><button>消す</button>') + '</td></tr>'; }).join("") + '</table>';
  },
  release(table) {
    return '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><span class="sub">置き場</span><code style="flex:1;background:var(--line2);padding:5px 10px;border-radius:5px">' + S.me.place + '</code><button>↻ 読み直す</button><button class="primary">＋ ZIP から版を置く…</button></div>'
      + '<div class="sub" style="margin-bottom:8px">① ZIP から版を置く → ② ZIP を展開した exe で試す → ③ 表の「この版を配る」。各 PC は起動したとき・30 分ごとに取り込み、開き直すとその版になります</div>'
      + (table || SX.versions())
      + '<div class="sx-card" style="margin-top:14px"><div class="sx-sec">新しい PC へ</div><div style="display:flex;gap:8px"><code style="flex:1;background:var(--line2);padding:5px 10px;border-radius:5px">' + S.me.place + '\\\\DefectTrace.exe</code><button>アドレスをコピー</button></div><div class="sub" style="margin-top:6px">このアドレスの exe を開くだけで、配っている版がその PC に入ります</div></div>';
  },
  history() {
    return '<table class="sx-t"><tr><th>日付</th><th>時刻</th><th class="n">使った時間</th><th>PC 名</th><th>ログイン名</th><th>版</th></tr>' + S.hist.map((h) => '<tr><td>' + h[0] + '</td><td>' + h[1] + '</td><td class="n">' + h[2] + '</td><td>' + h[3] + '</td><td>' + h[4] + '</td><td><span class="v">' + h[5] + '</span>' + (h[6] ? ' ' + tag("on", "更新 " + h[6] + " →") : '') + '</td></tr>').join("") + '</table>'
      + '<div class="sx-card" style="margin-top:14px;display:flex;gap:10px;align-items:center"><b>記録を残す日数</b><input value="365" style="width:70px"> 日 <button>保存</button><span class="spacer"></span><button>古い記録を今すぐ整理</button></div>';
  },
  pc() {
    const m = S.me;
    return '<dl class="sx-dl"><dt>ログイン名</dt><dd>' + m.login + '</dd><dt>PC 名</dt><dd>' + m.pc + ' <span class="sub">（' + m.pcSource + ' から）</span></dd><dt>権限</dt><dd>' + tag("dev", "開発者") + ' <span class="sub">版を置く・配る・使用状況の記録を消す・表示の初期値を決める</span></dd>'
      + '<dt>この PC の版</dt><dd><span class="v">' + m.version + '</span> ' + tag("ok", "最新") + '</dd><dt>ショートカット</dt><dd>デスクトップ・スタート <button>作り直す</button></dd><dt>配布の置き場</dt><dd style="font-family:Consolas,monospace">' + m.place + '</dd></dl>';
  },
  ini() {
    return '<div class="sx-card"><div class="sx-sec">表示の初期値 ' + tag("dev", "開発者") + '</div><div class="sub">新しい PC と「表示設定を初期化」が使う表示項目です。各 PC で変えた表示はそのまま残ります。</div>'
      + '<dl class="sx-dl" style="margin:10px 0"><dt>いまの初期値</dt><dd><b>アプリの初期値</b>（34 項目）</dd><dt>この PC の表示</dt><dd>初期 33・足した物 2</dd></dl><div class="sx-act"><button>アプリの初期値に戻す</button><button class="primary">いまの表示を初期値にする</button></div></div>';
  },
  open(html) { document.querySelectorAll(".sx-mask").forEach((x) => x.remove()); document.body.insertAdjacentHTML("beforeend", '<div class="sx-mask"><div class="sx-win">' + html + '</div></div>'); },
  head(sub) { return '<div class="sx-head"><b>設定</b><span class="sub">' + sub + '</span><span class="sx-me">' + tag("me", "sato @ 仕上PC-07") + tag("dev", "開発者") + '<button class="sx-x">×</button></span></div>'; },
  header(label) { const r = document.getElementById("btnRelease"); if (r) r.remove(); const d = document.getElementById("btnIniDev"); if (d) d.remove();
    document.getElementById("btnReset").insertAdjacentHTML("beforebegin", '<button type="button" class="ghost">' + label + '</button>'); },
};`;

const st = (tab) => `window.SXshow && window.SXshow(${JSON.stringify(tab)});`;
export const STATES = { pc: st("pc"), release: st("release"), fleet: st("fleet"), history: st("history") };

// 左の縦の見出し（LotScope の型）
const LEFT_TABS = (tabs, extra = "") => `window.SXshow = (cur) => {
  const T = ${JSON.stringify(tabs)};
  const nav = T.map((t) => t.grp ? '<div class="sx-grp">' + t.grp + '</div>' : '<button class="sx-tab' + (t.k === cur ? ' on' : '') + '">' + t.t + (t.n ? '<span class="n">' + t.n + '</span>' : '') + '</button>').join("");
  const body = { pc: SX.pc() + '<div style="height:16px"></div>' + SX.ini(), release: SX.release(),
    fleet: SX.kpi() + SX.filter() + SX.fleetTable("act"), history: SX.history() }[cur];
  SX.open(SX.head("") + '<div style="display:grid;grid-template-columns:220px 1fr;min-height:0"><nav style="border-right:1px solid var(--line);padding:10px 8px;overflow:auto">' + nav + '</nav><div class="sx-body">' + body + '</div></div>');
}; ${extra}`;

export const PROPOSALS = [
  {
    key: "A", name: "左の縦の見出し（この PC・配布・使用状況・使用の履歴）。見出しの「⚙ 設定」1 つにまとめる。要更新の数を見出しに",
    css: BASE,
    ops: [["script", PARTS + LEFT_TABS([{ k: "pc", t: "この PC" }, { grp: "管理（開発者）" }, { k: "release", t: "配布" }, { k: "fleet", t: "使用状況", n: 2 }, { k: "history", t: "使用の履歴" }]) + `SX.header("⚙ 設定");`]],
  },
  {
    key: "B", name: "上の横の見出し＋どの頁にも出る数の札（最新版・使用中・要更新・記録）。見出しは「⚙ 設定 ②」（要更新の数）",
    css: BASE + `.sx-top{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line)}.sx-top button{border:none;background:none;padding:10px 14px;border-bottom:3px solid transparent;border-radius:0;font-size:13.5px}.sx-top button.on{border-bottom-color:var(--acc);color:var(--acc);font-weight:700}
.sx-win{grid-template-rows:auto auto auto 1fr}.sx-kpiwrap{padding:14px 22px 0}`,
    ops: [["script", PARTS + `window.SXshow = (cur) => {
      const T = [["pc", "この PC"], ["release", "配布"], ["fleet", "使用状況 ②"], ["history", "使用の履歴"]];
      const body = { pc: SX.pc() + '<div style="height:16px"></div>' + SX.ini(), release: SX.release(), fleet: SX.filter() + SX.fleetTable("act"), history: SX.history() }[cur];
      SX.open(SX.head("") + '<div class="sx-top">' + T.map(([k, t]) => '<button class="' + (k === cur ? 'on' : '') + '">' + t + '</button>').join("") + '</div><div class="sx-kpiwrap">' + SX.kpi() + '</div><div class="sx-body">' + body + '</div>');
    }; SX.header("⚙ 設定 ②");`]],
  },
  {
    key: "C", name: "最初の頁を「概要」に: この PC・配る版・数の札・要更新の PC（促す相手）を 1 頁に。詳しい表は左の見出しの先",
    css: BASE + `.sx-ov{display:grid;grid-template-columns:1fr 1fr;gap:14px}.sx-ov .wide{grid-column:1/3}`,
    ops: [["script", PARTS + LEFT_TABS([{ k: "pc", t: "概要" }, { grp: "管理（開発者）" }, { k: "release", t: "配布" }, { k: "fleet", t: "使用状況", n: 2 }, { k: "history", t: "使用の履歴" }]) + `
      const show0 = window.SXshow; window.SXshow = (cur) => { show0(cur); if (cur !== "pc") return;
        const behind = S.rows.filter((r) => r.behind);
        document.querySelector(".sx-body").innerHTML = SX.kpi() + '<div class="sx-ov"><div class="sx-card"><div class="sx-sec">この PC</div>' + SX.pc() + '</div><div class="sx-card"><div class="sx-sec">配る版</div><b class="v" style="font-size:22px">4.6.0</b> ' + tag("me", "推奨: ラベルと桁の直し") + '<div class="sub" style="margin-top:6px">置いただけ: 4.7.0（10/28 09:10 maint）</div><div class="sx-act" style="margin-top:10px"><button>配布を開く</button></div></div>'
          + '<div class="sx-card wide"><div class="sx-sec">更新を促す相手 ' + tag("behind", behind.length + " 台") + '</div>' + behind.map((r) => '<div style="display:flex;gap:12px;padding:6px 0;border-top:1px solid var(--line2)"><b>' + r.pc + '</b><span>' + r.login + '</span><span class="v">' + r.version + '</span>' + state(r) + '<span class="sub">最後 ' + r.ago + '</span></div>').join("") + '</div></div>'; };
      SX.header("⚙ 設定");`]],
  },
  {
    key: "D", name: "PC の一覧が主: 左に PC の一覧（要更新が上・状態の点）、右に選んだ PC の詳細と使用の履歴。配布は上の見出しの別の頁",
    css: BASE + `.sx-split{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:16px;height:100%}.sx-split>div{min-height:0;overflow:auto}
.sx-top{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line)}.sx-top button{border:none;background:none;padding:10px 14px;border-bottom:3px solid transparent;border-radius:0}.sx-top button.on{border-bottom-color:var(--acc);color:var(--acc);font-weight:700}.sx-win{grid-template-rows:auto auto 1fr}`,
    ops: [["script", PARTS + `window.SXshow = (cur) => {
      const T = [["fleet", "PC と版"], ["release", "配布"], ["pc", "この PC"]];
      const k = cur === "history" ? "fleet" : cur;
      const r = S.rows[1];
      const det = '<div class="sx-card"><div class="sx-sec">' + r.pc + ' ' + verTag(r) + '</div><dl class="sx-dl"><dt>ログイン名</dt><dd>' + r.login + '</dd><dt>版</dt><dd class="v">' + r.version + '</dd><dt>状態</dt><dd>' + state(r) + '</dd><dt>回数・時間</dt><dd>' + r.sessions + ' 回・' + r.hours + '</dd></dl></div><div class="sx-sec" style="margin-top:14px">使用の履歴</div>' + SX.history();
      const body = { fleet: SX.kpi() + '<div class="sx-split"><div>' + SX.filter() + SX.fleetTable() + '</div><div>' + det + '</div></div>', release: SX.release(), pc: SX.pc() + '<div style="height:16px"></div>' + SX.ini() }[k];
      SX.open(SX.head("") + '<div class="sx-top">' + T.map(([a, t]) => '<button class="' + (a === k ? 'on' : '') + '">' + t + '</button>').join("") + '</div><div class="sx-body">' + body + '</div>');
      if (k === "fleet") document.querySelectorAll(".sx-split .sx-t tr")[2].style.outline = "2px solid var(--acc)";
    }; SX.header("⚙ 設定");`]],
  },
  {
    key: "E", name: "版が主: 配布の表の各版の行に、その版を使っている PC の札を並べる（配布と使用状況を 1 つの表に）。要更新の PC は配る版の下に赤で",
    css: BASE + `.sx-pcs{display:flex;flex-wrap:wrap;gap:4px}.sx-pcs .sx-tag{font-size:12px}`,
    ops: [["script", PARTS + LEFT_TABS([{ k: "release", t: "版と PC" }, { k: "history", t: "使用の履歴" }, { k: "pc", t: "この PC" }]) + `
      const show0 = window.SXshow; window.SXshow = (cur) => { show0(cur === "fleet" ? "release" : cur); if (cur !== "release" && cur !== "fleet") return;
        document.querySelector(".sx-body").innerHTML = SX.kpi() + SX.release('<table class="sx-t"><tr><th>版・置いた日時</th><th>状態</th><th>使っている PC</th><th></th></tr>' + S.versions.concat([]).map((x) => {
          const on = S.rows.filter((r) => r.version === x.v);
          return '<tr' + (x.v === "4.5.0" ? ' class="behind"' : '') + '><td><span class="v">' + x.v + '</span><div class="sub" style="font-size:12px">' + x.at + '</div></td><td>' + (x.st === "配っている" ? tag("ok", "配っている") : tag("", x.st)) + (x.v === "4.5.0" ? ' ' + tag("behind", "要更新") : '') + '</td><td><div class="sx-pcs">' + (on.map((r) => tag(r.dev ? "dev" : r.active ? "on" : "", (r.active ? "● " : "") + r.pc + "・" + r.login)).join("") || '<span class="sub">—</span>') + '</div></td><td class="sx-act">' + (x.st === "配っている" ? '<button>推奨を外す</button>' : '<button class="primary">この版を配る</button>') + '</td></tr>'; }).join("") + '</table>'); };
      SX.header("⚙ 設定");`]],
  },
  {
    key: "F", name: "A＋見出しに「この PC」の札（sato @ 仕上PC-07・版）を常に出し、設定は「管理」の 1 つに。要更新の PC には「更新を促す」（その PC の帯に出す）",
    css: BASE,
    ops: [["script", PARTS + LEFT_TABS([{ k: "pc", t: "この PC" }, { grp: "管理（開発者）" }, { k: "fleet", t: "使用状況", n: 2 }, { k: "release", t: "配布" }, { k: "history", t: "使用の履歴" }]) + `
      const show0 = window.SXshow; window.SXshow = (cur) => { show0(cur); if (cur !== "fleet") return;
        document.querySelectorAll(".sx-body .sx-t tr.behind .sx-act").forEach((td) => td.insertAdjacentHTML("afterbegin", '<button class="primary">更新を促す</button>')); };
      SX.header("⚙ 管理"); document.querySelector("header .spacer").insertAdjacentHTML("afterend", '<span class="sx-tag me" style="margin-right:8px">sato @ 仕上PC-07</span>');`]],
  },
];
