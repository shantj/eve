import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm, open } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
export const root = resolve(process.env.EVE_HOME || ".eve/runs");
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function runDir(id) {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw Error("无效项目编号");
  return join(root, id);
}
export const json = async (path) => JSON.parse(await readFile(path, "utf8"));
export async function save(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = path + "." + randomUUID() + ".tmp";
  await writeFile(
    tmp,
    typeof data === "string" || ArrayBuffer.isView(data)
      ? data
      : JSON.stringify(data, null, 2) + "\n",
  );
  await rename(tmp, path);
}
// A stopped Mac cannot release a PID file. Reclaim only a provably dead owner;
// serialize recovery so a second desk cannot unlink a newly acquired live lock.
export async function lockState(dir) {
  const path = join(dir, ".lock");
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const pid = Number(raw);
  if (!Number.isInteger(pid) || pid < 1 || pid > 2147483647)
    return { pid: null, dead: false };
  try {
    process.kill(pid, 0);
  } catch (e) {
    return { pid, dead: e.code === "ESRCH" };
  }
  return { pid, dead: false };
}
export async function locked(dir, fn) {
  const path = join(dir, ".lock");
  let lock;
  try {
    lock = await open(path, "wx");
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const owner = await lockState(dir);
    if (!owner?.dead)
      throw Error("项目已锁定。请等待正在运行的任务结束：" + path);
    const guard = await open(path + ".recovery", "wx");
    try {
      const current = await lockState(dir);
      if (!current?.dead || current.pid !== owner.pid)
        throw Error("项目锁已更新，请刷新。");
      await rm(path);
      lock = await open(path, "wx");
    } finally {
      await guard.close();
      await rm(path + ".recovery", { force: true });
    }
  }
  try {
    await lock.writeFile(String(process.pid));
    return await fn();
  } finally {
    await lock.close();
    await rm(path, { force: true });
  }
}
