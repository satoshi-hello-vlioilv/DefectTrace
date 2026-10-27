// 欠陥のフィルタを本物の画面で通しで確かめる（評価関数）。試験のロット（24 枚・欠陥 58）で:
//   帯が出る → 窓で条件を作る（分類 = 穴）→ 当てはまる数と見本・分布が出る → 自分に保存 → 一覧が絞られ、CAB の見出し・画像情報・MAP・左下の数がそろう
//   → ← → で当てはまる画像だけを送る → 共有にもう 1 つ保存して重ねる（どちらも満たす）→ 「条件 ▾」で外す・重ねる → 開発者でない人は既定を選べない
//   → 1280 でも 2 つのチップが名前・中身・× つきで出る（入りきらなければ帯の 2 段目へ折り返す）→ 消す → 外すと全部に戻る
//   node program/tools/filter-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, parseView } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "filter-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };
process.env.DT_UI_CFG = JSON.stringify({ release_users: ["dev-only"] });   // この画面の人は開発者でない（既定を選べない）
const h = await launch(undefined, [], {});
try {
  const page = await h.newPage(parseView("1728x1152"));
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const lot = await page.evaluate(() => window.__dtFx);
  await page.evaluate((p) => localStorage.setItem("lastLot", p), lot);
  await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
  await page.waitForFunction(() => window.dtFilter.ctx() && document.querySelectorAll("#grid .th").length === 24 && /枚/.test(document.getElementById("fCount").textContent), null, { timeout: 30000 });
  const look = () => page.evaluate(() => ({
    shown: [...document.querySelectorAll("#grid .th")].filter((t) => t.offsetParent).length,
    count: document.getElementById("fCount").textContent, chips: [...document.querySelectorAll("#fChips .f-chip:not([hidden]) b")].map((b) => b.textContent),
    whole: [...document.querySelectorAll("#fChips .f-chip")].every((c) => { const r = c.getBoundingClientRect(), b = document.getElementById("fChips").getBoundingClientRect();
      return c.querySelector(".c").offsetParent && c.querySelector(".x").offsetParent && r.right <= b.right + 1 && r.left >= b.left - 1; }),
    img: document.getElementById("imgTitle").textContent, map: document.getElementById("mapTitle").textContent, status: document.getElementById("status").textContent,
    heads: [...document.querySelectorAll(".cabsep:not([hidden]) .st")].map((s) => s.textContent).join(" ") }));
  let s = await look();
  check(s.shown === 24 && /なし/.test(await page.textContent("#fChips")) && s.count === "24 枚", `帯が出る（絞り込みなし・${s.count}）`);

  // 窓で作る（分類 = 穴）
  await page.click("#fOpen");
  await page.waitForSelector("#fEd #fName");
  check(/開発者だけ/.test(await page.textContent("#fEd")), "置き場に 自分・共有・既定（開発者だけ）が出る");
  const devOff = await page.evaluate(() => document.querySelector('#fEd input[name=fsc][value=def]').disabled);
  check(devOff, "開発者でない人（release_users に名前が無い）は既定を選べない");
  await page.fill("#fName", "穴だけ");
  await page.selectOption('#fEd select[data-k="field"]', "kindID");
  await page.selectOption('#fEd select[data-k="op"]', "in");
  await page.waitForSelector('#fEd [data-in="0"]');
  const holeId = await page.evaluate(() => { const k = window.dtFilter.ctx().kinds; return Object.keys(k).find((x) => k[x].name === "穴"); });
  await page.check(`#fEd [data-in="0"][value="${holeId}"]`);
  await page.waitForFunction(() => /当てはまる画像 \d+/.test(document.getElementById("fLive").textContent), null, { timeout: 10000 });
  const live = await page.textContent("#fLive");
  const prev = await page.evaluate(() => document.querySelectorAll("#fPrev img").length);
  check(/当てはまる画像 \d+ \/ 24 枚/.test(live) && prev > 0, `作っている間に当てはまる数と見本（${live}・見本 ${prev} 枚）`);
  await page.screenshot({ path: path.join(out, "edit-1728.png") });
  await page.click("[data-save]");
  await page.waitForFunction(() => document.getElementById("fModal").hidden);
  await page.waitForFunction(() => document.querySelectorAll("#fChips .f-chip").length === 1);
  await page.waitForTimeout(400);
  s = await look();
  const n1 = parseInt(live.match(/当てはまる画像 (\d+)/)[1]);
  check(s.shown === n1 && s.count === `${n1} / 24 枚`, `保存すると一覧が絞られる（${s.shown} 枚・帯 ${s.count}）`);
  check(new RegExp(`/${n1}・絞り込み中`).test(s.img) && /絞り込み中・全 58/.test(s.map) && new RegExp(`${n1} / 24 枚を表示`).test(s.status) && / \/ \d+枚/.test(s.heads),
    `画像情報・MAP・左下・CAB の見出しも絞った数（${s.img}・${s.map}・${s.status.slice(0, 22)}・${s.heads}）`);
  // 送り
  const keys = [];
  for (let i = 0; i < n1; i++) { keys.push(await page.evaluate(() => document.querySelector(".th.sel")?.dataset.key)); await page.keyboard.press("ArrowRight"); await page.waitForTimeout(60); }
  const allShown = await page.evaluate((ks) => ks.every((k) => { const t = document.querySelector(`.th[data-key="${CSS.escape(k)}"]`); return t && !t.classList.contains("fo"); }), keys);
  check(allShown && new Set(keys).size === n1, `← → で当てはまる画像だけを送る（${new Set(keys).size} 枚）`);

  // 共有にもう 1 つ（面積 ≥ 2.4）を保存して重ねる
  await page.click("#fOpen"); await page.waitForSelector("#fEd #fName");
  await page.click("[data-new]");
  await page.fill("#fName", "面積 2.4 以上");
  await page.selectOption('#fEd select[data-k="field"]', "area_mm");
  await page.fill('#fEd input[data-k="v"]', "2.4");
  await page.check('#fEd input[name=fsc][value=share]');
  await page.waitForFunction(() => /当てはまる画像 \d+/.test(document.getElementById("fLive").textContent));
  const hist = await page.evaluate(() => document.querySelectorAll("#fHist i").length);
  check(hist > 5, `数の項目は分布の棒が出る（${hist} 本）`);
  await page.click("[data-save]");
  await page.waitForFunction(() => document.querySelectorAll("#fChips .f-chip").length === 2);
  await page.waitForTimeout(400);
  s = await look();
  check([...s.chips].sort().join("・") === ["穴だけ", "面積 2.4 以上"].sort().join("・") && s.shown <= n1, `2 つ重ねる（どちらも満たす: ${s.shown} 枚・${s.chips.join("・")}）`);
  const shared = fs.readdirSync(path.join(path.dirname(h.fx), "shared"));
  check(shared.includes("filters-shared.json"), `共有は共有の置き場に保存（${shared.join("・")}）`);
  await page.screenshot({ path: path.join(out, "lot-1728.png") });

  // 条件 ▾ で 1 つ外す
  await page.click("#fPick"); await page.waitForSelector("#fPop:not([hidden]) [data-on]");
  const items = await page.evaluate(() => [...document.querySelectorAll("#fPop .f-item")].map((l) => l.textContent.replace(/\s+/g, " ").trim()));
  check(items.length === 2 && items.every((t) => /枚/.test(t)), `「条件 ▾」に登録した条件と枚数（${items.join(" / ")}）`);
  await page.locator("#fPop [data-on]").first().uncheck();
  await page.waitForFunction(() => document.querySelectorAll("#fChips .f-chip").length === 1);
  check(true, "「条件 ▾」のチェックで外す");
  await page.keyboard.press("Escape");

  // 1280: 帯は 1 段
  await page.locator("#fPop [data-on]").count();
  await page.click("#fPick"); await page.locator("#fPop [data-on]").first().check(); await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(500);
  s = await look();
  check(s.chips.length === 2 && s.whole, `1280 でも 2 つのチップが名前・中身・× つきで切れずに出る（${s.chips.join("・")}）`);
  await page.screenshot({ path: path.join(out, "lot-1280.png") });
  await page.setViewportSize({ width: 1728, height: 1152 }); await page.waitForTimeout(300);

  // 消す（2 度押し）・外す
  await page.click("#fOpen"); await page.waitForSelector("#fLib [data-del]");
  const del = page.locator("#fLib [data-del]").first();
  await del.click(); await del.click();
  await page.waitForFunction(() => document.querySelectorAll("#fLib [data-del]").length === 1);
  check(true, "窓で消す（2 度押し）");
  await page.keyboard.press("Escape");
  await page.click("#fClear"); await page.waitForTimeout(400);
  s = await look();
  check(s.shown === 24 && s.count === "24 枚" && /画像あり/.test(s.map), `「外す」で全部に戻る（${s.shown} 枚・${s.map}）`);
  check(!errs.length, `画面の誤りが出ない（${errs.join(" / ") || "なし"}）`);
} finally {
  await h.close();
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
