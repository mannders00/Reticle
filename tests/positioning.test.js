import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(path, "utf8");
const readIfPresent = (path) => existsSync(path) ? read(path) : "";
const homepage = read("web/index.html");
const teamPage = read("web/team/index.html");
const readme = read("README.md");

test("homepage leads with an intentional infrastructure diagram", () => {
  assert.match(homepage, /<h1>The infrastructure diagram you can operate\.<\/h1>/);
  assert.doesNotMatch(homepage.match(/<h1>(.*?)<\/h1>/)[1], /agent|API|MCP/i);
  for (const phrase of [
    "HUMAN-DEFINED. CONNECTED TO REALITY.",
    "Git-tracked diagram",
    "current health, notes, and guarded actions",
    "Explore the live diagram",
    "Download free Desktop",
    "One YAML · Visual editing · Customer-hosted · No Reticle cloud required",
  ]) {
    assert.ok(homepage.includes(phrase), `Homepage is missing: ${phrase}`);
  }
});

test("homepage proves the intentional model immediately after the demo", () => {
  const hero = homepage.indexOf('<section class="hero">');
  const demo = homepage.indexOf('<section id="live">');
  const intentional = homepage.indexOf('<section id="intentional">');
  const products = homepage.indexOf('<section id="products">');
  assert.ok(hero < demo && demo < intentional && intentional < products);
  for (const phrase of [
    "A REAL DIAGRAM, KEPT LIVE",
    "See an intentional architecture diagram connected to real systems.",
    "It was deliberately modeled as an architecture diagram",
    "INTENTIONAL BY DESIGN",
    "Keep your architecture connected to the way the system operates.",
    "Bring services, dependencies, boundaries, notes, checks, and known actions into one Git-tracked diagram.",
    "Draw the operating model",
    "Attach reality",
    "Use the same context",
  ]) {
    assert.ok(homepage.includes(phrase), `Homepage is missing: ${phrase}`);
  }
});

test("homepage distinguishes Desktop and Team without hiding the upgrade path", () => {
  for (const phrase of [
    "Start with the free Desktop app.",
    "Free, MIT-licensed, and local-only",
    "multiple local workspaces",
    "Keep the diagram live for the whole team.",
    "Customer-hosted and always on",
  ]) {
    assert.match(homepage, new RegExp(phrase, "i"));
  }
  assert.match(homepage, /href="https:\/\/github\.com\/mannders00\/reticle\/releases\/latest">Download Desktop<\/a>/);
  assert.match(homepage, /href="\/team\/">Explore Team<\/a>/);
});

test("homepage outcomes remain concrete without unsupported ROI claims", () => {
  assert.match(homepage, /FOR DAILY WORK AND INCIDENTS/);
  for (const phrase of [
    "Faster incident understanding",
    "Less tribal knowledge",
    "Safer next actions",
  ]) {
    assert.match(homepage, new RegExp(phrase, "i"));
  }
  assert.doesNotMatch(homepage, /guarantee(?:d|s)?\s+(?:ROI|recovery|reduction)|\d+%\s+(?:faster|reduction|improvement)/i);
});

test("research stays a secondary link beside the agent boundary", () => {
  assert.doesNotMatch(homepage, /machine-context|HUMAN-FIRST\. MACHINE-READABLE\./);
  assert.match(homepage, /Topology context raised patch correctness from 11\.1% to 78\.0% in controlled Kubernetes trials/);
  assert.ok(homepage.indexOf("arxiv.org/abs/2607.25995") > homepage.indexOf('<section id="security">'));
  assert.match(readme, /The study did not evaluate Reticle or human-curated topology/);
});

test("public pitch avoids inflated truth and discovery claims", () => {
  const publicCopy = [homepage, teamPage, readme].join("\n");
  assert.doesNotMatch(publicCopy, /source of truth|digital twin|AI-native|autonomous operations|provenance/i);
  assert.match(publicCopy, /YAML configuration is authoritative/i);
  assert.match(publicCopy, /timestamped,?\s+ephemeral observation/i);
  assert.match(publicCopy, /does not (?:replace|automatically enumerate)/i);
});

test("Team page sells shared availability before command security", () => {
  assert.match(teamPage, /<h1>Give the whole team one infrastructure diagram that stays live\.<\/h1>/);
  for (const phrase of [
    "Discuss your Team deployment",
    "Explore the live Team demo",
    "One topology · Unlimited teammates · One trusted network vantage point · Credentials stay on one host",
    "Always available",
    "Shared understanding",
    "Centralized access",
  ]) {
    assert.ok(teamPage.includes(phrase), `Team page is missing: ${phrase}`);
  }
  assert.ok(teamPage.indexOf('<section id="why-team">') < teamPage.indexOf('<section id="controlled-escalation">'));
  assert.ok(teamPage.indexOf('<section id="implementation">') < teamPage.indexOf('<section id="security">'));
});

