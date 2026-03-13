# Testing Plan & Walkthrough

This document tracks our progress in testing features from the guide and adapting them to use the Gemini Relay instead of Claude Code.

## 1. Core Messaging & Memory (Completed in Code)
- **Text Messaging:** Users can send text; bot replies using Gemini (`gemini-2.5-flash`).
- **Voice Messages:** Users can send voice; bot transcribes and responds using Gemini.
- **Photos/Images:** Users can send photos; Gemini analyzes them.
- **Documents:** Users can send files; Gemini reads the content.
- **Goals & Facts:** Supported natively. `[REMEMBER: fact]` and `[GOAL: text]` tags save data to Supabase Edge Functions (using Gemini embeddings `text-embedding-004`).
- **Semantic Search:** Bot can search by meaning for past memory context.

## 2. Interactive Profile & Smart Check-ins (Completed in Code)
Since we bypassed Claude Code for a more direct integration, these features are now native to the Relay:
- **Profile Generation:** We added a `/profile` command. Example: `/profile I am a software engineer in UTC.` This generates `config/profile.md` using Gemini.
- **Smart Check-ins & Morning Briefings:** Integrated via `node-cron` in `src/scheduler.ts`. 
  - Morning Briefings run at 9:00 AM weekdays.
  - Smart Check-ins evaluate at 10:30, 12:00, 14:00, 16:00, and 18:00 on weekdays to send proactive messages based on goals/context.

## 3. Background Services (Completed in Code)
- **Goal:** Make the bot "Always On" running quietly in the background, restarting automatically on crash or reboot.
- **What was done:** Simplified the `setup/configure-services.ts` (Windows/Linux) and `setup/configure-launchd.ts` (macOS) scripts to run a single `claude-telegram-relay` PM2 process. Since `node-cron` is already built into the relay, the scheduler runs automatically inside the same process — no separate checkin or briefing scripts needed.

## 4. Smarter Proactive AI (Completed in Code)
- **Decision framework:** Check-ins now evaluate 4 triggers before calling Gemini — deadline proximity (<48h), active goal count (≥3), user message activity today, and time since last bot message. If no triggers fire, the LLM call is skipped entirely.
- **Enriched briefings:** Morning briefings now include deadline status (OVERDUE / DUE TODAY / Xh left).
- **`/schedule` command:** View current config, change briefing time (`/schedule briefing 8:30`), or toggle check-ins (`/schedule checkins off`).

## 5. Live Progress & Control (Completed in Code)
- **Progress messages:** Complex queries show a "🔍 Working on it..." message that auto-deletes when the response arrives. Simple messages respond instantly.
- **Mid-task redirect:** Sending a new message while Gemini is thinking cancels the previous request (via AbortController) and starts the new one.
- **[ACTION:] confirmation:** When Gemini suggests a side-effect action, it uses `[ACTION: description]` tags. The user sees inline buttons (✅ Approve / ❌ Skip) and must confirm before anything executes.

## 6. Voice Replies & Proactive Voice (Completed in Code)
- **Voice replies:** When enabled via `/voice on`, the bot sends an audio version of every response alongside the text. Uses Gemini's native TTS model (`gemini-2.5-flash-preview-tts`) — no additional API keys needed.
- **Voice selection:** 5 built-in voices (Kore, Charon, Fenrir, Aoede, Puck) configurable via `/voice [name]`.
- **Call-to-task:** Voice messages longer than 15 seconds are treated as "task dumps" — Gemini extracts actionable items and saves each as a `[GOAL:]` automatically.
- **Proactive voice alerts:** When a scheduled check-in detects an urgent deadline (<4 hours away), the bot sends the check-in as a voice message in addition to text.

## 7. Image Memory & Tool Integrations (Completed in Code)
- **Image memory:** When you send a photo, Gemini's description is saved to Supabase `memory` table (type: `image`) with the Telegram `file_id` as metadata. Ask about past images weeks later — the bot finds them by meaning.
- **Tools framework:** Plugin-based system in `src/tools.ts`. Gemini uses `[TOOL: name | args]` tags to invoke tools. Two built-in tools:
  - `web_search` — searches DuckDuckGo for current information
  - `save_note` — saves a structured note to memory
