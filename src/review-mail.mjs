import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { json, save } from "./files.mjs";
import { jobs } from "./roles.mjs";

const now = () => new Date().toISOString();
const optional = async (path) => {
  try {
    return await json(path);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return null;
  }
};
async function record(path, value) {
  const existing = await optional(path);
  if (existing) return existing;
  await save(path, value);
  return value;
}
const folder = (dir, round, pr) =>
  join(dir, "engineering", "v" + round, "threads", pr);
const noticeFile = (dir, owner, id) =>
  join(dir, "inboxes", owner, id + ".json");
// One immutable post and one addressed notification per reviewer/PR/head/round.
export async function postReview(dir, s, kind, result, dispatch) {
  const from = jobs[kind].owner;
  const scoped = kind === "verify" || kind === "approve";
  const targets = scoped
    ? ["ui", "core"]
    : [kind === "reviewUI" ? "ui" : "core"];
  const receipts = await Promise.allSettled(
    targets.map(async (pr) => {
      const { head, author: to, diff } = s.pull.prs[pr];
      const findings = scoped
        ? result.findings
            .filter((f) => f.pr === pr || f.pr === "both")
            .map((f) => f.comment)
        : result.findings;
      if (result.findings.length && !findings.length) return;
      const round = s.attempt,
        id = [round, pr, head, kind].join("-"),
        thread = folder(dir, round, pr);
      await record(join(thread, kind + ".json"), {
        id,
        round,
        pr,
        head,
        from,
        to,
        verdict: result.verdict,
        assessment: result.assessment,
        findings,
        postedAt: now(),
      });
      const posts = (await readdir(thread))
        .filter((n) => /^(reviewUI|reviewCore|verify|approve)\.json$/.test(n))
        .sort();
      await record(noticeFile(dir, to, id), {
        id,
        round,
        pr,
        head,
        from,
        to,
        post: kind,
        posts,
        sentAt: now(),
      });
      // The author's worker opens its own inbox, follows the pointer, and fetches the canonical PR post.
      const notice = await json(noticeFile(dir, to, id));
      const ack = join(thread, kind + "-receipt.json");
      if (await optional(ack)) return;
      const comments = await Promise.all(
        (notice.posts || [notice.post + ".json"]).map((name) =>
          json(join(folder(dir, notice.round, notice.pr), name)),
        ),
      );
      const comment = comments.find((c) => c.id === notice.id);
      if (!comment || comments.some((c) => c.head !== head || c.to !== to))
        throw Error("PR 通知与当前提交不一致");
      const readKind = pr === "ui" ? "readUI" : "readCore";
      const reply = await dispatch(
        readKind,
        readKind + "-" + kind + "-v" + round,
        {
          notification: notice,
          pr: { head, author: to, diff },
          comments,
          comment,
        },
      );
      await save(ack, { employee: to, readAt: now(), action: reply.action });
    }),
  );
  for (const r of receipts) if (r.status === "rejected") throw r.reason;
}
export async function correspondence(dir) {
  const rows = [];
  for (const owner of ["ios", "platform"]) {
    const inbox = join(dir, "inboxes", owner);
    let names;
    try {
      names = await readdir(inbox);
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    for (const n of names.filter((n) => n.endsWith(".json"))) {
      const notice = await json(join(inbox, n)),
        root = folder(dir, notice.round, notice.pr);
      const [post, receipt] = await Promise.all([
        json(join(root, notice.post + ".json")),
        optional(join(root, notice.post + "-receipt.json")),
      ]);
      rows.push({ ...post, sentAt: notice.sentAt, receipt });
    }
  }
  return rows.sort(
    (a, b) => a.sentAt.localeCompare(b.sentAt) || a.id.localeCompare(b.id),
  );
}
