#!/usr/bin/env python3
"""Rate-limited collector for Krillion's prompt bank and revealed crowd answers.

Deals prompts (classic: 7 per request; endless: 1 per request at varied depths),
waits for each prompt's answer list to unlock, and saves it to data/answers.json.
Stops when new prompts dry up or after MAX_DEALS. Never exceeds ~1 request / MIN_GAP s.
"""
import json, os, random, ssl, sys, time, urllib.error, urllib.parse, urllib.request

BASE = "https://playdaily.org/api/krillion"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "answers.json")
MIN_GAP = 0.5          # seconds between any two requests
MAX_DEALS = int(os.environ.get("MAX_DEALS", 1500))      # hard cap on deal requests
DRY_WINDOW = 80        # stop if the last DRY_WINDOW deals found fewer than DRY_MIN new prompts
DRY_MIN = 2

ca = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
CTX = ssl.create_default_context(cafile=ca)
last = 0.0


def req(path, body=None):
    global last
    time.sleep(max(0, MIN_GAP - (time.time() - last)))
    last = time.time()
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(BASE + path, data, {"content-type": "application/json", "user-agent": "krillion-school-project/1.0"})
    try:
        with urllib.request.urlopen(r, context=CTX, timeout=20) as res:
            return res.status, json.load(res)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.load(e)
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


db = json.load(open(OUT)) if os.path.exists(OUT) else {}
pending = []           # (unlock_time, id, ticket)
seen = set(db)
recent, yields, deals = [], [], 0


def save():
    tmp = OUT + ".tmp"
    json.dump(db, open(tmp, "w"), ensure_ascii=False)
    os.replace(tmp, OUT)


def add(p, ticket, mode, depth=None):
    new = p["id"] not in seen or db[p["id"]]["answers"] is None
    if new:
        seen.add(p["id"])
        db.setdefault(p["id"], {"text": p["text"], "cat": p.get("cat"), "modes": [mode], "answers": None})
        pending.append([time.time() + 65, p["id"], ticket])
    elif mode not in db[p["id"]]["modes"]:
        db[p["id"]]["modes"].append(mode)
    if depth is not None:
        db[p["id"]].setdefault("depths", [])
        if depth not in db[p["id"]]["depths"]:
            db[p["id"]]["depths"].append(depth)
    recent.append(p["id"])
    del recent[:-50]
    return new


while True:
    # Fetch any unlocked answer lists first.
    now = time.time()
    due = [x for x in pending if x[0] <= now]
    for x in due:
        st, d = req("/answers?prompt=%s&ticket=%s" % (x[1], urllib.parse.quote(x[2])))
        if os.environ.get("DEBUG"): print("fetch", x[1], st, str(d)[:120], flush=True)
        if st == 200 and "answers" in d:
            db[x[1]]["answers"] = d["answers"]
            pending.remove(x)
        elif st == 425:
            x[0] = time.time() + d.get("wait", 10000) / 1000 + 1
        else:
            x[0] = time.time() + 30
            x.append(1)
            if len(x) > 6:  # give up after a few failures
                pending.remove(x)

    done = deals >= MAX_DEALS or (len(yields) >= DRY_WINDOW and sum(yields[-DRY_WINDOW:]) < DRY_MIN)
    if done:
        if not pending:
            break
        time.sleep(1)
        continue

    # Deal: mostly classic (7 prompts), every 3rd an endless prompt at a random depth.
    deals += 1
    if deals % 3 == 0:
        depth = random.choice([0, 500, 1500, 3000, 5000, 7000, 10000, 20000, 50000, 100000, 250000])
        st, d = req("/deal", {"mode": "endless", "depth": depth, "recent": recent})
        n = add(d["prompt"], d["ticket"], "endless", depth) if st == 200 and d.get("prompt") else 0
    else:
        st, d = req("/deal", {"mode": "classic", "recent": recent})
        n = sum(add(p, d["tickets"][p["id"]], "classic") for p in d.get("prompts", [])) if st == 200 else 0
    if st != 200:
        print("deal failed", st, d, flush=True)
        time.sleep(30)
    yields.append(n)
    if deals % 10 == 0:
        save()
        have = sum(1 for v in db.values() if v["answers"] is not None)
        print(f"deals={deals} prompts={len(db)} with_answers={have} pending={len(pending)} last40_new={sum(yields[-40:])}", flush=True)

save()
print("DONE", len(db), "prompts,", sum(1 for v in db.values() if v["answers"] is not None), "with answers", flush=True)
