const $ = (id) => document.getElementById(id);
const TIERS = ["plankton", "too clever", "schooler", "rare", "deep cut", "one in a krillion"];
const TIER_CLASS = ["plankton", "tooclever", "schooler", "rare", "deepcut", "krillion"];
let running = false, pts = 0, k = 0, n = 0, current = null, attempt = null;

document.querySelectorAll("nav button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("nav button, section").forEach((el) => el.classList.remove("on"));
    b.classList.add("on");
    $(b.dataset.tab).classList.add("on");
  })
);

window.bot.stats().then((s) => {
  $("stats").textContent = `${s.prompts.toLocaleString()} prompts in dataset · ${s.withKrillion.toLocaleString()} with a known krillion answer`;
});

$("mode").addEventListener("change", () => { $("code").style.display = $("mode").value === "join" ? "" : "none"; });

function setRunning(on) {
  running = on;
  $("go").textContent = on ? "Stop" : "Start";
  $("go").classList.toggle("stop", on);
  for (const id of ["mode", "code", "prompts", "pace"]) $(id).disabled = on;
}

$("go").addEventListener("click", () => {
  if (running) return window.bot.stop();
  const code = $("mode").value === "join" ? $("code").value.replace(/\D/g, "") : null;
  if ($("mode").value === "join" && code.length !== 6) return ($("status").textContent = "Enter the 6-digit room code.");
  pts = k = n = 0;
  $("pts").textContent = $("k").textContent = $("n").textContent = "0";
  $("feed").innerHTML = "";
  $("room").textContent = "";
  $("status").textContent = "Opening the game…";
  setRunning(true);
  window.bot.start({ code, prompts: +$("prompts").value, pace: $("pace").value });
});

$("cp").addEventListener("click", () => window.bot.control("pause"));
$("ct").addEventListener("click", () => window.bot.control("takeover"));
$("ch").addEventListener("click", () => window.bot.control("hud"));
$("manual").addEventListener("submit", (e) => { e.preventDefault(); window.bot.control("manual-answer", $("mi").value); $("mi").value = ""; });
window.bot.hotkeys().then((keys) => {
  $("keys").textContent = "Hotkeys: " + keys.map((h) => `${h.key} ${h.name}${h.ok ? "" : " (unavailable)"}`).join(" · ");
});

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" });

window.bot.on((m) => {
  if (m.ev === "status") $("status").textContent = m.text;
  if (m.ev === "room") { $("room").textContent = m.code.replace(/(\d{3})(\d{3})/, "$1 $2"); $("status").textContent = "Share this code with the room."; }
  if (m.ev === "thinking") $("status").textContent = `Thinking for ${m.seconds.toFixed(1)}s (${m.clockSec}s clock)…`;
  if (m.ev === "prompt") {
    current = el("li");
    current.append(el("div", "p", m.text));
    if (!m.source) current.append(el("div", "a", "No known or similar answer: skipped"));
    else if (m.source !== "dataset") current.append(el("div", "src", "No top answer known, borrowing from " + m.source.replace(/^similar: /, "“") + "”"));
    $("feed").prepend(current);
  }
  if (m.ev === "attempt") {
    attempt = el("div", "a" + (m.retry ? " retry" : ""), (m.retry ? "↳ " : "") + m.answer);
    current?.append(attempt);
  }
  if (m.ev === "result") {
    n++; pts += m.points; if (m.tier === "krillion") k++;
    $("pts").textContent = pts; $("k").textContent = k; $("n").textContent = n;
    attempt?.prepend(el("span", "tag " + m.tier, m.tier === "miss" ? "refused" : m.tier + " · " + m.points));
    $("status").textContent = m.tier === "miss" ? "Refused, trying another answer…" : "Waiting for the next prompt…";
  }
  if (m.ev === "hotkey-start" && !running) $("go").click();
  if (m.ev === "controls") {
    $("cp").textContent = m.paused ? "Resume" : "Pause"; $("cp").classList.toggle("on", m.paused);
    $("ct").textContent = m.takeover ? "Cancel takeover" : "Take over"; $("ct").classList.toggle("on", m.takeover);
  }
  if (m.ev === "manual") { $("manual").classList.add("on"); $("mi").focus(); $("status").textContent = `Your turn: type the bot's answer (${m.seconds}s left)`; }
  if (m.ev === "manual-end") $("manual").classList.remove("on");
  if (m.ev === "skipped") { current?.append(el("div", "a retry", m.why === "paused" ? "Skipped: paused" : m.why === "time" ? "Out of time" : "Skipped")); }
  if (m.ev === "done") { $("status").textContent = `${m.reason}. ${m.points} points.`; setRunning(false); }
});

let t;
$("q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(async () => {
    const res = await window.bot.search($("q").value);
    $("results").innerHTML = "";
    for (const r of res) {
      const ans = el("div", "ans");
      for (const [tier, a] of [...r.answers].sort((x, y) => y[0] - x[0]).slice(0, 60)) {
        const s = el("span", TIER_CLASS[tier], a);
        s.title = TIERS[tier];
        ans.append(s);
      }
      $("results").append(el("div", "q", `${r.text} (${r.answers.length})`), ans);
    }
    if (!res.length && $("q").value.trim().length >= 2) $("results").append(el("div", "p", "No matching prompts."));
  }, 200);
});
