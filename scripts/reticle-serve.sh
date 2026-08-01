#!/usr/bin/env bash
cd /Users/matt/doc/dev/pro/reticle
exec bun -e '
Bun.serve({
  port: 8787,
  async fetch(req) {
    const url = new URL(req.url);
    let p = url.pathname === "/" ? "/index.html" : url.pathname;
    const f = Bun.file("./src" + p);
    if (await f.exists()) return new Response(f);
    return new Response(Bun.file("./src/index.html"));
  },
});
'
