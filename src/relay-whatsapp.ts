/**
 * Claude Code WhatsApp Relay
 *
 * WhatsApp frontend for the Claude relay using whatsapp-web.js.
 * Imports shared logic from core.ts.
 *
 * First run: displays a QR code to scan with WhatsApp.
 * Subsequent runs: auto-reconnects via LocalAuth session persistence.
 *
 * Run: bun run src/relay-whatsapp.ts
 */

import pkg from "whatsapp-web.js";
const { Client, LocalAuth, MessageMedia } = pkg;
import * as qrcode from "qrcode-terminal";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";
import { transcribe } from "./transcribe.ts";
import {
  processMemoryIntents,
  getMemoryContext,
  getRelevantContext,
} from "./memory.ts";
import {
  UPLOADS_DIR,
  RELAY_DIR,
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
  USER_NAME,
  initSession,
} from "./core.ts";

// ============================================================
// WHATSAPP CONFIGURATION
// ============================================================

const WHATSAPP_ALLOWED_NUMBER = process.env.WHATSAPP_ALLOWED_NUMBER || "";

// Format the allowed number as a WhatsApp JID (e.g. "923001234567@c.us")
function getAllowedJid(): string {
  if (!WHATSAPP_ALLOWED_NUMBER) return "";
  const num = WHATSAPP_ALLOWED_NUMBER.replace(/[^0-9]/g, "");
  return `${num}@c.us`;
}

const ALLOWED_JID = getAllowedJid();

// ============================================================
// SETUP
// ============================================================

await ensureDirectories();
await initSession("whatsapp");
setupLockCleanup("whatsapp");

if (!(await acquireLock("whatsapp"))) {
  console.error("Could not acquire lock. Another instance may be running.");
  process.exit(1);
}

// ============================================================
// WHATSAPP CLIENT
// ============================================================

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: join(RELAY_DIR, "wwebjs_auth"),
  }),
  puppeteer: {
    headless: true, // Puppeteer headless flag is correct
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--no-first-run",
      "--disable-gpu",
      "--disable-software-rasterizer", // help prevent freeze on some windows machines
      "--mute-audio",
    ],
  },
});

// ============================================================
// AUTHENTICATION
// ============================================================

client.on("qr", (qr: string) => {
  console.log("\n📱 Scan this QR code with WhatsApp:\n");
  console.log("   Open WhatsApp → Settings → Linked Devices → Link a Device\n");
  qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
  console.log("✓ Authenticated successfully");
});

client.on("auth_failure", (msg: string) => {
  console.error("✗ Authentication failed:", msg);
  process.exit(1);
});

client.on("ready", () => {
  console.log("✓ WhatsApp client is ready!");
  console.log(
    `  Authorized number: ${ALLOWED_JID || "ANY (not recommended)"}`
  );
  console.log(
    `  Project directory: ${PROJECT_DIR || "(relay working directory)"}`
  );
  console.log("\n  Listening for messages...\n");
});

client.on("disconnected", (reason: string) => {
  console.log("Disconnected:", reason);
  releaseLock().then(() => process.exit(1));
});

// ============================================================
// SECURITY: Only respond to authorized number
// ============================================================

function isAuthorized(msg: any): boolean {
  // Ignore messages from groups
  if (msg.from.includes("@g.us")) return false;

  // Ignore status broadcasts
  if (msg.from === "status@broadcast") return false;

  // If no number restriction set, allow all private messages
  if (!ALLOWED_JID) return true;

  return msg.from === ALLOWED_JID;
}

// ============================================================
// MESSAGE HANDLER
// ============================================================

client.on("message_create", async (msg: any) => {
  // Only process incoming messages (not our own sent messages)
  if (msg.fromMe) return;

  if (!isAuthorized(msg)) {
    console.log(`Unauthorized: ${msg.from}`);
    return;
  }

  try {
    // Get the chat for typing indicator
    const chat = await msg.getChat();

    // Handle media messages
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();

      if (!media) {
        await msg.reply("Could not download media.");
        return;
      }

      // Voice/audio messages
      if (
        msg.type === "ptt" ||
        msg.type === "audio"
      ) {
        await handleVoice(msg, chat, media);
        return;
      }

      // Images
      if (msg.type === "image") {
        await handleImage(msg, chat, media);
        return;
      }

      // Documents
      if (msg.type === "document") {
        await handleDocument(msg, chat, media);
        return;
      }

      // Other media types — treat caption as text if present
      if (msg.body) {
        await handleText(msg, chat, msg.body);
        return;
      }

      await msg.reply(
        "I received media but I'm not sure how to handle this type. Try sending text, an image, a voice note, or a document."
      );
      return;
    }

    // Text messages
    if (msg.body) {
      await handleText(msg, chat, msg.body);
    }
  } catch (error) {
    console.error("Message handler error:", error);
    await msg.reply("Something went wrong. Check logs for details.").catch(() => {});
  }
});

