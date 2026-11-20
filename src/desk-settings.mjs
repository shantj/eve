import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { roster } from "./roles.mjs";
import { checkedEffort, modelPolicy, roleOverride } from "./model-policy.mjs";
import { root } from "./files.mjs";
import { maestroURL, isMaestro } from "./drivers.mjs";

// Only the desk process loads this file. CLI users keep their environment-based setup.
const file = join(dirname(root), "desk-settings.json");
const names = {
  model: "EVE_MODEL",
  url: "EVE_MODEL_URL",
  key: "EVE_API_KEY",
  mode: "EVE_JSON_MODE",
  effort: "EVE_REASONING_EFFORT",
};
function apply(c) {
  for (const [k, n] of Object.entries(names)) {
    if (c[k]) process.env[n] = c[k];
    else delete process.env[n];
  }
  if (c.roles)
    for (const owner of Object.keys(roster)) {
      const custom = c.roles[owner] || {};
      for (const [name, v] of [
        ["EVE_MODEL_", custom.model],
        ["EVE_REASONING_EFFORT_", custom.effort],
      ]) {
        const key = name + owner.toUpperCase();
        if (v) process.env[key] = v;
        else delete process.env[key];
      }
    }
}
export async function loadSettings() {
  try {
    apply(JSON.parse(await readFile(file, "utf8")));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}
export function settings() {
  return {
    ...modelPolicy(),
    roles: Object.fromEntries(
      Object.keys(roster).map((owner) => [owner, roleOverride(owner)]),
    ),
    url: process.env.EVE_MODEL_URL || maestroURL,
    provider: isMaestro(process.env.EVE_MODEL_URL || maestroURL)
      ? "Agent Maestro · Responses"
      : "Chat Completions",
    hasKey: Boolean(process.env.EVE_API_KEY),
    mode: process.env.EVE_JSON_MODE === "object" ? "object" : "schema",
  };
}
export async function setSettings(input) {
  const old = settings();
  const url = new URL(input.url);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !(
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
    )
  )
    throw Error("服务地址须为 HTTPS 或本机 HTTP，不能包含凭据或查询参数。");
  const clean = (u) => new URL(u).href.replace(/\/+$/, "");
  const c = {
    url: clean(input.url),
    model: String(input.model || "").trim(),
    mode: input.mode === "object" ? "object" : "schema",
    effort: checkedEffort(input.effort ?? old.effort),
    roles: { ...old.roles },
  };
  if (input.roles !== undefined) {
    if (
      !input.roles ||
      typeof input.roles !== "object" ||
      Array.isArray(input.roles)
    )
      throw Error("岗位配置格式错误");
    for (const [owner, custom] of Object.entries(input.roles)) {
      if (
        !Object.hasOwn(roster, owner) ||
        !custom ||
        typeof custom !== "object" ||
        Array.isArray(custom) ||
        typeof (custom.model ?? "") !== "string"
      )
        throw Error("无效岗位配置");
      c.roles[owner] = {
        model: (custom.model ?? "").trim(),
        effort: custom.effort ? checkedEffort(custom.effort) : "",
      };
    }
  }
  if (!c.model) throw Error("请输入模型名称。");
  c.key =
    String(input.key || "").trim() ||
    (clean(old.url) === c.url && !input.clearKey
      ? process.env.EVE_API_KEY || ""
      : "");
  await mkdir(dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID();
  await writeFile(tmp, JSON.stringify(c), { mode: 0o600, flag: "wx" });
  await rename(tmp, file);
  apply(c);
  return settings();
}
