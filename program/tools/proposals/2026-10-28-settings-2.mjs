// 設定の窓（配布・この PC・使用状況・使用の履歴・表示の初期値）の案（2 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-28-settings-2.mjs
//
// 1 回目の採点（2026-10-28-settings.json。1 位 F 74.1 点で合格点に届かず）から:
//  - F の「要更新の行にだけ『更新を促す』」は効いた（促す相手と手が 1 か所）。押すとその PC の画面に「更新のお願い」の帯が出る（作るときの決まり）
//  - 見出しのボタン（⚙ 管理）と窓の題（設定）の言葉がずれる → どちらも「設定」。名乗りの札は窓の見出しの 1 か所だけ
//  - 操作の欄のボタンが行ごとに左右へずれる → 欄の幅を決め、同じボタンは同じ位置（無いボタンは場所だけ空ける）
//  - 1280 で手順の 1 行が折れる → 短くする。配布・この PC の頁の下半分が空く → 埋め方を変える案を足す
//  - 機能を落とした案（表示の初期値・版を消す・記録を消す が無い）は −10。どの案も全部の操作を持つ
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
.sx-dl{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;font-size:13.5px}.sx-dl dt{color:var(--sub);white-space:nowrap}.sx-dl dd{margin:0;min-width:0;overflow-wrap:anywhere}
.sx-card{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
.sx-act{display:flex;gap:6px;justify-content:flex-end}td.sx-act{display:table-cell;text-align:right;white-space:nowrap;width:1%}.sx-t td{white-space:nowrap}td.sx-act button{margin-left:6px}td.sx-act .gap{visibility:hidden}.sx-act button{font-size:12.5px;padding:3px 10px}
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
        + (cols === "act" ? '<td class="sx-act"><button class="primary' + (r.behind ? '' : ' gap') + '">更新を促す</button><button>履歴</button><button' + (r.active ? ' class="gap"' : '') + '>記録を消す</button></td>' : '') + '</tr>').join("") + '</table>';
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
      + '<div class="sub" style="margin-bottom:8px">① ZIP から置く → ② 展開した exe で試す → ③「この版を配る」（各 PC は起動時と 30 分ごとに取り込む）</div>'
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
  head(sub) { return '<div class="sx-head"><b>設定</b><span class="sub">' + sub + '</span><span class="sx-me">' + tag("me", "sato @ 仕上PC-07・版 4.6.0") + tag("dev", "開発者") + '<button class="sx-x">×</button></span></div>'; },
  spread() {
    const by = {}; S.rows.forEach((r) => { by[r.version] = (by[r.version] || 0) + 1; });
    const col = (v) => v === S.latest ? "#2e7d5b" : v > S.latest ? "#6b5fc7" : "#c0563f";
    return '<div class="sx-card"><div class="sx-sec">版の行き渡り <span class="sub">記録のある ' + S.rows.length + ' 台</span></div><div style="display:flex;height:22px;border-radius:5px;overflow:hidden">' + Object.entries(by).sort().reverse().map(([v, n]) => '<div style="flex:' + n + ';background:' + col(v) + ';color:#fff;font-size:12px;display:grid;place-items:center">' + v + '・' + n + ' 台</div>').join("") + '</div>'
      + '<div class="sub" style="margin-top:6px">緑 = 配っている版　赤 = 要更新　紫 = 開発者が試している版</div></div>';
  },
  behindCard() {
    const b = S.rows.filter((r) => r.behind);
    return '<div class="sx-card"><div class="sx-sec">更新を促す相手 ' + tag("behind", b.length + " 台") + '</div><table class="sx-t">' + b.map((r) => '<tr class="behind"><td>' + r.pc + '</td><td>' + r.login + '</td><td><span class="v">' + r.version + '</span></td><td>' + state(r) + '・' + r.ago + '</td><td class="sx-act"><button class="primary">更新を促す</button></td></tr>').join("") + '</table></div>';
  },
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


// 左の縦の見出し（見出しのボタン・窓の題とも「設定」）
const TABS = [{ k: "pc", t: "この PC" }, { grp: "管理（開発者）" }, { k: "fleet", t: "使用状況", n: 2 }, { k: "release", t: "配布" }, { k: "history", t: "使用の履歴" }];

