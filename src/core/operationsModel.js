const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const SERVICE_RE = /^[A-Za-z0-9_.@-]+$/;
const STATES = new Set(["unknown", "ok", "warn", "err"]);

export const TIMEOUT_MIN = 1;
export const TIMEOUT_MAX = 120;

function newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultCollector(nodeId, type = "http", id = newId("check")) {
  const custom = type === "custom" || type === "local";
  const base = {
    id,
    nodeId,
    name: "",
    kind: type === "http" ? "http" : type === "local" ? "local" : "ssh",
    timeoutSeconds: 10,
    enabled: true,
    publishOutput: custom,
  };
  if (type === "http") return { ...base, url: "", status: "2xx", jq: "" };
  if (type === "service.status") return { ...base, probe: "service.status", service: "" };
  if (type === "custom") return { ...base, probe: "ssh.command", command: "" };
  if (type === "local") return { ...base, probe: "shell.command", command: "" };
  return { ...base, probe: "host.uptime" };
}

export function defaultAction(nodeId, id = newId("action"), kind = "ssh.command") {
  return {
    id,
    nodeId,
    name: "",
    kind,
    command: "",
    requiresSignal: "",
    requiresState: "",
    requiresApproval: true,
    timeoutSeconds: 20,
  };
}

function required(value, label, errors) {
  if (!String(value ?? "").trim()) errors.push(`${label} is required`);
}

function validateCommon(item, errors) {
  required(item.id, "ID", errors);
  required(item.nodeId, "Node", errors);
  if (item.id && !ID_RE.test(item.id)) errors.push("ID contains unsupported characters");
  const timeout = Number(item.timeoutSeconds);
  if (!Number.isInteger(timeout) || timeout < TIMEOUT_MIN || timeout > TIMEOUT_MAX) {
    errors.push(`Timeout must be between ${TIMEOUT_MIN} and ${TIMEOUT_MAX} seconds`);
  }
}

export function validateCollector(collector) {
  const errors = [];
  validateCommon(collector, errors);
  if (collector.kind === "http") {
    required(collector.url, "URL", errors);
    if (cleanText(collector.url)) {
      try {
        const url = new URL(cleanText(collector.url));
        if (!["http:", "https:"].includes(url.protocol)) errors.push("URL must use HTTP or HTTPS");
        if (url.username || url.password) errors.push("URL must not contain credentials");
      } catch {
        errors.push("URL is invalid");
      }
    }
    if (!validStatus(collector.status)) errors.push("Status expression is invalid");
  }
  else if (!["ssh", "local"].includes(collector.kind)) errors.push("Check kind is not supported");
  if (collector.kind === "ssh" && !["host.uptime", "service.status", "ssh.command"].includes(collector.probe)) {
    errors.push("SSH probe is not supported");
  }
  if (collector.kind === "local" && collector.probe !== "shell.command") errors.push("Local probe is not supported");
  if (collector.probe === "service.status") {
    required(collector.service, "Service", errors);
    if (collector.service && !SERVICE_RE.test(cleanText(collector.service))) errors.push("Service contains unsupported characters");
  }
  if (collector.probe === "ssh.command") {
    if (collector.enabled !== false) required(collector.command, "Command", errors);
    if (new TextEncoder().encode(String(collector.command ?? "")).length > 2048) errors.push("Command must be at most 2048 bytes");
    if (/[\0\r\n]/.test(String(collector.command ?? ""))) errors.push("Command must be one line without NUL");
  }
  if (collector.probe === "shell.command") {
    const command = String(collector.command ?? "");
    if (collector.enabled !== false) required(command, "Command", errors);
    if (new TextEncoder().encode(command).length > 2048) errors.push("Command must be at most 2048 bytes");
    if (command.includes(String.fromCharCode(0))) errors.push("Command must not contain NUL");
  }
  return errors;
}

function validStatus(value) {
  const status = cleanText(value);
  if (!status) return true;
  return status.split(",").every((raw) => {
    const part = raw.trim();
    if (/^[1-5]xx$/i.test(part)) return true;
    if (/^[1-5]\d\d$/.test(part)) return true;
    const range = part.match(/^([1-5]\d\d)\s*-\s*([1-5]\d\d)$/);
    return !!range && Number(range[1]) <= Number(range[2]);
  });
}

export function validateAction(action) {
  const errors = [];
  validateCommon(action, errors);
  required(action.name, "Name", errors);
  required(action.command, "Command", errors);
  if (!["ssh.command", "shell.command"].includes(action.kind)) errors.push("Action kind is not supported");
  const command = String(action.command ?? "");
  if (new TextEncoder().encode(command).length > 2048) errors.push("Command must be at most 2048 bytes");
  if (command.includes(String.fromCharCode(0))) errors.push("Command must not contain NUL");
  if (action.requiresState && !action.requiresSignal) errors.push("Required state needs a signal");
  if (action.requiresState && !STATES.has(action.requiresState)) errors.push("Required state is invalid");
  return errors;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

export function shapeCollector(collector) {
  const out = {
    id: cleanText(collector.id),
    nodeId: cleanText(collector.nodeId),
    name: cleanText(collector.name),
    kind: collector.kind,
    timeoutSeconds: Number(collector.timeoutSeconds),
    enabled: collector.enabled !== false,
    publishOutput: collector.publishOutput === true,
  };
  if (collector.kind === "http") {
    out.url = cleanText(collector.url);
    if (cleanText(collector.status)) out.status = cleanText(collector.status);
    if (cleanText(collector.jq)) out.jq = cleanText(collector.jq);
  } else {
    out.probe = collector.probe;
    if (collector.probe === "service.status") out.service = cleanText(collector.service);
    if (["ssh.command", "shell.command"].includes(collector.probe)) out.command = String(collector.command ?? "").trim();
  }
  return out;
}

export function shapeAction(action) {
  const out = {
    id: cleanText(action.id),
    nodeId: cleanText(action.nodeId),
    name: cleanText(action.name),
    kind: action.kind,
    command: String(action.command ?? "").trim(),
    requiresApproval: action.requiresApproval !== false,
    timeoutSeconds: Number(action.timeoutSeconds),
  };
  if (cleanText(action.requiresSignal)) out.requiresSignal = cleanText(action.requiresSignal);
  if (cleanText(action.requiresState)) out.requiresState = cleanText(action.requiresState);
  return out;
}

export function shapeOperationsRequest({ collectors = [], actions = [] }) {
  return {
    collectors: collectors.map(shapeCollector),
    actions: actions.map(shapeAction),
  };
}

export function findActionById(actions, id) {
  return actions.find((action) => action.id === id) ?? null;
}
