import { ImapFlow } from "imapflow";
import { dirname, join } from "node:path";
import { readdir } from "node:fs/promises";
import { account, mailboxId } from "./release-account.mjs";
import { root, json, save } from "./files.mjs";
import { readRun } from "./company.mjs";
import { sync } from "./publish.mjs";
const statusFile = join(dirname(root), "review-mail-status.json");
export const pendingPhases = [
  "uploading",
  "uploaded",
  "submitting",
  "submitted",
];
const now = () => new Date().toISOString();
export async function mailStatus() {
  try {
    return await json(statusFile);
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
}
// Only EXAMINE INBOX and fetch matching senders' envelopes. Never fetch the body or set a read flag.
export async function pollMailbox(
  c,
  cursor,
  connectOnly = false,
  connect = (options) => new ImapFlow(options),
) {
  const client = connect({
    host: c.host,
    port: c.port,
    secure: true,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: c.user, pass: c.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
  });
  client.on("error", () => {});
  try {
    await client.connect();
    const box = await client.mailboxOpen("INBOX", { readOnly: true });
    if (connectOnly) return;
    const validity = String(box.uidValidity),
      last = Number(box.uidNext) - 1;
    if (!Number.isSafeInteger(last) || last < 0) throw Error("UIDNEXT");
    const known = cursor?.validity === validity,
      prev = known ? cursor.last : 0;
    let matched = false;
    if (last > prev) {
      const filter = { from: "apple.com", uid: prev + 1 + ":" + last };
      if (!known) filter.since = new Date(Date.now() - 86400_000);
      const ids = await client.search(filter, { uid: true });
      if (ids?.length) {
        for (const m of await client.fetchAll(
          ids,
          { envelope: true },
          { uid: true },
        )) {
          if (
            m.envelope?.from?.some((a) =>
              /@(?:[a-z0-9-]+\.)*apple\.com$/i.test(a.address || ""),
            )
          ) {
            matched = true;
            break;
          }
        }
      }
    }
    return { cursor: { validity, last }, matched };
  } catch {
    throw Error(
      "IMAP 连接或读取失败。请检查 TLS 主机、账号、邮箱专用密码及 IMAP 权限。",
    );
  } finally {
    client.close();
  }
}
async function projects() {
  let names = [];
  try {
    names = await readdir(root);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const all = [];
  for (const id of names.filter((n) => /^[a-z0-9][a-z0-9-]{0,80}$/.test(n))) {
    try {
      all.push(await readRun(id));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  return all;
}
export function mailWatcher({
  read = pollMailbox,
  candidates = projects,
  reconcile = sync,
  config = account,
} = {}) {
  let busy = false,
    timer;
  async function check(test = false) {
    if (busy) throw Error("邮箱正在检查，请稍后再试");
    busy = true;
    try {
      const c = await config();
      if (test) {
        if (!(c.host && c.user && c.password))
          throw Error("请先保存 IMAP 配置");
        await read(c, null, true);
        return { ok: true };
      }
      if (!c.enabled) return { enabled: false };
      const key = mailboxId(c),
        old = await mailStatus();
      const previous = old.mailbox === key ? old : {};
      const state = { ...previous, mailbox: key, checkedAt: now(), error: "" };
      try {
        let next = { matched: false };
        try {
          next = await read(c, previous.cursor);
          state.cursor = next.cursor;
        } catch (e) {
          state.error = e.message;
        }
        if (next.matched) state.lastSignal = now();
        // Mail is a wakeup, not proof: titles, forwarded messages and localization cannot identify a build.
        // A periodic sweep covers delayed ASC state transitions and missed or filtered mail.
        if (
          next.matched ||
          previous.retry ||
          !previous.lastSweep ||
          Date.now() - Date.parse(previous.lastSweep) >= 30 * 60000
        ) {
          state.retry = true;
          const errors = [];
          for (const s of await candidates())
            if (s.driver === "model" && pendingPhases.includes(s.phase)) {
              try {
                await reconcile(s.id);
              } catch {
                errors.push(s.id);
              }
            }
          if (errors.length)
            throw Error("Apple 状态未核实，将重试：" + errors.join("、"));
          state.retry = false;
          state.lastSweep = now();
        }
      } catch (e) {
        state.error = [state.error, e.message].filter(Boolean).join("；");
      }
      await save(statusFile, state);
      return state;
    } finally {
      busy = false;
    }
  }
  const tick = () => {
    if (!busy) void check().catch(() => {});
  };
  return {
    check,
    get busy() {
      return busy;
    },
    start() {
      tick();
      timer = setInterval(tick, 60000);
      timer.unref();
    },
    stop() {
      clearInterval(timer);
    },
  };
}
