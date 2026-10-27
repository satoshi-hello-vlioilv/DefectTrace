/* 自己診断（環境変数 DT_SELFTEST=結果のファイル で起動したときだけ、窓が画面に流し込む）。
   本物の WebView の中から、窓（Rust）と画面が正しく動くかを確かめて /__desktop/selftest へ送る。窓は結果を書いて終わる。
   調べること: 画面が起動し終える・設備の木・表示項目・静的ファイルの決まり・日本語の問い合わせ・同時の問い合わせ・
   （DT_SELFTEST_LOT の設定があれば）ロットを開いて画像の一覧・縮小画像・原寸・欠陥の対応・MAP・転写・ピッチ・
   （試しの置き場 DT_LINK_DIRS のとき）ショートカットの帯の「作る」・画面のエラーが無い。 */
(async () => {
  const res = [];
  const ok = (name, cond, info = "") => res.push({ name, ok: !!cond, info: String(info).slice(0, 300) });
  const t0 = performance.now();
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const get = async (url, opt) => { const r = await fetch(url, opt); return { r, text: await r.text() }; };
  const json = async (url, opt) => { const x = await get(url, opt); return { r: x.r, j: (() => { try { return JSON.parse(x.text); } catch (_) { return null; } })() }; };
  const q = (o) => new URLSearchParams(o).toString();
  let info = null, update = null, install = null;
  try {
    // 1) 画面が起動し終える（設備の木と表示項目を読み終えた）
    const end = performance.now() + 60000;
    const booted = () => document.querySelector("#tree li") && document.querySelector("#status") && window.__dtReady;
    while (!booted() && performance.now() < end) await sleep(200);
    ok("画面が起動し終える（設備の木・表示項目）", booted(), ((performance.now() - t0) / 1000).toFixed(1) + " 秒");
    info = (await json("/__desktop/info")).j;
    ok("窓の情報", info && info.version && info.program, JSON.stringify(info).slice(0, 200));
    ok("窓の版と中身の版が同じ", info && info.version === info.shell_version, `${info && info.shell_version} / ${info && info.version}`);
    update = (await json("/__desktop/update")).j;
    install = (await json("/__desktop/install")).j;

    // 2) 静的ファイル（版付きは長く使い回す・外へは出ない）
    const js = await get(`/static/app.js?v=${info.version}`);
    ok("画面の JS（版付きは使い回す）", js.r.ok && /immutable/.test(js.r.headers.get("Cache-Control") || ""), js.r.status);
    const esc = await get("/static/%2e%2e/config/config.json");
    ok("static の外へは出ない", esc.r.status === 404, esc.r.status);

    // 3) API
    const eq = await json("/api/equipments");
    ok("設備の一覧", eq.r.ok && Array.isArray(eq.j), JSON.stringify(eq.j).slice(0, 120));
    const pins = await json("/api/pins");
    ok("表示項目", pins.r.ok && pins.j.length > 10, pins.j && pins.j.length);
    const nf = await json("/api/no-such-route");
    ok("無いところは 404（日本語の理由）", nf.r.status === 404 && nf.j && nf.j.error, nf.r.status);
    const bad = await json("/api/children?" + q({ path: "Z:\\無い\\場所・日本語" }));
    ok("開けない場所は 400 と日本語の理由", bad.r.status === 400 && /開けません/.test((bad.j || {}).error || ""), (bad.j || {}).error);
    const all = await Promise.all(Array.from({ length: 40 }, (_, i) => json(i % 2 ? "/api/pins" : "/api/equipments")));
    ok("40 本同時でも、それぞれの答えが届く", all.every((x, i) => x.r.ok && (i % 2 ? x.j.length > 10 : Array.isArray(x.j))));
    localStorage.setItem("dtSelftest", "1");
    ok("localStorage が使える", localStorage.getItem("dtSelftest") === "1");
    localStorage.removeItem("dtSelftest");

    // 4) ロット（自己診断の設定にロットがあるとき）
    const lot = (eq.j || []).map((e) => e.lot).find(Boolean) || (window.__dtSelftestLot || "");
    const L = (eq.j || []).length && (eq.j[0].path || "");
    if (L) {
      // 設備 → 年 → 年月 → 日 → ロット をたどる
      let path = L, lots = [];
      for (let depth = 0; depth < 6 && !lots.length; depth++) {
        const ch = (await json("/api/children?" + q({ path }))).j || [];
        lots = ch.filter((c) => c.kind === "lot");
        const dir = ch.find((c) => c.kind === "dir");
        if (!lots.length && dir) path = dir.path; else break;
      }
      ok("木をたどってロットに届く", lots.length > 0, path);
      const withImg = [];
      for (const l of lots) {
        const t1 = performance.now();
        const o = await json("/api/open", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lot: l.path }) });
        let st = null;
        for (let i = 0; i < 300; i++) { st = (await json("/api/status?" + q({ lot: l.path }))).j; if (st && st.finished) break; await sleep(100); }
        const sec = ((performance.now() - t1) / 1000).toFixed(2);
        ok(`ロットを開く（${l.name}）`, o.r.ok && st && st.finished, `${sec} 秒・${st && st.total} 単位`);
        if (st && st.cabs.some((c) => c.images.length)) withImg.push([l, st]);
        const inf = await json("/api/info?" + q({ lot: l.path }));
        ok(`ロット情報（${l.name}）`, inf.r.ok && inf.j.dat.length > 0 && inf.j.timecheck, inf.j && inf.j.dat.length);
      }
      const [l, st] = withImg[0] || [];
      if (l) {
        const c = st.cabs.find((x) => x.images.length);
        const one = { lot: l.path, g: c.group, cab: c.cab, name: c.images[0] };
        const th = await get("/thumb?" + q(one));
        ok("縮小画像（JPEG）", th.r.ok && /jpeg/.test(th.r.headers.get("Content-Type") || ""), th.r.status);
        const im = await fetch("/img?" + q(one));
        const head = new Uint8Array(await im.arrayBuffer()).slice(0, 2);
        ok("原寸の画像（BMP）", im.ok && head[0] === 0x42 && head[1] === 0x4d, im.status);
        const m = await json("/api/imgmap?" + q({ lot: l.path, g: c.group }));
        ok("画像と欠陥の対応", m.r.ok && Object.keys(m.j.map).length > 0 && m.j.final, JSON.stringify(m.j.info));
        const ii = await json("/api/imginfo?" + q(one));
        ok("画像情報", ii.r.ok && ii.j.width > 0 && ii.j.detect.length > 5, `${ii.j && ii.j.width}×${ii.j && ii.j.height}`);
        const mp = await json("/api/map?" + q({ lot: l.path, g: c.group }));
        ok("MAP", mp.r.ok && mp.j.ok && mp.j.points.length > 0, mp.j && mp.j.points.length);
        const pr = await json("/api/pairs?" + q({ lot: l.path, g: c.group, tol: 5 }));
        ok("転写候補", pr.r.ok && pr.j.ok && pr.j.pairs.length > 0, pr.j && pr.j.pairs.length);
        const pt = await json("/api/pitch?" + q({ lot: l.path, g: c.group, skip: 1 }));
        ok("ピッチ候補", pt.r.ok && pt.j.ok && pt.j.chains.length > 0, pt.j && pt.j.chains.length);
        // 画面でも開く（ツリーのロット行を押したのと同じ道）
        localStorage.setItem("lastLot", l.path);
      }
    }
    // 5) ショートカットの帯の「作る」（試しの置き場 DT_LINK_DIRS のときだけ。本物のデスクトップには作らない）
    if (info && info.testLinks && install && install.shortcut && install.shortcut.ask) {
      const bar = document.getElementById("scBar");
      ok("ショートカットが無いと、帯が尋ねる", bar && !bar.hidden);
      document.getElementById("scMake").click();
      for (let i = 0; i < 100 && !bar.hidden; i++) await sleep(100);
      const after = (await json("/__desktop/install")).j || {};
      const sc = after.shortcut || {};
      ok("「作る」を押すと、デスクトップとスタートにショートカットができる", bar.hidden && sc.links && sc.links.length === (sc.places || []).length && !sc.ask,
        `${document.getElementById("status").textContent} / ${JSON.stringify(sc).slice(0, 200)}`);
    }
    ok("画面のエラーが無い", !(window.__dtErrors || []).length, (window.__dtErrors || []).join(" / "));
  } catch (e) {
    ok("自己診断が最後まで流れる", false, e && (e.stack || e.message || e));
  }
  // 更新の係が置き場を確かめ終える（取り込み中なら済むまで）のを待ってから、その状態を添える（更新の通し verify.py が読む）
  for (let i = 0; i < 300; i++) {
    try { update = (await json("/__desktop/update")).j; } catch (_) { break; }
    if (!update || !["idle", "checking", "staging"].includes(update.state)) break;
    await sleep(200);
  }
  const result = { ok: res.length > 0 && res.every((x) => x.ok), results: res, info, update, install, elapsed: (performance.now() - t0) / 1000 };
  await fetch("/__desktop/selftest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(result) });
})();
