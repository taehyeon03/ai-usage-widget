const CLAUDE_SESSION_LABEL = /(?:current\s*session|curr\w*session)/i;
const CLAUDE_WEEK_LABEL = /(?:current\s*week|curr\w*week)/i;
const CLAUDE_RESET_LABEL = /Rese(?:t?s?)?/i;
const RESET_CAPTURE = /resets?(?:\s+at|\s+in|:)?\s*([^\n\r)]+?)(?=\s+(?:5h|weekly|week)\b|[\n\r)]|$)/i;

export function parseGeminiUsage(output) {
  const quotaState = findLastGeminiQuotaState(output);

  if (quotaState?.kind === "used") {
    const used = quotaState.value;
    return {
      primary: {
        percent_left: Math.max(0, 100 - used),
        reset: "N/A"
      },
      status: extractGeminiTier(output) || "Gemini"
    };
  }

  if (quotaState?.kind === "limit" || isGeminiExhausted(output)) {
    return {
      primary: {
        percent_left: 0,
        reset: "unknown"
      },
      status: "Gemini (Exhausted)"
    };
  }

  return null;
}

function findLastGeminiQuotaState(output) {
  const pattern = /(\d+(?:\.\d+)?)\s*%\s*used|\blimit\s+reached\b/ig;
  let latest = null;
  let match;

  while ((match = pattern.exec(output)) !== null) {
    if (match[1] !== undefined) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        latest = { kind: "used", value };
      }
      continue;
    }

    latest = { kind: "limit" };
  }

  return latest;
}

function isGeminiExhausted(output) {
  return /exhausted\s+your\s+capacity/i.test(output)
    || /RESOURCE_EXHAUSTED/i.test(output);
}

export function parseCodexStatus(output) {
  const fiveHourPercent = findPercent(output, [
    /5h(?:\s+limit|\s+remaining)?[^0-9]{0,100}(\d+(?:\.\d+)?)\s*%(?:\s*left)?/i,
    /5h\s+remaining[^0-9]*(\d+(?:\.\d+)?)\s*%/i
  ]);
  const weeklyPercent = findPercent(output, [
    /week(?:ly)?(?:\s+limit|\s+remaining)?[^0-9]{0,100}(\d+(?:\.\d+)?)\s*%(?:\s*left)?/i,
    /week(?:ly)?\s+remaining[^0-9]*(\d+(?:\.\d+)?)\s*%/i
  ]);
  const reset = findScopedReset(output, /5h/i);
  const weeklyReset = findScopedReset(output, /weekly|week/i);

  const primary = fiveHourPercent === null || reset === "unknown" ? undefined : {
    percent_left: fiveHourPercent,
    reset
  };
  const weekly = weeklyPercent === null || weeklyReset === "unknown" ? undefined : {
    percent_left: weeklyPercent,
    reset: weeklyReset
  };

  if (!primary && !weekly) {
    return null;
  }

  return {
    primary,
    weekly
  };
}

export function parseClaudeUsage(output) {
  const sessionUsed = findSectionPercent(output, CLAUDE_SESSION_LABEL);
  const weeklyUsed = findSectionPercent(output, CLAUDE_WEEK_LABEL);
  const remaining = findNumber(output, [/remaining(?:\s+requests)?[^0-9]*(\d+)/i, /(\d+)\s*(?:requests?\s*)?remaining/i]);
  const total = findNumber(output, [/total(?:\s+requests)?[^0-9]*(\d+)/i, /(?:of|\/)\s*(\d+)\s*requests?/i]);
  const reset = findSectionReset(output, CLAUDE_SESSION_LABEL);
  const weeklyReset = findSectionReset(output, CLAUDE_WEEK_LABEL);

  if (sessionUsed !== null) {
    return {
      primary: {
        percent_left: 100 - sessionUsed,
        reset
      },
      weekly: weeklyUsed === null ? undefined : {
        percent_left: 100 - weeklyUsed,
        reset: weeklyReset
      }
    };
  }

  if (remaining === null || total === null || total <= 0) {
    return null;
  }

  return {
    primary: {
      percent_left: Math.round((remaining / total) * 100),
      reset
    }
  };
}

export function parseGrokUsage(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.trim());

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonValue(lines[index]);
    const config = findGrokBillingConfig(parsed);
    const usage = usageFromGrokConfig(config);
    if (usage) {
      return usage;
    }
  }

  return null;
}

export function parseGrokSubscriptionTier(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonValue(lines[index]);
    const tier = findGrokSubscriptionTier(parsed);
    if (tier) return tier;
  }
  return null;
}

export function parseGrokWeeklyReset(output) {
  const lines = String(output).split(/\r?\n/).filter((line) => line.trim());
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const parsed = parseJsonValue(lines[index]);
    const config = findGrokPeriodConfig(parsed);
    if (!config) continue;

    const period = config.currentPeriod ?? config.current_period ?? {};
    const periodType = String(period.type ?? period.periodType ?? period.period_type ?? "");
    const start = period.start ?? config.billingPeriodStart ?? config.billing_period_start;
    const end = period.end ?? config.billingPeriodEnd ?? config.billing_period_end;
    if (end && isWeeklyGrokPeriod(periodType, start, end)) return String(end);
  }
  return null;
}

