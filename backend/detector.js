import { execFileWithTimeout } from "./executor.js";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getLookupCommand,
  augmentPath,
  isWindows,
  isWindowsNpmShimPath,
  resolveWindowsClaudeExecutable
} from "./platform.js";

// Keep the two Codex identities as separate widget rows. Both rows use the
// same executable, but each is evaluated with its own CODEX_HOME.
const PROVIDERS = ["codex-account1", "codex-account2", "claude", "gemini"];
const DETECTION_CACHE_TTL_MS = 5 * 60_000;

let cachedProviders = null;
let cacheExpiresAt = 0;
let pendingDetection = null;

export async function detectProviders() {
  const now = Date.now();
  if (cachedProviders && now < cacheExpiresAt) {
    return cachedProviders;
  }

  if (pendingDetection) {
    return pendingDetection;
  }

  pendingDetection = detectProvidersUncached();
  try {
    const providers = await pendingDetection;
    if (providers.length > 0) {
      cachedProviders = providers;
      cacheExpiresAt = Date.now() + DETECTION_CACHE_TTL_MS;
    } else {
      cachedProviders = null;
      cacheExpiresAt = 0;
    }
    return providers;
  } finally {
    pendingDetection = null;
  }
}

async function detectProvidersUncached() {
  const detected = [];
  const lookup = getLookupCommand();
  const env = augmentPath({ ...process.env });

  for (const provider of PROVIDERS) {
    const executable = provider.startsWith("codex-account") ? "codex" : provider;
    const result = await execFileWithTimeout(lookup.command, [...lookup.args, executable], {
      timeoutMs: 3000,
      env 
    });
    if (result.ok && result.stdout.trim().length > 0 && isUsableProviderLookup(executable, result.stdout, env)) {
      detected.push(provider);
      continue;
    }

    if (fallbackProviderExists(executable, env)) {
      detected.push(provider);
    }
  }

  return detected;
}

function fallbackProviderExists(provider, env) {
  if (isWindows()) {
    if (provider === "claude") {
      return Boolean(resolveWindowsClaudeExecutable(env));
    }

    const appData = env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    const localAppData = env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const npmDir = path.join(appData, "npm");
    const candidates = [
      path.join(npmDir, `${provider}.cmd`),
      path.join(npmDir, `${provider}.ps1`),
      path.join(npmDir, provider),
      path.join(localAppData, "Programs", provider, `${provider}.exe`),
      path.join(localAppData, "Programs", provider, `${provider}.cmd`)
    ];

    return candidates.some((candidate) => existsSync(candidate));
  }

  const pathEntries = String(env.PATH || "").split(":").filter(Boolean);
  const candidates = pathEntries.flatMap((entry) => [
    path.join(entry, provider)
  ]);

  return candidates.some((candidate) => existsSync(candidate));
}

function isUsableProviderLookup(provider, stdout, env) {
  if (!isWindows() || provider !== "claude") {
    return true;
  }

  if (resolveWindowsClaudeExecutable(env)) {
    return true;
  }

  const paths = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return paths.some((candidate) => !isWindowsNpmShimPath(candidate, provider));
}
