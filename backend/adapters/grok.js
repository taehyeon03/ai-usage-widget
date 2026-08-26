import { access } from "node:fs/promises";
import { parseGrokSubscriptionTier, parseGrokUsage, parseGrokWeeklyReset } from "../parser.js";
import { getGrokPaths, readGrokLogTail } from "../grokLog.js";
import { readyProvider, unavailableProvider } from "../providerState.js";

const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export async function getGrokUsage(options = {}) {
  const paths = getGrokPaths(options.env);

  try {
    const log = await readGrokLogTail(paths.logPath);
    const usage = parseGrokUsage(log.text);
    if (usage) {
      const result = readyProvider("grok", usage);
      if (Date.now() - log.mtimeMs > STALE_AFTER_MS) {
        return {
          ...result,
          stale: true,
          status: "Grok CLI usage data is older than 24 hours",
          message_key: "provider.grok_stale",
          log_path: paths.logPath
        };
      }
      return result;
    }

    const tier = parseGrokSubscriptionTier(log.text);
    if (/^free$/i.test(tier ?? "")) {
      const resetAt = parseGrokWeeklyReset(log.text);
      return {
        ...unavailableProvider("grok", "no_usage_capability", {
        status: "Grok CLI detected; Free plan does not expose a usage percentage",
        messageKey: "provider.grok_free_unmeasurable",
        detail: "Weekly reset is available locally, but the Free plan does not publish a measurable allowance.",
        logPath: paths.logPath
        }),
        ...(resetAt ? { reset_at: resetAt } : {})
      };
    }

    return unavailableProvider("grok", "parse_error", {
      status: "Grok CLI detected; local weekly usage not recognized",
      messageKey: "provider.grok_parse_error",
      logPath: paths.logPath
    });
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return unavailableProvider("grok", "unavailable", {
        status: "Grok CLI detected; local usage log unavailable",
        messageKey: "provider.grok_log_unavailable",
        detail: error instanceof Error ? error.message : String(error),
        logPath: paths.logPath
      });
    }
  }

  if (options.env?.XAI_API_KEY || process.env.XAI_API_KEY) {
    return unavailableProvider("grok", "no_usage_capability", {
      status: "Grok CLI detected; API key usage does not expose subscription quota",
      messageKey: "provider.grok_api_key_no_quota"
    });
  }

  try {
    await access(paths.authPath);
  } catch {
    return unavailableProvider("grok", "auth_required", {
      status: "Grok CLI detected; login required",
      messageKey: "provider.grok_auth_required"
    });
  }

  return unavailableProvider("grok", "no_output", {
    status: "Grok CLI detected; start Grok once to record weekly usage",
    messageKey: "provider.grok_run_once",
    logPath: paths.logPath
  });
}
