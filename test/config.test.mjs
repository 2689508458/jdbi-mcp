import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, it } from "node:test";
import { URL } from "node:url";
import { configPath, DEFAULT_MCP_URL, loadConfig, saveConfig } from "../config.mjs";
import { temporaryConfig } from "./fixtures/config-directory.mjs";
import { token } from "./fixtures/mcp-http.mjs";

describe("stdio 用户配置", () => {
  it("环境变量直接接入，不依赖任何配置文件", async () => {
    const result = await loadConfig({ JDBI_CONFIG_PATH: "相对路径", JDBI_API_KEY: token });
    assert.equal(result.url.href, DEFAULT_MCP_URL);
    assert.equal(result.token, token);
    assert.throws(() => configPath({ JDBI_CONFIG_PATH: "相对路径" }));
  });
  it("每人保存独立配置，后续启动读取它，更新采用原子替换", async () => {
    const files = await temporaryConfig();
    const env = { JDBI_CONFIG_PATH: files.path };
    try {
      await saveConfig({ url: new URL(DEFAULT_MCP_URL), token }, env);
      assert.equal((await loadConfig(env)).token, token);
      const next = `jdbi_${"b".repeat(43)}`;
      await saveConfig({ url: new URL(DEFAULT_MCP_URL), token: next }, env);
      assert.equal((await loadConfig(env)).token, next);
      assert.deepEqual(await readdir(dirname(files.path)), ["mcp.json"]);
    } finally { await files.close(); }
  });
  it("换站点或端点不复用旧密钥，显式环境密钥可配置新地址", async () => {
    const files = await temporaryConfig();
    const env = { JDBI_CONFIG_PATH: files.path };
    try {
      await saveConfig({ url: new URL(DEFAULT_MCP_URL), token }, env);
      for (const url of ["https://other.example.com/api/open/mcp", "https://jdbi.b9zy.cn/other"]) {
        await assert.rejects(loadConfig(env, url), /重新执行/u);
        assert.equal((await loadConfig({ ...env, JDBI_API_KEY: token }, url)).url.href, url);
      }
    } finally { await files.close(); }
  });
  it("损坏配置不输出正文，缺少配置时引导 setup", async () => {
    const files = await temporaryConfig();
    const env = { JDBI_CONFIG_PATH: files.path };
    try {
      await assert.rejects(loadConfig(env), /setup/u);
      await writeFile(files.path, token);
      await assert.rejects(loadConfig(env), (error) => error.message.includes("setup") && !error.message.includes(token));
      assert.equal(await readFile(files.path, "utf8"), token);
    } finally { await files.close(); }
  });
});
