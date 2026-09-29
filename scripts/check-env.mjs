/**
 * Checks .env.local without ever printing a key.
 *
 *   npm run check-env
 *
 * Catches the usual causes of "Invalid API key": a placeholder left in, a
 * truncated paste, surrounding quotes, or keys from a different project.
 */

import { readFileSync } from "node:fs";

const FILE = ".env.local";

let text;
try {
  text = readFileSync(FILE, "utf8");
} catch {
  console.error(`\n  ${FILE} not found. Copy .env.example to .env.local first.\n`);
  process.exit(1);
}

const read = (key) => {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  return match ? match[1] : null;
};

const problems = [];
const notes = [];

/** Legacy keys are JWTs; we can read the project ref and role out of them. */
function decodeJwt(value) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(
      parts[1].replace(/-/g, "+").replace(/_/g, "/"),
      "base64",
    ).toString();
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function checkKey(name, value, { expectRole, newPrefix }) {
  if (value === null) {
    problems.push(`${name} is missing from ${FILE}.`);
    return null;
  }

  const trimmed = value.trim().replace(/^["']|["']$/g, "");

  if (trimmed !== value) {
    problems.push(`${name} has surrounding quotes or whitespace. Remove them.`);
  }
  if (/^YOUR[-_]/i.test(trimmed) || trimmed === "") {
    problems.push(`${name} is still the placeholder. Paste your real key.`);
    return null;
  }

  const claims = decodeJwt(trimmed);

  if (claims) {
    // Legacy JWT key
    if (expectRole && claims.role !== expectRole) {
      problems.push(
        `${name} is a "${claims.role}" key but should be "${expectRole}". The two are swapped.`,
      );
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      problems.push(`${name} expired on ${new Date(claims.exp * 1000).toDateString()}.`);
    }
    console.log(`  ${name}: legacy JWT, role="${claims.role}", ref="${claims.ref}"`);
    return claims.ref ?? null;
  }

  if (trimmed.startsWith(newPrefix)) {
    // New-style key (sb_publishable_… / sb_secret_…)
    if (trimmed.length < 30) {
      problems.push(
        `${name} looks truncated — only ${trimmed.length} characters. Copy the whole key.`,
      );
    } else {
      console.log(`  ${name}: new-style key, ${trimmed.length} chars — OK`);
    }
    notes.push(`${name} uses the new key format; it cannot be checked against the project ref.`);
    return null;
  }

  problems.push(
    `${name} is not a recognised Supabase key. Expected a JWT (three dot-separated parts) or a key starting "${newPrefix}". Got ${trimmed.length} characters starting "${trimmed.slice(0, 8)}".`,
  );
  return null;
}

console.log(`\nChecking ${FILE}\n`);

// ---- URL -------------------------------------------------------------------
const url = read("NEXT_PUBLIC_SUPABASE_URL");
let urlRef = null;

if (!url) {
  problems.push("NEXT_PUBLIC_SUPABASE_URL is missing.");
} else {
  const clean = url.trim().replace(/^["']|["']$/g, "").replace(/\/+$/, "");
  const match = clean.match(/^https:\/\/([a-z0-9]{10,})\.supabase\.(co|in)$/);

  if (!match) {
    problems.push(
      `NEXT_PUBLIC_SUPABASE_URL is "${clean}" — it must look like https://abcdefghijk.supabase.co with your project ref in it.`,
    );
  } else {
    urlRef = match[1];
    console.log(`  NEXT_PUBLIC_SUPABASE_URL: ok, project ref "${urlRef}"`);
  }
}

// ---- keys ------------------------------------------------------------------
const anonRef = checkKey("NEXT_PUBLIC_SUPABASE_ANON_KEY", read("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
  expectRole: "anon",
  newPrefix: "sb_publishable_",
});

const serviceRef = checkKey("SUPABASE_SERVICE_ROLE_KEY", read("SUPABASE_SERVICE_ROLE_KEY"), {
  expectRole: "service_role",
  newPrefix: "sb_secret_",
});

// ---- cross-checks ----------------------------------------------------------
if (urlRef && anonRef && urlRef !== anonRef) {
  problems.push("The anon key belongs to a different Supabase project than the URL.");
}
if (urlRef && serviceRef && urlRef !== serviceRef) {
  problems.push("The service-role key belongs to a different Supabase project than the URL.");
}

// ---- report ----------------------------------------------------------------
console.log("");

if (notes.length) {
  for (const note of notes) console.log(`  note: ${note}`);
  console.log("");
}

if (problems.length === 0) {
  console.log("  No problems found. Run `npm run dev`.\n");
  process.exit(0);
}

console.log(`  ${problems.length} problem${problems.length === 1 ? "" : "s"} found:\n`);
for (const problem of problems) console.log(`   - ${problem}`);
console.log("\n  Fix these, then restart the dev server — env is only read at boot.\n");
process.exit(1);
