import { open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const MAX_LOG_BYTES = 1024 * 1024;

export function getGrokPaths(env = process.env, home = os.homedir()) {
  const grokHome = env.GROK_HOME || path.join(home, ".grok");
  return {
    authPath: path.join(grokHome, "auth.json"),
    logPath: path.join(grokHome, "logs", "unified.jsonl")
  };
}

export async function readGrokLogTail(logPath, maxBytes = MAX_LOG_BYTES) {
  const info = await stat(logPath);
  const bytesToRead = Math.min(info.size, maxBytes);
  const position = Math.max(0, info.size - bytesToRead);
  const handle = await open(logPath, "r");

  try {
    const buffer = Buffer.alloc(bytesToRead);
    const result = await handle.read(buffer, 0, bytesToRead, position);
    let text = buffer.subarray(0, result.bytesRead).toString("utf8");
    if (position > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return { text, mtimeMs: info.mtimeMs };
  } finally {
    await handle.close();
  }
}
