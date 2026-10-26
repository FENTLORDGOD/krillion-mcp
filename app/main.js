// Krillion Room Bot: desktop app that plays a Krillion multiplayer room as its own named player.
// The control window shows settings, a live feed and the dataset; the game window is the bot's player.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

if (process.env.HTTPS_PROXY) app.commandLine.appendSwitch("proxy-server", process.env.HTTPS_PROXY);

const DATA = app.isPackaged ? path.join(process.resourcesPath, "answers.json") : path.join(__dirname, "..", "data", "answers.json");
const db = JSON.parse(fs.readFileSync(DATA, "utf8"));
const GAME = "https://playdaily.org/krillion";

let control, game, run = null;
const send = (ev, data) => control && !control.isDestroyed() && control.webContents.send("bot", { ev, ...data });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);

const { createPicker } = require("./answers.js");
const candidates = createPicker(db);

// The answer box: a visible text input that isn't the room chat.
const ANSWER_INPUT = `[...document.querySelectorAll("input")].find(i => i.offsetParent && !/message/i.test(i.placeholder))`;

// Runs a snippet in the game page and returns its result.
const js = (code) => game.webContents.executeJavaScript(code, true).catch(() => null);
const clickButton = (re) =>
  js(`(() => { const b = [...document.querySelectorAll("button")].find(b => ${re}.test(b.textContent.trim())); if (b) { b.click(); return true } return false })()`);

const hasButton = (re) => js(`[...document.querySelectorAll("button")].some(b => ${re}.test(b.textContent.trim()))`);

// Clicks `click` until the `expect` button shows up (clicks before the page finishes loading are ignored).
async function step(click, expect, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end && run) {
    await clickButton(click);
    if (await waitFor(() => hasButton(expect), 3000)) return true;
  }
  return false;
}

async function waitFor(fn, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!run) return false;
    if (await fn()) return true;
    await sleep(250);
  }
  return false;
}

// Types one answer within budgetMs. Human pace thinks first (shorter on a retry), then types unevenly.
async function typeAnswer(answer, budgetMs, clockSec, pace, retry) {
  if (pace === "human") {
    const typingMs = answer.length * 180 + 800;
    const want = retry ? rand(1000, 3000) : rand(0.25, 0.6) * clockSec * 1000;
    const think = Math.max(500, Math.min(want, budgetMs - 3000 - typingMs));
    send("thinking", { seconds: think / 1000, clockSec });
    await sleep(think);
  }
  await js(`${ANSWER_INPUT}?.focus()`);
  for (const ch of answer) {
    if (!run) return;
    game.webContents.sendInputEvent({ type: "char", keyCode: ch });
    if (pace === "human") await sleep(rand(70, 220) + (Math.random() < 0.08 ? rand(250, 600) : 0));
  }
  if (pace === "human") await sleep(rand(300, 900));
  game.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter" });
  game.webContents.sendInputEvent({ type: "char", keyCode: "\r" });
  game.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter" });
}

// Tries candidates in order until one is accepted or the clock is nearly out.
async function answerPrompt(me, id, text) {
  const t0 = Date.now(), clockMs = me.clockSec * 1000;
  const cands = candidates(id, text);
  send("prompt", { text, source: cands[0]?.source ?? null });
  for (let i = 0; i < cands.length && run === me; i++) {
    const { answer, source } = cands[i];
    const budget = clockMs - (Date.now() - t0);
    if (budget < answer.length * (me.pace === "human" ? 220 : 0) + 2500) break;
    send("attempt", { answer, source, retry: i > 0 });
    const before = me.results.length;
    await typeAnswer(answer, budget, me.clockSec, me.pace, i > 0);
    await waitFor(async () => me.results.length > before, 6000);
    const r = me.results[me.results.length - 1];
    if (me.results.length > before && r.accepted) return;
  }
}

