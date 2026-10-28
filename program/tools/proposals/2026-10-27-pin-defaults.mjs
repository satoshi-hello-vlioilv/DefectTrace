// 初期の表示項目の見分け・外すときの警告・開発者が決める表示の初期値の案（1 回目）。
//   node program/tools/ui-variants.mjs <出力> program/tools/proposals/2026-10-27-pin-defaults.mjs
//
// 今の困りごと（ui-check.mjs の lot-1728 を見て）:
//  1. 表示項目は全部同じクリーム色の札・行。初期の項目（アプリや開発者が決めた物）と自分で足した物の見分けが付かない
//  2. 札の × は確かめずにすぐ外す。初期の項目を外しても、何が起きたか・どう戻すかが出ない
//  3. 「表示設定を初期化」が何に戻すのか（アプリの初期値か、開発者が決めた初期値か）が画面のどこにも無い。開発者が初期値を決める所も無い
// 案の方向: 見分け（色・輪郭・印・置き場）× 警告（中央の小窓・札の下の吹き出し・札の中・下の帯）× 開発者の所（見出しの小窓・データ項目の窓）
// 見本の作り: 初期の項目は id が d_ で始まる（試験のロットには開発者の初期値が無い）。足した物は p_。属性で色を付けるので描き直しても残る

const INI = (s) => `${s}[data-pid^="d_"]`;
const ADD = (s) => `${s}[data-pid^="p_"]`;

// 撮る前に、自分で足した表示項目を 3 つ置く（サマリ・画像表示・ロット情報）
export const SETUP = `return (async () => {
  const have = await (await fetch("/api/pins")).json();
  if (have.some((p) => p.id.startsWith("p_"))) return;
  const add = (b) => fetch("/api/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  await add({ scope: "lot", place: "summary", label: "画像数", file: "dat:INSP_INFO", key: "image_total_cnt" });
  await add({ scope: "image", place: "card", label: "幅(mm)", file: "dat:DETECT_INFO", key: "width_mm" });
  await add({ scope: "lot", place: "lot", label: "検査長", file: "dat:INSP_INFO", key: "insp_end_y" });
})()`;

export const STATES = {
  lot: "",
  items: `document.getElementById("btnSources").click();`,
  warn: `document.getElementById("srcClose").click(); window.__warn && window.__warn();`,
  dev: `window.__unwarn && window.__unwarn(); window.__dev && window.__dev();`,
};

// 色: 初期＝落ち着いた藍（決まっている・土台）、足した物＝今の黄（自分の付箋）
const COLOR_INI = `
${INI(".chip")}{background:#e9eff8;border-color:#b7c6dc;color:#1e3a5f}${INI(".chip")} .cl{color:#1e3a5f}
${INI("table.kv tr.pinned")} td{background:#eef3fa}${INI("table.kv tr.pinned")} td.k{color:#1e3a5f}`;
// 中央の小窓（警告）
const DLG_CSS = `.pw-mask{position:fixed;inset:0;background:rgba(15,23,42,.35);z-index:90;display:grid;place-items:center}
.pw-dlg{width:440px;background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.3);padding:18px 20px;font-size:13px}
.pw-dlg h3{margin:0 0 8px;font-size:15px;display:flex;gap:8px;align-items:center}.pw-dlg h3 i{font-style:normal;color:#b45309;font-size:18px}
.pw-dlg p{margin:4px 0;color:#374151;line-height:1.6}.pw-dlg .pw-b{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.pw-dlg button{padding:5px 14px}.pw-dlg .pw-go{background:#c62828;border-color:#c62828;color:#fff}.pw-dlg .pw-no{background:var(--acc);border-color:var(--acc);color:#fff}`;
const dlg = (extra = "") => `<div class="pw-mask" id="pwWarn"><div class="pw-dlg" role="alertdialog"><h3><i>⚠</i>初期の表示項目「材質」を外しますか</h3>
<p>「材質」は、はじめから置かれている項目（初期の表示項目）です。外すと、この PC のサマリから消えます。</p>
<p class="sub">戻すときは「データ項目」で置き直すか、「表示設定を初期化」を押します。</p>${extra}
<div class="pw-b"><button class="pw-go">外す</button><button class="pw-no">やめる</button></div></div></div>`;
const warnInsert = (html) => ["script", `window.__warn = () => document.body.insertAdjacentHTML("beforeend", ${JSON.stringify(html)});
  window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());`];

