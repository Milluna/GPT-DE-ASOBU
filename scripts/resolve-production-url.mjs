import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVICE_NAME = "gpt-de-asobu";
const APP_SERVICE = "aori-room";
const SOURCE_REF = process.env.SOURCE_REF || "source-direct-v1.2";
const WAIT_MS = readDuration("WAIT_FOR_DISCOVERY_MS", 0);
const POLL_MS = Math.max(1_000, readDuration("DISCOVERY_POLL_MS", 15_000));
const PROBE_TIMEOUT_MS = Math.max(1_000, readDuration("PROBE_TIMEOUT_MS", 10_000));
const USER_AGENT = "aori-room-production-resolver/1";

function readDuration(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCandidate(raw, source) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    if (url.username || url.password || !isPublicHostname(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return { url: url.toString().replace(/\/$/, ""), source };
  } catch {
    return null;
  }
}

function isPublicHostname(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
  if (["github.com", "api.github.com", "cloudflare.com", "dash.cloudflare.com"].includes(host)) return false;
  if (host === "::1" || host === "0.0.0.0" || host.startsWith("127.")) return false;
  if (host.startsWith("10.") || host.startsWith("192.168.") || host.startsWith("169.254.")) return false;
  const match = host.match(/^172\.(\d{1,3})\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return false;
  return true;
}

function addCandidate(list, seen, raw, source) {
  const candidate = normalizeCandidate(raw, source);
  if (!candidate || seen.has(candidate.url)) return;
  seen.add(candidate.url);
  list.push(candidate);
}

function collectUrls(value, output, depth = 0) {
  if (depth > 4 || value == null) return;
  if (typeof value === "string") {
    for (const match of value.matchAll(/https:\/\/[^\s"'<>]+/g)) output.push(match[0]);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, output, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) collectUrls(item, output, depth + 1);
  }
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
        "user-agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function githubJson(path) {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  if (!token || !repository) return null;
  const response = await fetchWithTimeout(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

async function discoverCandidates() {
  const candidates = [];
  const seen = new Set();
  addCandidate(candidates, seen, process.env.OVERRIDE_URL, "workflow input");
  addCandidate(candidates, seen, process.env.PRODUCTION_BASE_URL, "repository variable");

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository) {
    try {
      const deployments = await githubJson(
        `/repos/${repository}/deployments?ref=${encodeURIComponent(SOURCE_REF)}&per_page=20`,
      );
      if (Array.isArray(deployments)) {
        for (const deployment of deployments) {
          const statusList = await githubJson(
            `/repos/${repository}/deployments/${deployment.id}/statuses?per_page=20`,
          );
          if (Array.isArray(statusList)) {
            for (const status of statusList) {
              if (status?.state !== "success" && status?.state !== "in_progress") continue;
              addCandidate(candidates, seen, status.environment_url, "GitHub deployment environment");
              addCandidate(candidates, seen, status.target_url, "GitHub deployment target");
              const urls = [];
              collectUrls(status, urls);
              for (const url of urls) addCandidate(candidates, seen, url, "GitHub deployment status");
            }
          }
          const urls = [];
          collectUrls(deployment, urls);
          for (const url of urls) addCandidate(candidates, seen, url, "GitHub deployment payload");
        }
      }
    } catch (error) {
      console.warn(`deployment discovery unavailable: ${error instanceof Error ? error.message : error}`);
    }

    try {
      const repositoryData = await githubJson(`/repos/${repository}`);
      addCandidate(candidates, seen, repositoryData?.homepage, "repository homepage");
    } catch (error) {
      console.warn(`repository homepage discovery unavailable: ${error instanceof Error ? error.message : error}`);
    }

    const [owner] = repository.split("/");
    if (owner) {
      addCandidate(
        candidates,
        seen,
        `https://${SERVICE_NAME}.${owner.toLowerCase()}.workers.dev`,
        "Cloudflare conventional hostname",
      );
    }
  }
  addCandidate(candidates, seen, `https://${SERVICE_NAME}.pages.dev`, "Cloudflare Pages hostname");
  return candidates;
}

async function verifyCandidate(candidate) {
  const releaseUrl = `${candidate.url}/release.json`;
  try {
    const response = await fetchWithTimeout(releaseUrl);
    if (response.ok) {
      const release = await response.json().catch(() => null);
      if (release && release.service === APP_SERVICE) {
        return { ...candidate, evidence: `release.json (${release.gitSha ?? "unknown SHA"})` };
      }
    }
  } catch {
    // Older deployments do not have release metadata yet; inspect the HTML shell next.
  }

  try {
    const response = await fetchWithTimeout(`${candidate.url}/`);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    const html = await response.text();
    if (/AORI\s*ROOM/i.test(html) || /aori-room/i.test(html)) {
      return { ...candidate, evidence: "AORI ROOM HTML shell" };
    }
  } catch {
    return null;
  }
  return null;
}

function publish(found) {
  const output = process.env.GITHUB_OUTPUT;
  if (output) {
    appendFileSync(output, `url=${found.url}\nsource=${found.source}\nevidence=${found.evidence}\n`);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    appendFileSync(
      summary,
      `- Production URL: ${found.url}\n- Discovery source: ${found.source}\n- Evidence: ${found.evidence}\n`,
    );
  }
  console.log(JSON.stringify(found, null, 2));
}

async function main() {
  const deadline = Date.now() + WAIT_MS;
  const attempted = new Set();
  do {
    const candidates = await discoverCandidates();
    for (const candidate of candidates) {
      const key = `${candidate.url}|${candidate.source}`;
      if (!attempted.has(key)) {
        console.log(`probing ${candidate.url} (${candidate.source})`);
        attempted.add(key);
      }
      const verified = await verifyCandidate(candidate);
      if (verified) {
        publish(verified);
        return;
      }
    }
    if (Date.now() >= deadline) break;
    await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
  } while (Date.now() <= deadline);

  throw new Error(
    "Could not discover a verified AORI ROOM production URL from workflow input, repository variable, GitHub deployments, repository homepage, or conventional Cloudflare hostnames.",
  );
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) await main();

export { collectUrls, isPublicHostname, normalizeCandidate, verifyCandidate };
