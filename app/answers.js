// Picks answers for a prompt from the dataset. Known prompts use their own top-tier answers;
// unknown prompts borrow answers from the most similarly worded prompts in the dataset.
const STOP = new Set(("name a an the of that is are you can with in on or and something thing things kind kinds type types " +
  "word for to from your one famous popular by at as it its be has have who what which some any part parts like").split(" "));

const tokens = (text) =>
  new Set(text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w)));

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Top-tier answers first (5, then 4), shuffled within a tier; short ones only (less likely to be mangled).
const ranked = (answers, tiers = [5, 4]) =>
  tiers.flatMap((tier) => shuffle(answers.filter(([t, a]) => t === tier && a.length <= 30).map(([, a]) => ({ answer: a, fromTier: tier }))));

function createPicker(db) {
  const index = Object.entries(db).filter(([, v]) => v.answers?.length).map(([id, v]) => ({ id, text: v.text, toks: tokens(v.text), answers: v.answers }));

  // Scores by how much of the prompt's own wording another prompt shares (Jaccard as tiebreak).
  function similar(text, skipId, limit = 3) {
    const q = tokens(text);
    if (!q.size) return [];
    return index
      .map((e) => {
        let inter = 0;
        for (const w of q) if (e.toks.has(w)) inter++;
        return { e, score: inter / q.size, jac: inter / (q.size + e.toks.size - inter) };
      })
      .filter((x) => x.e.id !== skipId && x.score >= 0.33 && x.e.answers.some(([t]) => t === 5))
      .sort((a, b) => b.score - a.score || b.jac - a.jac)
      .slice(0, limit);
  }

  // Returns up to `max` candidate answers, each with where it came from.
  return function candidates(id, text, max = 4) {
    // Order: own tier 5/4, then tier-5 answers borrowed from similar prompts, then own tier 3.
    const mine = (tiers) => (db[id]?.answers?.length ? ranked(db[id].answers, tiers).map((c) => ({ ...c, source: "dataset" })) : []);
    const own = mine([5, 4]), low = mine([3]);
    if (own.some((c) => c.fromTier === 5)) return own.slice(0, max);
    const seen = new Set(own.map((c) => c.answer.toLowerCase())), out = [...own];
    const done = () => [...out, ...low].slice(0, max);
    for (const { e, score } of similar(text, id)) {
      for (const c of ranked(e.answers)) {
        const k = c.answer.toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ ...c, source: `similar: ${e.text}`, score });
        if (out.length >= max) return done();
        if (out.filter((o) => o.source === `similar: ${e.text}`).length >= 2) break; // spread across similar prompts
      }
    }
    return done();
  };
}

module.exports = { createPicker, tokens };
