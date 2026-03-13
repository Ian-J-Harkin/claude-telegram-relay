import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { PROJECT_ROOT, callLLM } from "./core.ts";

export async function generateProfile(transcriptionOrAnswers: string): Promise<string> {
  const prompt = `
You are tasked with generating a concise markdown profile of a user based on their answers to some questions.
The user's input: "${transcriptionOrAnswers}"

Create a clean, bulleted list summarizing the most important facts about this user (e.g., name, work, preferences, timezone, communication style). Do not include any conversational filler, just the markdown profile.
  `.trim();

  const profileMarkdown = await callLLM(prompt, { channel: "telegram" });

  try {
    const configDir = join(PROJECT_ROOT, "config");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "profile.md"), profileMarkdown.trim(), "utf-8");
    return profileMarkdown.trim();
  } catch (error) {
    console.error("Failed to save profile.md", error);
    return "Error saving profile.";
  }
}
