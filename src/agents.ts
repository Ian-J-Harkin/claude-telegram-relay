/**
 * Multi-Agent System
 *
 * Each agent has a unique persona and system prompt.
 * Agents are activated by Telegram Forum topic names —
 * send a message in the "Coder" topic, and the Coder agent responds.
 *
 * The /board command runs a "board meeting": every agent weighs in on a topic.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { PROJECT_ROOT, callLLM, buildPrompt } from "./core.ts";
import { getMemoryContext } from "./memory.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// AGENT TYPES
// ============================================================

export interface Agent {
  name: string;
  slug: string;
  emoji: string;
  systemPrompt: string;
}

// ============================================================
// AGENT LOADING
// ============================================================

let agents: Agent[] = [];

async function loadAgents(): Promise<Agent[]> {
  if (agents.length > 0) return agents;

  try {
    const configPath = join(PROJECT_ROOT, "config", "agents.json");
    const raw = await readFile(configPath, "utf-8");
    agents = JSON.parse(raw);
    console.log(`Loaded ${agents.length} agents: ${agents.map(a => a.name).join(", ")}`);
  } catch (err) {
    console.warn("Could not load agents.json, using default agent only.");
    agents = [{
      name: "General",
      slug: "general",
      emoji: "🤖",
      systemPrompt: "You are a helpful personal AI assistant.",
    }];
  }

  return agents;
}

// ============================================================
// TOPIC → AGENT ROUTING
// ============================================================

/**
 * Find the agent matching a Telegram Forum topic name.
 * Falls back to the General agent if no match found.
 */
export async function getAgentForTopic(topicName: string): Promise<Agent> {
  const allAgents = await loadAgents();
  const lower = topicName.toLowerCase();

  const match = allAgents.find(a =>
    lower.includes(a.slug.toLowerCase()) || lower.includes(a.name.toLowerCase())
  );

  return match || allAgents[0];
}

/**
 * Get all registered agents.
 */
export async function getAllAgents(): Promise<Agent[]> {
  return loadAgents();
}

/**
 * Call the LLM with a specific agent's persona.
 */
export async function callAgentLLM(
  agent: Agent,
  userMessage: string,
  supabase: SupabaseClient | null,
): Promise<string> {
  const memoryContext = await getMemoryContext(supabase);

  // Build a prompt with the agent's own system instructions
  const timeStr = new Date().toLocaleString("en-GB", {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const prompt = [
    agent.systemPrompt,
    `Current time: ${timeStr}`,
    memoryContext ? `\n${memoryContext}` : "",
    `\nUser: ${userMessage}`,
  ].join("\n");

  return callLLM(prompt, { channel: "telegram", systemPrompt: agent.systemPrompt });
}

// ============================================================
// BOARD MEETING
// ============================================================

/**
 * Run a "board meeting": each agent weighs in on the topic.
 * Returns a formatted response with each agent's perspective.
 */
export async function runBoardMeeting(
  topic: string,
  supabase: SupabaseClient | null,
): Promise<string> {
  const allAgents = await loadAgents();
  const results: string[] = [`*🏛 Board Meeting: "${topic}"*\n`];
  const memoryContext = await getMemoryContext(supabase);

  // Run all agents in parallel for speed
  const promises = allAgents.map(async (agent) => {
    try {
      const prompt = [
        agent.systemPrompt,
        `\nYou are participating in a board meeting. The topic is: "${topic}"`,
        `Give your perspective in 2-3 concise sentences from your area of expertise.`,
        `Do not repeat what others might say — focus on YOUR unique angle.`,
        memoryContext ? `\nContext:\n${memoryContext}` : "",
      ].join("\n");

      const response = await callLLM(prompt, { channel: "telegram" });
      return `${agent.emoji} *${agent.name}:*\n${response.trim()}`;
    } catch (err) {
      console.error(`Board meeting error for ${agent.name}:`, err);
      return `${agent.emoji} *${agent.name}:* (unavailable)`;
    }
  });

  const responses = await Promise.all(promises);
  results.push(...responses);

  return results.join("\n\n");
}
