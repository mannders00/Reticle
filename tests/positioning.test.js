import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const homepage = read("web/index.html");
const teamPage = read("web/team/index.html");

test("website presents the canonical graph lenses and product boundary", () => {
  assert.ok(homepage.includes("The live operational graph your whole team can see."));
  assert.ok(homepage.includes("Reticle turns topology and fixed health checks into one human-first map of production."));
  for (const phrase of ["human-first", "Visual UI", "JSON API", "Read-only MCP"]) {
    assert.match(homepage, new RegExp(phrase, "i"));
  }
  assert.match(homepage, /standalone, local-only/i);
  assert.match(homepage, /shared and always on/i);
  assert.match(homepage, /Optional chat is another read-only lens, not the product/i);
  assert.match(homepage, /href="\/team\/"/);
});

test("approved homepage copy remains intact", () => {
  const approved = [
    "Team: shared and always on",
    "Desktop: free and local only",
    "The live operational graph your whole team can see.",
    "Reticle turns topology and fixed health checks into one human-first map of production.",
    "The visual UI, JSON API, and read-only MCP are first-class lenses on the same graph, so people and tools work from the same truth.",
    "Explore Team Daemon",
    "Download free Desktop",
    "Team is shared and always on. Desktop is a standalone, local-only app with no shared daemon.",
    "LIVE TEAM DAEMON",
    "See the graph humans operate.",
    "This read-only map shows the real infrastructure serving reticle.live, refreshed and served from one shared daemon.",
    "Click to explore the live map",
    "Pan, inspect, and export. This public view cannot edit or run actions.",
    "ONE GRAPH, THREE PRIMARY LENSES",
    "Human-first, without isolating the humans.",
    "Each interface reads the same topology, relationships, and health evidence. Team adds authenticated shared access and configurable JSONL audit logging.",
    "Visual UI",
    "The primary operating surface: a live canvas that makes dependencies and failures legible during an incident.",
    "JSON API",
    "A structured lens for integrations that need the same graph and health truth. Team uses shared bearer tokens; Desktop remains loopback-only.",
    "Read-only MCP",
    "A constrained lens for agents to inspect evidence and relationships without gaining execution access.",
    "Optional chat is another read-only lens, not the product.",
    "Evidence first. Guarded action second.",
    "Team has no browser or ad-hoc shell.",
    "Choose where the graph needs to live.",
    "One trusted network vantage point for the whole team, with configurable JSONL audit logging, browser UI, authenticated JSON API, and read-only MCP.",
    "A complete standalone application for one person. It runs locally from your machine and does not provide a shared or always-on daemon.",
    "Give the incident one shared map.",
    "Deploy a Team Daemon to serve one live graph to authorized teammates and integrations from a trusted network vantage point.",
  ];
  for (const phrase of approved) {
    assert.ok(homepage.includes(phrase), `Homepage lost approved copy: ${phrase}`);
  }
});

test("outcome messaging sells reduced ambiguity without numeric ROI claims", () => {
  const outcomeCopy = [homepage, teamPage, read("README.md")].join("\n");
  for (const phrase of [
    "time to understand",
    "time to safe next action",
    "failed-deployment recovery time",
    "change-context latency",
    "operational handoff time",
    "operational context",
    "incident ambiguity",
  ]) {
    assert.match(outcomeCopy, new RegExp(phrase, "i"), `Outcome copy is missing ${phrase}`);
  }
  assert.doesNotMatch(outcomeCopy, /guarantee(?:d|s)?\s+(?:ROI|recovery|reduction)|\d+%\s+(?:faster|reduction|improvement)/i);
});

test("Team page contains exact pricing and an accessible comparison table", () => {
  for (const price of ["$199", "$1,999", "$3,000"]) {
    assert.ok(teamPage.includes(price), `Team page is missing ${price}`);
  }
  assert.match(teamPage, /<table class="comparison-table">/);
  assert.match(teamPage, /<th scope="col">Desktop<\/th>/);
  assert.match(teamPage, /<th scope="col">Team Daemon<\/th>/);
  assert.match(teamPage, /<th scope="row">Audit logs<\/th>/);
  assert.match(teamPage, /No Team shell/i);
});

