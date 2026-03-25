#!/usr/bin/env node

/**
 * Inject environment variables from env.json into a TypeScript file.
 * Runs BEFORE build to make env vars available to the extension.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, "..");

const envPath = resolve(rootDir, "env.json");
const envTsPath = resolve(rootDir, "src/lib/env.ts");

if (!existsSync(envPath)) {
  console.warn("⚠️  env.json not found. Using default empty config.");
  writeFileSync(
    envTsPath,
    `// Auto-generated - no env.json found\nexport const ENV_CONFIG: { ANTHROPIC_API_KEY: string; ANTHROPIC_MODEL: string } | null = null;\n`,
  );
  process.exit(0);
}

const env = JSON.parse(readFileSync(envPath, "utf-8"));

const envTs = `// Auto-generated from env.json - DO NOT COMMIT
// This file is regenerated on every build

export const ENV_CONFIG = {
  ANTHROPIC_API_KEY: '${env.ANTHROPIC_API_KEY || ""}',
  ANTHROPIC_MODEL: '${env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"}',
} as const;
`;

writeFileSync(envTsPath, envTs);

console.log("\n✅ Environment config generated:");
console.log(`   Model: ${env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514"}`);
console.log(
  `   API Key: ${env.ANTHROPIC_API_KEY ? `sk-ant-***${env.ANTHROPIC_API_KEY.slice(-6)}` : "Not set"}`,
);
console.log(`   Config file: ${envTsPath}\n`);
