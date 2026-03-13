import cron from "node-cron";
import { Bot } from "grammy";
import { supabase, callLLM, buildPrompt } from "./core.ts";
import { getMemoryContext } from "./memory.ts";

export function startScheduler(bot: Bot) {
  const TELEGRAM_USER_ID = process.env.TELEGRAM_USER_ID;
  if (!TELEGRAM_USER_ID) {
    console.warn("No TELEGRAM_USER_ID set, scheduler will not send messages.");
    return;
  }

  // Morning Briefing: 9:00 AM every weekday
  cron.schedule("0 9 * * 1-5", async () => {
    console.log("Running Morning Briefing...");
    try {
      const memoryContext = await getMemoryContext(supabase);
      const prompt = buildPrompt(
        "Generate my morning briefing. Review active goals and outstanding tasks. Keep it helpful, concise, and structured.",
        "",
        memoryContext
      );
      
      const response = await callLLM(prompt, { channel: "telegram" });
      await bot.api.sendMessage(TELEGRAM_USER_ID, response);
    } catch (err) {
      console.error("Morning briefing failed:", err);
    }
  });

  // Smart Check-ins: 10:30, 12:00, 14:00, 16:00, 18:00 on weekdays
  const checkInTimes = ["30 10 * * 1-5", "0 12 * * 1-5", "0 14 * * 1-5", "0 16 * * 1-5", "0 18 * * 1-5"];
  
  checkInTimes.forEach(time => {
    cron.schedule(time, async () => {
      console.log(`Running Smart Check-in for ${time}...`);
      try {
        const memoryContext = await getMemoryContext(supabase);
        // Prompt asks the LLM to decide whether to send a message
        const prompt = buildPrompt(
          "Evaluate if a check-in is necessary right now based on active goals and recent context. If there is a good reason (deadline approaching, something unresolved), write a short check-in message. If there is NOTHING urgent or useful to say right now, reply with EXACTLY the word SKIP and nothing else.",
          "",
          memoryContext
        );
        
        const response = await callLLM(prompt, { channel: "telegram" });
        if (response.trim() !== "SKIP") {
          await bot.api.sendMessage(TELEGRAM_USER_ID, response);
        } else {
          console.log("Smart Check-in skipped (no message needed).");
        }
      } catch (err) {
        console.error("Smart Check-in failed:", err);
      }
    });
  });

  console.log("Scheduler started: Morning briefings at 9am, smart check-ins throughout the day.");
}