function parseJsonValue(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function findGrokBillingConfig(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "string") {
    const parsed = parseJsonValue(value);
    return parsed === null ? null : findGrokBillingConfig(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findGrokBillingConfig(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (value.creditUsagePercent !== undefined || value.credit_usage_percent !== undefined) return value;
  for (const child of Object.values(value).reverse()) {
    const found = findGrokBillingConfig(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function findGrokPeriodConfig(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "string") {
    const parsed = parseJsonValue(value);
    return parsed === null ? null : findGrokPeriodConfig(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findGrokPeriodConfig(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  if (value.currentPeriod || value.current_period || value.billingPeriodEnd || value.billing_period_end) return value;
  for (const child of Object.values(value).reverse()) {
    const found = findGrokPeriodConfig(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function findGrokSubscriptionTier(value, depth = 0) {
  if (!value || depth > 12) return null;
  if (typeof value === "string") {
    const parsed = parseJsonValue(value);
    return parsed === null ? null : findGrokSubscriptionTier(parsed, depth + 1);
  }
  if (Array.isArray(value)) {
    for (let index = value.length - 1; index >= 0; index -= 1) {
      const found = findGrokSubscriptionTier(value[index], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const tier = value.subscriptionTier ?? value.subscription_tier;
  if (typeof tier === "string" && tier.trim()) return tier.trim();
  for (const child of Object.values(value).reverse()) {
    const found = findGrokSubscriptionTier(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function usageFromGrokConfig(config) {
  if (!config) return null;
  const used = Number(config.creditUsagePercent ?? config.credit_usage_percent);
  if (!Number.isFinite(used)) return null;

  const period = config.currentPeriod ?? config.current_period ?? {};
  const periodType = String(period.type ?? period.periodType ?? period.period_type ?? "");
  const start = period.start ?? config.billingPeriodStart ?? config.billing_period_start;
  const end = period.end ?? config.billingPeriodEnd ?? config.billing_period_end;
  if (!isWeeklyGrokPeriod(periodType, start, end) || !end) return null;

  return {
    weekly: {
      percent_left: Math.round((100 - Math.min(100, Math.max(0, used))) * 10) / 10,
      reset: String(end)
    }
  };
}

function isWeeklyGrokPeriod(periodType, start, end) {
  if (/weekly/i.test(periodType)) return true;
  if (/monthly/i.test(periodType)) return false;
  const startMs = Date.parse(String(start ?? ""));
  const endMs = Date.parse(String(end ?? ""));
  const durationDays = (endMs - startMs) / 86_400_000;
  return Number.isFinite(durationDays) && durationDays >= 6 && durationDays <= 8;
}

function findPercent(output, patterns) {
  const value = findNumber(output, patterns);
  if (value === null) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}

function findNumber(output, patterns) {
  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return null;
}

function findSectionPercent(output, labelPattern) {
  const normalized = output.replace(/\r/g, " ").replace(/\u001b\[[0-9;]*m/g, "");
  const labelRegex = new RegExp(`${labelPattern.source}[^%]{0,100}?(\\d+(?:\\.\\d+)?)%\\s*(?:used|consumed)`, "i");
  const match = normalized.match(labelRegex);
  if (!match) {
    return null;
  }

  const value = Number(match[1]);
  if (!Number.isFinite(value)) {
    return null;
  }

  return Math.min(100, Math.max(0, value));
}

function findSectionReset(output, labelPattern) {
  const normalized = output.replace(/\r/g, " ");
  const match = normalized.match(new RegExp(`${labelPattern.source}[\\s\\S]{0,260}?${CLAUDE_RESET_LABEL.source}\\s*([^\\n\\r]+?)(?=Current\\s*(?:session|week)|Curr\\w*session|Curr\\w*week|Refreshing|Esc\\s+to\\s+cancel|$)`, "i"));
  if (!match) {
    return findReset(output);
  }

  return cleanClaudeReset(match[1]);
}

function findReset(output) {
  const resetMatch = output.match(/rese(?:t?s?)?(?:\s+at|\s+in|:)?\s*([^\n\r]+)/i);
  if (!resetMatch) {
    return "unknown";
  }

  return cleanReset(resetMatch[1]);
}

function findLineReset(output, labelPattern) {
  const line = output.split(/\r?\n/).find((candidate) => labelPattern.test(candidate));
  if (!line) {
    return findReset(output);
  }

  const resetMatch = line.match(RESET_CAPTURE);
  return resetMatch ? cleanReset(resetMatch[1]) : findReset(output);
}

function findScopedReset(output, labelPattern) {
  const normalized = output.replace(/\r/g, " ");
  const scoped = normalized.match(new RegExp(`(?:${labelPattern.source})[\\s\\S]{0,220}?${RESET_CAPTURE.source}`, "i"));
  if (scoped?.[1]) {
    return cleanReset(scoped[1]);
  }

  return findLineReset(output, labelPattern);
}

function cleanReset(value) {
  if (!value) {
    return "unknown";
  }

  return String(value)
    .replace(/^(?:at|in)\s+/i, "")
    .replace(/[)\]|\u2502]+$/g, "")
    .replace(/\s*[)\]|\u2502]+\s*$/g, "")
    .trim();
}

function cleanClaudeReset(value) {
  if (!value) {
    return "unknown";
  }

  return value
    .replace(/\s*(?:Current\s+(?:session|week)|Curr\w*(?:session|week)|Refreshing|Esc\s*to\s*cancel|Esctocancel).*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractGeminiTier(output) {
  const tierMatch = output.match(/(?:Tier|Plan):\s+([^\n\r/]+)/i);
  return tierMatch ? tierMatch[1].trim() : null;
}