// ============================================================
// HANDLERS
// ============================================================

async function handleText(msg: any, chat: any, text: string): Promise<void> {
  console.log(`Message: ${text.substring(0, 50)}...`);

  await chat.sendStateTyping();
  await saveMessage("user", text, "whatsapp");

  const [relevantContext, memoryContext] = await Promise.all([
    getRelevantContext(supabase, text),
    getMemoryContext(supabase),
  ]);

  const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext);
  const rawResponse = await callLLM(enrichedPrompt, { resume: true, channel: "whatsapp" });
  const response = await processMemoryIntents(supabase, rawResponse);

  await saveMessage("assistant", response, "whatsapp");
  await sendWhatsAppResponse(msg, chat, response);
}

async function handleVoice(
  msg: any,
  chat: any,
  media: any
): Promise<void> {
  console.log("Voice message received");
  await chat.sendStateTyping();

  if (!process.env.VOICE_PROVIDER) {
    await msg.reply(
      "Voice transcription is not set up yet. " +
        "Run the setup again and choose a voice provider (Groq or local Whisper)."
    );
    return;
  }

  try {
    const buffer = Buffer.from(media.data, "base64");
    const transcription = await transcribe(buffer);

    if (!transcription) {
      await msg.reply("Could not transcribe voice message.");
      return;
    }

    await saveMessage("user", `[Voice]: ${transcription}`, "whatsapp");

    const [relevantContext, memoryContext] = await Promise.all([
      getRelevantContext(supabase, transcription),
      getMemoryContext(supabase),
    ]);

    const enrichedPrompt = buildPrompt(
      `[Voice message transcribed]: ${transcription}`,
      relevantContext,
      memoryContext
    );
    const rawResponse = await callLLM(enrichedPrompt, { resume: true, channel: "whatsapp" });
    const claudeResponse = await processMemoryIntents(supabase, rawResponse);

    await saveMessage("assistant", claudeResponse, "whatsapp");
    await sendWhatsAppResponse(msg, chat, claudeResponse);
  } catch (error) {
    console.error("Voice error:", error);
    await msg.reply("Could not process voice message. Check logs for details.");
  }
}

async function handleImage(
  msg: any,
  chat: any,
  media: any
): Promise<void> {
  console.log("Image received");
  await chat.sendStateTyping();

  try {
    const timestamp = Date.now();
    const ext = media.mimetype?.split("/")[1] || "jpg";
    const filePath = join(UPLOADS_DIR, `image_${timestamp}.${ext}`);

    const buffer = Buffer.from(media.data, "base64");
    await writeFile(filePath, buffer);

    const caption = msg.body || "Analyze this image.";
    const prompt = `[Image: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Image]: ${caption}`, "whatsapp");

    const claudeResponse = await callLLM(prompt, { resume: true, channel: "whatsapp" });
    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse, "whatsapp");
    await sendWhatsAppResponse(msg, chat, cleanResponse);
  } catch (error) {
    console.error("Image error:", error);
    await msg.reply("Could not process image.");
  }
}

async function handleDocument(
  msg: any,
  chat: any,
  media: any
): Promise<void> {
  const fileName = media.filename || `file_${Date.now()}`;
  console.log(`Document: ${fileName}`);
  await chat.sendStateTyping();

  try {
    const timestamp = Date.now();
    const filePath = join(UPLOADS_DIR, `${timestamp}_${fileName}`);

    const buffer = Buffer.from(media.data, "base64");
    await writeFile(filePath, buffer);

    const caption = msg.body || `Analyze: ${fileName}`;
    const prompt = `[File: ${filePath}]\n\n${caption}`;

    await saveMessage("user", `[Document: ${fileName}]: ${caption}`, "whatsapp");

    const claudeResponse = await callLLM(prompt, { resume: true, channel: "whatsapp" });
    await unlink(filePath).catch(() => {});

    const cleanResponse = await processMemoryIntents(supabase, claudeResponse);
    await saveMessage("assistant", cleanResponse, "whatsapp");
    await sendWhatsAppResponse(msg, chat, cleanResponse);
  } catch (error) {
    console.error("Document error:", error);
    await msg.reply("Could not process document.");
  }
}

// ============================================================
// RESPONSE HELPER
// ============================================================

async function sendWhatsAppResponse(
  msg: any,
  chat: any,
  response: string
): Promise<void> {
  await chat.clearState();

  const chunks = splitResponse(response, 4000);
  for (const chunk of chunks) {
    await msg.reply(chunk);
  }
}

// ============================================================
// START
// ============================================================

console.log("Starting Claude WhatsApp Relay...");
console.log("Initializing WhatsApp Web client...\n");

client.initialize();
