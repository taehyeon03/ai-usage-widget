import assert from "node:assert/strict";
import { mkdtemp, mkdir, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getGrokUsage } from "./adapters/grok.js";
import { getGrokPaths, readGrokLogTail } from "./grokLog.js";

test("resolves Grok files below GROK_HOME", () => {
  const paths = getGrokPaths({ GROK_HOME: "/tmp/custom-grok" }, "/unused");
  assert.equal(paths.authPath, "/tmp/custom-grok/auth.json");
  assert.equal(paths.logPath, "/tmp/custom-grok/logs/unified.jsonl");
});

test("reads only complete records from a truncated Grok log tail", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-log-"));
  const logPath = path.join(directory, "unified.jsonl");
  await writeFile(logPath, "discard-this-line\nkeep-one\nkeep-two\n");

  const result = await readGrokLogTail(logPath, 20);
  assert.equal(result.text, "keep-one\nkeep-two\n");
});

test("reports login required when Grok has no auth or usage log", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-state-"));
  const result = await getGrokUsage({ env: { GROK_HOME: directory } });

  assert.equal(result.state, "auth_required");
  assert.equal(result.usage, null);
});

test("reports that Grok must run once when auth exists without a log", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-state-"));
  await writeFile(path.join(directory, "auth.json"), "{}");
  const result = await getGrokUsage({ env: { GROK_HOME: directory } });

  assert.equal(result.state, "no_output");
});

test("returns Grok weekly usage from the local log", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-state-"));
  const logs = path.join(directory, "logs");
  await mkdir(logs);
  await writeFile(path.join(logs, "unified.jsonl"), JSON.stringify({
    context: {
      creditUsagePercent: 35,
      currentPeriod: {
        type: "USAGE_PERIOD_TYPE_WEEKLY",
        end: "2026-09-01T12:00:00Z"
      }
    }
  }));
  const result = await getGrokUsage({ env: { GROK_HOME: directory } });

  assert.equal(result.state, "ready");
  assert.equal(result.usage.weekly.percent_left, 65);
});

test("marks an old Grok log as stale", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-state-"));
  const logs = path.join(directory, "logs");
  const logPath = path.join(logs, "unified.jsonl");
  await mkdir(logs);
  await writeFile(logPath, JSON.stringify({
    creditUsagePercent: 5,
    currentPeriod: {
      type: "USAGE_PERIOD_TYPE_WEEKLY",
      end: "2026-09-01T12:00:00Z"
    }
  }));
  const old = new Date(Date.now() - (25 * 60 * 60 * 1000));
  await utimes(logPath, old, old);

  const result = await getGrokUsage({ env: { GROK_HOME: directory } });
  assert.equal(result.stale, true);
  assert.equal(result.usage.weekly.percent_left, 95);
});

test("reports unmeasurable usage for a real Grok Free billing shape", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "grok-state-"));
  const logs = path.join(directory, "logs");
  await mkdir(logs);
  await writeFile(path.join(logs, "unified.jsonl"), JSON.stringify({
    ctx: {
      config: {
        currentPeriod: {
          type: "USAGE_PERIOD_TYPE_WEEKLY",
          start: "2026-08-22T00:00:00+00:00",
          end: "2026-08-29T00:00:00+00:00"
        },
        isUnifiedBillingUser: true
      },
      subscriptionTier: "Free"
    }
  }));

  const result = await getGrokUsage({ env: { GROK_HOME: directory } });
  assert.equal(result.state, "no_usage_capability");
  assert.equal(result.message_key, "provider.grok_free_unmeasurable");
  assert.equal(result.reset_at, "2026-08-29T00:00:00+00:00");
  assert.match(result.status, /Free plan/);
});
