#!/usr/bin/env node
// MCP server for Krillion (https://playdaily.org/krillion): give the rarest
// correct answer to an open prompt. Wraps the game's public JSON API.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs";

const BASE = "https://playdaily.org/api/krillion";
const TIERS = "plankton 4, too clever 8, schooler 16, rare 32, deep cut 64, one in a krillion 100";

// Prompts dealt this session: id -> { text, cat, ticket, mode }
const prompts = new Map();
const recent = [];
const game = { mode: null, queue: [], run: null, points: 0, answered: 0, misses: 0 };

async function api(path, body) {
  const res = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function remember(p, ticket, mode) {
  prompts.set(p.id, { text: p.text, cat: p.cat, ticket, mode });
  recent.push(p.id);
  if (recent.length > 200) recent.shift();
}

// Answers already given per prompt, from collect.py: id -> { text, answers: [[tier 0-5, answer], ...] }
const DB_PATH = new URL("./data/answers.json", import.meta.url);
let db = {}, dbMtime = 0;
function loadDb() {
  try {
    const m = fs.statSync(DB_PATH).mtimeMs;
    if (m !== dbMtime) { db = JSON.parse(fs.readFileSync(DB_PATH, "utf8")); dbMtime = m; }
  } catch {}
  return db;
}
function saveAnswers(id, text, answers) {
  loadDb();
  db[id] = { ...(db[id] || {}), text, answers };
  fs.mkdirSync(new URL("./data/", import.meta.url), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(db));
  dbMtime = fs.statSync(DB_PATH).mtimeMs;
}
const taken = (id) => loadDb()[id]?.answers?.map(([, a]) => a) ?? null;
// Answers the game already scored "one in a krillion" (tier 5): resubmitting one scores 100 in testing.
const krillions = (id) => loadDb()[id]?.answers?.filter(([t]) => t === 5).map(([, a]) => a) ?? [];

const fmt = (p) => {
  const t = taken(p.id);
  return {
    promptId: p.id, prompt: p.text, category: p.cat,
    ...(krillions(p.id).length
      ? { krillionAnswers: krillions(p.id).slice(0, 15), tip: "Submit one of krillionAnswers: these scored one in a krillion before." }
      : { alreadyGiven: t ?? "not in dataset", tip: "No known krillion answer: give a correct answer not on this list, as obscure as possible." }),
  };
};
const text = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

const server = new McpServer({ name: "krillion", version: "1.0.0" });

server.registerTool(
  "start_classic",
  {
    description:
      "Start a Classic Krillion dive: deals 7 open prompts (e.g. 'Name a soda brand'). " +
      "Answer each with submit_answer. Rarer correct answers score more (" + TIERS + "); " +
      "700 points = perfect dive. Wrong answers score 0. In the real game each prompt has a 25s clock.",
    inputSchema: {},
  },
  async () => {
    const { status, data } = await api("/deal", { mode: "classic", recent: recent.slice(-50) });
    if (status !== 200 || !Array.isArray(data.prompts)) return fail(`deal failed (${status}): ${JSON.stringify(data)}`);
    for (const p of data.prompts) remember(p, data.tickets?.[p.id], "classic");
    Object.assign(game, { mode: "classic", queue: data.prompts.map((p) => p.id), run: null, points: 0, answered: 0, misses: 0 });
    return text({ mode: "classic", prompts: data.prompts.map(fmt) });
  }
);

server.registerTool(
  "endless_next",
  {
    description:
      "Endless mode: get the next prompt (starts a new run if none is active, or if newRun is true). " +
      "One prompt at a time; prompts get harder the deeper you go. 3 tanks of air: a miss costs one, " +
      "a 'one in a krillion' answer gives one back.",
    inputSchema: { newRun: z.boolean().optional().describe("Abandon the current run and start fresh") },
  },
  async ({ newRun }) => {
    if (newRun || game.mode !== "endless") {
      Object.assign(game, { mode: "endless", queue: [], run: null, points: 0, answered: 0, misses: 0 });
    }
    const body = { mode: "endless", depth: game.points * 10, recent: recent.slice(-50) };
    if (game.run) body.run = game.run;
    const { status, data } = await api("/deal", body);
    if (status !== 200 || !data.prompt) return fail(`deal failed (${status}): ${JSON.stringify(data)}`);
    remember(data.prompt, data.ticket, "endless");
    game.run = data.run ?? game.run;
    return text({ mode: "endless", ...fmt(data.prompt), depthMetres: game.points * 10, tanksLeft: Math.max(0, 3 - game.misses) });
  }
);

server.registerTool(
  "submit_answer",
  {
    description:
      "Submit one answer to a dealt prompt. Returns whether it was accepted, its rarity tier and points. " +
      "Each prompt takes one scoring answer; a refused answer can be retried.",
    inputSchema: {
      promptId: z.string().describe("promptId from start_classic or endless_next"),
      answer: z.string().min(1).describe("Your answer, e.g. 'Tehachapi'"),
    },
  },
  async ({ promptId, answer }) => {
    const p = prompts.get(promptId);
    if (!p) return fail(`Unknown promptId ${promptId}. Deal prompts first with start_classic or endless_next.`);
    const { status, data } = await api("/answer", { promptId, ticket: p.ticket, answer });
    if (status !== 200) return fail(`answer failed (${status}): ${JSON.stringify(data)}`);
    if (data.accepted) {
      game.points += data.points || 0;
      game.answered += 1;
      game.queue = game.queue.filter((id) => id !== promptId);
      if (data.tier === "krillion" || data.points === 100) game.misses = Math.max(0, game.misses - 1);
    }
    return text({ prompt: p.text, ...data, totalPoints: game.points, depthMetres: game.points * 10 });
  }
);

server.registerTool(
  "pass_prompt",
  {
    description: "Give up on a prompt (in Endless this costs a tank of air).",
    inputSchema: { promptId: z.string() },
  },
  async ({ promptId }) => {
    const p = prompts.get(promptId);
    if (!p) return fail(`Unknown promptId ${promptId}.`);
    if (p.mode === "endless") game.misses += 1;
    return text({ passed: p.text, tanksLeft: p.mode === "endless" ? Math.max(0, 3 - game.misses) : undefined });
  }
);

server.registerTool(
  "crowd_answers",
  {
    description:
      "See what other players answered for a prompt and how it scored. The server only reveals these " +
      "after the prompt's clock has run out; if it's too early this returns how long to wait.",
    inputSchema: { promptId: z.string() },
  },
  async ({ promptId }) => {
    const p = prompts.get(promptId);
    if (!p) return fail(`Unknown promptId ${promptId}.`);
    const q = `/answers?prompt=${encodeURIComponent(promptId)}&ticket=${encodeURIComponent(p.ticket)}`;
    const { status, data } = await api(q);
    if (status === 425) return text({ notYet: true, waitSeconds: Math.ceil((data.wait || 0) / 1000) });
    if (status !== 200) return fail(`answers failed (${status}): ${JSON.stringify(data)}`);
    if (Array.isArray(data.answers)) saveAnswers(promptId, p.text, data.answers);
    return text({ prompt: p.text, ...data });
  }
);

server.registerTool(
  "status",
  { description: "Current session score, depth and mode.", inputSchema: {} },
  async () =>
    text({
      mode: game.mode,
      totalPoints: game.points,
      depthMetres: game.points * 10,
      accepted: game.answered,
      tanksLeft: game.mode === "endless" ? Math.max(0, 3 - game.misses) : undefined,
      unanswered: game.mode === "classic" ? game.queue.map((id) => fmt({ id, ...prompts.get(id) })) : undefined,
    })
);

server.registerTool(
  "lookup_prompt",
  {
    description: "Search the collected dataset for a prompt by text and list the answers already given (tier 0 = plankton ... 5 = one in a krillion).",
    inputSchema: { query: z.string().describe("Part of the prompt text, e.g. 'religious holiday'") },
  },
  async ({ query }) => {
    const q = query.toLowerCase();
    const hits = Object.entries(loadDb()).filter(([, v]) => v.text?.toLowerCase().includes(q)).slice(0, 5);
    return text(hits.length ? hits.map(([id, v]) => ({ promptId: id, prompt: v.text, answers: v.answers })) : "no match");
  }
);

server.registerTool(
  "live_rooms",
  { description: "How many players are in each live Krillion multiplayer room right now.", inputSchema: {} },
  async () => {
    const { status, data } = await api("/rooms");
    return status === 200 ? text(data) : fail(`rooms failed (${status})`);
  }
);

await server.connect(new StdioServerTransport());
