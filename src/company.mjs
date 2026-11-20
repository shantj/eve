import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { root, runDir, json, locked, save, sha } from "./files.mjs";
import { jobs, validate } from "./roles.mjs";
import { deliver } from "./drivers.mjs";
import { inspect, makeSource, validIdentity } from "./ios.mjs";
import { openPulls, integrate } from "./pulls.mjs";
import { postReview, correspondence } from "./review-mail.mjs";
import { assetNames, renderArt } from "./art.mjs";
import { prepareAttachments, storeAttachments } from "./attachments.mjs";
export const readRun = (id) => json(join(runDir(id), "state.json"));
export const writeRun = (s) => save(join(runDir(s.id), "state.json"), s);
const board = join(dirname(root), "board");
export async function memo(text) {
  if (!text?.trim()) throw Error("决定不能为空");
  const item = { date: new Date().toISOString(), from: "CEO", text };
  await save(join(board, Date.now() + "-" + randomUUID() + ".json"), item);
  return item;
}
export async function create(
  direction,
  driver = "model",
  identity = {},
  files = [],
) {
  const prepared = await prepareAttachments(files);
  if (!direction.trim() && prepared.length)
    direction =
      "按项目附件立项：" + prepared.map((f) => f.meta.name).join("、");
  if (!direction.trim() || !["model", "demo"].includes(driver))
    throw Error("缺少 CEO 方向或未知执行方式");
  const id =
    new Date().toISOString().slice(0, 10) + "-" + randomUUID().slice(0, 8);
  identity = {
    bundleId: "com.example.eve.p" + id.replaceAll("-", ""),
    version: "1.0",
    buildNumber: "1",
    ...identity,
  };
  validIdentity(identity);
  let decisions = [];
  try {
    for (const f of (await readdir(board))
      .filter((x) => x.endsWith(".json"))
      .sort())
      decisions.push(await json(join(board, f)));
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await mkdir(root, { recursive: true });
  await mkdir(runDir(id));
  const s = {
    id,
    direction,
    driver,
    identity,
    decisions,
    ...(prepared.length ? { attachments: prepared.map((f) => f.meta) } : {}),
    phase: "charter",
    attempt: 1,
    history: [],
  };
  try {
    await storeAttachments(runDir(id), prepared);
    await writeRun(s);
  } catch (e) {
    await rm(runDir(id), { recursive: true, force: true });
    throw e;
  }
  return s;
}
const end = [
  "ready",
  "blocked",
  "signed",
  "prepared",
  "uploaded",
  "submitted",
  "listed",
  "uploading",
  "submitting",
];
function move(s, next, note = "") {
  s.history.push({
    at: new Date().toISOString(),
    from: s.phase,
    next,
    attempt: s.attempt,
    note,
  });
  s.phase = next;
}
function block(s, reason) {
  s.reason = reason;
  move(s, "blocked", reason);
}
function repair(s, feedback) {
  s.feedback = feedback;
  if (s.attempt >= 3) block(s, "三轮仍未解阻，请 CEO 重新定范围：" + feedback);
  else {
    move(s, "build", feedback);
    s.attempt++;
  }
}
export const evidenceDir = (s) =>
  join(runDir(s.id), "evidence", "v" + s.attempt);
export async function reviewedSource(s) {
  if (!s.digest) throw Error("无已批准源码");
  const b = await readFile(join(runDir(s.id), "release", "source.zip"));
  if (sha(b) !== s.digest || s.digest !== s.evidence.sourceHash)
    throw Error("受测源码摘要不匹配");
  return b;
}
const facts = (s) => ({
  direction: s.direction,
  charter: s.charter,
  product: s.spec,
  research: s.research,
  design: s.design,
  architecture: s.arch,
  acceptance: s.acceptance,
});
export function report(s) {
  return [
    "# " + s.spec.title,
    "",
    "CEO：" + s.direction,
    "",
    "执行方式：" +
      s.driver +
      "；版本：" +
      s.identity.version +
      " (" +
      s.identity.buildNumber +
      ")；已验收，尚未提交 Apple。",
    "",
    s.listing.summary,
    "",
    ...s.history
      .filter((h) => h.from === "consult")
      .flatMap((h) => [
        "技术讨论：[同事建议与问题](../employees/cto/decision-v" +
          h.attempt +
          "/assignment.json) → [CTO 决定](../employees/cto/decision-v" +
          h.attempt +
          "/delivery.json)。",
        "",
      ]),
    "## 工程签核",
    "",
    ...Object.entries(s.pull.prs).map(
      ([k, p]) =>
        "- " +
        p.author +
        " → " +
        s.reviews[k].employee +
        "：" +
        p.head +
        "（[改动](../engineering/v" +
        s.attempt +
        "/" +
        k +
        ".patch)）",
    ),
    "",
    "QA：" + s.qa.assessment,
    "",
    "CTO：" + s.approval.assessment,
    "",
    "集成提交：" + s.merge,
    "",
    "## 模拟器验收 · " + s.evidence.device,
    "",
    ...s.evidence.checks.map(
      (c) =>
        "- " +
        c.id +
        " " +
        c.requirement +
        "（[截图](../evidence/v" +
        s.attempt +
        "/" +
        c.screenshot +
        ")）",
    ),
    "",
    "## 商业验证",
    "",
    s.research.hypothesis,
    "",
    s.research.experiment,
    "",
    s.listing.firstMetric,
    "",
    "限制：" + s.listing.limitations.join("；"),
    "",
    "源码 SHA-256：" + s.digest,
    "",
  ].join("\n");
}
export async function run(
  id,
  { agent = deliver, check = inspect, log = console.log } = {},
) {
  const dir = runDir(id);
  return locked(dir, async () => {
    const s = await readRun(id);
    const attachments = s.attachments?.length
      ? await json(join(dir, "attachments", "context.json"))
      : null;
    async function dispatch(kind, key, inputs) {
      log(jobs[kind].owner + " ← " + key);
      const context = {
        ceoDirection: s.direction,
        boardDecisions: s.decisions,
        ...(attachments ? { projectAttachments: attachments } : {}),
        ...inputs,
      };
      return validate(
        kind,
        await agent({ dir, driver: s.driver, key, kind, inputs: context }),
        context,
      );
    }
    async function wave(items) {
      const results = await Promise.allSettled(
        items.map(async ([kind, inputs, versioned = false]) => {
          const key = kind + (versioned ? "-v" + s.attempt : "");
          const output = await dispatch(kind, key, inputs);
          if (["reviewUI", "reviewCore", "verify", "approve"].includes(kind))
            await postReview(dir, s, kind, output, dispatch);
          return output;
        }),
      );
      const failed = results.filter((x) => x.status === "rejected");
      if (failed.length)
        throw Error(failed.map((x) => x.reason.message).join("\n"));
      return results.map((x) => x.value);
    }
    while (!end.includes(s.phase)) {
      switch (s.phase) {
        case "charter":
          [s.charter] = await wave([["charter", {}]]);
          if (s.charter.blocker.trim()) block(s, s.charter.blocker);
          else move(s, "discovery");
          break;
        case "discovery":
          [s.spec, s.research] = await wave([
            ["product", { charter: s.charter }],
            ["research", { charter: s.charter }],
          ]);
          move(s, "design");
          break;
        case "design":
          [s.design, s.arch] = await wave([
            ["design", { product: s.spec, research: s.research }],
            ["architecture", { product: s.spec, charter: s.charter }],
          ]);
          {
            const assets = renderArt(s.design.art);
            for (const [k, p] of Object.entries(assetNames))
              await save(join(dir, "design", k + ".png"), assets[p]);
          }
          move(s, "contract");
          break;
        case "contract":
          [s.acceptance] = await wave([["acceptance", facts(s)]]);
          if (
            JSON.stringify(s.acceptance.criteria.map((c) => c.id).sort()) !==
            JSON.stringify(s.spec.requirements.map((c) => c.id).sort())
          )
            throw Error(
              "QA 用例没有逐项覆盖产品需求；见 README 的交付修订方式",
            );
          move(s, "build");
          break;
        case "build": {
          const input = {
            ...facts(s),
            previous: s.attempt > 1 ? { ui: s.ui, core: s.core } : null,
            feedback: s.feedback || "",
          };
          const mail =
            s.attempt > 1
              ? (await correspondence(dir)).filter(
                  (n) => n.round === s.attempt - 1,
                )
              : [];
          [s.ui, s.core, s.listing] = await wave([
            [
              "ui",
              { ...input, prComments: mail.filter((n) => n.to === "ios") },
              true,
            ],
            [
              "core",
              { ...input, prComments: mail.filter((n) => n.to === "platform") },
              true,
            ],
            ["listing", facts(s)],
          ]);
          if ([s.ui, s.core].some((r) => r.status === "blocked"))
            move(s, "consult");
          else if (
            s.design.art &&
            !/BrandArtwork|\.brandArtwork\b/.test(s.ui.swift)
          )
            repair(
              s,
              "客户端主界面缺少设计师交付的 BrandArtwork，请在约定位置展示插画。",
            );
          else move(s, "pulls");
          break;
        }
        case "consult": {
          const tasks = [];
          if (s.ui.status === "blocked")
            tasks.push([
              "adviseUI",
              { ...facts(s), question: s.ui.question },
              true,
            ]);
          if (s.core.status === "blocked")
            tasks.push([
              "adviseCore",
              { ...facts(s), question: s.core.question },
              true,
            ]);
          const advice = await wave(tasks);
          const [resolution] = await wave([
            ["decision", { ...facts(s), ui: s.ui, core: s.core, advice }, true],
          ]);
          if (resolution.blocker.trim()) block(s, resolution.blocker);
          else repair(s, resolution.decision + "；" + resolution.reason);
          break;
        }
        case "pulls": {
          const bytes = await makeSource(s);
          const workspace = join(dir, "engineering", "v" + s.attempt);
          await save(join(workspace, "candidate.zip"), bytes);
          s.pull = await openPulls(workspace, bytes);
          move(s, "test");
          break;
        }
        case "test": {
          const target = evidenceDir(s);
          await mkdir(target, { recursive: true });
          const bytes = await readFile(
            join(dir, "engineering", "v" + s.attempt, "candidate.zip"),
          );
          s.evidence = await check(s, target, bytes);
          await save(join(target, "results.json"), s.evidence);
          if (s.evidence.passed) move(s, "review");
          else repair(s, s.evidence.reason);
          break;
        }
        case "review": {
          const p = s.pull.prs,
            shared = { ...facts(s), evidence: s.evidence };
          const [ui, core, qa] = await wave([
            [
              "reviewUI",
              { ...shared, pr: p.ui, otherImplementation: s.core.swift },
              true,
            ],
            [
              "reviewCore",
              { ...shared, pr: p.core, otherImplementation: s.ui.swift },
              true,
            ],
            ["verify", { ...shared, ui: s.ui.swift, core: s.core.swift }, true],
          ]);
          s.reviews = {
            ui: { ...ui, head: p.ui.head, employee: jobs.reviewUI.owner },
            core: {
              ...core,
              head: p.core.head,
              employee: jobs.reviewCore.owner,
            },
          };
          s.qa = {
            ...qa,
            heads: [p.ui.head, p.core.head],
            employee: jobs.verify.owner,
          };
          const rejected = [ui, core, qa].filter((x) => x.verdict !== "pass");
          if (rejected.length)
            repair(s, "评审要求返工，按自己 PR 上的评论和处理决定复查。");
          else move(s, "approve");
          break;
        }
        case "approve": {
          const [a] = await wave([
            [
              "approve",
              {
                ...facts(s),
                prs: s.pull.prs,
                reviews: s.reviews,
                qa: s.qa,
                evidence: s.evidence,
              },
              true,
            ],
          ]);
          if (a.verdict !== "pass") {
            repair(s, "CTO 要求返工，按自己 PR 上的评论和处理决定复查。");
            break;
          }
          s.approval = {
            ...a,
            employee: jobs.approve.owner,
            heads: [s.pull.prs.ui.head, s.pull.prs.core.head],
          };
          const bytes = await readFile(
            join(evidenceDir(s), "tested-source.zip"),
          );
          s.merge = await integrate(s, bytes, s.approval);
          s.digest = sha(bytes);
          await save(join(dir, "release", "source.zip"), bytes);
          await save(join(dir, "release", "CEO.md"), report(s));
          await save(join(dir, "release", "listing.json"), s.listing);
          move(s, "ready");
          break;
        }
        default:
          throw Error("未知阶段 " + s.phase);
      }
      await writeRun(s);
    }
    return s;
  });
}