export const PROPOSALS = [
  {
    key: "G", name: "（F の直し）左の縦の見出し・題と入口を「設定」に・名乗りは窓の見出しだけ・操作の欄をそろえる・手順を短く・要更新の行に「更新を促す」",
    css: BASE,
    ops: [["script", PARTS + LEFT_TABS(TABS) + `SX.header("⚙ 設定");`]],
  },
  {
    key: "H", name: "（新）G＋配布の頁の下に「版の行き渡り」（版ごとの台数の帯）と「更新を促す相手」。配る → 行き渡ったか → 促す、が 1 頁で続く",
    css: BASE,
    ops: [["script", PARTS + LEFT_TABS(TABS) + `const s0 = window.SXshow; window.SXshow = (cur) => { s0(cur); if (cur !== "release") return;
      document.querySelector(".sx-body").insertAdjacentHTML("beforeend", '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">' + SX.spread() + SX.behindCard() + '</div>'); };
      SX.header("⚙ 設定");`]],
  },
  {
    key: "I", name: "（新）上の横の見出し（1280 でも折れない）・数の札は使用状況の頁だけ・要更新の行に「更新を促す」・この PC の頁に表示の初期値",
    css: BASE + `.sx-top{display:flex;gap:4px;padding:0 20px;border-bottom:1px solid var(--line)}.sx-top button{border:none;background:none;padding:10px 14px;border-bottom:3px solid transparent;border-radius:0;font-size:13.5px}.sx-top button.on{border-bottom-color:var(--acc);color:var(--acc);font-weight:700}.sx-top .n{font-size:11.5px;border-radius:9px;padding:0 7px;background:#fdecea;color:#9b2c1f;margin-left:6px}
.sx-win{grid-template-rows:auto auto 1fr}`,
    ops: [["script", PARTS + `window.SXshow = (cur) => {
      const T = [["pc", "この PC"], ["fleet", "使用状況", 2], ["release", "配布"], ["history", "使用の履歴"]];
      const body = { pc: SX.pc() + '<div style="height:16px"></div>' + SX.ini(), release: SX.release(), fleet: SX.kpi() + SX.filter() + SX.fleetTable("act"), history: SX.history() }[cur];
      SX.open(SX.head("") + '<div class="sx-top">' + T.map(([k, t, n]) => '<button class="' + (k === cur ? 'on' : '') + '">' + t + (n ? '<span class="n">' + n + '</span>' : '') + '</button>').join("") + '</div><div class="sx-body">' + body + '</div>');
    }; SX.header("⚙ 設定");`]],
  },
  {
    key: "J", name: "（新）G＋「この PC」の頁の右に「全体の状況」（数の札・更新を促す相手・版の行き渡り）。開くとすぐ全体と自分が分かる。表示の初期値は下に",
    css: BASE + `.sx-two{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:16px}.sx-two .sx-kpi{grid-template-columns:repeat(2,minmax(0,1fr))}`,
    ops: [["script", PARTS + LEFT_TABS(TABS) + `const s0 = window.SXshow; window.SXshow = (cur) => { s0(cur); if (cur !== "pc") return;
      document.querySelector(".sx-body").innerHTML = '<div class="sx-two"><div><div class="sx-card"><div class="sx-sec">この PC</div>' + SX.pc() + '</div><div style="height:14px"></div>' + SX.ini() + '</div><div><div class="sx-sec">全体の状況</div>' + SX.kpi() + SX.behindCard() + '<div style="height:14px"></div>' + SX.spread() + '</div></div>'; };
      SX.header("⚙ 設定");`]],
  },
  {
    key: "K", name: "（新）使用状況と使用の履歴を 1 頁に: PC の表の行の「履歴」で、その行の下に使用の履歴を開く（頁が 3 つに減る）。下に保存期間",
    css: BASE + `.sx-sub td{background:var(--line2)!important;padding:6px 10px 10px}.sx-sub .sx-t td{background:transparent!important}`,
    ops: [["script", PARTS + LEFT_TABS([{ k: "pc", t: "この PC" }, { grp: "管理（開発者）" }, { k: "fleet", t: "使用状況と履歴", n: 2 }, { k: "release", t: "配布" }]) + `const s0 = window.SXshow; window.SXshow = (cur) => { s0(cur === "history" ? "fleet" : cur); if (cur !== "fleet" && cur !== "history") return;
      const tr = document.querySelectorAll(".sx-body .sx-t tr")[2];
      const h = S.hist.filter((x) => x[3] === "仕上PC-11");
      tr.insertAdjacentHTML("afterend", '<tr class="sx-sub"><td colspan="7"><b>仕上PC-11 の使用の履歴</b><table class="sx-t">' + h.map((x) => '<tr><td>' + x[0] + ' ' + x[1] + '</td><td class="n">' + x[2] + '</td><td class="v">' + x[5] + '</td></tr>').join("") + '<tr><td>10/27 08:01</td><td class="n">7:55</td><td class="v">4.5.0</td></tr><tr><td>10/26 08:03</td><td class="n">8:02</td><td class="v">4.5.0</td></tr></table></td></tr>');
      tr.querySelectorAll("button")[1].textContent = "履歴 ▴";
      document.querySelector(".sx-body").insertAdjacentHTML("beforeend", '<div class="sx-card" style="margin-top:14px;display:flex;gap:10px;align-items:center"><b>記録を残す日数</b><input value="365" style="width:70px"> 日 <button>保存</button><span class="spacer"></span><button>古い記録を今すぐ整理</button></div>'); };
      SX.header("⚙ 設定");`]],
  },
];
