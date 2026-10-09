#!/usr/bin/env node
/**
 * Fails when a message used in `apps/web/src` never reached a locale catalog.
 *
 * A production build compiles every `<Trans>` and `t`…`` call to a generated
 * message id and reads the copy from the catalog of the active locale, so a
 * message that is missing from a catalog renders as that raw id instead of
 * text. The dev server keeps an inline fallback and hides the problem, and
 * nothing else runs the extractor, so the gap ships silently.
 *
 * Extraction runs against a generated config whose catalogs live in a
 * temporary directory: the checked-in catalogs are only read, never rewritten.
 * Only message ids are compared, so moving code around (which shifts the line
 * references stored in the catalogs) does not fail the check.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getConfig } from "@lingui/conf";

const webDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const localesDir = join(webDir, "src", "locales");
const catalogPath = (locale, root = localesDir) => join(root, locale, "messages.po");

const PO_ESCAPES = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };

/** Unescape one PO string literal, e.g. `"a\nb"` -> `a<newline>b`. */
function unquote(literal) {
  const trimmed = literal.trim();
  if (trimmed.length < 2 || !trimmed.startsWith('"') || !trimmed.endsWith('"')) return "";
  return trimmed.slice(1, -1).replace(/\\(.)/g, (_, char) => PO_ESCAPES[char] ?? char);
}

/** Message ids of a PO catalog, ignoring translations. */
function messageIds(poSource) {
  const ids = [];
  let pending = null;
  const flush = () => {
    if (pending) ids.push(pending);
    pending = null;
  };
  for (const line of poSource.split("\n")) {
    if (line.startsWith("msgid ")) {
      flush();
      pending = unquote(line.slice("msgid ".length));
      continue;
    }
    // Continuation lines of a multi-line msgid. After `msgstr` nothing is pending.
    if (pending !== null && line.startsWith('"')) {
      pending += unquote(line);
      continue;
    }
    flush();
  }
  flush();
  return ids;
}

function extractToTemporaryCatalogs(config) {
  const workDir = mkdtempSync(join(tmpdir(), "rakazo-locale-check-"));
  const outDir = join(workDir, "catalogs");
  const configPath = join(workDir, "lingui.check.config.js");
  writeFileSync(
    configPath,
    `module.exports = ${JSON.stringify({
      rootDir: webDir.split("\\").join("/"),
      sourceLocale: config.sourceLocale,
      locales: config.locales,
      compileNamespace: config.compileNamespace,
      fallbackLocales: config.fallbackLocales,
      catalogs: config.catalogs.map((catalog) => ({
        ...catalog,
        path: join(outDir, "{locale}", "messages").split("\\").join("/"),
      })),
    })};\n`,
  );

  try {
    const linguiDir = join(webDir, "node_modules", "@lingui", "cli");
    const { bin } = JSON.parse(readFileSync(join(linguiDir, "package.json"), "utf8"));
    execFileSync(
      process.execPath,
      [join(linguiDir, bin.lingui), "extract", "--config", configPath],
      {
        cwd: webDir,
        stdio: "pipe",
      },
    );
    return { outDir, workDir };
  } catch (error) {
    rmSync(workDir, { recursive: true, force: true });
    throw error;
  }
}

const config = getConfig({ configPath: join(webDir, "lingui.config.ts"), rootDir: webDir });
const { outDir, workDir } = extractToTemporaryCatalogs(config);

const problems = [];
let checked = 0;
try {
  const used = new Set(messageIds(readFileSync(catalogPath(config.sourceLocale, outDir), "utf8")));
  const present = readdirSync(localesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const locale of config.locales) {
    if (!present.includes(locale)) {
      problems.push(`src/locales/${locale}/messages.po is missing, but ${locale} is a locale.`);
    }
  }
  for (const locale of present) {
    if (!existsSync(catalogPath(locale))) {
      problems.push(`src/locales/${locale} has no messages.po.`);
      continue;
    }
    checked += 1;
    const catalog = new Set(messageIds(readFileSync(catalogPath(locale), "utf8")));
    const missing = [...used].filter((id) => !catalog.has(id));
    const stale = [...catalog].filter((id) => !used.has(id));
    if (missing.length > 0) {
      problems.push(
        `${locale} is missing ${missing.length} message(s) used in apps/web/src:\n${missing
          .map((id) => `    ${JSON.stringify(id)}`)
          .join("\n")}`,
      );
    }
    if (stale.length > 0) {
      problems.push(
        `${locale} keeps ${stale.length} message(s) no source uses any more:\n${stale
          .map((id) => `    ${JSON.stringify(id)}`)
          .join("\n")}`,
      );
    }
  }
} finally {
  rmSync(workDir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`Locale catalogs are out of date:\n\n${problems.join("\n\n")}\n`);
  console.error("Run `pnpm --filter @bobbot/web intl:extract` and commit the updated catalogs.");
  process.exit(1);
}

console.log(`Locale catalogs are in sync with apps/web/src (${checked} catalogs checked).`);
