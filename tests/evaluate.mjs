// 評価関数: 主要解像度 × 全画面 × テーマで「スクロールレス」「表示切れ」「実行時エラー」「データ整合」を検証する
// 使い方: node tests/evaluate.mjs [--shots <dir>]
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import fs from "node:fs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = pathToFileURL(path.join(root, "index.html")).href;
const shotDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

// Windows 11 / 125% スケーリングの実効CSSピクセル（2160x1440 → 1728x1152、FHD → 1536x864）を含む
const VIEWPORTS = [[1536, 864], [1728, 1152], [1920, 1080], [2560, 1440]];
const ROUTES = ["overview", "models/matrix", "models/profile", "guide/map", "guide/detail", "future/roadmap", "future/diffusion", "history/timeline", "history/growth", "future/capability", "future/infra", "future/frontier", "future/safety", "bench/index", "bench/agentic", "bench/reason", "bench/work", "bench/computer", "bench/heat", "cost", "speed", "compare", "table", "data"];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const failures = [];
let checks = 0;
const fail = (ctx, msg) => failures.push(`${ctx}: ${msg}`);

for (const theme of ["light", "dark"]) {
  for (const [w, h] of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => m.type() === "error" && errors.push(m.text()));
    await page.addInitScript(t => { try { localStorage.clear(); localStorage.setItem("aimb.theme", JSON.stringify(t)); } catch {} }, theme);
    await page.goto(url);
    // データ整合（アプリ内の検証関数を利用）
    if (theme === "light" && w === 1536) {
      const v = await page.evaluate(() => Data.validate(Data.seed()));
      checks++; if (v.errors.length) fail("data", v.errors.join(" / "));
      if (v.warnings.length) console.log("data warnings:", v.warnings);
    }
    for (const r of ROUTES) {
      await page.evaluate(h => { location.hash = h; }, r);
      await page.waitForTimeout(60);
      const ctx = `${theme} ${w}x${h} #${r}`;
      const res = await page.evaluate(() => {
        const out = { pageScroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1, clipped: [], empty: 0, svgOverflow: [] };
        // 内容がはみ出して隠れている領域（overflow:hidden のラッパー）
        document.querySelectorAll("#view .body > div, #view .body .chart").forEach(el => {
          if (getComputedStyle(el).overflow === "auto") { // スクロール領域：出典リスト・JSON見本以外で中身があふれたら「スクロールレス違反」
            if (!el.closest(".src-list, pre") && !el.querySelector(":scope > .src-list, :scope > pre") && el.scrollHeight > el.clientHeight + 2) out.clipped.push("要スクロール:" + (el.closest(".card")?.querySelector("h2")?.textContent || el.className) + ` ${el.scrollHeight}>${el.clientHeight}`);
            return;
          }
          if (el.scrollHeight > el.clientHeight + 2) out.clipped.push((el.id || el.className) + ` 縦 ${el.scrollHeight}>${el.clientHeight}`);
          if (el.scrollWidth > el.clientWidth + 2) out.clipped.push((el.id || el.className) + ` 横 ${el.scrollWidth}>${el.clientWidth}`);
        });
        // テキストの重なり（SVGラベル同士）
        out.overlap = [];
        document.querySelectorAll("#view .chart svg").forEach(svg => {
          const rs = [...svg.querySelectorAll("text.lb, text.lb2, text.vl, text.ax")].map(t => ({ t: t.textContent, r: t.getBoundingClientRect() })).filter(x => x.r.width);
          for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) { const a = rs[i].r, b = rs[j].r;
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left), oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 2 && oy > 3) out.overlap.push(rs[i].t + "×" + rs[j].t); }
        });
        document.querySelectorAll("#view .card").forEach(c => { if (c.scrollHeight > c.clientHeight + 2) out.clipped.push("card:" + c.querySelector("h2")?.textContent + ` ${c.scrollHeight}>${c.clientHeight}`); });
        // SVG内テキストがチャート領域外へはみ出していないか
        document.querySelectorAll("#view .chart svg").forEach(svg => {
          const b = svg.getBoundingClientRect();
          svg.querySelectorAll("text").forEach(t => { const r = t.getBoundingClientRect(); if (r.width && (r.left < b.left - 4 || r.right > b.right + 4 || r.top < b.top - 6 || r.bottom > b.bottom + 6)) out.svgOverflow.push(t.textContent); });
        });
        const f = document.querySelector("#filters"); if (f.scrollWidth > f.clientWidth + 1) out.clipped.push(`上部フィルター 横 ${f.scrollWidth}>${f.clientWidth}`);
        document.querySelectorAll("#view .chart svg").forEach(svg => { const ls = [...svg.querySelectorAll("g.r text.lb")].map(x => x.textContent).filter(x => x.endsWith("…")); const dup = ls.filter((x, i) => ls.indexOf(x) !== i); if (dup.length) out.clipped.push("省略後に区別できないラベル: " + [...new Set(dup)].join(", ")); });
        out.empty = document.querySelectorAll("#view .empty").length;
        out.cards = document.querySelectorAll("#view .card").length;
        return out;
      });
      checks++;
      if (res.pageScroll) fail(ctx, "ページ全体がスクロールしている");
      if (res.clipped.length) fail(ctx, "内容が切れている → " + res.clipped.join(", "));
      if (res.svgOverflow.length) fail(ctx, "SVGラベルがはみ出し → " + [...new Set(res.svgOverflow)].slice(0, 6).join(", "));
      if (res.overlap.length) fail(ctx, "ラベル重なり → " + res.overlap.slice(0, 5).join(", "));
      if (!res.cards) fail(ctx, "カードが描画されていない");
      if (res.empty) console.log(`note ${ctx}: 空表示 ${res.empty} 件`);
      if (shotDir && (theme === "light" ? [1536, 1728].includes(w) : w === 1728)) await page.screenshot({ path: path.join(shotDir, `${theme}-${w}-${r.replace("/", "_")}.png`) });
    }
    // 旧世代を含めた最大件数でも収まるか（ベンチ・ヒートマップ・仕様一覧・コスト）
    await page.evaluate(() => { S.f.legacy = true; });
    for (const r of ["bench/agentic", "bench/heat", "table", "cost", "speed", "models/matrix", "overview"]) {
      await page.evaluate(h => { location.hash = h; render(); }, r);
      const bad = await page.evaluate(() => [...document.querySelectorAll("#view .body > div, #view .body .chart")].filter(el => getComputedStyle(el).overflow !== "auto" && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2)).map(el => (el.id || el.className) + ` ${el.scrollHeight}>${el.clientHeight}/${el.scrollWidth}>${el.clientWidth}`));
      const amb = await page.evaluate(() => { const o = []; document.querySelectorAll("#view .chart svg").forEach(svg => { const ls = [...svg.querySelectorAll("g.r text.lb")].map(x => x.textContent); const d = ls.filter((x, i) => ls.indexOf(x) !== i); if (d.length) o.push(...d); }); return o; });
      checks++; if (amb.length) fail(`${theme} ${w}x${h} #${r}（旧世代込み）`, "同名に見えるラベル → " + [...new Set(amb)].join(", "));
      checks++; if (bad.length) fail(`${theme} ${w}x${h} #${r}（旧世代込み）`, "内容が切れている → " + bad.join(", "));
      if (shotDir && theme === "light" && w === 1536) await page.screenshot({ path: path.join(shotDir, `light-1536-legacy-${r.replace("/", "_")}.png`) });
    }
    await page.evaluate(() => { S.f.legacy = false; });
    // 個別解説・プロフィールを全件巡回（項目により文章量が異なるため）
    for (const [route, ids, key] of [["guide/detail", await page.evaluate(() => S.D.benchmarks.map(b => b.id)), "guideBench"], ["models/profile", await page.evaluate(() => visible().map(m => m.id)), "profile"], ["future/roadmap", await page.evaluate(() => S.D.outlook.upcoming.map(u => u.id)), "upcoming"]]) {
      for (const id of ids) {
        await page.evaluate(([r, k, i]) => { S[k] = i; location.hash = r; render(); }, [route, key, id]);
        const bad = await page.evaluate(() => [...document.querySelectorAll("#view .body > div")].filter(el => el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2).map(el => el.closest(".card")?.querySelector("h2")?.textContent + ` ${el.scrollHeight}>${el.clientHeight}`));
        checks++; if (bad.length) fail(`${theme} ${w}x${h} #${route}:${id}`, "内容があふれている → " + bad.join(", "));
        if (shotDir && theme === "light" && w === 1536 && ["tb4", "gdpval", "swepro", "claude-opus-5-5", "gemini-4-argon", "gemini4", "grok5"].includes(id)) await page.screenshot({ path: path.join(shotDir, `light-1536-${route.replace("/", "_")}-${id}.png`) });
      }
    }
    // 操作系：ドロワー・フィルター・比較選択
    if (w === 1728) {
      await page.evaluate(() => { location.hash = "overview"; });
      await page.click(".kpi .k-m"); await page.waitForTimeout(250);
      checks++; if (!(await page.$eval("#drawer", d => d.classList.contains("on")))) fail(`${theme} drawer`, "モデル詳細が開かない");
      if (shotDir && theme === "light") await page.screenshot({ path: path.join(shotDir, `light-1728-drawer.png`) });
      await page.keyboard.press("Escape");
      // 画面間の導線：ベンチの i → 解説、早見表の行 → プロフィール
      await page.evaluate(() => { location.hash = "bench/agentic"; }); await page.waitForTimeout(80);
      await page.click('#view [data-gb="tb4"]'); await page.waitForTimeout(80);
      checks++; if (await page.evaluate(() => location.hash) !== "#guide/detail" || !(await page.evaluate(() => S.guideBench === "tb4"))) fail(`${theme} nav`, "ベンチ解説への遷移が効かない");
      await page.evaluate(() => { location.hash = "models/matrix"; }); await page.waitForTimeout(80);
      await page.click('#view tr[data-prof="gemini-4-argon"]'); await page.waitForTimeout(80);
      checks++; if (!(await page.evaluate(() => location.hash === "#models/profile" && S.profile === "gemini-4-argon"))) fail(`${theme} nav`, "プロフィールへの遷移が効かない");
      await page.evaluate(() => { location.hash = "overview"; }); await page.waitForTimeout(80);
      await page.click('[data-prov="anthropic"]');
      checks++; const n = await page.evaluate(() => visible().some(m => m.provider === "anthropic")); if (n) fail(`${theme} filter`, "提供元フィルターが効かない");
      await page.click('[data-prov="anthropic"]');
      await page.click("#fLegacy");
      checks++; const leg = await page.evaluate(() => visible().some(m => m.legacy)); if (!leg) fail(`${theme} legacy`, "旧世代表示が効かない");
      await page.click("#fLegacy");
      // 取り込み（マージ）
      checks++;
      const before = await page.evaluate(() => S.D.models.length);
      const merged = await page.evaluate(() => ingest({ meta: { asOf: "2026-10-05" }, models: [{ id: "test-x", name: "Test X", provider: "openai", released: "2026-10-01", price: { input: 1, output: 2 }, scores: { tb4: 99 } }] }, "merge", "local") && S.D.models.length);
      if (merged !== before + 1) fail(`${theme} import`, "マージ取り込み件数が想定外: " + merged);
      const bad = await page.evaluate(() => ingest({ models: [] }, "replace", "local"));
      checks++; if (bad) fail(`${theme} import`, "不正データを受け入れてしまう");
    }
    checks++; if (errors.length) fail(`${theme} ${w}x${h}`, "JSエラー → " + [...new Set(errors)].join(" | "));
    await page.close();
  }
}
await browser.close();
console.log(`\n${checks} checks, ${failures.length} failures`);
failures.forEach(f => console.log("  ✕ " + f));
process.exit(failures.length ? 1 : 0);
