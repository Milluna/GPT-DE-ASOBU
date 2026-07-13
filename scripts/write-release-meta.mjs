import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

function readGitSha() {
  const candidates = [
    process.env.AORI_BUILD_SHA,
    process.env.GITHUB_SHA,
    process.env.CF_PAGES_COMMIT_SHA,
    process.env.CI_COMMIT_SHA,
    process.env.COMMIT_SHA,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && /^[0-9a-f]{7,40}$/i.test(candidate.trim())) {
      return candidate.trim().toLowerCase();
    }
  }

  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim().toLowerCase();
  } catch {
    return "unknown";
  }
}

const release = {
  service: "aori-room",
  version: String(packageJson.version ?? "0.0.0"),
  protocolVersion: 2,
  visualVersion: "beautiful-3d-v3",
  gitSha: readGitSha(),
  builtAt: new Date().toISOString(),
  characters: ["lumi", "mio", "sena"],
  capabilities: [
    "live-title-3d",
    "three-character-sync",
    "animated-hair-and-cloth",
    "iphone-webkit-verified",
  ],
};

const publicDirectory = resolve(root, "public");
mkdirSync(publicDirectory, { recursive: true });
writeFileSync(resolve(publicDirectory, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
console.log(`release metadata: ${release.gitSha} (${release.version}, ${release.visualVersion})`);
