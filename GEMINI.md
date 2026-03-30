# Gemini Telegram Relay — Setup Guide

> This guide helps you set up your personal AI assistant powered by Google Gemini.
> Configure everything step-by-step and confirm each part works before moving on.

## How This Works

This project turns Telegram into a personal AI assistant powered by Gemini.

1. **Telegram User** sends a message.
2. **Gemini Relay** (running on your computer or VPS) receives it.
3. **Gemini API** processes the request with your personal context and memory.
4. **Response** is sent back to your Telegram chat.

---

## Phase 1: Telegram Bot (~3 min)

**You need from the user:**
- A Telegram bot token from @BotFather
- Your personal Telegram user ID

**Setup Steps:**
1. Open Telegram, search for @BotFather, send `/newbot`.
2. Pick a display name and a username ending in "bot".
3. Copy the token BotFather gives you.
4. Get your user ID by messaging @userinfobot on Telegram.

**Configuration:**
1. Run `bun run setup` to install dependencies and create `.env` if it doesn't exist.
2. Save `TELEGRAM_BOT_TOKEN` and `TELEGRAM_USER_ID` in `.env`.
3. Run `bun run test:telegram` to verify — it sends a test message to you.

**Done when:** Test message arrives on Telegram.

---

## Phase 2: Gemini API (~2 min)

**You need:**
- A Google Gemini API Key

**Setup Steps:**
1. Go to [Google AI Studio](https://aistudio.google.com/).
2. Click "Get API key".
3. Create a new key in a new project.

**Configuration:**
1. Save `GEMINI_API_KEY` to `.env`.
2. Ensure `LLM_PROVIDER=gemini` is set (it is the default).

---

## Phase 3: Database & Memory — Supabase (~12 min)

Your bot's memory lives in Supabase: conversation history, facts, goals, and semantic search.

### Step 1: Create Supabase Project
1. Go to [supabase.com](https://supabase.com/), create a free account.
2. Create a new project (any name, any region close to you).
3. Wait ~2 minutes for it to provision.
4. Go to Project Settings > API.
5. Copy: Project URL and anon public key.
6. Save `SUPABASE_URL` and `SUPABASE_ANON_KEY` to `.env`.

### Step 2: Create Tables
1. Read `db/schema.sql`.
2. Paste the contents into the Supabase SQL Editor and run it.
3. Run `bun run test:supabase` to verify tables exist.

### Step 3: Set Up Semantic Search
1. The bot uses Gemini embeddings (`text-embedding-004`) for memory.
2. Deploy the Edge Functions in `supabase/functions/` (requires Supabase CLI).
3. Set up database webhooks as described in the course materials to trigger embedding generation on new messages.

---

## Phase 4: Personalize (~3 min)

1. Save `USER_NAME` and `USER_TIMEZONE` to `.env`.
2. Copy `config/profile.example.md` to `config/profile.md`.
3. Fill in `config/profile.md` with your details (work, constraints, preferences).

---

## Phase 5: Test & Launch

1. Launch the bot: `bun run start`.
2. Send a message to the bot on Telegram.
3. Confirm it responds and recalls your profile info.

> [!TIP]
> **For detailed usage instructions**, see the [USER_GUIDE.md](file:///c:/Github/godabot/claude-telegram-relay/USER_GUIDE.md).
> **For technical verification and health checks**, see the [TESTING_GUIDE.md](file:///c:/Github/godabot/claude-telegram-relay/TESTING_GUIDE.md).

---

## Phase 6: Always On (Background Service)

Make the bot run permanently in the background.

**macOS:**
```bash
bun run setup:launchd -- --service relay
```

**Linux/Windows:**
```bash
bun run setup:services -- --service relay
```

**Verify:** `npx pm2 status` (Windows/Linux) or `launchctl list | grep gemini` (macOS).

---

## Advanced Features

- **Voice Replies**: Enable with `/voice on`. Uses Gemini's native TTS.
- **Smart Check-ins**: Automated proactive messages based on your goals.
- **Multi-Agent Topics**: Use Telegram Forum mode to route tasks to specialized personas (Coder, Writer, etc.).

---

## Support & Course

Build your full AI infrastructure with the **Autonomee** course.
- YouTube: [youtube.com/@GodaGo](https://youtube.com/@GodaGo)
- Community: [skool.com/autonomee](https://skool.com/autonomee)
