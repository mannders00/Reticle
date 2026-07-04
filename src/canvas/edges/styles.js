// canvas/edges/styles.js
// Per-edge-kind visual style. Edges in v1 are simple coloured béziers;
// Module 3 adds orthogonal routing, ports and arrowheads. Styles live here
// so palette / detail panel / exporter can all agree on look without
// reaching into the renderer.

export const EDGE_STYLES = {
  ethernet:    { color: "#aab2c5", width: 2.2, dash: null,        arrow: true },
  tcp:         { color: "#5b8cff", width: 1.7, dash: null,        arrow: true },
  udp:         { color: "#5b8cff", width: 1.7, dash: "1 4",       arrow: true },
  http:        { color: "#2ec27e", width: 1.7, dash: null,        arrow: true },
  https:       { color: "#2ec27e", width: 1.7, dash: null,        arrow: true, lock: true },
  grpc:        { color: "#a78bfa", width: 1.7, dash: "5 3 1 3",   arrow: true },
  replication: { color: "#f5a623", width: 1.7, dash: "6 5",       arrow: true },
  peering:     { color: "#7aa2f7", width: 2.4, dash: null,        arrow: false, double: true },
  tunnel:      { color: "#9b8cff", width: 1.7, dash: "5 4",       arrow: true, lock: true },
  "routes-to": { color: "#6b7589", width: 1.4, dash: "2 4",       arrow: true },
  mgmt:        { color: "#4a5366", width: 1.3, dash: "2 3",       arrow: false, muted: true },
  fanout:      { color: "#2ec27e", width: 1.7, dash: null,        arrow: true },
  "depends-on":{ color: "#6b7589", width: 1.3, dash: "2 5",       arrow: true },
  custom:      { color: "#5b8cff", width: 1.6, dash: null,        arrow: true },
};

export const EDGE_LABELS = {
  ethernet: "ethernet",
  tcp: "tcp",
  udp: "udp",
  http: "http",
  https: "https",
  grpc: "grpc",
  replication: "replication",
  peering: "peering",
  tunnel: "tunnel",
  "routes-to": "routes",
  mgmt: "mgmt",
  fanout: "fanout",
  "depends-on": "depends",
  custom: "custom",
};

export const EDGE_KINDS = Object.keys(EDGE_STYLES);