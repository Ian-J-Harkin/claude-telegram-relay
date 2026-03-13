/**
 * Shared Core Module
 *
 * Platform-agnostic logic shared between Telegram and WhatsApp relays.
 * Contains: Claude CLI invocation, prompt building, session/lock management,
 * Supabase client setup, and message saving.
 */

import { spawn } from "bun";
import { writeFile, mkdir, readFile, unlink } from "fs/promises";
import { unlinkSync } from "fs";
import { join, dirname } from "path";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { GoogleGenAI } from "@google/genai";
import { getToolDescriptions } from "./tools.ts";

export const PROJECT_ROOT = dirname(dirname(import.meta.path));

// ============================================================
// CONFIGURATION (exported for relay modules)
// ============================================================

export const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
export const ALLOWED_USER_ID = process.env.TELEGRAM_USER_ID || "";

export const LLM_PROVIDER = process.env.LLM_PROVIDER || "claude"; // "claude" or "gemini"
export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
export const CLAUDE_PATH = process.env.CLAUDE_PATH || (process.platform === "win32" ? "claude.cmd" : "claude");

export const PROJECT_DIR = process.env.PROJECT_DIR || "";
export const RELAY_DIR =
  process.env.RELAY_DIR || join(process.env.HOME || "~", ".claude-relay");

export const TEMP_DIR = join(RELAY_DIR, "temp");
export const UPLOADS_DIR = join(RELAY_DIR, "uploads");

export const USER_NAME = process.env.USER_NAME || "";
export const USER_TIMEZONE =
  process.env.USER_TIMEZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;

// ============================================================
// SESSION MANAGEMENT
// ============================================================

export interface SessionState {
  sessionId: string | null;
  lastActivity: string;
}

export async function loadSession(channel: string = "telegram"): Promise<SessionState> {
  const sessionFile = join(RELAY_DIR, `${channel}_session.json`);
  try {
    const content = await readFile(sessionFile, "utf-8");
    return JSON.parse(content);
  } catch {
    return { sessionId: null, lastActivity: new Date().toISOString() };
  }
}

export async function saveSession(state: SessionState, channel: string = "telegram"): Promise<void> {
  const sessionFile = join(RELAY_DIR, `${channel}_session.json`);
  await writeFile(sessionFile, JSON.stringify(state, null, 2));
}

// Mutable session state — shared across the relay, initialized per channel
export const sessions: Record<string, SessionState> = {};

export async function initSession(channel: string): Promise<SessionState> {
  sessions[channel] = await loadSession(channel);
  return sessions[channel];
}

// ============================================================
// LOCK FILE (prevent multiple instances)
// ============================================================

export async function acquireLock(channel: string = "telegram"): Promise<boolean> {
  const lockFile = join(RELAY_DIR, `${channel}.lock`);
  try {
    const existingLock = await readFile(lockFile, "utf-8").catch(() => null);

    if (existingLock) {
      const pid = parseInt(existingLock);
      try {
        process.kill(pid, 0);
        console.log(`Another instance running (PID: ${pid})`);
        return false;
      } catch {
        console.log("Stale lock found, taking over...");
      }
    }

    await writeFile(lockFile, process.pid.toString());
    return true;
  } catch (error) {
    console.error("Lock error:", error);
    return false;
  }
}

export async function releaseLock(channel: string = "telegram"): Promise<void> {
  const lockFile = join(RELAY_DIR, `${channel}.lock`);
  await unlink(lockFile).catch(() => {});
}

export function setupLockCleanup(channel: string = "telegram"): void {
  const lockFile = join(RELAY_DIR, `${channel}.lock`);
  process.on("exit", () => {
    try {
      unlinkSync(lockFile);
    } catch {}
  });
  process.on("SIGINT", async () => {
    await releaseLock(channel);
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await releaseLock(channel);
    process.exit(0);
  });
}

// ============================================================
// DIRECTORIES
// ============================================================

export async function ensureDirectories(): Promise<void> {
  await mkdir(TEMP_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
}

// ============================================================
// SUPABASE
// ============================================================

export const supabase: SupabaseClient | null =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

export async function saveMessage(
  role: string,
  content: string,
  channel: string = "telegram",
  metadata?: Record<string, unknown>
): Promise<void> {
  if (!supabase) return;
  try {
    await supabase.from("messages").insert({
      role,
      content,
      channel,
      metadata: metadata || {},
    });
  } catch (error) {
    console.error("Supabase save error:", error);
  }
}

// ============================================================
// PROFILE
// ============================================================

let profileContext = "";
try {
  profileContext = await readFile(
    join(PROJECT_ROOT, "config", "profile.md"),
    "utf-8"
  );
} catch {
  // No profile yet — that's fine
}

// ============================================================
// CORE: Call Claude CLI
// ============================================================

export async function callLLM(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; audioPath?: string; channel?: string; signal?: AbortSignal }
): Promise<string> {
  if (LLM_PROVIDER === "gemini") {
    return callGemini(prompt, options);
  } else {
    return callClaude(prompt, options);
  }
}

