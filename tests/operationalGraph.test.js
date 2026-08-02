import test from "node:test";
import assert from "node:assert/strict";

import {
  graphToTopology,
  projectGraphHealth,
  serializeTopology,
} from "../src/core/operationalGraph.js";

test("graph signals project the worst state onto each topology node", () => {
  const topology = graphToTopology({
    version: 7,
    nodes: { api: { id: "api", title: "API" } },
    edges: {},
    signals: {
      reachable: { nodeId: "api", state: "ok", observedAt: 100, detail: "reachable" },
      latency: { nodeId: "api", state: "warn", observedAt: 110, detail: { ms: 850 } },
      service: { nodeId: "api", state: "err", observedAt: 120, detail: "service down" },
    },
  });

  assert.deepEqual(topology.nodes.api.health, {
    state: "err",
    lastCheck: 120000,
    detail: "service down",
  });
});

test("action descriptors remain outside persisted topology nodes", () => {
  const action = {
    id: "diagnose-api",
    nodeId: "api",
    name: "Diagnose API",
    kind: "ssh.command",
    target: "SSH",
    available: true,
    unavailableReason: null,
    requiresApproval: true,
    timeoutSeconds: 20,
    source: "static-topology",
  };
  const topology = graphToTopology({
    nodes: { api: { id: "api" }, db: { id: "db" } },
    actions: { "diagnose-api": action },
  });

  assert.equal(topology.nodes.api.actions, undefined);
  assert.equal(topology.nodes.db.actions, undefined);
});

test("runtime action guards do not leak into persisted topology", () => {
  const blocked = {
    id: "diagnose-api",
    nodeId: "api",
    name: "Diagnose API",
    kind: "ssh.command",
    target: "SSH",
    available: false,
    unavailableReason: "required signal is unavailable",
    requiresApproval: true,
  };

  const topology = graphToTopology({
    nodes: { api: { id: "api" } },
    actions: { "diagnose-api": blocked },
  });

  assert.equal(topology.nodes.api.actions, undefined);
});

test("nodes without signals receive explicit unknown health", () => {
  const health = projectGraphHealth({
    nodes: { idle: { id: "idle" } },
    signals: {},
  });

  assert.deepEqual(health.idle, {
    state: "unknown",
    lastCheck: null,
    detail: "no signal",
  });
});

test("topology serialization strips runtime fields and retains visual and spec data", () => {
  const edges = { route: { id: "route", from: "api", to: "db", label: "SQL" } };
  const serialized = serializeTopology({
    version: 3,
    nodes: {
      api: {
        id: "api",
        kind: "server",
        title: "API",
        x: 40,
        y: 80,
        w: 240,
        h: 140,
        parentId: "services",
        notes: "primary",
        addons: [{ kind: "ip", label: "10.0.0.4" }],
        spec: { host: "api.internal", port: 22, user: "ops" },
        health: { state: "ok", lastCheck: 123000, detail: "reachable" },
        actions: [{ id: "restart-api", available: true }],
        crons: [{ name: "legacy-check" }],
      },
    },
    edges,
  });

  assert.deepEqual(serialized, {
    version: 3,
    nodes: {
      api: {
        id: "api",
        kind: "server",
        title: "API",
        x: 40,
        y: 80,
        w: 240,
        h: 140,
        parentId: "services",
        notes: "primary",
        addons: [{ kind: "ip", label: "10.0.0.4" }],
        spec: { host: "api.internal", port: 22, user: "ops" },
      },
    },
    edges,
  });
});
