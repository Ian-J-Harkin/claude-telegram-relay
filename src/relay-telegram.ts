/**
 * Claude Code Telegram Relay
 *
 * Telegram frontend for the Claude relay.
 * Imports shared logic from core.ts.
 *
 * Run: bun run src/relay-telegram.ts
 */

import { Bot, Context } from "grammy";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import {
  processMemoryIntents,
  getMemoryContext,
  getRelevantContext,
} from "./memory.ts";
import {
  BOT_TOKEN,
  ALLOWED_USER_ID,
  UPLOADS_DIR,
  supabase,
  callLLM,
  buildPrompt,
  splitResponse,
  saveMessage,
  acquireLock,
  releaseLock,
  setupLockCleanup,
  ensureDirectories,
  PROJECT_DIR,
  initSession,
} from "./core.ts";
import { generateProfile } from "./setup-profile.ts";
import { startScheduler, getScheduleConfig, updateScheduleConfig } from "./scheduler.ts";
import { textToSpeech, cleanupTTSFile, setVoice, getVoice, getAvailableVoices } from "./tts.ts";
import { processToolCalls } from "./tools.ts";
import { InputFile } from "grammy";

// ============================================================
// VOICE REPLY STATE
// ============================================================

let voiceReplyEnabled = (process.env.VOICE_REPLY_ENABLED || "false") === "true";

// ============================================================
// SETUP
// ============================================================

if (!BOT_TOKEN) {
  console.error("TELEGRAM_BOT_TOKEN not set!");
  console.log("\nTo set up:");
  console.log("1. Message @BotFather on Telegram");
  console.log("2. Create a new bot with /newbot");
  console.log("3. Copy the token to .env");
  process.exit(1);
}

await ensureDirectories();
await initSession("telegram");
setupLockCleanup("telegram");

if (!(await acquireLock("telegram"))) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

const bot = new Bot(BOT_TOKEN);

// ============================================================
// SECURITY: Only respond to authorized user
// ============================================================

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id.toString();

  if (ALLOWED_USER_ID && userId !== ALLOWED_USER_ID) {
    console.log(`Unauthorized: ${userId}`);
    await ctx.reply("This bot is private.");
    return;
  }

  await next();
});

// ============================================================
// MESSAGE HANDLERS
// ============================================================

// Profile setup command
bot.command("profile", async (ctx) => {
  const text = ctx.match;
  if (!text) {
    await ctx.reply(
      "To build your profile, please provide some background information after the command.\n\n" +
      "Example:\n`/profile I am Ian, my timezone is UTC, I work as a software engineer, and I prefer concise communication.`",
      { parse_mode: "Markdown" }
    );
    return;
  }
  
  await ctx.replyWithChatAction("typing");
  await ctx.reply("Generating your profile...");
  
  try {
    const profileMarkdown = await generateProfile(text);
    await ctx.reply(`*Profile Updated!*\n\n${profileMarkdown}`, { parse_mode: "Markdown" });
  } catch (error) {
    console.error("Profile generation error:", error);
    await ctx.reply("Could not generate profile. Check logs for details.");
  }
});

