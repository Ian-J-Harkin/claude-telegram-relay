# Module 12 – Production Deployment (Corrected Draft)

> Changes from original are annotated with `<!-- CHANGED -->` comments.  
> Remove these before publishing.

---

## What You Need

A VPS — Recommended: Hostinger (promo code: GODAGO), ~$5/mo. Alternatives: DigitalOcean, Hetzner, Linode, Vultr. Any Linux server with SSH works.

<!-- CHANGED: Was "Anthropic API key from console.anthropic.com". Now Gemini. -->
A Google AI API key — From [aistudio.google.com](https://aistudio.google.com). Pay per use. Gemini 2.5 Flash is extremely affordable — most personal users spend $1–5/month. Start with $5 credit.

<!-- CHANGED: Removed "A domain or static IP — Telegram needs a URL for webhooks." 
     The bot uses grammY long-polling, not webhooks. No domain or static IP needed. -->

## Three Ways to Run It

<!-- CHANGED: Rewrote all three modes to reflect Gemini architecture. -->

**Local Only.** Runs on your computer using the Gemini API. When your computer sleeps, your bot sleeps. Best for trying it out. Cost: ~$1–5/mo API.

**VPS Only (Recommended).** Runs on a cloud server 24/7. Same codebase, same features — just deployed to a server that never sleeps. Cost: ~$5/mo server + $1–5/mo API.

<!-- CHANGED: Removed "Full mode" and "Fast mode" — these don't exist in the codebase.
     If you build them later, add them back with clear definitions. -->

**Hybrid (Future).** Server catches messages 24/7. When your local machine is running, it processes there. When it's off, the server handles everything. Start with Local or VPS — the architecture supports adding this later, nothing needs rebuilding.

<!-- CHANGED: Was described as if it exists today. The forwarding mechanism 
     hasn't been built yet. Labeled as "Future" to be accurate. 
     If you'd rather keep it as a current option, the forwarding code 
     needs to be implemented first. -->

## Why Gemini?

<!-- CHANGED: New section replacing the Anthropic ToS note. -->

GoBot uses the Gemini API directly — standard API key authentication under Google's terms of service. No CLI tools, no subscription tokens, no workarounds. You get an API key, the bot uses it, you pay per token.

Gemini 2.5 Flash delivers fast responses at rock-bottom pricing ($0.30 per million input tokens, $2.50 per million output tokens). For a personal assistant handling 50–100 messages per day, expect $1–5/month in API costs.

<!-- NOTE: If you implement smart model routing (Flash-Lite for simple, 
     Flash for medium, Pro for complex), add it here with actual model names. 
     Don't reference it until it's built. -->

## Cost Management

<!-- CHANGED: Removed references to Haiku/Sonnet/Opus routing (Anthropic models). -->

Gemini 2.5 Flash keeps costs low by default — it's one of the most affordable frontier models available. For even lower costs on simple queries, future updates will add automatic routing between Flash-Lite (trivial questions) and Flash (everything else).

<!-- CHANGED: Removed "Fallback AI Chain" section. The codebase has LLM_PROVIDER 
     which is set at startup (claude or gemini), not a runtime fallback chain.
     If you build OpenRouter/Ollama fallback, re-add this section. -->

## Auto-Deploy

Updates push from GitHub — pull the latest, restart the bot, new features are live. PM2 (Linux/Windows) or launchd (macOS) keeps the bot running, restarts on crash, and starts on boot.

---

# Summary of Changes from Original

| Original Claim | Issue | Correction |
|---|---|---|
| "Anthropic API key from console.anthropic.com" | Bot uses Gemini, not Anthropic | Google AI API key from aistudio.google.com |
| "Domain or static IP for webhooks" | Bot uses long-polling, not webhooks | Removed entirely |
| "Pro ($20/mo) or Max ($100–200/mo) subscription" | These are Claude subscription tiers | Replaced with Gemini API pricing |
| "Full mode" / "Fast mode" | Don't exist in codebase | Removed |
| "Smart routing (Haiku/Sonnet/Opus)" | Anthropic models; no routing code exists | Removed; noted as future feature |
| Hybrid forwarding mechanism | Not implemented yet | Labeled as "Future" |
| ToS Note about Anthropic OAuth, Agent SDK | Entirely Anthropic-specific | Replaced with Gemini API terms (much simpler) |
| "Fallback AI Chain" (Claude → OpenRouter → local) | Not implemented | Removed |
| "$5–30/mo API" | Overestimate for Gemini Flash | $1–5/mo for personal use |
| "$10–20 to start" API credit | Anthropic pricing | $5 is plenty for Gemini Flash |
