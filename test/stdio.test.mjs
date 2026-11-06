import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import process from "node:process";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath, URL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { connectionConfig, startStdio } from "../stdio.mjs";
import { mockBi, token } from "./fixtures/mcp-http.mjs";

const entry = fileURLToPath(new URL("../stdio.mjs", import.meta.url));
const deadline = { timeout: 10_000 };

async function clientFor(env, run, args = [entry]) {
  const client = new Client({ name: "stdio-test", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath, args, env, stderr: "pipe" });
  let stderr = "";
  transport.stderr.on("data", (chunk) => { stderr += chunk; });
  try {
    await client.connect(transport, deadline);
    await run(client);
  } finally { await client.close(); await transport.close(); }
  assert.equal(stderr, "");
}

describe("开放查询 stdio", () => {
  it("拒绝缺失密钥、不安全地址和 URL 凭据", () => {
    const env = { JDBI_MCP_URL: "https://bi.example.com/api/open/mcp", JDBI_API_KEY: token };
    assert.equal(connectionConfig(env).url.protocol, "https:");
    for (const url of ["http://remote.example.com", "https://user:pass@bi.example.com", "https://bi.example.com?token=secret", "https://bi.example.com#secret", "file:///data"]) {
      assert.throws(() => connectionConfig({ ...env, JDBI_MCP_URL: url }));
    }
    for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
      assert.equal(connectionConfig({ ...env, JDBI_MCP_URL: `http://${host}/api/open/mcp` }).url.protocol, "http:");
    }
    assert.throws(() => connectionConfig({ ...env, JDBI_API_KEY: "" }), /JDBI_API_KEY/u);
    assert.throws(() => connectionConfig({ ...env, JDBI_MCP_URL: "" }), /JDBI_MCP_URL/u);
  });

  it("真实子进程完成握手、发现与并发调用，完整保留数据及警告", deadline, async () => {
    const bi = await mockBi();
    try {
      await clientFor(bi.env, async (client) => {
        const { tools } = await client.listTools();
        assert.equal(tools[0].name, "list_metrics");
        assert.equal(tools[0].annotations.readOnlyHint, true);
        const results = await Promise.all([1, 2].map(() => client.callTool({ name: "list_metrics", arguments: {} })));
        for (const result of results) assert.deepEqual(result.structuredContent.data, {
          name: "list_metrics", amount: 12.34, warnings: ["缺数"], page: { hasMore: true },
        });
      });
    } finally { await bi.close(); }
  });

  it("业务错误保留 isError、校验详情与追踪编号", deadline, async () => {
    const failure = { content: [{ type: "text", text: "参数错误" }], isError: true, structuredContent: { error: { code: 400, detail: { fields: ["period"] }, traceId: "trace-1" } } };
    const bi = await mockBi({ call: async () => failure });
    try {
      await clientFor(bi.env, async (client) => {
        const result = await client.callTool({ name: "list_metrics" });
        assert.deepEqual(result, failure);
      });
    } finally { await bi.close(); }
  });

  it("按 Evoflow 示例使用绝对路径环境文件启动", deadline, async () => {
    const bi = await mockBi();
    const directory = await mkdtemp(join(tmpdir(), "jdbi-stdio-"));
    assert.equal(dirname(directory), tmpdir());
    assert.ok(basename(directory).startsWith("jdbi-stdio-"));
    const config = join(directory, ".env");
    try {
      await writeFile(config, `JDBI_MCP_URL=${bi.env.JDBI_MCP_URL}\nJDBI_API_KEY=${token}\n`);
      await clientFor(undefined, async (client) => {
        assert.equal((await client.listTools()).tools[0].name, "list_metrics");
      }, [`--env-file=${config}`, entry]);
    } finally {
      await bi.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("无效密钥在初始化前失败，错误正文和密钥不会进入输出", deadline, async () => {
    const bi = await mockBi({ status: 401 });
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...bi.env }, stdio: "pipe" });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    try {
      const [code] = await once(child, "close");
      assert.equal(code, 1);
      assert.equal(stdout, "");
      assert.match(stderr, /密钥无效/u);
      assert.ok(!stderr.includes(token));
    } finally { child.kill(); await bi.close(); }
  });

  it("限流只请求一次，保留 Retry-After 且不输出响应正文", async () => {
    let calls = 0;
    const bi = await mockBi({ status: 429, onRequest: () => { calls++; } });
    try {
      await assert.rejects(startStdio({ env: bi.env, stdin: new PassThrough(), stdout: new PassThrough() }), /等待 17 秒/u);
      assert.equal(calls, 1);
    } finally { await bi.close(); }
  });

  it("拒绝跟随重定向，不把密钥传到跳转目标", async () => {
    let calls = 0;
    const stdin = new PassThrough(), stdout = new PassThrough();
    await assert.rejects(startStdio({ env: { JDBI_API_KEY: token, JDBI_MCP_URL: "https://bi.example.com/api/open/mcp" }, stdin, stdout,
      fetcher: async (_input, init) => {
        calls++;
        assert.equal(init.redirect, "error");
        return new globalThis.Response(null, { status: 302, headers: { Location: "https://other.example.com" } });
      },
    }), /HTTP 302/u);
    assert.equal(calls, 1);
  });

  it("取消 stdio 调用会断开对应 HTTP 请求", deadline, async () => {
    let markStarted, markCancelled;
    const started = new Promise((resolve) => { markStarted = resolve; });
    const cancelled = new Promise((resolve) => { markCancelled = resolve; });
    const bi = await mockBi({ call: async (_request, extra) => {
      markStarted();
      await new Promise((resolve) => extra.signal.addEventListener("abort", () => { markCancelled(); resolve(); }, { once: true }));
      return { content: [] };
    } });
    try {
      await clientFor(bi.env, async (client) => {
        const abort = new globalThis.AbortController();
        const pending = client.callTool({ name: "list_metrics" }, undefined, { signal: abort.signal });
        const rejected = assert.rejects(pending);
        await started;
        abort.abort();
        await rejected;
        await Promise.race([cancelled, setTimeout(3000).then(() => { throw new Error("HTTP 请求未被取消"); })]);
      });
    } finally { await bi.close(); }
  });

  it("stdin 结束后退出，不留下常驻 HTTP 连接", deadline, async () => {
    const bi = await mockBi();
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...bi.env }, stdio: "pipe" });
    try {
      const exit = once(child, "close");
      child.stdin.end();
      assert.equal((await exit)[0], 0);
    } finally { child.kill(); await bi.close(); }
  });
});