// Voice reply toggle command
bot.command("voice", async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();

  if (!arg) {
    await ctx.reply(
      `*Voice Replies*\n\n` +
      `Status: ${voiceReplyEnabled ? "ON 🔊" : "OFF 🔇"}\n` +
      `Voice: ${getVoice()}\n\n` +
      `*Commands:*\n` +
      `\`/voice on\` — enable voice replies\n` +
      `\`/voice off\` — disable voice replies\n` +
      `\`/voice [name]\` — change voice (${getAvailableVoices().join(", ")})`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (arg === "on") {
    voiceReplyEnabled = true;
    await ctx.reply("🔊 Voice replies enabled. I'll respond with audio after each message.");
  } else if (arg === "off") {
    voiceReplyEnabled = false;
    await ctx.reply("🔇 Voice replies disabled.");
  } else if (setVoice(arg)) {
    await ctx.reply(`✓ Voice changed to ${getVoice()}.`);
  } else {
    await ctx.reply(
      `Unknown voice. Available: ${getAvailableVoices().join(", ")}`,
    );
  }
});

// Schedule configuration command
bot.command("schedule", async (ctx) => {
  const text = ctx.match?.trim();
  
  if (!text) {
    const config = getScheduleConfig();
    await ctx.reply(
      `*Current Schedule*\n\n` +
      `Briefing: \`${config.briefingCron}\`\n` +
      `Check-ins: ${config.checkinsEnabled ? "ON" : "OFF"}\n\n` +
      `*Commands:*\n` +
      `\`/schedule briefing 8:30\` — change briefing time\n` +
      `\`/schedule checkins off\` — disable check-ins\n` +
      `\`/schedule checkins on\` — enable check-ins`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  const parts = text.split(/\s+/);
  
  if (parts[0] === "briefing" && parts[1]) {
    // Parse time like "8:30" or "9:00"
    const timeMatch = parts[1].match(/^(\d{1,2}):(\d{2})$/);
    if (!timeMatch) {
      await ctx.reply("Use format: `/schedule briefing 8:30`", { parse_mode: "Markdown" });
      return;
    }
    const newCron = `${timeMatch[2]} ${timeMatch[1]} * * 1-5`;
    updateScheduleConfig({ briefingCron: newCron });
    startScheduler(bot); // restart with new config
    await ctx.reply(`✓ Briefing rescheduled to ${parts[1]} on weekdays.`);
  } else if (parts[0] === "checkins") {
    const enabled = parts[1] !== "off";
    updateScheduleConfig({ checkinsEnabled: enabled });
    startScheduler(bot); // restart with new config
    await ctx.reply(`✓ Smart check-ins ${enabled ? "enabled" : "disabled"}.`);
  } else {
    await ctx.reply("Unknown option. Try `/schedule` for help.", { parse_mode: "Markdown" });
  }
});

// ============================================================
// LIVE PROGRESS & CONTROL
// ============================================================

// Keywords that hint at a complex query (triggers progress messages)
const COMPLEX_KEYWORDS = [
  "research", "summarize", "summarise", "compare", "analyze", "analyse",
  "explain", "review", "draft", "write", "create", "plan", "evaluate",
  "describe in detail", "break down", "list all",
];

function isComplexQuery(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.length > 80 || COMPLEX_KEYWORDS.some(k => lower.includes(k));
}

// Track in-flight request so we can cancel it on redirect
let currentAbort: AbortController | null = null;
let progressMessageId: number | null = null;
let progressChatId: number | null = null;

// Text messages
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  console.log(`Message: ${text.substring(0, 50)}...`);

  // Mid-task redirect: if something is already in-flight, cancel it
  if (currentAbort) {
    console.log("Mid-task redirect: cancelling previous request.");
    currentAbort.abort();
    currentAbort = null;
    // Delete the old progress message if it exists
    if (progressMessageId && progressChatId) {
      await bot.api.deleteMessage(progressChatId, progressMessageId).catch(() => {});
      progressMessageId = null;
    }
  }

  await ctx.replyWithChatAction("typing");

  // Show progress message for complex queries
  const complex = isComplexQuery(text);
  if (complex) {
    const msg = await ctx.reply("🔍 Working on it...");
    progressMessageId = msg.message_id;
    progressChatId = ctx.chat.id;
  }

  await saveMessage("user", text, "telegram");

  const abort = new AbortController();
  currentAbort = abort;

  try {
    const [relevantContext, memoryContext] = await Promise.all([
      getRelevantContext(supabase, text),
      getMemoryContext(supabase),
    ]);

    const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext);
    const rawResponse = await callLLM(enrichedPrompt, {
      resume: true,
      channel: "telegram",
      signal: abort.signal,
    });

    // If cancelled by a redirect, stop here
    if (abort.signal.aborted || rawResponse === "[CANCELLED]") {
      console.log("Request was cancelled, skipping response.");
      return;
    }

    let response = await processMemoryIntents(supabase, rawResponse);

    // Process [TOOL:] tags — execute tools and insert their output
    response = await processToolCalls(response, supabase);

    // Delete progress message
    if (progressMessageId && progressChatId) {
      await bot.api.deleteMessage(progressChatId, progressMessageId).catch(() => {});
      progressMessageId = null;
    }

    // Check for [ACTION:] tags — ask for confirmation instead of executing
    const actionMatch = response.match(/\[ACTION:\s*(.+?)\]/i);
    if (actionMatch) {
      const actionDesc = actionMatch[1];
      const cleanResponse = response.replace(/\[ACTION:\s*.+?\]/gi, "").trim();

      // Save what Gemini wanted to do
      await saveMessage("assistant", cleanResponse, "telegram");
      if (cleanResponse) {
        await sendResponse(ctx, cleanResponse);
      }

      // Send confirmation buttons
      await ctx.reply(`⚡ *Action required:* ${actionDesc}`, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "✅ Approve", callback_data: `action_approve:${actionDesc.substring(0, 50)}` },
              { text: "❌ Skip", callback_data: "action_skip" },
            ],
          ],
        },
      });
    } else {
      await saveMessage("assistant", response, "telegram");
      await sendResponse(ctx, response);
    }
  } catch (err: any) {
    if (err?.name === "AbortError") return;
    console.error("Text handler error:", err);
    await ctx.reply("Something went wrong processing your message.");
  } finally {
    currentAbort = null;
  }
});

