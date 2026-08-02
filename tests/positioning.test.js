import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const homepage = read("web/index.html");
const teamPage = read("web/team/index.html");

test("website leads with current context, local operation, and safe inspection", () => {
  assert.ok(homepage.includes("One live infrastructure graph for your team and its agents."));
  assert.ok(homepage.includes("CUSTOMER-HOSTED OPERATIONAL CONTEXT"));
  for (const phrase of ["Git-tracked YAML", "JSON API", "read-only MCP", "Read-only is not a missing feature"]) {
    assert.match(homepage, new RegExp(phrase, "i"));
  }
  assert.match(homepage, /Open source and local only/i);
  assert.match(homepage, /Customer-hosted and always on/i);
  assert.match(homepage, /No agent shell access/i);
  assert.doesNotMatch(homepage, /href="\/team\/"/);
  assert.match(homepage, /href="#pricing"/);
  assert.ok(homepage.indexOf('<section class="hero">') < homepage.indexOf('<section id="live">'));
  assert.ok(homepage.indexOf('<section id="live">') < homepage.indexOf('<section id="products">'));
});

test("approved homepage copy remains intact", () => {
  const approved = [
    "CUSTOMER-HOSTED OPERATIONAL CONTEXT",
    "One live infrastructure graph for your team and its agents.",
    "Define your topology once in Git-tracked YAML. Reticle adds current health evidence, then serves the same operating picture to the visual map, JSON API, and read-only MCP—locally in the free desktop app or continuously from one Team Daemon inside your network.",
    "Explore the live Team demo",
    "Download free Desktop",
    "One YAML · One customer-hosted daemon · Unlimited teammates · No agent shell access",
    "LIVE TEAM DAEMON",
    "See the graph humans operate.",
    "Explore the read-only graph behind reticle.live, served live from one shared daemon.",
    "Click to explore the live map",
    "Pan, inspect, and export. This public view cannot edit or run actions.",
    "START LOCAL. SHARE WHEN IT MATTERS.",
    "One model, two deployment paths.",
    "Free Desktop",
    "Open source and local only",
    "No account or Reticle cloud service required.",
    "Team Daemon",
    "Customer-hosted and always on",
    "ONE OPERATING PICTURE",
    "Your map, internal tools, and AI agents should not disagree.",
    "CONTEXT BEFORE CONTROL",
    "Let agents investigate production without letting them operate it.",
    "Read-only is not a missing feature. It is the trust boundary.",
    "Evidence first. Guarded action second.",
    "Team has no browser or ad-hoc shell.",
    "TEAM PRICING",
    "One topology. Unlimited teammates.",
    "Start with Team",
  ];
  for (const phrase of approved) {
    assert.ok(homepage.includes(phrase), `Homepage lost approved copy: ${phrase}`);
  }
});

test("homepage converts Desktop and Team visitors without a Team-page detour", () => {
  assert.doesNotMatch(homepage, /href="\/team\/?(?:#.*?)?"/);
  for (const price of ["$199", "$1,999", "$3,000"]) {
    assert.ok(homepage.includes(price), `Homepage is missing ${price}`);
  }
  assert.match(homepage, /Download Desktop/);
  assert.match(homepage, /Start with Team/);
  assert.match(homepage, /configurable JSONL audit logging/i);
  assert.ok(homepage.lastIndexOf('<section id="pricing">') > homepage.indexOf('<section id="product">'));
  const structuredData = JSON.stringify(JSON.parse(homepage.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]));
  for (const price of ['"price":"199"', '"price":"1999"', '"lowPrice":"3000"']) {
    assert.ok(structuredData.includes(price), `Homepage structured data is missing ${price}`);
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

test("public pitch avoids operational truth and hype claims", () => {
  const publicCopy = [homepage, teamPage, read("README.md")].join("\n");
  assert.doesNotMatch(publicCopy, /source of truth|provenance/i);
  assert.match(publicCopy, /YAML configuration is authoritative/i);
  assert.match(publicCopy, /timestamped,?\s+ephemeral observation/i);
  assert.match(publicCopy, /does not replace (?:them|metrics, logs, or durable history)/i);
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
  assert.match(teamPage, /Runs on your own infrastructure from a local YAML configuration/i);
});

test("product proof uses truthful viewer and PDF media", () => {
  assert.match(teamPage, /<iframe src="https:\/\/demo\.reticle\.live\/"/);
  assert.match(teamPage, /Read-only access is enforced by the daemon/i);
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
  assert.match(homepage, /Deeper diagnostics require Desktop's global privileged toggle, or Team's daemon flag and editor authorization/i);
  assert.match(homepage, /Desktop offers a warned operator shell/i);
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
