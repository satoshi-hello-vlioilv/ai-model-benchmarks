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
const ROUTES = ["overview", "bench/index", "bench/agentic", "bench/reason", "bench/work", "bench/computer", "bench/heat", "cost", "speed", "compare", "table", "data"];

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
          if (getComputedStyle(el).overflow === "auto") return; // 意図したスクロール領域（出典リスト等）は除外
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
    // 操作系：ドロワー・フィルター・比較選択
    if (w === 1728) {
      await page.evaluate(() => { location.hash = "overview"; });
      await page.click(".kpi .k-m"); await page.waitForTimeout(250);
      checks++; if (!(await page.$eval("#drawer", d => d.classList.contains("on")))) fail(`${theme} drawer`, "モデル詳細が開かない");
      if (shotDir && theme === "light") await page.screenshot({ path: path.join(shotDir, `light-1728-drawer.png`) });
      await page.keyboard.press("Escape");
      await page.click('[data-prov="anthropic"]');
      checks++; const n = await page.evaluate(() => visible().some(m => m.provider === "anthropic")); if (n) fail(`${theme} filter`, "提供元フィルターが効かない");
      await page.click('[data-prov="anthropic"]');
      await page.click("#fLegacy");
      checks++; const leg = await page.evaluate(() => visible().some(m => m.legacy)); if (!leg) fail(`${theme} legacy`, "旧世代表示が効かない");
      await page.click("#fLegacy");
      // 取り込み（マージ）
      checks++;
      const merged = await page.evaluate(() => ingest({ meta: { asOf: "2026-10-05" }, models: [{ id: "test-x", name: "Test X", provider: "openai", released: "2026-10-01", price: { input: 1, output: 2 }, scores: { tb4: 99 } }] }, "merge", "local") && S.D.models.length);
      if (merged !== 14) fail(`${theme} import`, "マージ取り込み件数が想定外: " + merged);
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
