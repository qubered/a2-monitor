#!/usr/bin/env node
// Renders docs/design/archive/mockups/*.png from
// docs/design/archive/prototype/index.html.
//
// That prototype is archived (see docs/design/archive/README.md): it
// predates DESIGN.md 2.0.0+ and does not reflect the current Pulse design
// language. This script still works, for anyone who wants a picture of the
// pre-rebrand product, but it is not part of any current workflow.
//
//   node scripts/render-mockups.mjs
//
// Not wired into CI, and deliberately not a repository dependency: it needs
// playwright-core and a Chromium build, which most contributors will not have.
// Install them where you are running it, or leave the committed images alone.
//
//   npm i playwright-core          # or npx playwright install chromium
//   CHROMIUM=/path/to/chrome node scripts/render-mockups.mjs
//
// Web fonts are fetched once with curl and inlined as data URIs, so the render
// does not depend on the browser reaching a CDN and the type in the images is
// the real type rather than a fallback stack. With no network the script still
// runs and says so; the images will use fallbacks and should not be committed.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const ROOT = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const PAGE = `file://${ROOT}/docs/design/archive/prototype/index.html`;
const OUT = `${ROOT}/docs/design/archive/mockups`;
// Google Fonts serves woff2 only to a user agent it believes supports it.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Archivo:wght@600;700;800;900" +
  "&family=Baloo+2:wght@700" +
  "&family=Hanken+Grotesk:wght@400;500;600;700" +
  "&family=JetBrains+Mono:wght@400;500;600&family=Kalam:wght@400;700&display=swap";

const curl = (url, binary = false) =>
  execFileSync("curl", ["-sSL", "-A", UA, url], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: binary ? "buffer" : "utf8",
  });

function inlineFonts() {
  try {
    const css = curl(FONT_CSS);
    const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2/g) ?? [])];
    let out = css;
    for (const u of urls) {
      const b64 = curl(u, true).toString("base64");
      out = out.split(u).join(`data:font/woff2;base64,${b64}`);
    }
    console.log(`fonts: inlined ${urls.length} faces`);
    return out;
  } catch (e) {
    console.warn("fonts: could not fetch — rendering with fallbacks, do not commit these images");
    return "";
  }
}

// Each shot is [file, description, steps]. Keep this list short and curated:
// these are the states worth having a picture of, not every screen.
const SHOTS = [
  ["01-a2-grid-paper", "A2 grid, Paper, at rest", async (p) => {}],
  ["02-a2-grid-dark", "A2 grid, dark theme", async (p) => {
    await p.click('.seg [data-t="dark"]');
  }],
  ["03-a2-alerts", "Unacknowledged alerts veiling their cards", async (p) => {}],
  ["04-a2-acknowledged", "One alert acknowledged, one self-resolved", async (p) => {
    await p.click('.chcard[data-i="1"] .alertover');
    await p.waitForTimeout(12500);
  }],
  ["05-a2-player", "The player expanded, four graphs under one playhead", async (p) => {
    await p.click("#expand");
  }],
  ["06-a2-replay", "Scrubbed back into replay", async (p) => {
    await p.click("#expand");
    const box = await p.locator("#seek").boundingBox();
    await p.mouse.click(box.x + box.width * 0.62, box.y + box.height / 2);
  }],
  ["07-a2-detail", "Channel detail — antennas, frequency, transmitter, battery", async (p) => {
    await p.click('.chcard[data-i="2"] .zoom');
  }],
  ["08-a1-grid", "A1 view — glance and report, no listening", async (p) => {
    await p.click('.seg [data-s="a1"]');
  }],
  ["09-a1-report", "The report sheet, several issues selected", async (p) => {
    await p.click('.seg [data-s="a1"]');
    await p.click('#a1grid .chcard[data-i="2"] .hit');
    await p.click('.fbtn[data-pick="1"]');
    await p.click('.fbtn[data-pick="4"]');
  }],
  ["10-a1-sent", "Report sent, with undo still live", async (p) => {
    await p.click('.seg [data-s="a1"]');
    await p.click('#a1grid .chcard[data-i="2"] .hit');
    await p.click('.fbtn[data-pick="1"]');
    await p.click("#rsend");
  }],
  ["11-mic-check", "Guided mic check, one-handed", async (p) => {
    await p.click('.seg [data-s="check"]');
  }],
  ["12-replay-incident", "Replay surface and the incident panel", async (p) => {
    await p.click('.seg [data-s="replay"]');
  }],
];

const fontCss = inlineFonts();
mkdirSync(OUT, { recursive: true });

const exe =
  process.env.CHROMIUM ||
  execFileSync("bash", ["-lc", "find /opt/pw-browsers -name chrome -type f | head -1"])
    .toString()
    .trim();

const browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
const errors = [];

for (const [name, description, steps] of SHOTS) {
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  await page.goto(PAGE);
  if (fontCss) await page.addStyleTag({ content: fontCss });
  await page.waitForTimeout(1800);
  await steps(page);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
  console.log(`${name}.png — ${description}`);
}

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
console.log("done");
