// 表示項目の初期値を本物の画面で通しで確かめる（評価関数）。試験のロットで:
//   初期の札・行は ini（輪郭）、足した物は add（黄）で、初期が先・足した物の前に区切り「足した物」→ 足した物の × は聞かずに外す
//   → 初期の × は真ん中の小窓で確かめる（やめる＝残る・Esc＝残る・外す＝消える）→ データ項目の窓の「置く先」で初期を外すときも確かめる
//   → 開発者には見出しに「初期値を決める（開発者）」→ いまの表示を初期値にする（共有の置き場の pins-default.json）→ 足した物が初期に変わる
//   → 表示を変えて「表示設定を初期化」→ 開発者の初期値に戻る → 「アプリの初期値に戻す」→ 初期化でアプリの初期値（34 項目）
//   → 開発者でない人には「初期値を決める」が出ない
//   node program/tools/pin-defaults-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, parseView } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "pin-defaults-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
const add = (page, b) => page.evaluate((b) => fetch("/api/pins", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then((r) => r.json()), b);
const pins = (page) => page.evaluate(() => fetch("/api/pins").then((r) => r.json()));
const openLot = async (page) => {
  const lot = await page.evaluate(() => window.__dtFx);
  await page.evaluate((p) => localStorage.setItem("lastLot", p), lot);
  await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
  await page.waitForFunction(() => document.querySelectorAll("#summary .chip").length > 3 && document.querySelectorAll("#imgInfo tr.pinned").length > 3, null, { timeout: 30000 });
};

for (const dev of [true, false]) {
  process.env.DT_UI_CFG = JSON.stringify(dev ? {} : { release_users: ["dev-only"] });
  const h = await launch(undefined, [], {});
  try {
    const page = await h.newPage(parseView("1728x1152"));
    const errs = []; page.on("pageerror", (e) => errs.push(e.stack || e.message));
    page.on("dialog", (d) => d.accept());   // 「表示設定を初期化」の確かめ（confirm）は受ける
    if (!dev) {
      await openLot(page);
      check(await page.locator("#btnIniDev").isHidden(), "開発者でない人には「初期値を決める（開発者）」が出ない");
      const r = await page.evaluate(() => fetch("/api/pins/default", { method: "POST" }).then((r) => r.status));
      check(r === 400, `開発者でない人は初期値を決められない（POST → ${r}）`);
      check(!errs.length, `画面のエラーなし ${errs.join(" / ")}`);
      continue;
    }
    await add(page, { scope: "lot", place: "summary", label: "画像数", file: "dat:INSP_INFO", key: "image_total_cnt" });
    await add(page, { scope: "image", place: "card", label: "幅", file: "dat:DETECT_INFO", key: "width_mm" });
    await openLot(page);
    const look = () => page.evaluate(() => ({
      sum: [...document.querySelectorAll("#summary .chip, #summary .pinsep")].map((c) => (c.classList.contains("pinsep") ? "|" : c.classList.contains("ini") ? "i" : "a")).join(""),
      rows: [...document.querySelectorAll("#imgInfo tr.pinned, #imgInfo tr.pinsep")].map((r) => (r.classList.contains("pinsep") ? "|" : r.classList.contains("ini") ? "i" : "a")).join(""),
      iniLook: (() => { const c = document.querySelector("#summary .chip.ini"), a = document.querySelector("#summary .chip.add"), cs = getComputedStyle(c), as = a && getComputedStyle(a);
        return { ib: cs.backgroundColor, ir: cs.borderTopLeftRadius, ab: as && as.backgroundColor, ar: as && as.borderTopLeftRadius }; })(),
    }));
    let s = await look();
    check(/^i+\|a$/.test(s.sum), `サマリ: 初期が先・区切り・足した物（${s.sum}）`);
    check(/^i+\|a$/.test(s.rows), `画像情報の表: 初期が先・区切り・足した物（${s.rows}）`);
    check(s.iniLook.ib !== s.iniLook.ab && s.iniLook.ir !== s.iniLook.ar, `初期と足した物は地の色と角の形が違う（${JSON.stringify(s.iniLook)}）`);
    check(await page.locator("#btnIniDev").isVisible(), "開発者には見出しに「初期値を決める（開発者）」が出る");
    await page.screenshot({ path: path.join(out, "lot-1728.png") });

    // 足した物は聞かずに外す
    await page.click("#summary .chip.add .x");
    await page.waitForFunction(() => !document.querySelector("#summary .chip.add"));
    check(await page.locator("#pinWarn").isHidden(), "足した物の × は確かめずに外す");
    // 初期の × は確かめる
    const n0 = (await pins(page)).length;
    await page.click('#summary .chip[data-pid="d_s_mat"] .x');
    await page.waitForSelector("#pinWarn:not([hidden])");
    const txt = await page.textContent("#pinWarn");
    check(/初期の表示項目を外しますか/.test(txt) && /材質/.test(txt) && /アプリ（開発者）が決めた初期の項目/.test(txt) && /サマリ/.test(txt), `初期の × で真ん中の小窓（${txt.replace(/\s+/g, " ").slice(0, 70)}…）`);
    await page.screenshot({ path: path.join(out, "warn-1728.png") });
    await page.click('#pinWarn [data-w="no"]');
    check(await page.locator("#pinWarn").isHidden() && (await pins(page)).length === n0, "「やめる」で残る");
    await page.click('#summary .chip[data-pid="d_s_mat"] .x');
    await page.waitForSelector("#pinWarn:not([hidden])");
    await page.keyboard.press("Escape");
    check(await page.locator("#pinWarn").isHidden() && (await pins(page)).length === n0, "Esc で閉じて残る");
    await page.click('#summary .chip[data-pid="d_s_mat"] .x');
    await page.click('#pinWarn [data-w="go"]');
    await page.waitForFunction(() => !document.querySelector('#summary .chip[data-pid="d_s_mat"]'));
    check((await pins(page)).length === n0 - 1, "「外す」で消える");
    // データ項目の窓の「置く先」で初期を外すときも確かめる
    await page.click("#btnSources");
    await page.fill("#srcFilter", "width_mm");
    await page.click('#srcRows tr.src[data-key="width_mm"]');
    const tg = page.locator('#srcRows [data-toggle="image"]');
    await tg.click();
    const asked = await page.locator("#pinWarn").isVisible();
    if (asked) await page.click('#pinWarn [data-w="no"]');
    check(asked, "データ項目の窓の「置く先」で初期の項目を外すときも確かめる");
    const tags = await page.evaluate(() => [...document.querySelectorAll('#srcRows tr.src[data-key="width_mm"] .dpl')].map((t) => t.className).join(" "));
    check(/ini/.test(tags) && /add/.test(tags), `中央の一覧の置き先の札も初期と足した物で分かれる（${tags}）`);
    await page.keyboard.press("Escape");

    // 開発者がいまの表示を初期値にする
    await page.click("#btnIniDev");
    await page.waitForSelector("#iniWin:not([hidden])");
    check(/アプリの初期値/.test(await page.textContent("#iniWin")), "小窓に、いまの初期値（アプリの初期値）が出る");
    await page.screenshot({ path: path.join(out, "dev-1728.png") });
    await page.click('#iniWin [data-ini="set"]');
    await page.waitForFunction(() => /開発者/.test(document.getElementById("iniWin").textContent));
    const shared = path.join(h.fx, "..", "shared", "pins-default.json");
    const saved = fs.existsSync(shared) ? JSON.parse(fs.readFileSync(shared, "utf8")) : null;
    const now = await pins(page);
    check(saved && saved.pins.length === now.length && !saved.pins.some((p) => p.id === "d_s_mat"), `共有の置き場に、いまの表示（${now.length} 項目・材質なし）を初期値として書く`);
    s = await look();
    check(!/a/.test(s.rows) && !/\|/.test(s.rows), `足した物（画像表示の幅）が初期に変わる（${s.rows}）`);
    await page.keyboard.press("Escape");
    // 表示を変えて初期化 → 開発者の初期値
    await add(page, { scope: "lot", place: "summary", label: "検査幅", file: "dat:INSP_INFO", key: "@insp_width" });
    await page.click("#btnReset");
    await page.waitForFunction(() => /開発者.*初期値に戻しました/.test(document.getElementById("status").textContent));
    check(JSON.stringify((await pins(page)).map((p) => p.id)) === JSON.stringify(saved.pins.map((p) => p.id)), "「表示設定を初期化」で開発者の初期値に戻る");
    // 開発者の初期値をやめる → 初期化でアプリの初期値
    await page.click("#btnIniDev");
    await page.click('#iniWin [data-ini="clear"]');
    await page.waitForFunction(() => /アプリの初期値（34 項目/.test(document.getElementById("iniWin").textContent));
    check(!fs.existsSync(shared), "「アプリの初期値に戻す」で共有の初期値を消す");
    await page.keyboard.press("Escape");
    await page.click("#btnReset");
    await page.waitForFunction(() => /^表示項目をアプリの初期値に戻しました/.test(document.getElementById("status").textContent));
    const back = await pins(page);
    check(back.length === 34 && back.every((p) => p.id.startsWith("d_")), `初期化でアプリの初期値（${back.length} 項目・${back.filter((p) => !p.id.startsWith("d_")).map((p) => p.id)}）`);
    check(!errs.length, `画面のエラーなし ${errs.join(" / ")}`);
  } finally {
    await h.close();
  }
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
