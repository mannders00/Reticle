import api from "./api.js";
import { bus } from "./eventBus.js";
import { shapeOperationsRequest } from "./operationsModel.js";

const state = {
  editableCollectors: [],
  editableActions: [],
  baseRevision: null,
  customChecksEnabled: false,
  localChecksEnabled: false,
  canManage: false,
  runtimeCollectors: [],
  runtimeActions: [],
  loading: false,
  saving: false,
  error: null,
};
let saveRequested = false;
let savePromise = null;
let persistedCollectors = [];
let persistedActions = [];

export const getOperationsState = () => state;

function changed(type = "changed") {
  bus.emit(`operations:${type}`, { state });
}

export function recordRuntimeOperations(graph) {
  state.runtimeCollectors = Array.isArray(graph?.collectors) ? graph.collectors : [];
  state.runtimeActions = Array.isArray(graph?.actions)
    ? graph.actions
    : Object.values(graph?.actions ?? {});
  changed("runtime");
}

export function recordOperationsRevision(revision) {
  if (revision != null) state.baseRevision = revision;
}

export function captureOperationsPersistedCandidate() {
  if (state.saving || saveRequested) return null;
  return {
    collectors: structuredClone(state.editableCollectors),
    actions: structuredClone(state.editableActions),
  };
}

export function recordOperationsPersistedState(candidate) {
  if (!candidate) return;
  persistedCollectors = structuredClone(candidate.collectors);
  persistedActions = structuredClone(candidate.actions);
}

export async function waitForOperationsSave() {
  return savePromise ? savePromise : true;
}

function applyEditableOperations(result) {
  state.editableCollectors = structuredClone(result?.collectors ?? []);
  state.editableActions = structuredClone(result?.actions ?? []);
  state.baseRevision = result?.baseRevision ?? null;
  state.customChecksEnabled = result?.customChecksEnabled === true;
  state.localChecksEnabled = result?.localChecksEnabled === true;
  persistedCollectors = structuredClone(state.editableCollectors);
  persistedActions = structuredClone(state.editableActions);
}

export async function loadEditableOperations() {
  state.canManage = api.canWrite;
  state.error = null;
  if (!state.canManage) {
    state.editableCollectors = [];
    state.editableActions = [];
    state.baseRevision = null;
    state.customChecksEnabled = false;
    state.localChecksEnabled = false;
    persistedCollectors = [];
    persistedActions = [];
    changed();
    return;
  }
  state.loading = true;
  changed("loading");
  try {
    const result = await api.getEditableOperations();
    applyEditableOperations(result);
  } catch (err) {
    state.editableCollectors = [];
    state.editableActions = [];
    state.baseRevision = null;
    persistedCollectors = [];
    persistedActions = [];
    state.error = String(err?.message ?? err);
    throw err;
  } finally {
    state.loading = false;
    changed();
  }
}

export async function trustWorkspaceCommands() {
  if (api.transport !== "tauri") return false;
  state.error = null;
  try {
    applyEditableOperations(await api.trustCurrentWorkspaceCommands());
    changed("trusted");
    changed();
    return true;
  } catch (err) {
    state.error = String(err?.message ?? err);
    changed("error");
    return false;
  }
}

export async function revokeWorkspaceCommands() {
  if (api.transport !== "tauri") return false;
  state.error = null;
  try {
    await api.revokeCurrentWorkspaceCommands();
    state.customChecksEnabled = false;
    state.localChecksEnabled = false;
    changed("revoked");
    changed();
    return true;
  } catch (err) {
    state.error = String(err?.message ?? err);
    changed("error");
    return false;
  }
}

export function beginOperationsWorkspaceTransition() {
  state.editableCollectors = [];
  state.editableActions = [];
  state.runtimeCollectors = [];
  state.runtimeActions = [];
  state.baseRevision = null;
  state.customChecksEnabled = false;
  state.localChecksEnabled = false;
  state.error = null;
  state.loading = true;
  persistedCollectors = [];
  persistedActions = [];
  changed("loading");
  changed();
}

export function setEditableCollector(collector) {
  const i = state.editableCollectors.findIndex((item) => item.id === collector.id);
  if (i < 0) state.editableCollectors.push(structuredClone(collector));
  else state.editableCollectors[i] = structuredClone(collector);
  state.error = null;
  changed();
}

export function removeEditableCollector(id) {
  state.editableCollectors = state.editableCollectors.filter((item) => item.id !== id);
  state.error = null;
  changed();
}

export function setEditableAction(action) {
  const i = state.editableActions.findIndex((item) => item.id === action.id);
  if (i < 0) state.editableActions.push(structuredClone(action));
  else state.editableActions[i] = structuredClone(action);
  state.error = null;
  changed();
}

export function removeEditableAction(id) {
  state.editableActions = state.editableActions.filter((item) => item.id !== id);
  state.error = null;
  changed();
}

export function removeEditableOperationsForNode(nodeId) {
  const removedCollectors = new Set(
    state.editableCollectors.filter((item) => item.nodeId === nodeId).map((item) => item.id),
  );
  state.editableCollectors = state.editableCollectors.filter((item) => item.nodeId !== nodeId);
  state.editableActions = state.editableActions.filter((item) =>
    item.nodeId !== nodeId && !removedCollectors.has(item.requiresSignal));
  state.error = null;
  changed();
}

export function saveEditableOperations() {
  if (!state.canManage) return Promise.resolve(false);
  saveRequested = true;
  if (savePromise) return savePromise;
  state.saving = true;
  state.error = null;
  changed("saving");
  savePromise = (async () => {
    while (saveRequested) {
      saveRequested = false;
      try {
        const operations = shapeOperationsRequest({
          collectors: state.editableCollectors,
          actions: state.editableActions,
        });
        const result = await api.saveEditableOperations(operations);
        if (result?.rev != null) state.baseRevision = result.rev;
        persistedCollectors = structuredClone(operations.collectors);
        persistedActions = structuredClone(operations.actions);
        changed("saved");
      } catch (err) {
        const message = String(err?.message ?? err);
        state.editableCollectors = structuredClone(persistedCollectors);
        state.editableActions = structuredClone(persistedActions);
        state.error = /stale/i.test(message)
          ? `Operations changed elsewhere. This change was not applied; reload before retrying. (${message})`
          : `Operation change was not applied. ${message}`;
        saveRequested = false;
        changed("error");
        return false;
      }
    }
    return true;
  })().finally(() => {
    state.saving = false;
    savePromise = null;
    changed();
  });
  return savePromise;
}

export function operationsForNode(nodeId) {
  return {
    collectors: state.editableCollectors.filter((item) => item.nodeId === nodeId),
    actions: state.editableActions.filter((item) => item.nodeId === nodeId),
    runtimeCollectors: state.runtimeCollectors.filter((item) => item.nodeId === nodeId),
    runtimeActions: state.runtimeActions.filter((item) => item.nodeId === nodeId),
  };
}

export function nodeHasOperations(nodeId) {
  return [
    ...state.editableCollectors,
    ...state.editableActions,
    ...state.runtimeCollectors,
    ...state.runtimeActions,
  ].some((item) => item.nodeId === nodeId);
}

export function collectorActionReferences(collectorId) {
  return state.editableActions.filter((action) => action.requiresSignal === collectorId);
}