- **Extensible:** New tools can be added via `registerTool()` with a name, description, and execute function.

## 8. Multi-Agent Topics (Completed in Code)
- **Agent personas:** 5 built-in agents (General 🤖, Coder 💻, Writer ✍️, Researcher 🔍, Coach 🎯) each with a custom system prompt in `config/agents.json`.
- **Forum topic routing:** When using a Telegram Group set to Forum mode, messages in a topic named "Coder" are handled by the Coder agent, "Writer" by the Writer, etc.
- **`/board` command:** Runs a "board meeting" — all agents weigh in on a topic in parallel and return their unique perspectives.
- **Extensible:** Add new agents by editing `config/agents.json`.

## 9. VPS Deployment (TODO — Deferred)

**Status:** On hold. The bot currently runs locally and that works for personal use.

### What it would include
- [ ] **Deploy script** (`setup/deploy-vps.sh`) — automate: clone repo, install Bun, copy `.env`, install deps, set up PM2 with auto-start on reboot
- [ ] **Model tier routing** — env var `GEMINI_MODEL_TIER` to switch between Flash (fast/cheap) and Pro (smarter/expensive) based on query complexity
- [ ] **`/usage` command** — track approximate API token usage per day/month and display in Telegram

### Pros
- ✅ Bot runs 24/7 without your machine needing to stay on
- ✅ Much lower latency (cloud server closer to Telegram/Gemini endpoints)
- ✅ Survives reboots, power outages, ISP issues automatically
- ✅ Professional deployment — ready for production use

### Cons
- ❌ Adds ~$5-10/month for a VPS (Hetzner, DigitalOcean, Linode, etc.)
- ❌ Another system to maintain (security updates, monitoring)
- ❌ Slightly more complex debugging (SSH vs local terminal)
- ❌ Secrets management on a remote server (`.env` file)

### Things to consider before building
1. **Is it needed yet?** Your bot runs fine locally via `bun run src/relay-telegram.ts`. If your machine is generally on, this works fine for personal use.
2. **VPS vs platform** — a VPS script works anywhere (Hetzner, DO, Linode), but platforms like Railway or Fly.io offer simpler deploys. Worth deciding which.
3. **Model tier routing** — currently we use `gemini-2.5-flash` for everything. Only add Pro routing if you start hitting quality limits on complex prompts.
4. **Git simplifies deploys** — with the repo on GitHub, you can just `git pull && pm2 restart` on the VPS. The deploy script mainly automates first-time setup.

--- 

## MANUAL TESTING CHECKLIST

**Where to test:** Open the Telegram app (on your phone or desktop) and go to the direct message chat with the bot you created via BotFather. Make sure the `bun run src/relay-telegram.ts` command is still running in your computer's terminal.

Try doing each of the following inside the chat with your bot. Let me know if any of them fail!

### Profile Setup
- [x] In the Telegram chat with your bot, type the `/profile` command followed by your background information. For example: `/profile I am Ian, my timezone is GMT, I work as an editor, and I prefer concise communication.`
- [x] Confirm the bot responds saying your profile was updated.

### Basic Modalities
- [ ] **Send Text:** Send "Hello" or "Are you there?" to see a classic response.
- [x] **Send limits (Image):** Send a photo. Ask the bot "What is in this picture?"
  *Note for future improvement: Gemini vision model incorrectly identified a croissant as a giant panda due to a tree in the background. We should consider passing higher resolution images or experimenting with different Gemini vision modes in the future.*
- [x] **Send Voice:** Hold your microphone button on Telegram, speak a sentence, and send it. Check if the bot transcribes and responds correctly.
- [ ] **Send Document:** Send a PDF, CSV, code file, or text document and ask it to summarize the file.

### Memory & Facts
- [ ] **Tell it a fact:** Say "I live in Berlin" or "My daughter's name is Mija." Wait for a response.
- [ ] **Set a goal:** Say "My goal is to launch my website by Friday." Wait for a response.
- [ ] **Recall meaning/semantic search:** Open a *new* chat message later (or close the app and come back), and ask "What did we talk about yesterday?" or "Do you remember where I live?" Observe if it correctly queries Supabase and recalls the facts.

