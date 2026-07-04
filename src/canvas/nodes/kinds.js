// canvas/nodes/kinds.js
// The taxonomy catalog — every node kind Reticle understands. Each entry
// drives the card visual (icon + default size + tint accent), the
// available interaction modes (ssh / kubectl / destructive / none), the
// health probe class, and the starter actions seeded on creation.
//
// Group kinds (`isGroup: true`) render as a dashed boundary rather than a
// card and contain other nodes; moving them moves their children.

export const CATEGORIES = [
  { id: "compute", label: "Compute", color: "#5b8cff" },
  { id: "data", label: "Data", color: "#a78bfa" },
  { id: "network", label: "Network", color: "#2ec27e" },
  { id: "composite", label: "Kubernetes", color: "#3aa0ff" },
  { id: "cloud-group", label: "Cloud Groups", color: "#f5a623" },
  { id: "network-group", label: "Network Segments", color: "#7aa2f7" },
  { id: "misc", label: "Misc", color: "#6b7589" },
];

export const KINDS = {
  // ---- compute ----------------------------------------------------------
  server: { label: "Server", category: "compute", size: [220, 120], modes: ["ssh"], health: ["tcp"], actions: ["df -h", "free -m", "uptime", "systemctl status"] },
  // A docker/podman container ON A HOST (not k8s — that's Pod). SSH to
  // the host it runs on; docker commands run there via that ssh.
  container: { label: "Container", category: "compute", size: [150, 100], modes: ["ssh"], health: ["tcp", "exec"], actions: ["docker ps --filter name=myctr", "docker logs --tail 80 myctr"] },
  vm: { label: "VM", category: "compute", size: [200, 110], modes: ["ssh"], health: ["tcp"], actions: ["df -h", "free -m"] },
  // A process/service on a machine — nginx, your API, a systemd unit.
  // SSH to its host; health = TCP on the app's own port.
  app: { label: "Application", category: "compute", size: [200, 110], modes: ["ssh"], health: ["tcp"], actions: ["systemctl status myapp --no-pager", "journalctl -u myapp -n 80 --no-pager"] },
  pod: { label: "Pod", category: "composite", size: [160, 110], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl logs --tail=80", "kubectl describe pod"] },
  daemonset: { label: "DaemonSet", category: "composite", size: [160, 110], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get pods -l app=daemonset"] },
  statefulset: { label: "StatefulSet", category: "composite", size: [170, 120], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get pods", "kubectl rollout status"] },
  deployment: { label: "Deployment", category: "composite", size: [170, 120], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl rollout status", "kubectl get pods"] },
  cluster: { label: "Cluster", category: "composite", size: [280, 180], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get nodes", "kubectl get pods -A"] },
  knode: { label: "K8s Node", category: "composite", size: [200, 120], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl describe node", "kubectl get pods -A --field-selector spec.nodeName=$NAME"] },

  // ---- data -------------------------------------------------------------
  database: { label: "Database", category: "data", size: [180, 150], modes: ["ssh"], health: ["tcp", "exec"], actions: ["pg_isready", "mysqladmin status", "redis-cli ping"] },
  cache: { label: "Cache", category: "data", size: [160, 140], modes: ["ssh"], health: ["tcp", "exec"], actions: ["redis-cli ping", "redis-cli info memory"] },
  queue: { label: "Queue", category: "data", size: [180, 140], modes: ["ssh"], health: ["tcp", "exec"], actions: ["kafka-topics --list", "rabbitmqctl list_queues"] },
  "object-store": { label: "Object Store", category: "data", size: [180, 140], modes: ["ssh"], health: ["tcp"], actions: ["aws s3 ls", "gsutil ls"] },

  // ---- network ----------------------------------------------------------
  "load-balancer": { label: "Load Balancer", category: "network", size: [220, 120], modes: ["ssh"], health: ["tcp", "http"], actions: ["show backends", "curl -s localhost/stats"] },
  switch: { label: "Switch", category: "network", size: [180, 110], modes: ["ssh"], health: ["tcp"], actions: ["show interfaces", "show mac address-table"] },
  router: { label: "Router", category: "network", size: [180, 110], modes: ["ssh"], health: ["tcp"], actions: ["show ip route", "show interfaces"] },
  firewall: { label: "Firewall", category: "network", size: [180, 120], modes: ["ssh"], health: ["tcp"], actions: ["show rules", "show connections"] },
  vpn: { label: "VPN", category: "network", size: [180, 120], modes: ["ssh"], health: ["tcp"], actions: ["show tunnels", "show status"] },
  bastion: { label: "Bastion", category: "network", size: [180, 120], modes: ["ssh"], health: ["tcp"], actions: ["who", "last -n 20"] },
  dns: { label: "DNS", category: "network", size: [160, 100], modes: ["none"], health: ["http"], actions: ["dig example.com", "nslookup example.com"] },
  cdn: { label: "CDN", category: "network", size: [180, 140], modes: ["none"], health: ["http"], actions: ["curl -I https://edge"] },

  // ---- network & cloud groups -------------------------------------------
  lan: { label: "LAN", category: "network-group", size: [400, 280], modes: ["none"], isGroup: true },
  wan: { label: "WAN", category: "network-group", size: [600, 420], modes: ["none"], isGroup: true },
  vpc: { label: "VPC", category: "cloud-group", size: [640, 420], modes: ["none"], isGroup: true },
  region: { label: "Region", category: "cloud-group", size: [800, 560], modes: ["none"], isGroup: true },
  zone: { label: "Zone", category: "cloud-group", size: [360, 280], modes: ["none"], isGroup: true },
  subnet: { label: "Subnet", category: "cloud-group", size: [320, 200], modes: ["none"], isGroup: true },
  "security-group": { label: "Security Group", category: "cloud-group", size: [360, 280], modes: ["none"], isGroup: true },

  // ---- composite --------------------------------------------------------
  service: { label: "Service", category: "composite", size: [160, 100], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get svc", "kubectl describe svc"] },
  ingress: { label: "Ingress", category: "composite", size: [160, 100], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get ingress", "kubectl describe ingress"] },
  gateway: { label: "Gateway", category: "composite", size: [160, 110], modes: ["kubectl"], health: ["kubectl"], actions: ["kubectl get gateway", "kubectl describe gateway"] },

  // A machine as a BOUNDING BOX — draw the host, drop its applications
  // and containers inside. The children carry the ssh endpoints (each
  // node's spec is what its actions/crons run against); the host box is
  // the visual scope. Lives in compute so it's next to Server/App.
  host: { label: "Host", category: "compute", size: [460, 320], modes: ["none"], isGroup: true },

  // ---- misc -------------------------------------------------------------
  generic: { label: "Generic", category: "misc", size: [180, 120], modes: ["ssh"], health: ["tcp"], actions: [] },
  note: { label: "Note", category: "misc", size: [180, 140], modes: ["none"], health: [] },
  // A free-form container: group anything under any label (a rack, an
  // office, a team, "legacy stuff") without cloud/network semantics.
  box: { label: "Box", category: "misc", size: [420, 300], modes: ["none"], isGroup: true },
};

export function kindMeta(id) {
  return (
    KINDS[id] || {
      label: id,
      category: "misc",
      size: [180, 120],
      modes: ["none"],
      health: [],
      actions: [],
    }
  );
}

export function categoryOf(id) {
  return kindMeta(id).category;
}

export function isGroupKind(id) {
  return !!kindMeta(id).isGroup;
}

/** Attachable resources ("add-ons"): secondary items that decorate a node
 *  — a GPU, an extra volume, a public IP. Pure indicators: no health, no
 *  execution, just facts about the box, persisted with it. */
export const ADDONS = {
  gpu:  { label: "GPU",     hint: "2× A100 80G" },
  disk: { label: "Disk",    hint: "2TB NVMe" },
  ram:  { label: "RAM",     hint: "128G ECC" },
  cpu:  { label: "CPU",     hint: "32c EPYC" },
  nic:  { label: "NIC",     hint: "10GbE" },
  ip:   { label: "IP",      hint: "203.0.113.7" },
  cert: { label: "TLS cert", hint: "*.example.com" },
  ups:  { label: "UPS",     hint: "1500VA" },
  misc: { label: "Misc",    hint: "anything" },
};

/** Group KINDS by category id, in CATEGORIES order. */
export function kindsByCategory() {
  const byCat = {};
  for (const c of CATEGORIES) byCat[c.id] = [];
  for (const [id, meta] of Object.entries(KINDS)) {
    if (!byCat[meta.category]) byCat[meta.category] = [];
    byCat[meta.category].push({ id, ...meta });
  }
  return CATEGORIES.map((c) => ({ ...c, kinds: byCat[c.id] || [] }));
}