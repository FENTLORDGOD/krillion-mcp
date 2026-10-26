const $ = (id) => document.getElementById(id);
let pts = 0, k = 0, controls = { paused: false, takeover: false, running: false }, manual = false, timer;

function renderState() {
  const s = $("state");
  s.className = "state";
  if (manual) { s.textContent = "YOUR TURN"; s.classList.add("manual"); }
  else if (!controls.running) s.textContent = "IDLE";
  else if (controls.paused) { s.textContent = "PAUSED"; s.classList.add("pause"); }
  else if (controls.takeover) { s.textContent = "TAKEOVER NEXT"; s.classList.add("manual"); }
  else { s.textContent = "RUNNING"; s.classList.add("run"); }
  $("bp").textContent = controls.paused ? "Resume" : "Pause";
  $("bt").textContent = controls.takeover ? "Cancel takeover" : "Take over";
  $("bs").textContent = controls.running ? "Stop" : "Start";
}

$("bp").addEventListener("click", () => window.bot.control("pause"));
$("bt").addEventListener("click", () => window.bot.control("takeover"));
$("bs").addEventListener("click", () => window.bot.control("startstop"));
$("manual").addEventListener("submit", (e) => {
  e.preventDefault();
  window.bot.control("manual-answer", $("mi").value);
  $("mi").value = "";
});

window.bot.hotkeys().then((keys) => {
  $("keys").textContent = keys.map((h) => `${h.key} ${h.name}${h.ok ? "" : " (unavailable)"}`).join(" · ");
});

window.bot.on((m) => {
  if (m.ev === "controls") { controls = m; renderState(); }
  if (m.ev === "room") { pts = 0; k = 0; $("pts").textContent = "0"; $("k").textContent = "0"; }
  if (m.ev === "room") $("prompt").textContent = `Room ${m.code.replace(/(\d{3})(\d{3})/, "$1 $2")} · waiting for a prompt…`;
  if (m.ev === "prompt") { $("prompt").textContent = m.text; $("answer").textContent = m.answer ? "→ " + m.answer : "no known answer"; $("last").textContent = ""; }
  if (m.ev === "thinking") $("last").textContent = `thinking ${m.seconds.toFixed(1)}s…`;
  if (m.ev === "attempt") $("answer").textContent = (m.source === "you" ? "you: " : "→ ") + m.answer;
  if (m.ev === "skipped") $("last").textContent = m.why === "paused" ? "skipped (paused)" : m.why === "time" ? "out of time" : "";
  if (m.ev === "result") {
    pts += m.points; if (m.tier === "krillion") k++;
    $("pts").textContent = pts; $("k").textContent = k;
    $("last").className = "last " + m.tier;
    $("last").textContent = m.tier === "miss" ? "refused" : `${m.tier} · ${m.points}`;
  }
  if (m.ev === "manual") {
    manual = true; renderState();
    $("manual").classList.add("on"); $("mi").focus();
    let left = m.seconds;
    $("last").className = "last"; $("last").textContent = `${left}s left`;
    clearInterval(timer);
    timer = setInterval(() => { left--; if (manual) $("last").textContent = `${Math.max(0, left)}s left`; }, 1000);
  }
  if (m.ev === "manual-end") { manual = false; clearInterval(timer); $("manual").classList.remove("on"); renderState(); }
  if (m.ev === "done") { $("prompt").textContent = `${m.reason}. ${m.points} points.`; $("answer").textContent = ""; pts = 0; k = 0; }
});
renderState();
