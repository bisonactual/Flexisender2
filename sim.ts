import { spawn, file } from "bun";

const SIM_TCP_PORT = 23000;
const WS_PORT = 7000;
const SIM_PATH = "./Simulator/build/grblHAL_sim";
const LOG_PATH = "./sim-bridge.log";
const VERSION = "0.0.2";

console.log(`sim-bridge v${VERSION}`);

const logFile = file(LOG_PATH).writer();

function log(msg: string, quiet = false) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  if (!quiet) process.stdout.write(line);
  logFile.write(line);
  logFile.flush();
}

log(`Spawning ${SIM_PATH} -p ${SIM_TCP_PORT}`);

const sim = spawn([SIM_PATH, "-p", String(SIM_TCP_PORT)], {
  stdout: "inherit",
  stderr: "inherit",
});

log(`PID ${sim.pid}`);

await Bun.sleep(500);

let tcpSocket: ReturnType<typeof Bun.connect> extends Promise<infer T> ? T : never;
let wsClient: any = null;

function preview(data: Buffer | Uint8Array | string) {
  const s = typeof data === "string" ? data : new TextDecoder().decode(data);
  const clean = s.replace(/\r/g, "\\r").replace(/\n/g, "\\n");
  return clean.length > 300 ? clean.slice(0, 300) + "…" : clean;
}

async function connectTcp() {
  log(`TCP connecting to 127.0.0.1:${SIM_TCP_PORT}...`);
  return Bun.connect({
    hostname: "127.0.0.1",
    port: SIM_TCP_PORT,
    socket: {
      data(_socket, data) {
        const text = new TextDecoder().decode(data);
        log(`sim→ws ${data.length}B: ${preview(text)}`, true);
        if (wsClient && wsClient.readyState === 1) {
          wsClient.send(text);  // send as TEXT frame, not binary
        } else {
          log(`sim→ws DROPPED (no ws client)`);
        }
      },
      open() {
        log("TCP connected to sim");
      },
      close() {
        log("TCP closed");
      },
      error(_socket, err) {
        log(`TCP error: ${err.message}`);
      },
      connectError(_socket, err) {
        log(`TCP connect failed: ${err.message}`);
      },
    },
  });
}

const server = Bun.serve({
  port: WS_PORT,
  fetch(req, server) {
    const url = new URL(req.url);
    log(`HTTP ${req.method} ${url.pathname} — upgrading`);
    if (server.upgrade(req)) return;
    return new Response("FlexiSender sim bridge", { status: 200 });
  },
  websocket: {
    async open(ws) {
      log("WS client connected");
      wsClient = ws;
      try {
        tcpSocket = await connectTcp();
      } catch (e: any) {
        log(`WS open — TCP connect failed: ${e.message}`);
        ws.close(1011, "sim not reachable");
      }
    },
    message(_ws, msg) {
      const data = typeof msg === "string" ? msg : new TextDecoder().decode(msg);
      log(`ws→sim ${data.length}B: ${preview(data)}`, true);
      if (tcpSocket) {
        tcpSocket.write(data);
      } else {
        log("ws→sim DROPPED (no tcp)");
      }
    },
    close(_ws, code, reason) {
      log(`WS closed code=${code} reason=${reason}`);
      wsClient = null;
      if (tcpSocket) tcpSocket.end();
    },
  },
});

log(`WebSocket on ws://localhost:${WS_PORT}`);

process.on("SIGINT", () => {
  log("Shutting down");
  logFile.end();
  sim.kill();
  server.stop();
  process.exit(0);
});
