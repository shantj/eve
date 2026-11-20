import { createServer } from "node:http";
import { readFile, readdir, stat, realpath } from "node:fs/promises";
import { join, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { root, runDir, json, save, lockState } from "./files.mjs";
import {
  create,
  run,
  readRun,
  memo,
  evidenceDir,
  reviewedSource,
} from "./company.mjs";
import { archive, prepare, ship, sync } from "./publish.mjs";
import { roster } from "./roles.mjs";
import { direction } from "../examples/demo.mjs";
import { settings, setSettings } from "./desk-settings.mjs";
import { account, publicAccount, saveAccount } from "./release-account.mjs";
import { mailWatcher, mailStatus } from "./mail-watch.mjs";
import { correspondence } from "./review-mail.mjs";
import { uploadLimit } from "./attachments.mjs";
const web = fileURLToPath(new URL("../web/", import.meta.url));
const terminal = new Set([
  "ready",
  "blocked",
  "signed",
  "prepared",
  "uploaded",
  "submitted",
  "listed",
  "uploading",
  "submitting",
]);
const assets = {
  "/": ["index.html", "text/html"],
  "/style.css": ["style.css", "text/css"],
  "/app.js": ["app.js", "text/javascript"],
  "/office.svg": ["office.svg", "image/svg+xml"],
  "/mark.svg": ["mark.svg", "image/svg+xml"],
};
const err = (code, message) => Object.assign(Error(message), { status: code });
async function ls(path) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
}
async function optional(path) {
  try {
    return await json(path);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}
async function body(req, multipart = false) {
  let size = 0;
  const chunks = [];
  for await (const b of req) {
    size += b.length;
    if (size > (multipart ? uploadLimit + 64000 : 64000))
      throw err(413, multipart ? "附件合计不能超过 10 MB" : "输入内容过长");
    chunks.push(b);
  }
  const bytes = Buffer.concat(chunks);
  if (multipart) {
    const form = await new Response(bytes, {
      headers: { "Content-Type": req.headers["content-type"] },
    }).formData();
    return {
      ...Object.fromEntries(
        ["direction", "bundleId", "version", "buildNumber"].map((k) => [
          k,
          form.get(k),
        ]),
      ),
      files: form.getAll("attachments"),
    };
  }
  const v = JSON.parse(bytes.toString() || "{}");
  if (!v || typeof v !== "object" || Array.isArray(v))
    throw err(400, "请求格式错误");
  return v;
}
const text = (v, max = 4000) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
async function contained(base, path) {
  const actual = await realpath(path);
  if (!actual.startsWith((await realpath(base)) + sep))
    throw err(404, "找不到文件");
  return actual;
}
export function deskServer({ execute = run, watcher = mailWatcher() } = {}) {
  const running = new Map(),
    startedAt = new Date().toISOString();
  function launch(id, kind, fn) {
    if (running.has(id)) throw err(409, "项目正在执行");
    running.set(id, kind);
    const file = join(runDir(id), "desk-job.json");
    void (async () => {
      try {
        await save(file, { kind, started: new Date().toISOString() });
        await fn();
        await save(file, { kind, finished: new Date().toISOString() });
      } catch (e) {
        await save(file, {
          kind,
          error: String(e.message).slice(0, 2000),
          finished: new Date().toISOString(),
        });
      } finally {
        running.delete(id);
      }
    })().catch(() => running.delete(id));
    return { id, accepted: true };
  }
  async function summary(s) {
    const dir = runDir(s.id);
    const job = await optional(join(dir, "desk-job.json"));
    const owner = await lockState(dir),
      locked = Boolean(owner && !owner.dead),
      stale = owner?.dead;
    return {
      id: s.id,
      title: s.spec?.title || s.direction,
      direction: s.direction,
      driver: s.driver,
      phase: s.phase,
      attempt: s.attempt,
      date:
        s.history.at(-1)?.at ||
        (await stat(join(dir, "state.json"))).birthtime.toISOString(),
      reason: s.reason,
      identity: s.identity,
      busy: running.get(s.id) || (locked ? "external" : ""),
      error: stale
        ? "上次执行已中断。点击继续执行可从已保存的阶段恢复。"
        : job?.error,
    };
  }
  async function list() {
    const dirs = (await ls(root)).filter(
      (d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]{0,80}$/.test(d.name),
    );
    const items = await Promise.all(
      dirs.map(async (d) => {
        const s = await optional(join(root, d.name, "state.json"));
        return s ? summary(s) : null;
      }),
    );
    return items.filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
  }
  async function assignments(id) {
    const out = [];
    await Promise.all(
      Object.keys(roster).map(async (owner) => {
        const dir = join(runDir(id), "employees", owner);
        await Promise.all(
          (await ls(dir))
            .filter((d) => d.isDirectory())
            .map(async (d) => {
              const base = join(dir, d.name);
              const [a, r, e] = await Promise.all(
                ["assignment", "delivery", "last-error"].map((n) =>
                  optional(join(base, n + ".json")),
                ),
              );
              if (a)
                out.push({
                  owner,
                  key: d.name,
                  kind: a.job,
                  started: a.startedAt,
                  finished: r?.finishedAt,
                  state: r
                    ? "done"
                    : e && e.at >= a.startedAt
                      ? "error"
                      : "assigned",
                  model: r?.model,
                  effort: r?.effort,
                  error: r ? null : e?.error,
                });
            }),
        );
      }),
    );
    return out.sort(
      (a, b) =>
        b.started.localeCompare(a.started) || a.key.localeCompare(b.key),
    );
  }
  const server = createServer(async (req, res) => {
    const send = (code, data, type = "application/json") => {
      res.writeHead(code, {
        "Content-Type":
          type +
          (type.startsWith("text/") || type === "application/json"
            ? "; charset=utf-8"
            : ""),
      });
      res.end(type === "application/json" ? JSON.stringify(data) : data);
    };
    try {
      const port = req.socket.localPort,
        host = req.headers.host;
      if (!["127.0.0.1:" + port, "localhost:" + port].includes(host))
        throw err(403, "仅允许本机访问");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      const path = new URL(req.url, "http://" + host).pathname;
      if (req.method === "GET" && Object.hasOwn(assets, path)) {
        const [name, type] = assets[path];
        return send(200, await readFile(join(web, name)), type);
      }
      if (req.method === "GET" && path === "/api/health")
        return send(200, { app: "eve-desk", startedAt });
      if (req.method === "GET" && path === "/api/desk") {
        const decisions = await Promise.all(
          (await ls(join(dirname(root), "board")))
            .filter((d) => d.isFile() && d.name.endsWith(".json"))
            .map((d) => json(join(dirname(root), "board", d.name))),
        );
        const projects = await list();
        const working = (
          await Promise.all(
            projects
              .filter((p) => p.busy)
              .map(async (p) =>
                (await assignments(p.id))
                  .filter((t) => t.state === "assigned")
                  .map((t) => ({ owner: t.owner, kind: t.kind, id: p.id })),
              ),
          )
        ).flat();
        return send(200, {
          app: "eve-desk",
          startedAt,
          working,
          projects,
          roster,
          settings: settings(),
          releaseAccount: publicAccount(await account()),
          reviewMailbox: await mailStatus(),
          decisions: decisions.sort((a, b) => b.date.localeCompare(a.date)),
        });
      }
      const m = path.match(
        /^\/api\/projects\/([a-z0-9][a-z0-9-]{0,80})(?:\/(.*))?$/,
      );
      let s, dir, sub;
      if (m) {
        s = await readRun(m[1]);
        dir = runDir(s.id);
        sub = m[2] || "";
      }
      if (req.method === "GET" && s) {
        if (!sub)
          return send(200, {
            ...(await summary(s)),
            tasks: await assignments(s.id),
            history: s.history,
            checks: s.evidence?.checks || [],
            device: s.evidence?.device,
            hasReport: Boolean(s.digest),
            projectDir: dir,
            attachments: s.attachments || [],
            repository: s.pull?.repo,
            qa: s.qa?.assessment,
            approval: s.approval?.assessment,
            listing: s.listing,
            reviews: s.reviews,
            comments: await correspondence(dir),
            design: s.design?.art
              ? { concept: s.design.art.concept, layout: s.design.layout }
              : null,
            releaseHash: s.releaseHash,
            storeStatus: s.storeStatus,
          });
        const attachment = sub.match(/^attachments\/([a-f0-9-]{36})$/);
        if (attachment) {
          const item = s.attachments?.find((f) => f.id === attachment[1]);
          if (!item) throw err(404, "找不到此项目的附件");
          const bytes = await readFile(
            await contained(dir, join(dir, "attachments", item.id)),
          );
          res.setHeader(
            "Content-Disposition",
            "attachment; filename*=UTF-8''" +
              encodeURIComponent(item.name).replace(
                /['()*]/g,
                (c) => "%" + c.charCodeAt(0).toString(16),
              ),
          );
          return send(200, bytes, "application/octet-stream");
        }
        const t = sub.match(/^tasks\/([a-z]+)\/([A-Za-z0-9-]+)$/);
        const art = sub.match(/^design\/(icon|illustration)$/);
        if (art && s.design?.art)
          return send(
            200,
            await readFile(
              await contained(dir, join(dir, "design", art[1] + ".png")),
            ),
            "image/png",
          );
        if (t && Object.hasOwn(roster, t[1])) {
          const base = join(dir, "employees", t[1], t[2]);
          const a = await json(
            await contained(dir, join(base, "assignment.json")),
          );
          const r = await optional(join(base, "delivery.json"));
          return send(200, { input: a.inputs, output: r?.output });
        }
        if (sub === "report" && s.digest)
          return send(
            200,
            await readFile(
              await contained(dir, join(dir, "release", "CEO.md")),
            ),
            "text/plain",
          );
        if (sub === "source" && s.digest) {
          res.setHeader(
            "Content-Disposition",
            'attachment; filename="' + s.id + '-source.zip"',
          );
          return send(200, await reviewedSource(s), "application/zip");
        }
        if (sub === "manifest" && s.submission)
          return send(
            200,
            await json(
              await contained(dir, join(s.submission, "manifest.json")),
            ),
          );
        const shot = sub.match(/^shots\/(\d+)$/);
        if (shot) {
          const c = s.evidence?.checks?.[Number(shot[1])];
          if (c)
            return send(
              200,
              await readFile(
                await contained(
                  evidenceDir(s),
                  join(evidenceDir(s), c.screenshot),
                ),
              ),
              "image/png",
            );
        }
        const diff = sub.match(/^diff\/(ui|core)$/);
        if (diff && s.pull?.prs?.[diff[1]])
          return send(200, s.pull.prs[diff[1]].diff, "text/plain");
      }
      if (req.method === "POST") {
        const type = req.headers["content-type"]?.split(";")[0];
        const multipart =
          path === "/api/projects" && type === "multipart/form-data";
        if (
          req.headers.origin !== "http://" + host ||
          req.headers["x-eve-desk"] !== "1" ||
          (!multipart && type !== "application/json")
        )
          throw err(403, "请在本机工作台内操作");
        const b = await body(req, multipart);
        if (path === "/api/stop") {
          if (running.size || watcher.busy)
            throw err(409, "项目或邮箱检查运行中，请完成后再停止服务。");
          send(200, { stopped: true });
          server.close();
          return;
        }
        if (path === "/api/settings") {
          if (running.size) throw err(409, "项目运行中，请结束后修改连接");
          return send(200, await setSettings(b));
        }
        if (path === "/api/release-account") {
          if (running.size || watcher.busy)
            throw err(409, "项目或邮箱检查运行中，请稍后保存账号");
          const c = await saveAccount(b);
          if (c.enabled) void watcher.check().catch(() => {});
          return send(200, c);
        }
        if (
          path === "/api/review-mail/test" ||
          path === "/api/review-mail/check"
        ) {
          const result = await watcher.check(path.endsWith("/test"));
          return send(result.error ? 400 : 200, result);
        }
        if (path === "/api/decisions")
          return send(201, await memo(text(b.text)));
        if (path === "/api/projects") {
          const driver = b.demo === true ? "demo" : "model";
          const goal = driver === "demo" ? direction : text(b.direction);
          const identity = Object.fromEntries(
            ["bundleId", "version", "buildNumber"]
              .filter((k) => text(b[k]))
              .map((k) => [k, text(b[k], 160)]),
          );
          const next = await create(
            goal,
            driver,
            identity,
            multipart ? b.files : [],
          );
          return send(201, { id: next.id });
        }
        if (s) {
          if (sub === "run") {
            if (terminal.has(s.phase))
              throw err(409, "该阶段不能启动，请查看项目状态");
            return send(
              202,
              launch(s.id, sub, () => execute(s.id, { log: () => {} })),
            );
          }
          if (["sign", "prepare", "upload", "submit", "sync"].includes(sub)) {
            if (s.driver === "demo")
              throw err(409, "演示项目不能发往 App Store，请新建正式项目");
            const valid = {
              sign: ["ready"],
              prepare: ["signed", "prepared"],
              upload: ["prepared"],
              submit: ["uploaded"],
              sync: [
                "uploading",
                "uploaded",
                "submitting",
                "submitted",
                "listed",
              ],
            };
            if (!valid[sub].includes(s.phase))
              throw err(409, "当前阶段不能执行此操作");
            if (
              ["upload", "submit"].includes(sub) &&
              (!s.releaseHash ||
                b.approve !== s.releaseHash ||
                b.confirm !== true)
            )
              throw err(409, "需要确认当前版本的发布清单");
            const actions = {
              sign: () => archive(s.id, text(b.team, 20)),
              prepare: async () => {
                const p = Object.fromEntries(
                  [
                    "supportURL",
                    "privacyURL",
                    "firstName",
                    "lastName",
                    "email",
                    "phone",
                    "whatsNew",
                  ].map((k) => [k, text(b[k])]),
                );
                p.releaseAfterApproval = b.releaseAfterApproval === true;
                const file = join(
                  dir,
                  "release",
                  "desk-profile-" + randomUUID() + ".json",
                );
                await save(file, p);
                await prepare(s.id, file);
              },
              upload: () => ship(s.id, sub, b.approve),
              submit: () => ship(s.id, sub, b.approve),
              sync: () => sync(s.id),
            };
            return send(202, launch(s.id, sub, actions[sub]));
          }
        }
      }
      throw err(404, "找不到该页面或记录");
    } catch (e) {
      send(e.status || (e.code === "ENOENT" ? 404 : 400), {
        error: e.code === "ENOENT" ? "找不到该记录" : e.message,
      });
    }
  });
  server.once("listening", () => watcher.start());
  server.once("close", () => watcher.stop());
  return server;
}
