/**
 * Text-to-Speech Module
 *
 * Uses Gemini's native audio generation to convert text to speech.
 * No additional API keys needed — reuses the existing GEMINI_API_KEY.
 *
 * The generated audio is sent as a Telegram voice message.
 */

import { GoogleGenAI } from "@google/genai";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const TEMP_DIR = join(process.env.HOME || process.env.USERPROFILE || ".", ".claude-relay", "temp");

// Available Gemini TTS voices
const VOICES = ["Kore", "Charon", "Fenrir", "Aoede", "Puck"] as const;
type VoiceName = typeof VOICES[number];

let selectedVoice: VoiceName = "Kore";

export function setVoice(voice: string): boolean {
  const match = VOICES.find(v => v.toLowerCase() === voice.toLowerCase());
  if (match) {
    selectedVoice = match;
    return true;
  }
  return false;
}

export function getVoice(): string {
  return selectedVoice;
}

export function getAvailableVoices(): readonly string[] {
  return VOICES;
}

/**
 * Convert text to speech using Gemini's native audio generation.
 * Returns the path to a temporary audio file, or null on failure.
 */
export async function textToSpeech(text: string): Promise<string | null> {
  if (!GEMINI_API_KEY) {
    console.warn("TTS: No GEMINI_API_KEY set.");
    return null;
  }

  // Truncate very long texts to avoid excessive TTS generation
  const maxChars = 1000;
  const truncatedText = text.length > maxChars
    ? text.substring(0, maxChars) + "... (message truncated for voice)"
    : text;

  try {
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: truncatedText }] }],
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: selectedVoice,
            },
          },
        },
      },
    });

    // Extract audio data from response
    const candidate = (response as any).candidates?.[0];
    const audioPart = candidate?.content?.parts?.[0]?.inlineData;

    if (!audioPart?.data) {
      console.warn("TTS: No audio data in Gemini response.");
      return null;
    }

    // Save to temp file
    const audioBuffer = Buffer.from(audioPart.data, "base64");
    const filePath = join(TEMP_DIR, `tts_${Date.now()}.wav`);
    await writeFile(filePath, audioBuffer);

    return filePath;
  } catch (error) {
    console.error("TTS error:", error);
    return null;
  }
}

/**
 * Clean up a temporary TTS audio file.
 */
export async function cleanupTTSFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => {});
}