### Smarter Proactive AI
- [ ] **View schedule:** Type `/schedule` — confirm it shows current briefing time and check-in status.
- [ ] **Change briefing time:** Type `/schedule briefing 8:30` — confirm it responds with "✓ Briefing rescheduled to 8:30 on weekdays."
- [ ] **Toggle check-ins:** Type `/schedule checkins off` — confirm response. Then `/schedule checkins on` to re-enable.

### Live Progress & Control
- [ ] **Progress message:** Send a complex query like *"Research the best practices for TypeScript project structure and summarize them"* — you should see "🔍 Working on it..." appear and auto-delete once the answer arrives.
- [ ] **Mid-task redirect:** Send a complex query, then quickly send *"Actually, just tell me a joke instead."* — you should get only the joke, not the original response.
- [ ] **Action confirmation:** Ask the bot to do something like *"Draft an email to my colleague about the project deadline and send it."* — you should see inline ✅ Approve / ❌ Skip buttons.

### Voice Replies
- [ ] **Check status:** Type `/voice` — confirm it shows current status (ON/OFF) and voice name.
- [ ] **Enable voice:** Type `/voice on` — confirm it responds "🔊 Voice replies enabled."
- [ ] **Test voice reply:** Send any text message — confirm you receive both a text reply AND an audio file.
- [ ] **Change voice:** Type `/voice puck` — confirm it responds "✓ Voice changed to Puck."
- [ ] **Disable voice:** Type `/voice off` — confirm audio stops.
- [ ] **Call-to-task:** Record a voice message longer than 15 seconds describing several tasks. Confirm the bot transcribes and extracts goals from it.

### Image Memory & Tools
- [ ] **Image memory:** Send a photo with the caption *"Remember this."* Then later ask *"What photos have I sent you?"* — the bot should recall the image description from memory.
- [ ] **Web search:** Ask *"Search the web for the latest TypeScript release notes"* — the bot should use the `web_search` tool and return results.
- [ ] **Save note:** Say *"Save a note: Meeting with Sarah moved to Thursday at 3pm"* — the bot should save it to memory.

### Multi-Agent Topics
- [ ] **View agents:** Type `/board` — confirm it lists all available agents with emojis.
- [ ] **Board meeting:** Type `/board Should I learn Rust or Go next?` — confirm all 5 agents respond with their unique perspectives.
- [ ] **Forum topics (optional):** If you have a Telegram Group set to Forum mode, create topics named "Coder", "Writer", etc. Send a message in each — confirm the agent persona matches the topic name.

### Background Services (Always On)

These steps make the bot run permanently in the background, surviving terminal closes, crashes, and reboots.

**Step 1: Install PM2** (only needed once)

In a PowerShell window, run:
```
npm install -g pm2
```

**Step 2: Start the background service**

```
bun run setup:services
```

This runs `setup/configure-services.ts`, which:
- Stops any previous instance of `claude-telegram-relay`
- Launches a new one via PM2 using `bun` as the interpreter
- Saves the config to survive reboots

- [ ] Confirm the output shows: `✓ claude-telegram-relay started — Main bot (always running)`

**Step 3: Verify it's running**

```
npx pm2 status
```

- [ ] Confirm one row with name `claude-telegram-relay` and status `online`.

**Step 4: Enable auto-start on reboot** (run once, as Administrator)

```
npx pm2 startup
```

PM2 will print a command to run. Copy and paste that into an Administrator PowerShell to register auto-start with Windows.

**Step 5: Send a message from Telegram to confirm the background bot is alive.**

- [ ] Close your terminal window entirely so `bun run src/relay-telegram.ts` is no longer running.
- [ ] Send a Telegram message to your bot.
- [ ] Confirm the bot still responds (it's now running via PM2, not your terminal).

---

**Troubleshooting: `EPERM` error on Windows**

If `npx pm2 status` or `bun run setup:services` throws:
```
connect EPERM //./pipe/rpc.sock
```

This happens when a previous PM2 daemon was started by a different user or Administrator session, locking the socket. Fix:

1. Open **PowerShell as Administrator**
2. Run `npx pm2 kill` to forcibly stop the stuck daemon
3. Close the Administrator window
4. Return to your normal terminal and re-run `bun run setup:services`

