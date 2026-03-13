/**
 * Tools Framework
 *
 * A plugin-based system for extending the bot's capabilities.
 * Gemini uses [TOOL: name | args] tags to invoke tools.
 * Each tool has a name, description, and execute function.
 *
 * Built-in tools:
 * - web_search: Search the web for information
 * - save_note: Save a note to memory
 */

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// TOOL INTERFACE
// ============================================================

export interface Tool {
  name: string;
  description: string;
  execute: (args: string, supabase: SupabaseClient | null) => Promise<string>;
}

// ============================================================
// BUILT-IN TOOLS
// ============================================================

const webSearchTool: Tool = {
  name: "web_search",
  description: "Search the web for current information. Args: search query.",
  async execute(query: string): Promise<string> {
    try {
      // Use a free search API (DuckDuckGo instant answers)
      const encoded = encodeURIComponent(query);
      const res = await fetch(
        `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1`
      );
      const data = await res.json() as any;

      const results: string[] = [];

      if (data.Abstract) {
        results.push(`**${data.Heading}**: ${data.Abstract}`);
      }

      if (data.RelatedTopics?.length) {
        for (const topic of data.RelatedTopics.slice(0, 3)) {
          if (topic.Text) {
            results.push(`- ${topic.Text}`);
          }
        }
      }

      if (results.length === 0) {
        return `No results found for "${query}". Try a more specific search.`;
      }

      return results.join("\n\n");
    } catch (err) {
      console.error("Web search error:", err);
      return "Web search is currently unavailable.";
    }
  },
};

const saveNoteTool: Tool = {
  name: "save_note",
  description: "Save a structured note to the user's memory. Args: the note content.",
  async execute(content: string, supabase: SupabaseClient | null): Promise<string> {
    if (!supabase) return "Memory not available (Supabase not configured).";
    try {
      await supabase.from("memory").insert({
        type: "note",
        content,
      });
      return `Note saved: "${content.substring(0, 50)}..."`;
    } catch (err) {
      console.error("Save note error:", err);
      return "Failed to save note.";
    }
  },
};

// ============================================================
// TOOL REGISTRY
// ============================================================

const tools: Map<string, Tool> = new Map();

// Register built-in tools
tools.set("web_search", webSearchTool);
tools.set("save_note", saveNoteTool);

/**
 * Register a custom tool.
 */
export function registerTool(tool: Tool): void {
  tools.set(tool.name, tool);
}

/**
 * Get descriptions of all registered tools for the system prompt.
 */
export function getToolDescriptions(): string {
  const descriptions = Array.from(tools.values())
    .map(t => `- ${t.name}: ${t.description}`)
    .join("\n");
  return `AVAILABLE TOOLS:\n${descriptions}`;
}

/**
 * Process [TOOL: name | args] tags in a response.
 * Executes the tool and returns the response with tool output inserted.
 */
export async function processToolCalls(
  response: string,
  supabase: SupabaseClient | null
): Promise<string> {
  let result = response;

  for (const match of response.matchAll(/\[TOOL:\s*(\w+)\s*\|\s*(.+?)\]/gi)) {
    const toolName = match[1].toLowerCase();
    const args = match[2].trim();
    const tool = tools.get(toolName);

    if (tool) {
      console.log(`Executing tool: ${toolName}("${args.substring(0, 50)}")`);
      const output = await tool.execute(args, supabase);
      result = result.replace(match[0], `\n📎 *${toolName}:* ${output}\n`);
    } else {
      result = result.replace(match[0], `\n⚠️ Unknown tool: ${toolName}\n`);
    }
  }

  return result;
}
