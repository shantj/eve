import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, join, isAbsolute } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { root } from "./files.mjs";
const file = join(dirname(root), "release-account.json");
async function stored() {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
export async function account() {
  return {
    team: process.env.ASC_TEAM_ID || "",
    keyId: process.env.ASC_KEY_ID || "",
    issuer: process.env.ASC_ISSUER_ID || "",
    keyFile: process.env.ASC_KEY_FILE || "",
    email: "",
    host: "",
    user: "",
    port: 993,
    enabled: false,
    password: "",
    ...(await stored()),
  };
}
export function publicAccount({ password, ...c }) {
  return { ...c, hasPassword: !!password };
}
export function mailboxId(c) {
  return createHash("sha256")
    .update(JSON.stringify([c.host, c.port, c.user]))
    .digest("hex");
}
export async function saveAccount(input) {
  const old = await account(),
    c = { ...old };
  for (const k of [
    "team",
    "email",
    "keyId",
    "issuer",
    "keyFile",
    "host",
    "user",
  ])
    if (Object.hasOwn(input, k)) c[k] = String(input[k] || "").trim();
  if (input.port !== undefined) c.port = Number(input.port);
  if (input.enabled !== undefined) c.enabled = input.enabled === true;
  if (c.team && !/^[A-Z0-9]{10}$/.test(c.team))
    throw Error("Team ID 应为 10 位大写字母或数字");
  if (c.keyId && !/^[A-Z0-9]{10}$/.test(c.keyId))
    throw Error("Key ID 应为 10 位大写字母或数字");
  if (c.issuer && !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(c.issuer))
    throw Error("Issuer ID 应为 UUID");
  if (c.keyFile && !(isAbsolute(c.keyFile) && c.keyFile.endsWith(".p8")))
    throw Error("请填写本机 .p8 文件的绝对路径");
  if (c.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email))
    throw Error("请填写有效的提审账号邮箱");
  if (c.host && !/^[a-z0-9.-]+$/i.test(c.host))
    throw Error("请填写 IMAP 主机名");
  if (!Number.isInteger(c.port) || c.port < 1 || c.port > 65535)
    throw Error("IMAP TLS 端口无效");
  c.password =
    String(input.password || "") ||
    (mailboxId(c) === mailboxId(old) && input.clearPassword !== true
      ? old.password
      : "");
  if (
    c.enabled &&
    !(
      c.host &&
      c.user &&
      c.password &&
      c.email &&
      c.keyId &&
      c.issuer &&
      c.keyFile
    )
  )
    throw Error("启用监听前，请填好收件箱及 App Store Connect API 配置");
  await mkdir(dirname(file), { recursive: true });
  const temp = file + "." + randomUUID();
  await writeFile(temp, JSON.stringify(c), { mode: 0o600, flag: "wx" });
  await rename(temp, file);
  return publicAccount(c);
}
