// 設定の窓を本物の画面で通しで確かめる（評価関数）。試験のロットと、使用状況の見本（ui-harness の seedPresence: 6 台）で:
//   窓の大きさが頁で変わらない → この PC の頁に名乗り（ログイン名・PC 名と出どころ）・版・表示の初期値・自分の使用の記録 →
//   使用状況: 数の札・要更新が上・お願い済みの札・絞り込み・操作のボタンが行で同じ位置 → 更新を促す → お願い済みになる →
//   促された PC（この PC）の画面に「更新のお願い」の帯 → あとで で畳む → 履歴（PC で絞る）→ 記録を消す（使用中は消せない）・残す日数 →
//   配布の頁に 使っている PC の台数・行き渡り・促す相手 → 開発者でない人には この PC の頁だけ
//   node program/tools/settings-check.mjs [出力のフォルダ]
import fs from "node:fs";
import path from "node:path";
import { launch, parseView } from "./ui-harness.mjs";

const out = path.resolve(process.argv[2] || "settings-check");
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const check = (ok, what) => { if (!ok) bad++; console.log(`${ok ? "OK  " : "NG  "} ${what}`); };

for (const dev of [true, false]) {
  process.env.DT_UI_CFG = JSON.stringify(dev ? {} : { release_users: ["dev-only"] });
  const h = await launch(undefined, [], {});
  try {
    for (const view of dev ? ["1728x1152", "1280x720"] : ["1728x1152"]) {
      const page = await h.newPage(parseView(view));
      const errs = []; page.on("pageerror", (e) => errs.push(e.stack || e.message));
      page.on("dialog", (d) => d.accept());
      const w = view.split("x")[0];
      await page.click("#btnSettings");
      await page.waitForSelector("#setPc .set-dl");
      const size = () => page.evaluate(() => { const r = document.querySelector(".set-win").getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; });
      const s0 = await size();
      const pcText = await page.textContent("#setPc");
      check(/ログイン名/.test(pcText) && /から）/.test(pcText) && /表示の初期値/.test(pcText) && /この PC の使用の記録/.test(pcText), `${w}: この PC の頁に名乗り・出どころ・表示の初期値・使用の記録`);
      await page.screenshot({ path: path.join(out, `pc-${w}${dev ? "" : "-user"}.png`) });
      if (!dev) {
        check(await page.locator('#setTabs [data-page="fleet"]').isHidden() && await page.locator('#setTabs [data-page="release"]').isHidden(), "開発者でない人には管理の頁が出ない");
        check(!errs.length, `画面のエラーなし ${errs.join(" / ")}`);
        await page.context().close();
        continue;
      }
      // 使用状況
      await page.click('#setTabs [data-page="fleet"]');
      await page.waitForSelector("#setFleet .set-kpi");
      const sizes = [s0, await size()];
      const fl = await page.evaluate(() => ({
        rows: [...document.querySelectorAll("#setFleet tbody tr")].map((r) => ({ behind: r.classList.contains("behind"), pc: r.children[1].textContent, txt: r.textContent })),
        kpi: document.querySelector("#setFleet .set-kpi").textContent,
        ops: [...document.querySelectorAll("#setFleet tbody tr")].map((r) => [...r.querySelectorAll(".set-ops button")].map((b) => Math.round(b.getBoundingClientRect().left)).join(",")),
        cut: [...document.querySelectorAll("#setFleet *")].some((e) => e.getBoundingClientRect().right > document.querySelector(".set-win").getBoundingClientRect().right + 1),
      }));
      check(fl.rows.length >= 6 && fl.rows[0].behind && fl.rows[1].behind && !fl.rows[2].behind, `${w}: 要更新の PC が上に 2 台（${fl.rows.map((r) => r.pc).join("・")}）`);
      check(/要更新の PC\s*2 台/.test(fl.kpi), `${w}: 数の札に要更新 2 台`);
      check(/お願い済み/.test(fl.rows[0].txt + fl.rows[1].txt), `${w}: 促した PC にお願い済みの札`);
      check(new Set(fl.ops).size === 1, `${w}: 操作のボタンが行で同じ位置（${[...new Set(fl.ops)].join(" / ")}）`);
      check(!fl.cut, `${w}: 使用状況の表が窓からはみ出さない`);
      await page.screenshot({ path: path.join(out, `fleet-${w}.png`) });
      // 絞り込み
      await page.click('#setFleet [data-filter="behind"]');
      check((await page.$$("#setFleet tbody tr")).length === 2, `${w}: 「要更新」で 2 台に絞る`);
      await page.click('#setFleet [data-filter="all"]');
      // 配布の頁
      await page.click('#setTabs [data-page="release"]');
      await page.waitForSelector("#relMore .set-bar");
      await page.waitForSelector("#relBody .rl-t");
      sizes.push(await size());
      const rel = await page.textContent("#setBody section[data-page=release]");
      check(/版の行き渡り/.test(rel) && /更新を促す相手/.test(rel) && /使っている PC/.test(rel) && /ZIP から/.test(rel) && /新しい PC へ/.test(rel), `${w}: 配布の頁に 置く・新しい PC へ・使っている PC・行き渡り・促す相手`);
      await page.screenshot({ path: path.join(out, `release-${w}.png`) });
      // 使用の履歴
      await page.click('#setTabs [data-page="history"]');
      await page.waitForSelector("#setHist .set-days");
      sizes.push(await size());
      const nAll = (await page.$$("#setHist tbody tr")).length;
      await page.click('#setHist [data-pcf="検査PC-01@ito"]');
      await page.waitForSelector('#setHist [data-pcf="検査PC-01@ito"].on');
      const only = await page.$$eval("#setHist tbody tr", (rs) => rs.map((r) => r.children[2].textContent));
      check(nAll > only.length && only.length > 0 && only.every((p) => p === "検査PC-01"), `${w}: 履歴を PC で絞る（${nAll} → ${only.length} 行）`);
      await page.screenshot({ path: path.join(out, `history-${w}.png`) });
      check(new Set(sizes).size === 1, `${w}: 窓の大きさが頁で変わらない（${[...new Set(sizes)].join(" / ")}）`);
      if (w === "1728") {
        // 記録を消す（使用中は押せない・使っていない PC は消える）・残す日数
        await page.click('#setTabs [data-page="fleet"]');
        await page.waitForSelector("#setFleet .set-kpi");
        await page.click('#setFleet [data-set="forget"][data-key="検査PC-05@yamada"]');
        await page.waitForFunction(() => !document.querySelector('#setFleet [data-key="検査PC-05@yamada"]'));
        check(true, "使っていない PC の記録を消せる");
        check(await page.locator('#setFleet tr:has-text("仕上PC-11") [data-set="forget"]').evaluate((b) => b.classList.contains("gap")), "使用中の PC の「記録を消す」は出さない");
        // 更新を促す（自分の PC に）→ 帯
        const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()).then((r) => r.me));
        await page.click('#setFleet [data-set="nudge"][data-key="仕上PC-11@suzuki"]');
        await page.waitForFunction(() => /お願い済み/.test([...document.querySelectorAll("#setFleet tbody tr")].find((r) => /仕上PC-11/.test(r.textContent)).textContent));
        check(true, "「更新を促す」でお願い済みになる");
        await page.evaluate((k) => fetch("/api/presence/nudge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k }) }), me.key);
        await page.keyboard.press("Escape");
        await page.reload(); await page.waitForFunction(() => window.__dtReady === true);
        await page.waitForSelector("#nudgeBar:not([hidden])", { timeout: 25000 });
        check(/更新のお願い/.test(await page.textContent("#nudgeBar")), "促された PC の画面に「更新のお願い」の帯が出る");
        await page.screenshot({ path: path.join(out, `nudge-${w}.png`) });
        await page.click("#nudgeLater");
        check(await page.locator("#nudgeBar").isHidden(), "「あとで」で帯を畳む");
        await page.click("#btnSettings"); await page.click('#setTabs [data-page="history"]'); await page.waitForSelector("#setDays");
        await page.fill("#setDays", "120"); await page.click('#setHist [data-set="days"]');
        await page.waitForFunction(() => /120 日/.test(document.getElementById("status").textContent));
        check(true, "記録を残す日数を変えられる");
      }
      check(!errs.length, `${w}: 画面のエラーなし ${errs.join(" / ")}`);
      await page.context().close();
    }
  } finally {
    await h.close();
  }
}
console.log(bad ? `NG ${bad} 件` : "全部 OK");
process.exit(bad ? 1 : 0);
