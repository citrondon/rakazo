#!/usr/bin/env node
// Import Grok Bot profiles from a public profile collection into bot presets.
//
// The profile text is copied verbatim: the collection asks that a profile is used
// as written, so nothing here rewrites, shortens, or translates a prompt. Only the
// manifest wrapper (name, description, integrations) is derived, mechanically.
import { writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PROFILE_BASE = "https://raw.githubusercontent.com/mergisi/awesome-grokbot/main/bots";
const OUT_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "../bot-library");

/** Front matter is a flat `key: value` block where lists look like `[A, B]`. */
function frontMatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("profile has no front matter");
  const fields = new Map();
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":");
    if (at === -1) continue;
    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    fields.set(key, value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value);
  }
  return fields;
}

/** The first sentence under "What you do": a purpose line, taken as written. */
function purpose(body) {
  const section = body.split(/^##\s+/m).find((part) => part.startsWith("What you do")) ?? body;
  // The section still starts with its own heading, so skip that line.
  const [, ...rest] = section.split("\n");
  const line = rest.map((entry) => entry.trim()).find((entry) => entry.length > 0);
  if (!line) throw new Error("profile has no purpose line");
  return line;
}

function manifestFor(name, description, body, integrations) {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    bot: { name, title: "", description, instructions: body.trim() },
    integrations,
    memory: [],
    routines: [],
    files: [],
    history: [],
  };
}

const slugs = process.argv.slice(2);
if (slugs.length === 0) {
  console.error("usage: import-grokbot-profiles.mjs <category/slug> [...]");
  process.exit(2);
}

for (const slug of slugs) {
  const url = `${PROFILE_BASE}/${slug}/PROFILE.md`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  const markdown = await response.text();
  const fields = frontMatter(markdown);
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const integrations = (fields.get("integrations") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const manifest = manifestFor(
    fields.get("name") ?? slug.split("/").pop(),
    purpose(body),
    body,
    integrations,
  );
  const file = path.join(OUT_DIR, `${slug.split("/").pop()}.v1.json`);
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${slug} -> ${path.basename(file)} (${integrations.length} integrations)`);
}
