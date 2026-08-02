import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultAction, defaultCollector, findActionById, shapeOperationsRequest,
  validateAction, validateCollector,
} from "./operationsModel.js";

test("new operation definitions have safe defaults", () => {
  const collector = defaultCollector("web", "custom", "custom-check");
  assert.deepEqual(collector, {
    id: "custom-check",
    nodeId: "web",
    name: "",
    kind: "ssh",
    timeoutSeconds: 10,
    enabled: true,
    publishOutput: true,
    probe: "ssh.command",
    command: "",
  });
  assert.deepEqual(defaultCollector("web", "local", "local-check"), {
    id: "local-check",
    nodeId: "web",
    name: "",
    kind: "local",
    timeoutSeconds: 10,
    enabled: true,
    publishOutput: true,
    probe: "shell.command",
    command: "",
  });
  assert.equal(defaultAction("web", "diagnose-web").requiresApproval, true);
  assert.equal(defaultAction("web", "local-action", "shell.command").kind, "shell.command");
});

test("validation bounds timeouts and request shaping omits empty optionals", () => {
  const collector = { ...defaultCollector("web", "http", "web-http"), url: " https://example.test/health ", timeoutSeconds: 121 };
  assert.match(validateCollector(collector).join(" "), /between 1 and 120/);
  collector.timeoutSeconds = 8;
  const action = { ...defaultAction("web", "diagnose-web"), name: " Diagnose web ", command: " curl -fsS http://127.0.0.1 ", requiresSignal: "", requiresState: "" };
  assert.deepEqual(validateAction(action), []);
  assert.deepEqual(shapeOperationsRequest({ collectors: [collector], actions: [action] }), {
    collectors: [{
      id: "web-http", nodeId: "web", name: "", kind: "http", timeoutSeconds: 8,
      enabled: true, publishOutput: false, url: "https://example.test/health", status: "2xx",
    }],
    actions: [{
      id: "diagnose-web", nodeId: "web", name: "Diagnose web", kind: "ssh.command",
      command: "curl -fsS http://127.0.0.1", requiresApproval: true, timeoutSeconds: 20,
    }],
  });
});

test("secure shell checks retain command validation without per-check acknowledgment", () => {
  const collector = { ...defaultCollector("web", "custom", "diagnostic"), command: "uptime" };
  assert.deepEqual(validateCollector(collector), []);
});

test("local shell checks allow multiline pipelines", () => {
  const collector = {
    ...defaultCollector("web", "local", "local-http"),
    command: "curl -fsS https://example.test/health |\n  jq -e '.status == \"ok\"'",
  };
  assert.deepEqual(validateCollector(collector), []);
  assert.equal(shapeOperationsRequest({ collectors: [collector] }).collectors[0].command, collector.command);
});

test("named command actions preserve command text", () => {
  const action = {
    ...defaultAction("web", "diagnose", "shell.command"),
    name: "Diagnose",
    command: "curl -fsS http://127.0.0.1 |\n  jq -e '.ok'",
  };
  assert.deepEqual(validateAction(action), []);
  assert.equal(shapeOperationsRequest({ actions: [action] }).actions[0].command, action.command);
});

test("named actions are looked up by stable ID rather than display name", () => {
  const actions = [
    { id: "restart-a", name: "Restart service" },
    { id: "restart-b", name: "Restart service" },
  ];
  assert.equal(findActionById(actions, "restart-b"), actions[1]);
  assert.equal(findActionById(actions, "Restart service"), null);
});
