import { getRelevantContext, getMemoryContext, processMemoryIntents } from "./src/memory.ts";
import { supabase, callClaude, buildPrompt, saveMessage } from "./src/core.ts";

async function test() {
  console.log("Test started");
  const text = "/start";
  
  console.log("Saving message...");
  await saveMessage("user", text, "telegram");
  
  console.log("Getting context...");
  const [relevantContext, memoryContext] = await Promise.all([
    getRelevantContext(supabase, text),
    getMemoryContext(supabase),
  ]);
  
  console.log("Got context. Building prompt...");
  const enrichedPrompt = buildPrompt(text, relevantContext, memoryContext);
  
  console.log("Calling Claude...");
  const rawResponse = await callClaude(enrichedPrompt, { resume: true });
  
  console.log("Got raw response. Processing intents...");
  const response = await processMemoryIntents(supabase, rawResponse);
  
  console.log("Done. Response:", response.substring(0, 100));
}

test().catch(e => {
  console.error("TEST SCRIPT CRASHED:", e);
  process.exit(1);
});
