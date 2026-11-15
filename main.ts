// main.ts — hands the entry in: copies game/ and screenshots/ from the
// repository to the output directory and writes dossier.json with
// buildDossier. Deterministic, standard library only, never exits non-zero,
// and never deletes, removes or renames the output directory itself.
import { copyFileSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 48 * 1024 * 1024,
  game_path_max_bytes: 1000,
};

function inputDir(): string {
  const fromEnv = process.env.MAKEFUN_BOT_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return dirname(fileURLToPath(import.meta.url));
}

function outputDir(): string {
  const fromEnv = process.env.MAKEFUN_OUTPUT_DIR;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  return '/output';
}

function copyTree(src: string, dst: string): void {
  // Sorted per-file copies only; directories are created with recursive
  // mkdir. Nothing is ever deleted, removed or renamed.
  let entries: string[] = [];
  try {
    entries = readdirSync(src).sort();
  } catch {
    return;
  }
  try {
    mkdirSync(dst, { recursive: true });
  } catch {
    return;
  }
  for (const name of entries) {
    const s = join(src, name);
    const d = join(dst, name);
    let st;
    try {
      st = statSync(s);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      copyTree(s, d);
    } else if (st.isFile()) {
      try {
        copyFileSync(s, d);
      } catch {
        // Best effort: one failed file must not fail the run.
      }
    }
  }
}

function writeDossier(repo: string, out: string): void {
  let bytes: Uint8Array | null = null;
  try {
    bytes = buildDossier(repo, CAPS);
  } catch {
    bytes = null;
  }
  if (bytes === null) return;
  try {
    writeFileSync(join(out, 'dossier.json'), bytes);
  } catch {
    // A dossier-writing failure must never fail the run.
  }
}

function main(): void {
  const repo = inputDir();
  const out = outputDir();
  try {
    mkdirSync(out, { recursive: true });
  } catch {
    return;
  }
  copyTree(join(repo, 'game'), join(out, 'game'));
  copyTree(join(repo, 'screenshots'), join(out, 'screenshots'));
  writeDossier(repo, out);
}

try {
  main();
} catch {
  // Outermost guard: any unexpected failure still ends with exit code 0
  // after best-effort outputs. This program never throws out of main.
}