test("Team page preserves pricing, comparison, and current limitations", () => {
  for (const price of ["$199", "$1,999", "$3,000"]) {
    assert.ok(teamPage.includes(price), `Team page is missing ${price}`);
  }
  assert.match(teamPage, /<table class="comparison-table">/);
  assert.match(teamPage, /Multiple local workspaces/);
  assert.match(teamPage, /One topology per licensed daemon/);
  assert.match(teamPage, /No Team shell/);
  assert.match(teamPage, /shared viewer and editor bearer tokens/i);
  assert.match(teamPage, /SSO, individual identity, per-user attribution, built-in high availability, and a default SLA are not included/i);
  assert.match(teamPage, /Audit logging is configurable, not automatic/i);
});

test("Team FAQ explains monitoring and sharing boundaries", () => {
  for (const question of [
    "Does Reticle replace monitoring or observability?",
    "Why use Team instead of sharing the YAML?",
  ]) {
    assert.ok(teamPage.includes(question));
  }
  assert.match(teamPage, /Metrics, logs, traces, alerting, and durable history remain in their existing tools/);
});

test("live demos remain real, gated, and read-only", () => {
  assert.match(homepage, /<iframe id="live-frame" src="https:\/\/demo\.reticle\.live\/"/);
  assert.match(teamPage, /<iframe src="https:\/\/demo\.reticle\.live\/"/);
  assert.match(homepage, /The public view is read-only/);
  assert.match(teamPage, /Read-only access is enforced by the daemon/);
  assert.doesNotMatch(`${homepage}\n${teamPage}`, /demo-shell/);
});

test("custom commands and actions preserve explicit execution boundaries", () => {
  const architecture = [
    homepage,
    teamPage,
    readme,
    read("SECURITY.md"),
    read("DAEMON.md"),
    read("docs/daemon.md"),
    read("docs/topology-reference.md"),
    read("topology.yaml.example"),
  ].join("\n");
  for (const requirement of [
    /--allow-custom-commands/,
    /fixed[^.\n]{0,80}(?:probes|checks)[^.\n]{0,80}(?:safe defaults|remain the default)/i,
    /enabled:\s*false/,
    /editor (?:authorization|authorize|access|role)/i,
    /restricted SSH principal|restricted remote principal/i,
    /least-privileged (?:daemon|Reticle) OS account/i,
    /no (?:browser terminal|interactive or ad-hoc shell|Team shell)/i,
    /persisted,? server-owned definitions/i,
  ]) {
    assert.match(architecture, requirement);
  }
  assert.doesNotMatch(architecture, /custom (?:SSH )?(?:checks|commands)[^.\n]{0,80}(?:are|remain) (?:inherently )?read-only/i);
});

test("MCP and chat remain secondary read-only consumers", () => {
  const publicCopy = [homepage, teamPage, readme, read("docs/operational-graph.md")].join("\n");
  assert.match(publicCopy, /MCP has no shell, mutation, command, or named-action tools/i);
  assert.match(publicCopy, /Team has no browser\s+terminal or ad-hoc shell/i);
  assert.doesNotMatch(publicCopy, /MCP (?:can|may) (?:execute|invoke|run) (?:actions|commands)/i);
});

test("structured data includes Team subscriptions and implementation", () => {
  for (const page of [homepage, teamPage]) {
    const block = page.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(block, "Page is missing JSON-LD");
    const serialized = JSON.stringify(JSON.parse(block[1]));
    for (const price of ['"price":"199"', '"price":"1999"', '"lowPrice":"3000"']) {
      assert.ok(serialized.includes(price), `Structured data is missing ${price}`);
    }
  }
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

test("old agent-first positioning stays removed from current surfaces", () => {
  const current = [
    homepage,
    teamPage,
    readme,
    read("docs/getting-started.md"),
    read("docs/operational-graph.md"),
    read("docs/capabilities-and-limitations.md"),
    read("docs/daemon.md"),
    read("DAEMON.md"),
    readIfPresent("VALUE.md"),
    readIfPresent("PRODUCT.md"),
  ].join("\n");
  assert.doesNotMatch(current, /One live infrastructure graph for your team and its agents|The live operational graph for humans, APIs, and agents|The live operational graph your whole team can see|human-first,? (?:live )?operational graph/i);
});
