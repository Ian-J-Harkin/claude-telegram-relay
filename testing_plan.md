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

## 3. Background Services (Next Up)
- **Goal:** Make the bot "Always On" running quietly in the background, restarting automatically on crash or reboot.
- **Plan:** We will simplify the PM2 deployment. Instead of running three separate scripts (relay, checkin, briefing), we will run a single `claude-telegram-relay` PM2 process that handles both the messaging and the built-in cron scheduling.

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
