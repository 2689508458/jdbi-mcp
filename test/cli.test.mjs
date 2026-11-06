import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { temporaryConfig } from "./fixtures/config-directory.mjs";
import { mockBi, token } from "./fixtures/mcp-http.mjs";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
async function command(args, path, input = "") {
  const env = { ...process.env, JDBI_CONFIG_PATH: path };
  delete env.JDBI_API_KEY;
  delete env.JDBI_MCP_URL;
  const child = spawn(process.execPath, [cli, ...args], { env, stdio: "pipe" });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const done = once(child, "close");
  child.stdin.end(input);
  const [code] = await done;
  return { code, stdout, stderr };
}

describe("可安装 stdio 命令", () => {
  it("支持版本与帮助，启动未配置时给出明确提示", { timeout: 10_000 }, async () => {
    const files = await temporaryConfig();
    try {
      assert.equal((await command(["--version"], files.path)).stdout.trim(), "1.2.0");
      assert.match((await command(["--help"], files.path)).stdout, /setup/u);
      const missing = await command([], files.path);
      assert.equal(missing.code, 1);
      assert.equal(missing.stdout, "");
      assert.match(missing.stderr, /setup/u);
    } finally { await files.close(); }
  });

  it("客户端直接传入密钥即可连接，不需要 setup 或保存配置文件", { timeout: 10_000 }, async () => {
    const files = await temporaryConfig();
    const bi = await mockBi();
    const client = new Client({ name: "evoflow-env-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli],
      env: { ...bi.env, JDBI_CONFIG_PATH: files.path }, stderr: "pipe" });
    let stderr = "";
    transport.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      await client.connect(transport, { timeout: 3000 });
      assert.equal((await client.listTools()).tools[0].name, "list_metrics");
      assert.equal((await client.callTool({ name: "list_metrics" })).structuredContent.data.amount, 12.34);
      await assert.rejects(readFile(files.path), { code: "ENOENT" });
      assert.equal(stderr, "");
    } finally { await client.close(); await transport.close(); await bi.close(); await files.close(); }
  });

  it("首次粘贴密钥验证后保存，后续可从任意目录启动 MCP", { timeout: 10_000 }, async () => {
    const files = await temporaryConfig();
    const bi = await mockBi();
    const client = new Client({ name: "installed-cli-test", version: "1" });
    const transport = new StdioClientTransport({ command: process.execPath, args: [cli], env: { JDBI_CONFIG_PATH: files.path }, stderr: "pipe" });
    let stderr = "";
    transport.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      const configured = await command(["setup", "--url", bi.env.JDBI_MCP_URL], files.path, `${token}\n`);
      assert.equal(configured.code, 0, configured.stderr);
      assert.equal(configured.stdout, "");
      assert.ok(!configured.stderr.includes(token));
      assert.match(configured.stderr, /配置已保存/u);
      await client.connect(transport, { timeout: 3000 });
      assert.equal((await client.listTools()).tools[0].name, "list_metrics");
      assert.equal((await client.callTool({ name: "list_metrics" })).structuredContent.data.amount, 12.34);
      assert.equal(stderr, "");
    } finally { await client.close(); await transport.close(); await bi.close(); await files.close(); }
  });

  it("失效密钥不会覆盖原配置，响应原文与密钥不会进入输出", { timeout: 10_000 }, async () => {
    const files = await temporaryConfig();
    const bi = await mockBi({ status: 401 });
    try {
      const previous = JSON.stringify({ version: 1, mcpUrl: "https://previous.example.com/api/open/mcp", apiKey: token });
      await writeFile(files.path, previous);
      const failed = await command(["setup", "--url", bi.env.JDBI_MCP_URL], files.path, `${token}\n`);
      assert.equal(failed.code, 1);
      assert.ok(!`${failed.stdout}${failed.stderr}`.includes(token));
      assert.match(failed.stderr, /密钥无效/u);
      assert.equal(await readFile(files.path, "utf8"), previous);
    } finally { await bi.close(); await files.close(); }
  });
});
