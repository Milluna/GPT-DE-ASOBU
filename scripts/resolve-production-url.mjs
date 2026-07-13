import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SERVICE_NAME = "gpt-de-asobu";
const APP_SERVICE = "aori-room";
const SOURCE_REF = process.env.SOURCE_REF || "source-direct-v1.2";
const SOURCE_SHA = process.env.SOURCE_SHA || process.env.EXPECTED_SHA || "";
const WAIT_MS = readDuration("WAIT_FOR_DISCOVERY_MS", 0);
const POLL_MS = Math.max(1_000, readDuration("DISCOVERY_POLL_MS", 15_000));
const PROBE_TIMEOUT_MS = Math.max(1_000, readDuration("PROBE_TIMEOUT_MS", 10_000));
const USER_AGENT = "aori-room-production-resolver/2";

function readDuration(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : fallback;
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function normalizeCandidate(raw, source) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const clean = raw.trim().replace(/[\])},.;:]+$/g, "");
    const url = new URL(clean);
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
  if (
    host === "github.com" ||
    host.endsWith(".github.com") ||
    host === "api.github.com" ||
    host === "cloudflare.com" ||
    host.endsWith(".cloudflare.com")
  ) return false;
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
  if (depth > 6 || value == null) return;
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

async function githubJson(path, { allowNotFound = false } = {}) {
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
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

function addUrlsFromPayload(candidates, seen, payload, source) {
  const urls = [];
  collectUrls(payload, urls);
  for (const url of urls) addCandidate(candidates, seen, url, source);
}

async function addDeploymentCandidates(candidates, seen, repository) {
  const queries = new Set([`ref=${encodeURIComponent(SOURCE_REF)}`]);
  if (SOURCE_SHA) queries.add(`sha=${encodeURIComponent(SOURCE_SHA)}`);
  const deploymentsById = new Map();
  for (const query of queries) {
    const deployments = await githubJson(`/repos/${repository}/deployments?${query}&per_page=50`);
    if (!Array.isArray(deployments)) continue;
    for (const deployment of deployments) deploymentsById.set(deployment.id, deployment);
  }

  for (const deployment of deploymentsById.values()) {
    const statusList = await githubJson(
      `/repos/${repository}/deployments/${deployment.id}/statuses?per_page=50`,
    );
    if (Array.isArray(statusList)) {
      for (const status of statusList) {
        if (!["success", "in_progress", "queued", "pending"].includes(status?.state)) continue;
        addCandidate(candidates, seen, status.environment_url, "GitHub deployment environment");
        addCandidate(candidates, seen, status.target_url, "GitHub deployment target");
        addUrlsFromPayload(candidates, seen, status, "GitHub deployment status");
      }
    }
    addUrlsFromPayload(candidates, seen, deployment, "GitHub deployment payload");
  }
}

async function addCommitSignalCandidates(candidates, seen, repository) {
  const revision = SOURCE_SHA || SOURCE_REF;
  if (!revision) return;
  const encodedRevision = encodeURIComponent(revision);

  try {
    const statuses = await githubJson(
      `/repos/${repository}/commits/${encodedRevision}/statuses?per_page=100`,
    );
    if (Array.isArray(statuses)) {
      for (const status of statuses) {
        addCandidate(candidates, seen, status.target_url, "GitHub commit status target");
        addUrlsFromPayload(candidates, seen, status, "GitHub commit status");
      }
    }
  } catch (error) {
    console.warn(`commit status discovery unavailable: ${error instanceof Error ? error.message : error}`);
  }

  try {
    const checkRuns = await githubJson(
      `/repos/${repository}/commits/${encodedRevision}/check-runs?filter=latest&per_page=100`,
    );
    if (Array.isArray(checkRuns?.check_runs)) {
      for (const check of checkRuns.check_runs) {
        addCandidate(candidates, seen, check.details_url, "GitHub check details");
        addUrlsFromPayload(candidates, seen, check, "GitHub check output");
      }
    }
  } catch (error) {
    console.warn(`check-run discovery unavailable: ${error instanceof Error ? error.message : error}`);
  }

  try {
    const comments = await githubJson(
      `/repos/${repository}/commits/${encodedRevision}/comments?per_page=100`,
    );
    if (Array.isArray(comments)) {
      for (const comment of comments) addUrlsFromPayload(candidates, seen, comment, "GitHub commit comment");
    }
  } catch (error) {
    console.warn(`commit comment discovery unavailable: ${error instanceof Error ? error.message : error}`);
  }
}

async function discoverCandidates() {
  const candidates = [];
  const seen = new Set();
  addCandidate(candidates, seen, process.env.OVERRIDE_URL, "workflow input");
  addCandidate(candidates, seen, process.env.PRODUCTION_BASE_URL, "repository variable");

  const repository = process.env.GITHUB_REPOSITORY;
  if (repository) {
    try {
      await addDeploymentCandidates(candidates, seen, repository);
    } catch (error) {
      console.warn(`deployment discovery unavailable: ${error instanceof Error ? error.message : error}`);
    }

    await addCommitSignalCandidates(candidates, seen, repository);

    try {
      const repositoryData = await githubJson(`/repos/${repository}`);
      addCandidate(candidates, seen, repositoryData?.homepage, "repository homepage");
    } catch (error) {
      console.warn(`repository homepage discovery unavailable: ${error instanceof Error ? error.message : error}`);
    }

    try {
      const pages = await githubJson(`/repos/${repository}/pages`, { allowNotFound: true });
      addCandidate(candidates, seen, pages?.html_url, "GitHub Pages configuration");
    } catch (error) {
      console.warn(`GitHub Pages discovery unavailable: ${error instanceof Error ? error.message : error}`);
    }

    const [owner, repositoryName] = repository.split("/");
    if (owner) {
      const ownerSlug = owner.toLowerCase();
      addCandidate(
        candidates,
        seen,
        `https://${SERVICE_NAME}.${ownerSlug}.workers.dev`,
        "Cloudflare conventional hostname",
      );
      addCandidate(
        candidates,
        seen,
        `https://${SERVICE_NAME}-${ownerSlug}.pages.dev`,
        "Cloudflare owner-qualified Pages hostname",
      );
      if (repositoryName) {
        addCandidate(
          candidates,
          seen,
          `https://${ownerSlug}.github.io/${repositoryName}`,
          "GitHub Pages conventional hostname",
        );
      }
    }
  }
  addCandidate(candidates, seen, `https://${SERVICE_NAME}.workers.dev`, "Legacy Workers hostname");
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
    "Could not discover a verified AORI ROOM production URL from workflow input, repository variables, GitHub deployments, commit statuses, check output, commit comments, repository metadata, or conventional hosting names.",
  );
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entryPath === import.meta.url) await main();

export {
  collectUrls,
  discoverCandidates,
  isPublicHostname,
  normalizeCandidate,
  verifyCandidate,
};
