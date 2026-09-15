#!/usr/bin/env node
/**
 * Raise the cross-session reference cap in the shipped
 * `@deepseek-ai/dsh-session-reference` package from 3 to 10.
 *
 * Why a source patch and not a setting: the cap is a hard-coded constant
 * (`MAX_REFERENCES`), and the package rejects anything higher twice — the Zod
 * `Config` schema caps `maxReferences` at the constant, and the constructor
 * throws `session-reference: maxReferences must not exceed ...`. So no DSH
 * setting and no profile patch row can raise it, and no published version
 * (0.1.5-rc.2 is `next`; 0.1.6-alpha.1 also caps at 3) raises it either.
 *
 * The edit covers every place the number lives:
 *   lib/index.js               MAX_REFERENCES, the schema, the default, the guard
 *   lib/types/config.js        the constant itself
 *   lib/types/config.d.ts      the declared constant and its doc comment
 *   lib/types/index.js         derived from config.js — no edit needed
 *
 * Idempotent: a file that already holds the new text is reported as such and
 * left alone. Any other shape (a future release moved or reworded the lines)
 * fails loudly instead of guessing, and — because every edit is planned before
 * anything is written — nothing at all is written in that case.
 *
 * Writing takes effect only in a new host process: the running `dsh web` holds
 * the old module in memory, so restart it afterwards.
 *
 * Usage:
 *   node max-references.mjs --print-dir   # resolved package directory
 *   node max-references.mjs               # dry run: report the edits
 *   node max-references.mjs --dry-run     # the same, spelled out
 *   node max-references.mjs --apply       # write them
 *
 * Environment:
 *   DSH_SESSION_REFERENCE_DIR  explicit package directory
 *   DSH_HOME / DSH_PROFILE     profile used for discovery (default ~/.dsh, web)
 */
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** The new cap. Everything below derives from this one number. */
const LIMIT = 10;

const PACKAGE_NAME = '@deepseek-ai/dsh-session-reference';
const RELATIVE = join('node_modules', ...PACKAGE_NAME.split('/'));

/** Literal string edits, each asserted to appear exactly once. */
const EDITS = [
  {
    file: 'lib/index.js',
    from: 'const MAX_REFERENCES = 3;',
    to: `const MAX_REFERENCES = ${LIMIT};`,
  },
  {
    file: 'lib/index.js',
    from: 'z.number().step(1).min(1).max(3).default(3)',
    to: 'z.number().step(1).min(1).max(MAX_REFERENCES).default(MAX_REFERENCES)',
  },
  {
    file: 'lib/index.js',
    from: 'maxReferences: config.maxReferences ?? 3,',
    to: 'maxReferences: config.maxReferences ?? MAX_REFERENCES,',
  },
  {
    file: 'lib/index.js',
    from:
      'if (this.config.maxReferences > 3) throw new SessionReferenceError(' +
      '`session-reference: maxReferences must not exceed 3`, "SESSION_REFERENCE_INVALID_CONFIG");',
    to:
      'if (this.config.maxReferences > MAX_REFERENCES) throw new SessionReferenceError(' +
      '`session-reference: maxReferences must not exceed ${MAX_REFERENCES}`, "SESSION_REFERENCE_INVALID_CONFIG");',
  },
  {
    file: 'lib/types/config.js',
    from: 'export const MAX_REFERENCES = 3;',
    to: `export const MAX_REFERENCES = ${LIMIT};`,
  },
  {
    file: 'lib/types/config.d.ts',
    from: 'export declare const MAX_REFERENCES = 3;',
    to: `export declare const MAX_REFERENCES = ${LIMIT};`,
  },
  {
    file: 'lib/types/config.d.ts',
    from: 'Maximum distinct source sessions referenced by one message, from one to three.',
    to: `Maximum distinct source sessions referenced by one message, from one to ${LIMIT}.`,
  },
];

function fail(message) {
  process.stderr.write(`max-references: ${message}\n`);
  process.exit(1);
}