export const PROPOSALS = [
  {
    key: "P1", name: "藍＝初期・黄＝足した物＋外す前に中央の小窓＋見出しの「表示設定 ▾」に初期化と開発者の「いまの表示を初期値に」",
    css: COLOR_INI + DLG_CSS + `
.pd-menu{position:fixed;right:10px;top:38px;z-index:80;width:330px;background:#fff;color:var(--txt);border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:6px;font-size:13px}
.pd-menu .pd-src{padding:8px 10px;border-bottom:1px solid var(--line2);color:var(--sub);font-size:12px}.pd-menu .pd-src b{color:var(--txt)}
.pd-menu button{display:block;width:100%;text-align:left;border:none;padding:8px 10px;border-radius:5px}.pd-menu button:hover{background:var(--accbg)}
.pd-menu small{display:block;color:var(--sub);font-size:12px}.pd-menu .pd-dev{border-top:1px solid var(--line2);margin-top:4px;padding-top:4px}
.pd-menu .pd-tag{font-size:11px;background:#fff3d6;color:#8a5a00;border-radius:3px;padding:0 5px;margin-left:6px}`,
    ops: [["script", `document.getElementById("btnReset").textContent = "表示設定 ▾";`],
      warnInsert(dlg()),
      ["script", `window.__dev = () => document.body.insertAdjacentHTML("beforeend", '<div class="pd-menu"><div class="pd-src">初期値: <b>アプリの初期値</b>（開発者はまだ決めていません）</div>'
        + '<button>初期値に戻す<small>この PC の表示項目を、上の初期値に戻します</small></button>'
        + '<div class="pd-dev"><button>いまの表示を初期値にする<span class="pd-tag">開発者</span><small>新しい PC と「初期値に戻す」が、いまの表示になります</small></button>'
        + '<button>アプリの初期値に戻す<span class="pd-tag">開発者</span><small>開発者の初期値をやめます</small></button></div></div>');`]],
  },
  {
    key: "P2", name: "輪郭＝初期・塗り＝足した物＋札の下の吹き出しで確かめる＋データ項目の窓の見出しに初期値の出どころと開発者のボタン",
    css: `
${INI(".chip")}{background:#fff;border:1.5px solid #7f95b5;color:#1e3a5f}${INI(".chip")} .cl{color:#1e3a5f}
${INI("table.kv tr.pinned")} td{background:#fff}${INI("table.kv tr.pinned")} td.k{color:#1e3a5f;box-shadow:inset 3px 0 0 #7f95b5}
.pw-pop{position:fixed;z-index:90;width:300px;background:#fff;border:1px solid #e3b25a;border-radius:8px;box-shadow:0 10px 26px rgba(0,0,0,.22);padding:10px 12px;font-size:12.5px}
.pw-pop:before{content:"";position:absolute;left:24px;top:-7px;width:12px;height:12px;background:#fff;border-left:1px solid #e3b25a;border-top:1px solid #e3b25a;transform:rotate(45deg)}
.pw-pop b{color:#8a5a00}.pw-pop p{margin:4px 0 8px;color:#374151}.pw-pop .pw-b{display:flex;gap:6px;justify-content:flex-end}
.pw-pop .pw-go{background:#c62828;border-color:#c62828;color:#fff}
.pd-head{display:flex;align-items:center;gap:8px;margin-left:14px;font-size:12px;color:var(--sub)}.pd-head b{color:var(--txt)}
.pd-key{display:inline-flex;gap:6px;align-items:center;margin-left:10px}.pd-key i{font-style:normal;border-radius:10px;padding:0 8px;font-size:11.5px}
.pd-key .a{border:1.5px solid #7f95b5;color:#1e3a5f}.pd-key .b{background:var(--pinbg);border:1px solid #ecd9a8;color:#8a5a00}`,
    ops: [["script", `window.__warn = () => { const c = document.querySelector('.chip[data-pid="d_s_mat"]').getBoundingClientRect();
        document.body.insertAdjacentHTML("beforeend", '<div class="pw-pop" id="pwWarn" style="left:' + (c.left - 10) + 'px;top:' + (c.bottom + 8) + 'px"><b>⚠ 初期の項目です</b><p>「材質」を外すと、この PC のサマリから消えます（「表示設定を初期化」で戻せます）。</p><div class="pw-b"><button>やめる</button><button class="pw-go">外す</button></div></div>'); };
      window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());
      document.querySelector("#srcModal .dhead .spacer").insertAdjacentHTML("beforebegin", '<span class="pd-key"><i class="a">初期</i><i class="b">足した物</i></span>');
      window.__dev = () => { document.getElementById("btnSources").click();
        document.querySelector("#srcModal .dhead .spacer").insertAdjacentHTML("afterend", '<span class="pd-head">初期値: <b>アプリの初期値</b><button>表示設定を初期化</button><button class="primary">いまの表示を初期値にする（開発者）</button></span>'); };`]],
  },
  {
    key: "P3", name: "「初」の印＋藍の地で初期を示す＋札の中で「外す？ はい・いいえ」＋データ項目の窓の表示先の下に「表示の初期値」の欄",
    css: COLOR_INI + `
${INI(".chip")}:before{content:"初";font-size:10.5px;font-weight:700;color:#fff;background:#3b5b86;border-radius:3px;padding:0 3px;margin-right:2px}
${INI("table.kv tr.pinned")} td.k:before{content:"初";font-size:10.5px;font-weight:700;color:#fff;background:#3b5b86;border-radius:3px;padding:0 3px;margin-right:5px}
.chip.pw-ask{background:#fdecea!important;border-color:#e57373!important;color:#8e1c1c!important}
.chip.pw-ask .pw-q{font-weight:700;margin-left:4px}.chip.pw-ask button{border:1px solid #e57373;border-radius:9px;padding:0 7px;font-size:11.5px;background:#fff;margin-left:3px}
.chip.pw-ask button.go{background:#c62828;color:#fff;border-color:#c62828}
.pd-box{margin-top:10px;border:1px solid var(--line);border-radius:8px;padding:10px;background:#f8fafc;font-size:12px}
.pd-box b{display:block;font-size:12.5px;margin-bottom:4px}.pd-box .pd-row{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}`,
    ops: [["script", `window.__warn = () => { const c = document.querySelector('.chip[data-pid="d_s_mat"]'); c.classList.add("pw-ask"); c.id = "pwWarn";
        c.insertAdjacentHTML("beforeend", '<span class="pw-q">初期の項目を外す？</span><button class="go">外す</button><button>やめる</button>'); c.querySelector(".x").remove(); };
      window.__unwarn = () => { const c = document.getElementById("pwWarn"); if (!c) return; c.classList.remove("pw-ask"); c.removeAttribute("id");
        c.querySelectorAll(".pw-q,button:not(.fm)").forEach((x) => x.remove()); c.insertAdjacentHTML("beforeend", '<button type="button" class="x">×</button>'); };
      window.__dev = () => { document.getElementById("btnSources").click();
        document.getElementById("srcPlaces").insertAdjacentHTML("afterend", '<div class="pd-box"><b>表示の初期値</b>いまは <b style="display:inline">アプリの初期値</b>。新しい PC と「表示設定を初期化」がこれを使います。<div class="pd-row"><button>表示設定を初期化</button><button class="primary">いまの表示を初期値に（開発者）</button></div></div>'); };`]],
  },
  {
    key: "P4", name: "置き場で分ける: 帯の中で初期の札を先・区切り線の後に足した物（色も分ける）＋中央の小窓＋見出しに「初期値…」の窓",
    css: COLOR_INI + DLG_CSS + `
.pd-sep{display:inline-flex;align-items:center;gap:4px;color:var(--sub);font-size:11.5px;border-left:1px dashed #b0b7c3;padding-left:8px;margin-left:4px}
.pd-win{position:fixed;right:12px;top:38px;z-index:80;width:420px;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:0 14px 40px rgba(0,0,0,.25);padding:14px 16px;font-size:13px}
.pd-win h4{margin:0 0 6px;font-size:14px}.pd-win dl{display:grid;grid-template-columns:auto 1fr;gap:4px 12px;margin:8px 0;font-size:12.5px}.pd-win dt{color:var(--sub)}
.pd-win .pd-b{display:flex;gap:8px;justify-content:flex-end;margin-top:10px}`,
    ops: [["script", `for (const box of document.querySelectorAll(".summary,.slot,.chips")) { const first = box.querySelector('.chip[data-pid^="p_"]');
        if (first) first.insertAdjacentHTML("beforebegin", '<span class="pd-sep">足した物</span>'); }
      document.getElementById("btnReset").insertAdjacentHTML("beforebegin", '<button type="button" class="ghost">初期値…</button>');`],
      warnInsert(dlg()),
      ["script", `window.__dev = () => document.body.insertAdjacentHTML("beforeend", '<div class="pd-win"><h4>表示の初期値</h4><div class="sub">新しい PC と「表示設定を初期化」が使う表示項目</div>'
        + '<dl><dt>いまの初期値</dt><dd>アプリの初期値（34 項目）</dd><dt>この PC の表示</dt><dd>初期 34・足した物 3</dd></dl>'
        + '<div class="pd-b"><button>アプリの初期値に戻す</button><button class="primary">いまの表示を初期値にする</button></div><div class="sub" style="margin-top:6px">初期値を決められるのは開発者だけです</div></div>');`]],
  },
  {
    key: "P5", name: "青緑の細い左帯で初期を示す＋外すときは画面の下に警告の帯（外す・やめる）＋初期化のボタンに出どころの札",
    css: `
${INI(".chip")}{background:#eef6f5;border-color:#a9cfca;color:#134e4a;box-shadow:inset 3px 0 0 #2f7d78}${INI(".chip")} .cl{color:#134e4a}
${INI("table.kv tr.pinned")} td{background:#f1f8f7}${INI("table.kv tr.pinned")} td.k{color:#134e4a;box-shadow:inset 3px 0 0 #2f7d78}
.pw-bar{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:90;display:flex;align-items:center;gap:12px;background:#3b2a07;color:#fff;border-radius:8px;padding:10px 14px;box-shadow:0 10px 30px rgba(0,0,0,.3);font-size:13px}
.pw-bar b{color:#ffd27a}.pw-bar button{background:transparent;color:#fff;border-color:#9b8350}.pw-bar .go{background:#c62828;border-color:#c62828}
.pd-badge{font-size:11px;background:#2f7d78;color:#fff;border-radius:3px;padding:0 5px;margin-left:6px}
.pd-menu{position:fixed;right:10px;top:38px;z-index:80;width:300px;background:#fff;border:1px solid var(--line);border-radius:8px;box-shadow:0 10px 30px rgba(0,0,0,.2);padding:6px;font-size:13px}
.pd-menu button{display:block;width:100%;text-align:left;border:none;padding:8px 10px}.pd-menu button:hover{background:var(--accbg)}`,
    ops: [["script", `document.getElementById("btnReset").innerHTML = '表示設定を初期化<span class="pd-badge">アプリの初期値</span>';
      window.__warn = () => document.body.insertAdjacentHTML("beforeend", '<div class="pw-bar" id="pwWarn"><span>⚠ <b>「材質」は初期の表示項目です。</b> 外すとこの PC のサマリから消えます</span><button class="go">外す</button><button>やめる</button></div>');
      window.__unwarn = () => document.querySelectorAll("#pwWarn").forEach((x) => x.remove());
      window.__dev = () => document.body.insertAdjacentHTML("beforeend", '<div class="pd-menu"><button>この PC を初期値に戻す</button><button>いまの表示を初期値にする（開発者）</button><button>アプリの初期値に戻す（開発者）</button></div>');`]],
  },
  {
    key: "P6", name: "初期の札は × の代わりに錠（🔒→押すと警告の小窓）・藍の地＋データ項目の窓の表示先の見出しに初期の数",
    css: COLOR_INI + DLG_CSS + `
${INI(".chip")} .x{font-size:0}${INI(".chip")} .x:after{content:"🔒";font-size:10.5px}
${INI("table.kv tr.pinned")} .pb{font-size:0}${INI("table.kv tr.pinned")} .pb:after{content:"🔒";font-size:10.5px}
.pd-n{font-size:11px;color:#1e3a5f;background:#e9eff8;border-radius:3px;padding:0 5px;margin-left:4px}
.pd-dev{display:flex;gap:8px;align-items:center;margin:0 0 8px;padding:8px 10px;border:1px solid #c9d6e8;background:#f3f7fc;border-radius:8px;font-size:12px}`,
    ops: [["script", `document.querySelectorAll("#srcPlaces .dph").forEach(() => {});`],
      warnInsert(dlg('<p class="sub">🔒 の付いた項目は初期の表示項目です。</p>')),
      ["script", `window.__dev = () => { document.getElementById("btnSources").click();
        document.getElementById("srcPlaces").insertAdjacentHTML("beforebegin", '<div class="pd-dev"><span>初期値: <b>アプリの初期値</b></span><span class="spacer"></span><button class="primary">いまの表示を初期値に（開発者）</button></div>'); };`]],
  },
];
