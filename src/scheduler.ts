import cron from "node-cron";
import { Bot, InputFile } from "grammy";
import { supabase, callLLM, buildPrompt, saveMessage } from "./core.ts";
import { getMemoryContext } from "./memory.ts";
import { textToSpeech, cleanupTTSFile } from "./tts.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// DECISION FRAMEWORK — Should we bother the user?
// ============================================================

interface TriggerResult {
  shouldFire: boolean;
  reasons: string[];
}

async function evaluateTriggers(sb: SupabaseClient): Promise<TriggerResult> {
  const reasons: string[] = [];

  try {
    // 1. Check for approaching deadlines (within 48 hours)
    const { data: goals } = await sb.rpc("get_active_goals");
    if (goals?.length) {
      const now = Date.now();
      const FORTY_EIGHT_HOURS = 48 * 60 * 60 * 1000;
      for (const g of goals) {
        if (g.deadline) {
          const deadline = new Date(g.deadline).getTime();
          const hoursLeft = Math.round((deadline - now) / (60 * 60 * 1000));
          if (deadline - now <= FORTY_EIGHT_HOURS && deadline > now) {
            reasons.push(`Goal "${g.content}" has a deadline in ~${hoursLeft} hours.`);
          }
        }
      }
      // 2. Count unresolved goals — if there are several, that's worth noting
      if (goals.length >= 3) {
        reasons.push(`There are ${goals.length} active goals.`);
      }
    }

    // 3. Check recent message activity — if user has been chatting today, they're engaged
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const { count } = await sb
      .from("messages")
      .select("*", { count: "exact", head: true })
      .eq("role", "user")
      .gte("created_at", today.toISOString());

    if (count && count > 0) {
      reasons.push(`User has sent ${count} message(s) today (active engagement).`);
    }

    // 4. Check when the bot last messaged the user
    const { data: lastBotMsg } = await sb
      .from("messages")
      .select("created_at")
      .eq("role", "assistant")
      .order("created_at", { ascending: false })
      .limit(1);

    if (lastBotMsg?.[0]) {
      const hoursSinceLastMsg = (Date.now() - new Date(lastBotMsg[0].created_at).getTime()) / (60 * 60 * 1000);
      if (hoursSinceLastMsg > 6) {
        reasons.push(`It's been ${Math.round(hoursSinceLastMsg)} hours since the last bot message.`);
      }
    }
  } catch (err) {
    console.error("Trigger evaluation error:", err);
  }

  return {
    shouldFire: reasons.length > 0,
    reasons,
  };
}

// ============================================================
// ENRICHED CONTEXT — Feed structured data into prompts
// ============================================================

async function getEnrichedContext(sb: SupabaseClient): Promise<string> {
  const memoryContext = await getMemoryContext(sb);

  // Add deadline proximity info
  let deadlineInfo = "";
  try {
    const { data: goals } = await sb.rpc("get_active_goals");
    if (goals?.length) {
      const now = Date.now();
      const withDeadlines = goals
        .filter((g: any) => g.deadline)
        .map((g: any) => {
          const hoursLeft = Math.round(
            (new Date(g.deadline).getTime() - now) / (60 * 60 * 1000)
          );
          const status = hoursLeft < 0 ? "OVERDUE" : hoursLeft < 24 ? "DUE TODAY" : `${hoursLeft}h left`;
          return `- ${g.content} [${status}]`;
        });
      if (withDeadlines.length) {
        deadlineInfo = "\n\nDEADLINE STATUS:\n" + withDeadlines.join("\n");
      }
    }
  } catch {}

  return memoryContext + deadlineInfo;
}

// ============================================================
// SCHEDULER — Configurable CRON jobs
// ============================================================

// Default schedule (can be overridden via /schedule command)
let briefingCron = process.env.BRIEFING_CRON || "0 9 * * 1-5";
let checkinsEnabled = (process.env.CHECKINS_ENABLED || "true") === "true";

// Store active cron tasks so we can restart them
let activeTasks: ReturnType<typeof cron.schedule>[] = [];

export function getScheduleConfig() {
  return { briefingCron, checkinsEnabled };
}

