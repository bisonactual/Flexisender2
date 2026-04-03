import { watch } from "fs";
import { resolve } from "path";

const rootDir = import.meta.dir;
const srcDir = resolve(rootDir, "src");

const reloadSockets = new Set<any>();

// Watch src/ for changes
watch(srcDir, { recursive: true }, (_, filename) => {
  if (!filename) return;
  console.log(`[reload] ${filename} changed`);
  for (const ws of reloadSockets) ws.send("reload");
});

// Also watch the HTML
watch(rootDir, (_, filename) => {
  if (filename === "index.html" || filename === "style.css") {
    console.log(`[reload] ${filename} changed`);
    for (const ws of reloadSockets) ws.send("reload");
  }
});

Bun.serve({
  port: 3000,
  reusePort: true,
  async fetch(req, server) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/ws") {
      if (server.upgrade(req)) return undefined as any;
      return new Response("upgrade failed", { status: 400 });
    }

    if (path === "/" || path === "/index.html") {
      return new Response(Bun.file(`${rootDir}/index.html`), {
        headers: { "content-type": "text/html" },
      });
    }

    if (path === "/style.css") {
      return new Response(Bun.file(`${rootDir}/style.css`), {
        headers: { "content-type": "text/css" },
      });
    }

    if (path === "/bundle.js") {
      try {
        const result = await Bun.build({
          entrypoints: [`${srcDir}/main.ts`],
          format: "esm",
          minify: false,
        });
        if (!result.success) {
          const errors = result.logs.map(l => l.message).join("\n");
          console.error("[build error]", errors);
          return new Response("// BUILD ERROR\n" + errors, {
            headers: { "content-type": "application/javascript" },
            status: 500,
          });
        }
        const js = await result.outputs[0].text();
        return new Response(js, {
          headers: { "content-type": "application/javascript" },
        });
      } catch (e: any) {
        console.error("[app.js exception]", e);
        return new Response("// EXCEPTION: " + e.message, {
          headers: { "content-type": "application/javascript" },
          status: 500,
        });
      }
    }

    console.warn(`[404] ${path}`);
    return new Response("not found", { status: 404 });
  },
  websocket: {
    open(ws) { reloadSockets.add(ws); },
    close(ws) { reloadSockets.delete(ws); },
    message() {},
  },
});

console.log("FlexiSender dev server → http://localhost:3000");
