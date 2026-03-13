/**
 * Semantic Search Edge Function
 *
 * Generates an embedding for the query, then calls match_messages or
 * match_memory to find similar rows. This keeps the API key in Supabase
 * so the relay never needs it.
 *
 * POST body:
 *   { query: string, table?: "messages" | "memory", match_count?: number, match_threshold?: number }
 *
 * Returns: array of matching rows with similarity scores.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

Deno.serve(async (req) => {
  try {
    const {
      query,
      table = "messages",
      match_count = 10,
      match_threshold = 0.7,
    } = await req.json();

    if (!query) {
      return new Response("Missing query", { status: 400 });
    }

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiKey) {
      return new Response("GEMINI_API_KEY not configured", { status: 500 });
    }

    // Generate embedding for the search query via Gemini
    const embeddingResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: {
            parts: [{ text: query }]
          }
        }),
      }
    );

    if (!embeddingResponse.ok) {
      const err = await embeddingResponse.text();
      return new Response(`Gemini error: ${err}`, { status: 500 });
    }

    const { embedding: geminiEmbedding } = await embeddingResponse.json();
    const embedding = geminiEmbedding.values;

    // Semantic search via Supabase RPC
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const rpcName = table === "memory" ? "match_memory" : "match_messages";

    const { data: results, error } = await supabase.rpc(rpcName, {
      query_embedding: embedding,
      match_threshold,
      match_count,
    });

    if (error) {
      return new Response(`Search error: ${error.message}`, { status: 500 });
    }

    return new Response(JSON.stringify(results || []), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(String(error), { status: 500 });
  }
});