export function updateScheduleConfig(opts: { briefingCron?: string; checkinsEnabled?: boolean }) {
  if (opts.briefingCron !== undefined) briefingCron = opts.briefingCron;
  if (opts.checkinsEnabled !== undefined) checkinsEnabled = opts.checkinsEnabled;
}

export function startScheduler(bot: Bot) {
  const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
  if (!TELEGRAM_USER_ID) {
    console.warn("No TELEGRAM_USER_ID set, scheduler will not send messages.");
    return;
  }

  // Stop any existing tasks before restarting
  activeTasks.forEach(t => t.stop());
  activeTasks = [];

  // ---- Morning Briefing ----
  const briefingTask = cron.schedule(briefingCron, async () => {
    console.log("Running Morning Briefing...");
    try {
      if (!supabase) return;
      const enrichedContext = await getEnrichedContext(supabase);
      const prompt = buildPrompt(
        "Generate my morning briefing. Include:\n" +
        "1. Active goals and their deadline status (overdue, due today, upcoming)\n" +
        "2. A short prioritised to-do list for today\n" +
        "3. Any unresolved items from recent conversations\n" +
        "Keep it concise, structured, and actionable.",
        "",
        enrichedContext
      );

      const response = await callLLM(prompt, { channel: "telegram" });
      await bot.api.sendMessage(TELEGRAM_USER_ID, response);
    } catch (err) {
      console.error("Morning briefing failed:", err);
    }
  });
  activeTasks.push(briefingTask);

  // ---- Smart Check-ins (with decision framework) ----
  if (checkinsEnabled) {
    const checkInTimes = [
      "30 10 * * 1-5",
      "0 12 * * 1-5",
      "0 14 * * 1-5",
      "0 16 * * 1-5",
      "0 18 * * 1-5",
    ];

    checkInTimes.forEach((time) => {
      const task = cron.schedule(time, async () => {
        if (!supabase) return;

        // DECISION FRAMEWORK: evaluate triggers BEFORE calling the LLM
        const triggers = await evaluateTriggers(supabase);
        if (!triggers.shouldFire) {
          console.log(`Smart Check-in skipped (no triggers fired for ${time}).`);
          return;
        }

        console.log(`Smart Check-in triggered for ${time}: ${triggers.reasons.join("; ")}`);

        try {
          const enrichedContext = await getEnrichedContext(supabase);
          const triggerContext = "TRIGGER REASONS:\n" + triggers.reasons.map(r => `- ${r}`).join("\n");

          const prompt = buildPrompt(
            "A scheduled check-in has been triggered for the following reasons:\n" +
            triggerContext + "\n\n" +
            "Based on the user's goals and recent context, write a short, useful check-in message. " +
            "Be specific — reference actual goals or deadlines. " +
            "If despite the triggers there is genuinely nothing useful to say, reply with EXACTLY the word SKIP.",
            "",
            enrichedContext
          );

          const response = await callLLM(prompt, { channel: "telegram" });
          if (response.trim() !== "SKIP") {
            await bot.api.sendMessage(TELEGRAM_USER_ID, response);

            // Proactive voice alert: if any trigger mentions a deadline <4h, also send as voice
            const hasUrgentDeadline = triggers.reasons.some(r => r.includes("hours") && parseInt(r.match(/(\d+)/)?.[1] || "99") <= 4);
            if (hasUrgentDeadline) {
              try {
                const audioPath = await textToSpeech(response);
                if (audioPath) {
                  await bot.api.sendAudio(TELEGRAM_USER_ID, new InputFile(audioPath), { title: "Urgent Check-in" });
                  await cleanupTTSFile(audioPath);
                  console.log("Sent proactive voice alert for urgent deadline.");
                }
              } catch (ttsErr) {
                console.error("Proactive voice alert failed:", ttsErr);
              }
            }
          } else {
            console.log("Smart Check-in: LLM decided to skip despite triggers.");
          }
        } catch (err) {
          console.error("Smart Check-in failed:", err);
        }
      });
      activeTasks.push(task);
    });
  }

  console.log(
    `Scheduler started: Briefing="${briefingCron}", Check-ins=${checkinsEnabled ? "ON" : "OFF"}`
  );
}
