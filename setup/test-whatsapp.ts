/**
 * Claude WhatsApp Relay — Test WhatsApp Connection
 *
 * Verifies whatsapp-web.js can initialize and connect.
 * On first run, displays a QR code to scan.
 * On subsequent runs, verifies the saved session still works.
 *
 * Usage: bun run setup/test-whatsapp.ts
 */

import { join, dirname } from "path";

const PROJECT_ROOT = dirname(import.meta.dir);

// Colors
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;

const PASS = green("✓");
const FAIL = red("✗");
const WARN = yellow("⚠");

// Load .env manually (no dotenv dependency)
async function loadEnv(): Promise<Record<string, string>> {
  const envPath = join(PROJECT_ROOT, ".env");
  try {
    const content = await Bun.file(envPath).text();
    const vars: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      vars[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return vars;
  } catch {
    return {};
  }
}

async function main() {
  console.log("");
  console.log(bold("  WhatsApp Connection Test"));
  console.log("");

  // Check whatsapp-web.js is installed
  try {
    await import("whatsapp-web.js");
    console.log(`  ${PASS} whatsapp-web.js is installed`);
  } catch {
    console.log(`  ${FAIL} whatsapp-web.js is not installed`);
    console.log(`      ${dim("Run: bun install")}`);
    process.exit(1);
  }

  // Check qrcode-terminal is installed
  try {
    await import("qrcode-terminal");
    console.log(`  ${PASS} qrcode-terminal is installed`);
  } catch {
    console.log(`  ${FAIL} qrcode-terminal is not installed`);
    console.log(`      ${dim("Run: bun install")}`);
    process.exit(1);
  }

  // Check env config
  const env = await loadEnv();
  const allowedNumber =
    env.WHATSAPP_ALLOWED_NUMBER ||
    process.env.WHATSAPP_ALLOWED_NUMBER ||
    "";

  if (!allowedNumber || allowedNumber === "your_whatsapp_number") {
    console.log(
      `  ${WARN} WHATSAPP_ALLOWED_NUMBER not set in .env`
    );
    console.log(
      `      ${dim("The bot will respond to ANY number (not recommended)")}`
    );
    console.log(
      `      ${dim("Set it to your number in international format, e.g. 923001234567")}`
    );
  } else {
    console.log(`  ${PASS} Allowed number: ${allowedNumber}`);
  }

  // Check relay directory
  const relayDir =
    env.RELAY_DIR ||
    process.env.RELAY_DIR ||
    join(process.env.HOME || "~", ".claude-relay");
  console.log(`  ${PASS} Relay directory: ${relayDir}`);

  // Try to initialize the client
  console.log(`\n  ${bold("Initializing WhatsApp Web client...")}`);
  console.log(
    `  ${dim("This will download Chromium on first run (~280MB)")}`
  );
  console.log(
    `  ${dim("If a QR code appears, scan it with your phone to authenticate.")}`
  );
  console.log("");

  const pkg = await import("whatsapp-web.js");
  const { Client, LocalAuth } = pkg.default || pkg;
  const qrcode = (await import("qrcode-terminal")).default;

  const client = new Client({
    authStrategy: new LocalAuth({
      dataPath: join(relayDir, "wwebjs_auth"),
    }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--no-first-run",
        "--disable-gpu",
      ],
    },
  });

  let authenticated = false;
  const timeout = setTimeout(() => {
    if (!authenticated) {
      console.log(`\n  ${FAIL} Connection timed out after 60 seconds`);
      console.log(
        `      ${dim("Make sure you scanned the QR code, or try again.")}`
      );
      process.exit(1);
    }
  }, 60000);

  client.on("qr", (qr: string) => {
    console.log(`  ${WARN} QR code generated — scan with your phone:\n`);
    qrcode.generate(qr, { small: true });
    console.log(
      `\n  ${dim("Open WhatsApp → Settings → Linked Devices → Link a Device")}`
    );
  });

  client.on("authenticated", () => {
    authenticated = true;
    console.log(`  ${PASS} Authenticated`);
  });

  client.on("auth_failure", (msg: string) => {
    clearTimeout(timeout);
    console.log(`  ${FAIL} Authentication failed: ${msg}`);
    process.exit(1);
  });

  client.on("ready", async () => {
    clearTimeout(timeout);

    const info = client.info;
    console.log(`  ${PASS} Connected as: ${info?.pushname || "Unknown"}`);
    console.log(
      `  ${PASS} Phone number: ${info?.wid?.user || "Unknown"}`
    );

    console.log(
      `\n  ${green("All good!")} WhatsApp client is connected and ready.`
    );
    console.log(
      `  ${dim("Session saved — you won't need to scan again.")}`
    );
    console.log("");

    // Clean shutdown
    await client.destroy();
    process.exit(0);
  });

  client.initialize();
}

main().catch((err) => {
  console.error(`\n  ${red("Error:")} ${err.message}`);
  process.exit(1);
});
