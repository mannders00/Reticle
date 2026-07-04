// app/TerminalDock.js
// Terminal manager for the right panel. Creates xterm.js instances inside
// RightPanel-managed tabs. Each shell gets its own tab with a close button
// and a maximize button.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { h } from "../core/dom.js";
import { bus } from "../core/eventBus.js";
import { getState } from "../core/store.js";
import { kindMeta } from "../canvas/nodes/kinds.js";
import { terminalTheme } from "../core/theme.js";
import api from "../core/api.js";

const shells = new Map(); // nodeId → { term, fitAddon, container, activate }

export function createTerminalManager(bodyEl, addTab, removeTab, switchTab) {
  function openShell(nodeId) {
    const node = getState().topology.nodes[nodeId];
    if (!node) return;
    const meta = kindMeta(node.kind);
    if (!meta.modes.includes("ssh") && !meta.modes.includes("kubectl")) {
      bus.emit("terminal:error", { error: `${meta.label} nodes don't support shells` });
      return;
    }

    // If already open, just switch to it
    if (shells.has(nodeId)) {
      switchTab("term-" + nodeId);
      return;
    }

    const title = node.spec?.host
      ? `${node.spec.user || "?"}@${node.spec.host}`
      : `${node.title}`;

    const container = h("div", { class: "terminal-instance", "data-node": nodeId });
    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, "Cascadia Code", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 10000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    const entry = {
      term, fitAddon, container,
      activate: () => setTimeout(() => fitAddon.fit(), 50),
    };
    shells.set(nodeId, entry);

    addTab("term-" + nodeId, title, container, {
      closeable: true,
      onClose: () => closeShell(nodeId),
    });
    switchTab("term-" + nodeId);

    const ro = new ResizeObserver(() => fitAddon.fit());
    ro.observe(container);
    entry.ro = ro;

    term.onData((data) => {
      if (api.ready) api.writeShell(nodeId, data);
    });
    term.onResize(({ cols, rows }) => {
      if (api.ready) api.resizeShell(nodeId, cols, rows);
    });

    // Connect
    if (api.ready && node.spec?.host) {
      connectSSH(nodeId, node, term, fitAddon);
    } else if (meta.modes.includes("kubectl")) {
      connectKubectl(nodeId, node, term, fitAddon);
    } else {
      term.writeln("\x1b[33mReticle preview mode — no backend connected.\x1b[0m");
      term.writeln(`\x1b[2mNode: ${title}\x1b[0m`);
      if (node.spec?.host) {
        term.writeln(`\x1b[2mWould open: ssh ${node.spec?.user || "user"}@${node.spec?.host}\x1b[0m`);
      } else if (meta.modes.includes("kubectl")) {
        term.writeln(`\x1b[2mWould open: kubectl exec -it <pod> -- /bin/sh\x1b[0m`);
        term.writeln(`\x1b[2mMock pods: nginx-pod-abc123, nginx-pod-def456, redis-pod-xyz789\x1b[0m`);
      }
      term.writeln("");
      term.write("$ ");
    }

    term.focus();
  }

  async function connectSSH(nodeId, node, term, fitAddon) {
    try {
      const unlisten = await api.listenShell(nodeId, (data) => term.write(data));
      const e = shells.get(nodeId);
      if (e) e.unlisten = unlisten;
      const { cols, rows } = term;
      await api.openShell(nodeId, node.spec.host, node.spec.port ?? 22, node.spec.user ?? "", cols, rows);
    } catch (err) {
      term.write(`\r\n\x1b[31mFailed to connect: ${String(err)}\x1b[0m\r\n`);
    }
  }

  async function connectKubectl(nodeId, node, term, fitAddon) {
    const ctx = node.spec?.kubeContext || "";
    const ns = node.spec?.namespace || "";
    if (node.spec?.pod) {
      await execKubectl(nodeId, node, node.spec.pod, node.spec.container, term);
      return;
    }
    term.writeln(`\x1b[36mFetching pods in ${ctx || "current-context"}/${ns || "default"}...\x1b[0m`);
    try {
      const pods = api.ready
        ? await api.listPods(ctx, ns, node.spec?.selector)
        : ["nginx-pod-abc123", "nginx-pod-def456", "redis-pod-xyz789"];
      if (pods.length === 0) {
        term.writeln("\x1b[31mNo pods found.\x1b[0m");
        term.write("$ ");
        return;
      }
      if (pods.length === 1) {
        await execKubectl(nodeId, node, pods[0], null, term);
        return;
      }
      term.writeln("\x1b[33mMultiple pods found. Select one:\x1b[0m");
      pods.forEach((p, i) => term.writeln(`  \x1b[36m${i + 1}\x1b[0m  ${p}`));
      term.writeln("");
      let buffer = "";
      const onData = (data) => {
        buffer += data;
        term.write(data);
        if (data === "\r" || data === "\n") {
          term.writeln("");
          const idx = parseInt(buffer.trim(), 10) - 1;
          term.offData(onData);
          if (idx >= 0 && idx < pods.length) {
            execKubectl(nodeId, node, pods[idx], null, term);
          } else {
            term.writeln("\x1b[31mInvalid selection.\x1b[0m");
            term.write("$ ");
          }
          buffer = "";
        }
      };
      term.onData(onData);
      term.write("Pod number: ");
    } catch (err) {
      term.write(`\r\n\x1b[31mFailed to list pods: ${String(err)}\x1b[0m\r\n`);
      term.write("$ ");
    }
  }

  async function execKubectl(nodeId, node, pod, container, term) {
    if (!api.ready) {
      term.writeln(`\x1b[2m[preview] kubectl exec -it ${pod} -- /bin/sh\x1b[0m`);
      term.writeln(`\x1b[2m[preview] context=${node.spec?.kubeContext || "default"} ns=${node.spec?.namespace || "default"}\x1b[0m`);
      term.writeln("");
      term.write("$ ");
      return;
    }
    try {
      const unlisten = await api.listenShell(nodeId, (data) => term.write(data));
      const e = shells.get(nodeId);
      if (e) e.unlisten = unlisten;
      const { cols, rows } = term;
      await api.openKubectlShell(nodeId, node.spec?.kubeContext, node.spec?.namespace, pod, container, cols, rows);
    } catch (err) {
      term.write(`\r\n\x1b[31mFailed to exec: ${String(err)}\x1b[0m\r\n`);
    }
  }

  function closeShell(nodeId) {
    const e = shells.get(nodeId);
    if (!e) return;
    e.ro?.disconnect();
    e.unlisten?.();
    e.term.dispose();
    e.container.remove();
    shells.delete(nodeId);
    if (api.ready) api.closeShell(nodeId).catch(() => {});
    removeTab("term-" + nodeId);
  }

  // Follow theme changes
  bus.on("theme:changed", ({ mode }) => {
    const t = terminalTheme(mode);
    for (const e of shells.values()) e.term.options.theme = t;
  });

  // Cleanup on unload
  window.addEventListener("beforeunload", () => {
    for (const id of [...shells.keys()]) closeShell(id);
  });

  return { openShell, closeShell };
}