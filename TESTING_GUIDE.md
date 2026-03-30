# Gemini Telegram Relay — Technical Testing & Startup Guide

This guide ensures your environment is ready, the bot is running, and all features are functioning correctly.

---

## 1. Automated Health Check (Start Here)
Before running the bot, verify your configuration and external dependencies:

```bash
bun run setup:verify
```

**What this checks:**
- [ ] **Files**: Presence of `.env` and `node_modules`.
- [ ] **Telegram**: Validates your bot token and user ID against the Telegram API.
- [ ] **Supabase**: Verifies that `messages`, `memory`, and `logs` tables are reachable.
- [ ] **Branding**: Confirms services are correctly labeled under "Gemini".

**If you see ✗ FAIL:** Fix the reported `.env` variable before proceeding to the next step.

---

## 2. Starting the System

### Manual Startup (Verification Mode)
Use this to see real-time error messages in your terminal:
```bash
bun run start
```
**Expected Output:**
- `Starting Gemini Telegram Relay...`
- `LLM Provider: gemini`
- `Bot @YourBotName is online.`

### Background Services (Always On)
Once you've verified everything works manually, use these commands for production:

**Windows/Linux (PM2):** `bun run setup:services`
**macOS (launchd):** `bun run setup:launchd`

---

## 3. End-to-End Test Suite (Manual Verification)

Perform these tests in order to confirm specialized logic (Vision, Voice, Memory) is active.

### Test A: Core Logic & Context
- **Action**: Send `Who are you and what time is it?`
- **Expected**: Bot identifies as your assistant and reports the correct local time.

### Test B: Gemini Vision (Native)
- **Action**: Send a photo of an object with the caption `What color is this?`
- **Expected**: Bot analyzes the image correctly.
- **Check Terminal**: You should see `Uploading image to Gemini...`.

### Test C: Long-Term Memory (Supabase)
- **Action 1**: Send `Remember that my car is a silver Honda.`
- **Action 2**: Send `What kind of car do I have?`
- **Expected**: Bot recalls "Silver Honda."

### Test D: Voice Transcription
- **Action**: Send a short voice message.
- **Expected**: Bot transcribes and responds to the audio content.

### Test E: Multi-Agent Board Meeting
- **Action**: Send `/board Should I start a YouTube channel?`
- **Expected**: Multiple agents (Researcher, Strategy, etc.) respond sequentially.

---

## 4. Troubleshooting Flowchart

| Symptom | Primary Suspect | Fix |
|---|---|---|
| Bot is offline | `TELEGRAM_BOT_TOKEN` | Check @BotFather token in `.env`. |
| "Worked on it" but no answer | `GEMINI_API_KEY` | Ensure key has billing/quota in AI Studio. |
| Memory doesn't work | `SUPABASE_ANON_KEY` | Verify project URL and key. |
| Voice messages fail | `ffmpeg` | Install via `brew install ffmpeg` or `apt-get`. |

### Still Stuck?
Run `bun run test:telegram` to send a direct ping to your account. If the ping arrives but the bot doesn't respond to messages, check the `ALLOWED_USER_ID` filter in `.env`.
