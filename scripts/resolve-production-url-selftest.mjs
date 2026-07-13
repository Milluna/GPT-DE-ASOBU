import assert from "node:assert/strict";
import test from "node:test";
import {
  collectUrls,
  isPublicHostname,
  normalizeCandidate,
  verifyCandidate,
} from "./resolve-production-url.mjs";

test("accepts only normalized public HTTPS production candidates", () => {
  assert.deepEqual(normalizeCandidate(" https://example.com/app///?x=1#top ", "test"), {
    url: "https://example.com/app",
    source: "test",
  });
  assert.deepEqual(
    normalizeCandidate("https://gpt-de-asobu.example.workers.dev/).", "check output"),
    {
      url: "https://gpt-de-asobu.example.workers.dev",
      source: "check output",
    },
  );
  assert.equal(normalizeCandidate("http://example.com", "test"), null);
  assert.equal(normalizeCandidate("https://127.0.0.1", "test"), null);
  assert.equal(normalizeCandidate("https://192.168.1.4", "test"), null);
  assert.equal(normalizeCandidate("https://github.com/Milluna/GPT-DE-ASOBU", "test"), null);
  assert.equal(normalizeCandidate("https://dash.cloudflare.com/example", "test"), null);
  assert.equal(isPublicHostname("gpt-de-asobu.milluna.workers.dev"), true);
});

test("extracts nested HTTPS deployment and check-output URLs", () => {
  const urls = [];
  collectUrls(
    {
      payload: {
        message: "deployed to https://gpt-de-asobu.example.workers.dev and https://example.com/app",
      },
      output: {
        summary: "[Open deployment](https://preview.example.workers.dev/)",
      },
    },
    urls,
  );
  assert.deepEqual(urls, [
    "https://gpt-de-asobu.example.workers.dev",
    "https://example.com/app",
    "https://preview.example.workers.dev/)",
  ]);
});

test("verifies release metadata before accepting a candidate", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://prod.example/release.json");
    return new Response(JSON.stringify({ service: "aori-room", gitSha: "abc1234" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const result = await verifyCandidate({ url: "https://prod.example", source: "test" });
  assert.deepEqual(result, {
    url: "https://prod.example",
    source: "test",
    evidence: "release.json (abc1234)",
  });
});

test("uses the AORI ROOM HTML shell for deployments older than release metadata", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/release.json")) return new Response("missing", { status: 404 });
    return new Response("<!doctype html><title>AORI ROOM Prototype</title>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };
  const result = await verifyCandidate({ url: "https://legacy.example", source: "test" });
  assert.equal(result?.evidence, "AORI ROOM HTML shell");
});

test("rejects unrelated HTML", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    if (String(url).endsWith("/release.json")) return new Response("missing", { status: 404 });
    return new Response("<!doctype html><title>Other application</title>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
  };
  assert.equal(
    await verifyCandidate({ url: "https://unrelated.example", source: "test" }),
    null,
  );
});
