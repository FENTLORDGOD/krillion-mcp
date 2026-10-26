const $ = (id) => document.getElementById(id);
const TIERS = ["plankton", "too clever", "schooler", "rare", "deep cut", "one in a krillion"];
const TIER_CLASS = ["plankton", "tooclever", "schooler", "rare", "deepcut", "krillion"];
let running = false, pts = 0, k = 0, n = 0, current = null;

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

const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls || "", textContent: text ?? "" });

window.bot.on((m) => {
  if (m.ev === "status") $("status").textContent = m.text;
  if (m.ev === "room") { $("room").textContent = m.code.replace(/(\d{3})(\d{3})/, "$1 $2"); $("status").textContent = "Share this code with the room."; }
  if (m.ev === "thinking") $("status").textContent = `Thinking for ${m.seconds.toFixed(1)}s (${m.clockSec}s clock)…`;
  if (m.ev === "prompt") {
    current = el("li");
    current.append(el("div", "p", m.text), el("div", "a", m.answer ?? "No known answer: skipped"));
    if (!m.answer) current.prepend(el("span", "tag", "no data"));
    $("feed").prepend(current);
  }
  if (m.ev === "result") {
    n++; pts += m.points; if (m.tier === "krillion") k++;
    $("pts").textContent = pts; $("k").textContent = k; $("n").textContent = n;
    if (current) current.prepend(el("span", "tag " + m.tier, m.tier === "krillion" ? "krillion · " + m.points : m.tier + " · " + m.points));
    $("status").textContent = "Waiting for the next prompt…";
  }
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