// Voice messages
bot.on("message:voice", async (ctx) => {
  const voice = ctx.message.voice;
  console.log(`Voice message: ${voice.duration}s`);
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.getFile();
    const url = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`;
    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `voice_${timestamp}.ogg`);

    const response = await fetch(url);
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    await saveMessage("user", `[Voice message sent, duration: ${voice.duration}s]`, "telegram");

    const [relevantContext, memoryContext] = await Promise.all([
      getRelevantContext(supabase, "voice message"),
      getMemoryContext(supabase),
    ]);

    // Call-to-task: long voice messages (>15s) are treated as task dumps
    const isTaskDump = voice.duration > 15;
    const voiceInstruction = isTaskDump
      ? `[The user sent a long voice message (${voice.duration}s) as a task dump. ` +
        `Transcribe it, then extract all actionable items. For each task, include a [GOAL: task description] tag. ` +
        `Confirm the list of extracted tasks back to the user.]`
      : `[The user sent a voice message. Please transcribe and respond to it.]`;

    const enrichedPrompt = buildPrompt(
      voiceInstruction,
      relevantContext,
      memoryContext
    );
    const rawResponse = await callLLM(enrichedPrompt, { 
      resume: true, 
      channel: "telegram",
      audioPath: filePath 
    });
    
    await unlink(filePath).catch(() => {});
    
    const claudeResponse = await processMemoryIntents(supabase, rawResponse);

    await saveMessage("assistant", claudeResponse, "telegram");
    await sendResponse(ctx, claudeResponse);
  } catch (error) {
    console.error("Voice error:", error);
    await ctx.reply("Could not process voice message. Check logs for details.");
  }
});

// Photos/Images
bot.on("message:photo", async (ctx) => {
  console.log("Image received");
  await ctx.replyWithChatAction("typing");

  try {
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];
    const file = await ctx.api.getFile(photo.file_id);

    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `image_${timestamp}.jpg`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || "Analyze this image.";
    const prompt = `[Image: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Image]: ${caption}`, "telegram");

    const claudeResponse = await callLLM(prompt, { resume: true, channel: "telegram" });

    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);

    // IMAGE MEMORY: save the AI's description to Supabase for future recall
    if (supabase) {
      try {
        await supabase.from("memory").insert({
          type: "image",
          content: `Image from ${new Date().toLocaleDateString()}: ${cleanResponse.substring(0, 500)}`,
          metadata: { telegram_file_id: photo.file_id, caption },
        });
        console.log("Image description saved to memory.");
      } catch (memErr) {
        console.error("Image memory save error:", memErr);
      }
    }

    await saveMessage("assistant", cleanResponse, "telegram");
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Image error:", error);
    await ctx.reply("Could not process image.");
  }
});

// Documents
bot.on("message:document", async (ctx) => {
  const doc = ctx.message.document;
  console.log(`Document: ${doc.file_name}`);
  await ctx.replyWithChatAction("typing");

  try {
    const file = await ctx.getFile();
    const timestamp = Date.now();
    const fileName = doc.file_name || `file_${timestamp}`;
    const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

    const response = await fetch(
      `https://api.telegram.org/file/bot${BOT_TOKEN}/${file.file_path}`
    );
    const buffer = await response.arrayBuffer();
    await writeFile(filePath, Buffer.from(buffer));

    const caption = ctx.message.caption || `Analyze: ${doc.file_name}`;
    const prompt = `[File: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Document: ${doc.file_name}]: ${caption}`, "telegram");

    const claudeResponse = await callLLM(prompt, { resume: true, channel: "telegram" });

    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse, "telegram");
    await sendResponse(ctx, cleanResponse);
  } catch (error) {
    console.error("Document error:", error);
    await ctx.reply("Could not process document.");
  }
});

// ============================================================
// CALLBACK QUERIES (Inline Keyboard Actions)
// ============================================================

bot.callbackQuery(/^action_approve:(.+)$/, async (ctx) => {
  const actionDesc = ctx.match![1];
  await ctx.answerCallbackQuery("Approved!");
  await ctx.editMessageText(`✅ *Approved:* ${actionDesc}`, { parse_mode: "Markdown" });
  // Log the approval
  await saveMessage("user", `[APPROVED ACTION: ${actionDesc}]`, "telegram");
  console.log(`Action approved: ${actionDesc}`);
});

bot.callbackQuery("action_skip", async (ctx) => {
  await ctx.answerCallbackQuery("Skipped.");
  await ctx.editMessageText("❌ Action skipped.");
  console.log("Action skipped by user.");
});

// ============================================================
// HELPERS
// ============================================================

async function sendResponse(ctx: Context, response: string): Promise<void> {
  const chunks = splitResponse(response, 4000);
  for (const chunk of chunks) {
    await ctx.reply(chunk);
  }

  // If voice replies are enabled, also send as audio
  if (voiceReplyEnabled) {
    try {
      const audioPath = await textToSpeech(response);
      if (audioPath) {
        await ctx.replyWithAudio(new InputFile(audioPath), {
          title: "Voice Reply",
        });
        await cleanupTTSFile(audioPath);
      }
    } catch (err) {
      console.error("Voice reply TTS error:", err);
      // Silently fail — text was already sent
    }
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude Telegram Relay...");
console.log(`Authorized user: ${ALLOWED_USER_ID || "ANY (not recommended)"}`);
console.log(`Project directory: ${PROJECT_DIR || "(relay working directory)"}`);

bot.catch((err) => {
  console.error("Error in telegram bot:", err);
});

// Start background cron jobs
startScheduler(bot);

bot.start({
  onStart: () => {
    console.log("Bot is running!");
  },
});