/** Locate the installed package: explicit env, then the live profile, then one npx cache. */
function resolvePackageDir() {
  const explicit = process.env.DSH_SESSION_REFERENCE_DIR;
  if (explicit !== undefined && explicit !== '') {
    const dir = realpathSync(resolve(explicit));
    if (!existsSync(join(dir, 'package.json'))) fail(`${dir} holds no package.json`);
    return dir;
  }

  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh');
  const profile = process.env.DSH_PROFILE ?? 'web';

  // The Loader resolves shipped packages through an ancestor node_modules of the
  // profile, so walk up from the profile directory to the filesystem root.
  let dir = join(home, 'profiles', profile);
  for (;;) {
    const candidate = join(dir, RELATIVE);
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  // Fallback: an npx cache, only when exactly one is present.
  const cache = join(homedir(), '.npm', '_npx');
  const found = existsSync(cache)
    ? [
        ...new Set(
          readdirSync(cache)
            .map((hash) => join(cache, hash, RELATIVE))
            .filter((candidate) => existsSync(candidate))
            .map((candidate) => realpathSync(candidate)),
        ),
      ]
    : [];
  if (found.length === 1) return found[0];
  fail(
    found.length === 0
      ? `cannot find ${PACKAGE_NAME}; set DSH_SESSION_REFERENCE_DIR`
      : `${found.length} installs found; set DSH_SESSION_REFERENCE_DIR to one of: ${found.join(', ')}`,
  );
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
for (const arg of args) {
  if (!['--apply', '--dry-run', '--print-dir', '--help'].includes(arg)) fail(`unknown option ${arg}`);
}

const packageDir = resolvePackageDir();
if (args.includes('--print-dir')) {
  process.stdout.write(`${packageDir}\n`);
  process.exit(0);
}
if (args.includes('--help')) {
  process.stdout.write('usage: max-references.mjs [--print-dir | --apply]\n');
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));
if (manifest.name !== PACKAGE_NAME) {
  fail(`${packageDir} is ${String(manifest.name)}, not ${PACKAGE_NAME}`);
}
process.stdout.write(`${PACKAGE_NAME}@${manifest.version}\n${packageDir}\n\n`);

// Plan every edit before writing anything: one unmatched line must abort the
// whole run rather than leave the package half-patched.
const files = new Map();
let invalid = 0;

for (const edit of EDITS) {
  if (!files.has(edit.file)) {
    files.set(edit.file, { path: join(packageDir, edit.file), original: undefined, text: undefined });
  }
  const entry = files.get(edit.file);
  entry.original ??= readFileSync(entry.path, 'utf8');
  entry.text ??= entry.original;

  const matched = entry.text.split(edit.from).length - 1;
  if (matched === 1) {
    entry.text = entry.text.replace(edit.from, edit.to);
    process.stdout.write(`  patch   ${edit.file}: ${edit.from.slice(0, 64)}…\n`);
    continue;
  }
  const present = entry.text.split(edit.to).length - 1;
  if (matched === 0 && present === 1) {
    process.stdout.write(`  already ${edit.file}: ${edit.to.slice(0, 64)}…\n`);
    continue;
  }
  process.stdout.write(
    `  FAIL    ${edit.file}: ${matched} matches of ${JSON.stringify(edit.from.slice(0, 64))}…\n`,
  );
  invalid += 1;
}

if (invalid > 0) fail('refusing to write: the installed package does not match the expected shape');

const pending = [...files.values()].filter((entry) => entry.text !== entry.original);
if (pending.length === 0) {
  process.stdout.write(`\ncap is already ${LIMIT}; nothing to do\n`);
  process.exit(0);
}
if (!apply) {
  process.stdout.write(`\ndry run: ${pending.length} file(s) would change; pass --apply to write\n`);
  process.exit(0);
}
for (const entry of pending) {
  writeFileSync(entry.path, entry.text);
  process.stdout.write(`  wrote   ${entry.path}\n`);
}
process.stdout.write(
  `\ncap raised to ${LIMIT} in ${pending.length} file(s).\n` +
    'Restart the host to load it: the running `dsh web` has the old module in memory.\n',
);