test("product proof uses truthful viewer and PDF media", () => {
  assert.match(teamPage, /demo-overview\.webp/);
  assert.match(teamPage, /real Team viewer session/i);
  assert.match(homepage, /demo-pdf-preview\.webp/);
  assert.match(homepage, /assets\/demo-pdf\.pdf/);
  assert.doesNotMatch(`${homepage}\n${teamPage}`, /demo-shell/);
});

test("custom command checks preserve the gated execution boundary", () => {
  const architecture = [
    homepage,
    teamPage,
    read("README.md"),
    read("SECURITY.md"),
    read("DAEMON.md"),
    read("docs/daemon.md"),
    read("docs/topology-reference.md"),
    read("topology.yaml.example"),
  ].join("\n");

  for (const requirement of [
    /--allow-custom-commands/,
    /fixed[^.\n]{0,80}(?:probes|checks)[^.\n]{0,80}remain the default/i,
    /enabled:\s*false/,
    /editor (?:authorization|authorize|role)/i,
    /restricted SSH principal|restricted remote principal/i,
    /least-privileged (?:daemon|Reticle) OS account/i,
    /no interactive or ad-hoc shell|No interactive\/ad-hoc shell/i,
    /kind:\s*ssh\s+probe:\s*ssh\.command/,
    /kind:\s*local\s+probe:\s*shell\.command/,
  ]) {
    assert.match(architecture, requirement);
  }

  assert.doesNotMatch(architecture, /custom (?:SSH )?(?:checks|commands)[^.\n]{0,80}(?:are|remain) (?:inherently )?read-only/i);
});

test("privileged mode is positioned as flexible operator power with read-only viewers", () => {
  const readme = read("README.md");
  assert.match(homepage, /one global privileged toggle can enable reviewed remote SSH commands, or local Bash on Unix hosts, as persisted checks or guarded named actions/i);
  assert.match(homepage, /Desktop may also open a separately warned live shell/i);
  assert.match(teamPage, /Viewers receive bounded results, never command text or execution controls/i);
  assert.match(readme, /Safe by default, precise when you choose/i);
  assert.match(readme, /Enable privileged mode/);
  assert.match(readme, /active workspace for the current app session/i);
  assert.match(readme, /JSON, MCP, and chat remain read-only/i);
});

test("Team structured data includes subscriptions and implementation service", () => {
  const block = teamPage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, "Team page is missing JSON-LD");
  const data = JSON.parse(block[1]);
  const serialized = JSON.stringify(data);
  for (const price of ['"price":"199"', '"price":"1999"', '"lowPrice":"3000"']) {
    assert.ok(serialized.includes(price), `Team JSON-LD is missing ${price}`);
  }
  assert.ok(serialized.includes('"@type":"Service"'));
});

test("public product docs keep Team pricing and links consistent", () => {
  const docs = [
    "README.md",
    "DAEMON.md",
    "docs/daemon.md",
    "docs/getting-started.md",
    ".github/workflows/desktop-release.yml",
  ];
  for (const path of docs) {
    const content = read(path);
    assert.ok(content.includes("$199/month"), `${path} is missing monthly pricing`);
    assert.ok(content.includes("$1,999/year"), `${path} is missing annual pricing`);
    assert.ok(content.includes("$3,000"), `${path} is missing implementation pricing`);
    assert.ok(content.includes("https://reticle.live/team/"), `${path} is missing Team link`);
  }
});

test("public examples do not teach legacy executable fields", () => {
  const paths = [
    "docs/topology-reference.md",
    ...readdirSync("src/samples")
      .filter((name) => name.endsWith(".yaml"))
      .map((name) => join("src/samples", name)),
  ];
  const prohibited = [/^\s+script:/m, /^\s+exec:\s+local/m, /^\s+crons:/m, /^\s+interpreter:/m];
  for (const path of paths) {
    const content = read(path);
    for (const pattern of prohibited) {
      assert.doesNotMatch(content, pattern, `${path} contains ${pattern}`);
    }
  }
});

test("retired pricing and execution-first marketing stay removed", () => {
  const publicCopy = [homepage, teamPage, read("README.md"), read("docs/daemon.md")].join("\n");
  assert.doesNotMatch(publicCopy, /flat per year|annual team license|run_local/i);
});
