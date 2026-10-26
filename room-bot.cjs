#!/usr/bin/env node
// Plays a Krillion multiplayer room using data/answers.json.
// For each prompt it types a known tier-5 ("one in a krillion") answer, or a tier-4 one if none is known.
// Usage: node room-bot.cjs [roomCode] [--prompts N] [--video DIR] [--fast] [--show]
//   --show opens a visible browser window so you can watch it play.
//   Answers at a human pace by default (thinks, then types); --fast submits instantly.
//   no roomCode -> creates a private room and prints its code.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const code = args.find((a) => /^\d{6}$/.test(a.replace(/\s/g, "")))?.replace(/\s/g, "");
const PROMPTS = opt("--prompts", "5");
const NAME = opt("--name", null);
const VIDEO = opt("--video", null);
const DB = path.join(__dirname, "data", "answers.json");
const FAST = args.includes("--fast");
const rand = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let clockSec = 25; // updated from the room id, e.g. "p7-t30-..." = 30s per prompt

// Type like a person: think first, then type with uneven gaps, finishing well inside the clock.
async function humanType(page, input, answer) {
  const typingMs = answer.length * 180 + 800;
  const latest = clockSec * 1000 - 4000 - typingMs; // leave ~4s spare
  const think = Math.max(1500, Math.min(rand(0.25, 0.6) * clockSec * 1000, latest));
  await sleep(think);
  await input.click();
  for (const ch of answer) {
    await input.press(ch === " " ? "Space" : ch).catch(() => input.type(ch));
    await sleep(rand(70, 220) + (Math.random() < 0.08 ? rand(250, 600) : 0));
  }
  await sleep(rand(300, 900));
  await input.press("Enter");
  return think;
}

const pick = (id) => {
  const e = JSON.parse(fs.readFileSync(DB, "utf8"))[id];
  if (!e?.answers) return null;
  for (const tier of [5, 4, 3]) {
    // Prefer short, plain answers: less likely to be mangled or refused.
    const c = e.answers.filter(([t, a]) => t === tier && a.length <= 30).map(([, a]) => a);
    if (c.length) return { answer: c[Math.floor(Math.random() * c.length)], fromTier: tier };
  }
  return null;
};

(async () => {
  const b = await chromium.launch({ headless: !args.includes("--show") });
  const ctx = await b.newContext({ viewport: { width: 900, height: 900 }, ...(VIDEO && { recordVideo: { dir: VIDEO } }) });
  const p = await ctx.newPage();
  const byText = new Map(); // prompt text -> id, from the room lineup
  const results = [];
  p.on("response", async (r) => {
    const u = r.url();
    try {
      const t = /room=[^&]*?-t(\d+)/.exec(u);
      if (t) clockSec = +t[1];
      if (u.includes("/api/krillion/rooms/lineup")) for (const q of (await r.json()).prompts || []) byText.set(q.text, q.id);
      if (/\/api\/krillion\/answer$/.test(u)) {
        const v = await r.json();
        results.push(v);
        console.log(`  -> ${v.tier} ${v.points ?? 0}${v.reason ? " (" + v.reason + ")" : ""}`);
      }
    } catch {}
  });

  await p.goto("https://playdaily.org/krillion" + (code ? `?room=${code}` : ""), { waitUntil: "networkidle" });
  if (!code) {
    await p.click("text=PLAY MULTIPLAYER");
    await p.locator("button", { hasText: "CREATE A ROOM" }).first().click();
    await p.locator("button").filter({ hasText: new RegExp(`^\\s*${PROMPTS}\\s*prompts`, "i") }).first().click();
    await p.locator("button").filter({ hasText: /^\s*private\s*$/i }).first().click();
    await p.locator("button").filter({ hasText: /create private room/i }).first().click();
  }
  await p.waitForURL(/room=\d+/, { timeout: 20000 }).catch(() => {});
  console.log("ROOM", p.url(), "code", new URL(p.url()).searchParams.get("room"));
  if (NAME) console.log("(name option not wired: the game assigns a random name; change it in the UI)");

  let last = "", played = 0, total = +PROMPTS;
  const deadline = Date.now() + (total + 2) * 45000;
  while (played < total && Date.now() < deadline) {
    const input = p.locator("input:visible").first();
    if (!(await input.count())) { await p.waitForTimeout(300); continue; }
    const body = await p.innerText("body");
    const text = [...byText.keys()].find((t) => body.includes(t));
    if (!text || text === last) { await p.waitForTimeout(300); continue; }
    last = text;
    const choice = pick(byText.get(text));
    const answer = choice?.answer ?? "Nefandous"; // no data: placeholder, will likely be refused
    console.log(`PROMPT: ${text}\n  answer: ${answer} (${choice ? "dataset tier " + choice.fromTier : "NOT IN DATASET"})`);
    if (FAST) { await input.fill(answer); await input.press("Enter"); }
    else console.log(`  (thought for ${((await humanType(p, input, answer)) / 1000).toFixed(1)}s, ${clockSec}s clock)`);
    played++;
    await p.waitForTimeout(1500);
  }
  await p.waitForTimeout(3000);
  const tally = {};
  for (const r of results) tally[r.tier] = (tally[r.tier] || 0) + 1;
  console.log("RESULT", JSON.stringify(tally), "points", results.reduce((s, r) => s + (r.points || 0), 0));
  await ctx.close();
  await b.close();
})();
