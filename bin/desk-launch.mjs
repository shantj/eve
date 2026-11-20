// Finder entry point: detach the service from the launcher and open the ordinary browser.
import { spawn, execFile } from "node:child_process";
import { open, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
const cwd = fileURLToPath(new URL("../", import.meta.url)),
  port = Number(process.env.EVE_DESK_PORT || 4317),
  url = "http://127.0.0.1:" + port;
async function online() {
  try {
    const r = await fetch(url + "/api/health", {
      signal: AbortSignal.timeout(600),
    });
    return (await r.json()).app === "eve-desk";
  } catch {
    return false;
  }
}
if (!(await online())) {
  await mkdir(join(cwd, ".eve"), { recursive: true });
  const path = join(cwd, ".eve", "desk.log"),
    log = await open(path, "a", 0o600);
  const worker = spawn(process.execPath, [join(cwd, "bin", "desk.mjs")], {
    cwd,
    detached: true,
    stdio: ["ignore", log.fd, log.fd],
  });
  worker.unref();
  await log.close();
  for (let i = 0; i < 40 && !(await online()); i++) await wait(150);
  if (!(await online())) throw Error("服务未能启动。检查端口或查看 " + path);
}
console.log("工作台：" + url + " （可以关闭这个启动窗口）");
if (!process.argv.includes("--no-open"))
  execFile("/usr/bin/open", [url], (e) => {
    if (e) console.error("请在浏览器打开 " + url);
  });
