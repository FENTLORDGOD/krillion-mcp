# krillion-mcp

MCP server for [Krillion](https://playdaily.org/krillion): give the rarest correct answer to an open prompt.
It calls the game's own JSON API (`/api/krillion/deal`, `/answer`, `/answers`, `/rooms`).

## Tools
| tool | what it does |
|---|---|
| `start_classic` | Deal 7 prompts (classic dive) |
| `endless_next` | Next prompt in Endless mode (`newRun: true` to restart) |
| `submit_answer` | `promptId` + `answer` → accepted?, tier, points |
| `pass_prompt` | Skip a prompt (costs a tank in Endless) |
| `crowd_answers` | What others answered (only after the prompt's clock runs out) |
| `status` | Score, depth, tanks, unanswered prompts |
| `live_rooms` | Players in each multiplayer room |

Tiers: plankton 4 · too clever 8 · schooler 16 · rare 32 · deep cut 64 · one in a krillion 100. Every point = 10 m.

## Install
```
cd krillion-mcp && npm install
```

Claude Code:
```
claude mcp add krillion -- node /absolute/path/to/krillion-mcp/index.js
```

Claude Desktop (`claude_desktop_config.json`):
```json
{ "mcpServers": { "krillion": { "command": "node", "args": ["/absolute/path/to/krillion-mcp/index.js"] } } }
```

Then ask: "Start a classic Krillion game and play it — aim for rare answers."

Requires Node 18+. Score is tracked per server session; it's not linked to a playdaily.org account.

## Dataset (`data/answers.json`)
Collected with `collect.py` (rate-limited) for a school project done with PlayDaily's permission.
Maps prompt id -> `{ text, cat, answers: [[tier, answer], ...] }`, tier 0 = plankton ... 5 = one in a krillion.
Finding: resubmitting an answer already at tier 5 scores one in a krillion; brand-new answers are judged on obscurity and usually land at deep cut.
The MCP server attaches known tier-5 answers (`krillionAnswers`) to each dealt prompt.

## Multiplayer room bot (`room-bot.cjs`)
For private rooms with people who know they're playing an AI.
```
npm install playwright && npx playwright install chromium
node room-bot.cjs --prompts 7      # create a private room, prints the 6-digit code
node room-bot.cjs 123456           # join an existing room by code
node room-bot.cjs --show           # visible browser window: watch it play live
```
Answers at a human pace by default: thinks for 25-60% of the clock, then types with natural gaps (finishes ~4s before time). `--fast` submits instantly.
Each prompt: types a known tier-5 answer, else tier-4, else tier-3. Prompts not in the dataset get a placeholder and usually miss.
Solo test: 6/7 one in a krillion.

## Desktop app (`app/`, Linux AppImage)
A GUI for the room bot. The bot plays in its own visible game window as a separate, named player.
- **Play tab:** create a private room or join by code, choose prompt count and pace (human or instant), then Start. Shows the room code, a live feed of prompts, answers and tiers, and a running score.
- **Dataset tab:** search prompts and see every recorded answer, coloured by tier.
- **HUD:** a small always-on-top panel showing the bot's state, current prompt, planned answer and score, with Pause / Take over / Start-Stop buttons. Drag it anywhere.
- **Hotkeys** (global, so they work while another window is focused):
  - `Ctrl+Alt+P` pause/resume: while paused the bot skips prompts
  - `Ctrl+Alt+T` take over: you type the bot's answer for the current or next prompt (box appears in the HUD)
  - `Ctrl+Alt+H` show/hide the HUD
  - `Ctrl+Alt+S` start/stop
  On a Steam Deck, map the back paddles to these key combos in Steam Input. Global hotkeys need X11 or XWayland; on pure Wayland desktops use the HUD buttons.
- **Unknown prompts:** borrows top-tier answers from the most similarly worded prompts; if the game refuses one it tries the next while time allows.

Run the AppImage: `chmod +x Krillion-Room-Bot-1.0.0-x86_64.AppImage && ./Krillion-Room-Bot-1.0.0-x86_64.AppImage`
Build it yourself: `cd app && npm install && npm run dist` (output in `app/dist/`). Run from source: `npm start`.
