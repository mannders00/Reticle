// Pure projections between the backend operational graph and the editable
// frontend topology. Keep runtime graph data out of persisted topology files.

const STATE_RANK = { unknown: 0, ok: 1, warn: 2, err: 3 };

function signalHealth(signal, missingObservedAt) {
  return {
    state: signal.state,
    lastCheck: signal.observedAt == null ? missingObservedAt : signal.observedAt * 1000,
    detail: typeof signal.detail === "string" ? signal.detail : JSON.stringify(signal.detail),
  };
}

/** Project each graph node's worst signal into the card health model. */
export function projectGraphHealth(graph, missingObservedAt = null) {
  const health = Object.fromEntries(Object.keys(graph?.nodes ?? {}).map((id) => [id, {
    state: "unknown",
    lastCheck: null,
    detail: "no signal",
  }]));

  for (const signal of Object.values(graph?.signals ?? {})) {
    if (!health[signal.nodeId]) continue;
    if ((STATE_RANK[signal.state] ?? 0) >= (STATE_RANK[health[signal.nodeId].state] ?? 0)) {
      health[signal.nodeId] = signalHealth(signal, missingObservedAt);
    }
  }
  return health;
}

/** Convert a canonical operational graph into the frontend topology shape. */
export function graphToTopology(graph) {
  const health = projectGraphHealth(graph);
  const nodes = Object.fromEntries(Object.entries(graph?.nodes ?? {}).map(([id, node]) => [id, {
    ...node,
    health: health[id],
    actions: [],
    crons: [],
  }]));

  for (const action of Object.values(graph?.actions ?? {})) {
    if (nodes[action.nodeId]) nodes[action.nodeId].actions.push(action);
  }

  return {
    version: graph?.version ?? 1,
    nodes,
    edges: graph?.edges ?? {},
  };
}

/** Strip operational-only node data before writing the editable topology. */
export function serializeTopology(topology) {
  const nodes = Object.fromEntries(Object.entries(topology.nodes).map(([id, node]) => {
    const { health, actions, crons, ...persisted } = node;
    return [id, persisted];
  }));
  return {
    version: topology.version || 1,
    nodes,
    edges: topology.edges,
  };
}