async function start({ code, prompts, pace }) {
  if (run) return;
  run = { byText: new Map(), clockSec: 25, results: [], pace };
  const me = run;
  game = new BrowserWindow({ width: 900, height: 900, title: "Krillion · bot player", autoHideMenuBar: true });
  game.on("closed", () => { game = null; if (run === me) stop("Game window closed"); });

  // Watch the game's own network traffic: room lineup (prompt ids) and answer verdicts.
  const dbg = game.webContents.debugger;
  dbg.attach("1.3");
  dbg.sendCommand("Network.enable").catch(() => {}); // awaiting this on a blank window can hang
  const watched = new Map();
  dbg.on("message", async (_e, method, p) => {
    if (method === "Network.responseReceived") {
      const u = p.response.url;
      const t = /room=[^&]*?-t(\d+)/.exec(u);
      if (t) me.clockSec = +t[1];
      if (u.includes("/api/krillion/rooms/lineup")) watched.set(p.requestId, "lineup");
      else if (/\/api\/krillion\/answer$/.test(u)) watched.set(p.requestId, "answer");
    } else if (method === "Network.loadingFinished" && watched.has(p.requestId)) {
      const kind = watched.get(p.requestId);
      watched.delete(p.requestId);
      try {
        const body = JSON.parse((await dbg.sendCommand("Network.getResponseBody", { requestId: p.requestId })).body);
        if (kind === "lineup") for (const q of body.prompts || []) me.byText.set(q.text, q.id);
        else { me.results.push(body); send("result", { tier: body.tier, points: body.points || 0, reason: body.reason, answer: body.answer }); }
      } catch {}
    }
  });

  await game.loadURL(code ? `${GAME}?room=${code}` : GAME);
  if (!code) {
    send("status", { text: "Creating a private room…" });
    const ok =
      (await step(/play multiplayer/i, /create a room/i)) &&
      (await step(/create a room/i, /^private$/i)) &&
      (await step(new RegExp(`^${prompts}\\s*prompts`, "i"), /^private$/i)) &&
      (await step(/^private$/i, /create private room/i)) &&
      (await waitFor(() => clickButton(/create private room/i)));
    if (!ok) return stop("Couldn't create a room (the game's layout may have changed)");
  }
  await waitFor(async () => /room=\d+/.test(game.webContents.getURL()));
  const room = new URL(game.webContents.getURL()).searchParams.get("room");
  send("room", { code: room });
  send("status", { text: "Waiting for the next prompt…" });

  let last = "", played = 0;
  while (run === me && played < prompts) {
    const state = await js(`({ input: !!${ANSWER_INPUT}, body: document.body.innerText })`);
    const text = state?.input && [...me.byText.keys()].find((t) => state.body.includes(t));
    if (!text || text === last) { await sleep(300); continue; }
    last = text;
    await answerPrompt(me, me.byText.get(text), text);
    played++;
    await sleep(1500);
  }
  if (run === me) { await sleep(4000); stop("Finished"); }
}

function stop(reason) {
  if (!run) return;
  const r = run;
  run = null;
  const pts = r.results.reduce((s, x) => s + (x.points || 0), 0); // refused attempts score 0
  send("done", { reason, points: pts, results: r.results.map((x) => x.tier) });
  if (game && !game.isDestroyed()) game.close();
}

function search(q) {
  q = q.trim().toLowerCase();
  if (q.length < 2) return [];
  return Object.values(db).filter((v) => v.text?.toLowerCase().includes(q)).slice(0, 30)
    .map((v) => ({ text: v.text, answers: v.answers || [] }));
}

app.whenReady().then(() => {
  control = new BrowserWindow({
    width: 460, height: 760, title: "Krillion Room Bot", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  control.loadFile(path.join(__dirname, "index.html"));
  ipcMain.handle("start", (_e, opts) => { start(opts).catch((err) => stop("Error: " + err.message)); });
  ipcMain.handle("stop", () => stop("Stopped"));
  ipcMain.handle("search", (_e, q) => search(q));
  ipcMain.handle("stats", () => {
    const L = Object.values(db).filter((v) => v.answers);
    return { prompts: L.length, withKrillion: L.filter((v) => v.answers.some(([t]) => t === 5)).length };
  });
});
app.on("window-all-closed", () => app.quit());
