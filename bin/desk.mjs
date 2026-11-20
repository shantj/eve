#!/usr/bin/env node
import { execFile } from "node:child_process";
import { deskServer } from "../src/desk.mjs";
import { loadSettings } from "../src/desk-settings.mjs";
const port = Number(process.env.EVE_DESK_PORT || 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw Error("EVE_DESK_PORT 无效");
const url = "http://127.0.0.1:" + port;
const openBrowser = () => {
  if (process.argv.includes("--open") && process.platform === "darwin")
    execFile("/usr/bin/open", [url], () => {});
};
await loadSettings();
const app = deskServer();
app.on("error", async (e) => {
  if (e.code === "EADDRINUSE") {
    try {
      const r = await fetch(url + "/api/desk", {
        signal: AbortSignal.timeout(2000),
      });
      if ((await r.json()).app === "eve-desk") {
        console.log("工作台已启动：" + url);
        openBrowser();
        return;
      }
    } catch {}
  }
  console.error("无法启动：" + e.message);
  process.exitCode = 1;
});
app.listen(port, "127.0.0.1", () => {
  console.log(
    "EVE CEO 工作台：" +
      url +
      "\n关闭浏览器不影响团队执行；结束此服务会停止后台工作。",
  );
  openBrowser();
});
