import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export async function temporaryConfig() {
  const directory = await mkdtemp(join(tmpdir(), "jdbi-mcp-test-"));
  assert.equal(dirname(directory), tmpdir());
  return {
    path: join(directory, "mcp.json"),
    close: () => rm(directory, { recursive: true, force: true }),
  };
}