export async function callGemini(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; audioPath?: string; channel?: string; signal?: AbortSignal }
): Promise<string> {
  const channel = options?.channel || "telegram";
  const session = sessions[channel];
  
  if (!GEMINI_API_KEY) {
    return "Error: GEMINI_API_KEY is not set in environment.";
  }

  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
  console.log(`Calling Gemini: ${prompt.substring(0, 50)}...`);

  try {
    let parts: any[] = [{ text: prompt }];

    if (options?.audioPath) {
      console.log(`Uploading audio to Gemini: ${options.audioPath}`);
      const fileManager = ai.files;
      const uploadedFile = await fileManager.upload({
        file: options.audioPath,
        config: { mimeType: "audio/ogg" },
      });
      parts.unshift({
        fileData: {
          fileUri: uploadedFile.uri,
          mimeType: uploadedFile.mimeType || "audio/ogg",
        },
      });
    }

    // Check if request was cancelled before making API call
    if (options?.signal?.aborted) {
      return "[CANCELLED]";
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: parts,
    });
    
    // Process session timestamp for UI purposes
    if (session) {
      session.lastActivity = new Date().toISOString();
      await saveSession(session, channel);
    }
    
    return response.text || "";
  } catch (error) {
    console.error("Gemini error:", error);
    return `Error: Could not run Gemini API`;
  }
}

export async function callClaude(
  prompt: string,
  options?: { resume?: boolean; imagePath?: string; channel?: string }
): Promise<string> {
  const channel = options?.channel || "telegram";
  const session = sessions[channel];
  
  const args = [CLAUDE_PATH, "-p", prompt];

  if (options?.resume && session?.sessionId) {
    args.push("--resume", session.sessionId);
  }

  args.push("--output-format", "text");

  console.log(`Calling Claude: ${prompt.substring(0, 50)}...`);

  try {
    const proc = spawn(args, {
      stdin: "ignore", // Prevent halting for input
      stdout: "pipe",
      stderr: "pipe",
      cwd: PROJECT_DIR || undefined,
      env: {
        ...process.env,
      },
    });

    const output = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error("Claude error:", stderr);
      return `Error: ${stderr || "Claude exited with code " + exitCode}`;
    }

    // Extract session ID from output if present (for --resume)
    const sessionMatch = output.match(/Session ID: ([a-f0-9-]+)/i);
    if (sessionMatch && session) {
      session.sessionId = sessionMatch[1];
      session.lastActivity = new Date().toISOString();
      await saveSession(session, channel);
    }

    return output.trim();
  } catch (error) {
    console.error("Spawn error:", error);
    return `Error: Could not run Claude CLI`;
  }
}

// ============================================================
// PROMPT BUILDING
// ============================================================

export function buildPrompt(
  userMessage: string,
  relevantContext?: string,
  memoryContext?: string
): string {
  const now = new Date();
  const timeStr = now.toLocaleString("en-US", {
    timeZone: USER_TIMEZONE,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const parts = [
    "You are a personal AI assistant responding via messaging. Keep responses concise and conversational.",
  ];

  if (USER_NAME) parts.push(`You are speaking with ${USER_NAME}.`);
  parts.push(`Current time: ${timeStr}`);
  if (profileContext) parts.push(`\nProfile:\n${profileContext}`);
  if (memoryContext) parts.push(`\n${memoryContext}`);
  if (relevantContext) parts.push(`\n${relevantContext}`);

  parts.push(
    "\nMEMORY MANAGEMENT:" +
      "\nWhen the user shares something worth remembering, sets goals, or completes goals, " +
      "include these tags in your response (they are processed automatically and hidden from the user):" +
      "\n[REMEMBER: fact to store]" +
      "\n[GOAL: goal text | DEADLINE: optional date]" +
      "\n[DONE: search text for completed goal]" +
      "\n\nACTION CONFIRMATION:" +
      "\nWhen you are about to do something significant (send an email, schedule a meeting, update a document, " +
      "modify data), wrap the action in an [ACTION: description] tag instead of doing it directly. " +
      "The user will be asked to approve or skip. Only use this for actions with real side-effects, not for normal responses." +
      "\n\nTOOL USAGE:" +
      "\nYou have access to tools. To use a tool, include [TOOL: tool_name | arguments] in your response. " +
      "The tool will execute and the result will replace the tag in the message sent to the user." +
      "\n" + getToolDescriptions() +
      "\n\nIMAGE MEMORY:" +
      "\nWhen the user asks about a photo or image they sent previously, check the memory context for entries " +
      "with type 'image'. These contain AI-generated descriptions of past images the user has sent."
  );

  parts.push(`\nUser: ${userMessage}`);

  return parts.join("\n");
}

// ============================================================
// RESPONSE SPLITTING
// ============================================================

/**
 * Split a long response into chunks at natural boundaries.
 * @param response The full response text
 * @param maxLength Maximum characters per chunk (default 4000)
 * @returns Array of string chunks
 */
export function splitResponse(response: string, maxLength: number = 4000): string[] {
  if (response.length <= maxLength) {
    return [response];
  }

  const chunks: string[] = [];
  let remaining = response;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf("\n\n", maxLength);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf("\n", maxLength);
    if (splitIndex === -1) splitIndex = remaining.lastIndexOf(" ", maxLength);
    if (splitIndex === -1) splitIndex = maxLength;

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trim();
  }

  return chunks;
}
