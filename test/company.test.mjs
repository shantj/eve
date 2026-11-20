import { test, after } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  readdir,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { fixture, direction } from "../examples/demo.mjs";
const temp = await mkdtemp(join(tmpdir(), "eve-company-test-"));
process.env.EVE_HOME = join(temp, "runs");
const { create, run, readRun, reviewedSource, memo, writeRun } = await import(
  "../src/company.mjs"
);
const { gate } = await import("../src/pulls.mjs");
const { jobs, roster } = await import("../src/roles.mjs");
const { sha } = await import("../src/files.mjs");
const { ship, prepare } = await import("../src/publish.mjs");
after(() => rm(temp, { recursive: true, force: true }));
const log = () => {};
async function probe(s, dir, bytes) {
  await writeFile(join(dir, "tested-source.zip"), bytes);
  return {
    passed: true,
    device: "contract test double",
    checks: s.acceptance.criteria.map((c) => ({
      id: c.id,
      requirement: c.requirement,
      screenshot: "test.png",
    })),
    sourceHash: sha(bytes),
  };
}

test("nine independent employee requests overlap, persist deliveries, resume failed sibling, and merge exact reviewed commits", async (t) => {
  let active = 0,
    peak = 0;
  const calls = [];
  let failResearch = true;
  const http = createServer(async (req, res) => {
    if (req.url !== "/v1/chat/completions") {
      res.writeHead(404).end();
      return;
    }
    let buf = "";
    for await (const chunk of req) buf += chunk;
    const body = JSON.parse(buf);
    const kind = body.response_format.json_schema.name;
    const employee = jobs[kind].owner;
    calls.push({
      kind,
      employee,
      model: body.model,
      effort: body.reasoning_effort,
      inputs: JSON.parse(body.messages[1].content),
    });
    active++;
    peak = Math.max(active, peak);
    await new Promise((r) => setTimeout(r, 20));
    active--;
    if (kind === "research" && failResearch) {
      failResearch = false;
      res.writeHead(503).end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        model: body.model,
        choices: [
          { message: { content: JSON.stringify(await fixture(kind)) } },
        ],
      }),
    );
  });
  await new Promise((r) => http.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        http.closeAllConnections();
        http.close(r);
      }),
  );
  process.env.EVE_MODEL_URL = "http://127.0.0.1:" + http.address().port + "/v1";
  delete process.env.EVE_MODEL;
  delete process.env.EVE_REASONING_EFFORT;
  process.env.EVE_MODEL_QA = "gpt-6.2-sol";
  process.env.EVE_REASONING_EFFORT_QA = "medium";
  process.env.EVE_REASONING_EFFORT_RELEASE = "provider";
  process.env.EVE_MODEL_CTO = "test-architecture";
  await memo("首发只支持离线使用");
  const s = await create(direction);
  await assert.rejects(run(s.id, { check: probe, log }), /503/);
  assert.equal((await readRun(s.id)).phase, "discovery");
  const done = await run(s.id, { check: probe, log });
  assert.equal(done.phase, "ready");
  assert.equal(calls.filter((x) => x.kind === "product").length, 1);
  assert.ok(peak >= 2);
  for (const c of calls) {
    if (c.employee === "qa")
      assert.deepEqual([c.model, c.effort], ["gpt-6.2-sol", "medium"]);
    else if (c.employee === "release")
      assert.deepEqual([c.model, c.effort], ["gpt-6.2-astra", undefined]);
    else if (c.employee !== "cto")
      assert.deepEqual([c.model, c.effort], ["gpt-6.2-astra", "high"]);
  }
  assert.equal(
    new Set(calls.map((x) => x.employee)).size,
    Object.keys(roster).length,
  );
  assert.ok(
    calls
      .filter((x) => x.employee === "cto")
      .every((x) => x.model === "test-architecture"),
  );
  assert.ok(
    calls.every(
      (x) => x.inputs.boardDecisions.at(-1).text === "首发只支持离线使用",
    ),
  );
  assert.equal(
    (await readdir(join(temp, "runs", s.id, "employees"))).length,
    9,
  );
  assert.equal(sha(await reviewedSource(done)), done.digest);
  assert.throws(
    () =>
      gate(
        done.pull.prs,
        { ...done.reviews, ui: { ...done.reviews.ui, employee: "ios" } },
        done.qa,
        done.approval,
      ),
    /交叉评审/,
  );
  assert.throws(
    () =>
      gate(
        done.pull.prs,
        { ...done.reviews, core: { ...done.reviews.core, head: "stale" } },
        done.qa,
        done.approval,
      ),
    /交叉评审/,
  );
  assert.throws(
    () =>
      gate(done.pull.prs, done.reviews, done.qa, {
        ...done.approval,
        employee: "qa",
      }),
    /批准/,
  );
  await assert.rejects(ship(done.id, "upload", "bogus"), /当前阶段/);
  // Prepare an offline release fixture and ensure modified store assets cannot pass the publishing gate.
  const png = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(png);
  png.writeUInt32BE(1320, 16);
  png.writeUInt32BE(2868, 20);
  const shot = join(temp, "shot.png");
  await writeFile(shot, png);
  done.ipa = join(temp, "fixture.ipa");
  await writeFile(done.ipa, "offline-ipa");
  done.ipaHash = sha("offline-ipa");
  done.phase = "signed";
  done.team = "TESTTEAM01";
  await writeRun(done);
  const profile = join(temp, "profile.json");
  await writeFile(
    profile,
    JSON.stringify({
      supportURL: "https://example.org/support",
      privacyURL: "https://example.org/privacy",
      firstName: "Test",
      lastName: "Example",
      email: "qa@example.org",
      phone: "+12345678",
      releaseAfterApproval: false,
      screenshots: [shot],
    }),
  );
  const prepared = await prepare(done.id, profile);
  await assert.rejects(ship(done.id, "upload", "bogus"), /完整 SHA/);
  await writeFile(
    join(prepared.submission, "metadata", "extra.txt"),
    "unapproved",
  );
  await assert.rejects(
    ship(done.id, "upload", prepared.releaseHash),
    /文件清单/,
  );
  await writeFile(join(temp, "runs", s.id, "release/source.zip"), "tampered");
  await assert.rejects(reviewedSource(done), /摘要/);
});
test("blocked UI engineer gets advice from the platform engineer, CTO resolves; new PRs after QA rejection", async () => {
  const s = await create(direction, "demo");
  let ui = 0,
    qa = 0;
  const timeline = [];
  const agent = async ({ kind, inputs }) => {
    timeline.push(kind);
    if (kind === "ui" && ui++ === 0)
      return {
        status: "blocked",
        swift: "",
        implementation: "",
        question: "持久化初始化由哪层负责？",
      };
    if (kind === "adviseUI") {
      assert.match(inputs.question, /初始化/);
      return { advice: "由模型构造器恢复数据", tradeoff: "界面无需访问存储" };
    }
    if (kind === "decision") {
      assert.match(inputs.advice[0].advice, /构造器/);
      return {
        decision: "由模型初始化，视图调用 record",
        reason: "单一状态所有者",
        blocker: "",
      };
    }
    if (kind === "verify" && qa++ === 0)
      return {
        verdict: "rework",
        assessment: "需要改进",
        findings: [{ pr: "ui", comment: "复查归零时按钮状态" }],
      };
    if (kind === "ui" && ui === 2) assert.match(inputs.feedback, /模型初始化/);
    if (kind === "ui" && ui === 3)
      assert.ok(
        inputs.prComments.some(
          (n) =>
            n.from === "qa" &&
            n.receipt.employee === "ios" &&
            n.findings.includes("复查归零时按钮状态"),
        ),
      );
    if (kind === "core")
      assert.ok(
        !inputs.prComments.some((n) =>
          n.findings.includes("复查归零时按钮状态"),
        ),
      );
    return fixture(kind);
  };
  const done = await run(s.id, { agent, check: probe, log });
  assert.equal(done.phase, "ready");
  assert.equal(done.attempt, 3);
  assert.ok(timeline.indexOf("adviseUI") < timeline.indexOf("decision"));
  assert.equal(timeline.filter((k) => k === "approve").length, 1);
  assert.equal(timeline.filter((k) => k === "reviewCore").length, 2);
});
test("three failed simulator gates stop at CEO; neither reviewer nor CTO can wave them through", async () => {
  const s = await create(direction, "demo"),
    calls = [];
  const final = await run(s.id, {
    agent: async ({ kind }) => {
      calls.push(kind);
      return fixture(kind);
    },
    check: async () => ({ passed: false, reason: "重开后状态丢失" }),
    log,
  });
  assert.equal(final.phase, "blocked");
  assert.equal(final.attempt, 3);
  assert.ok(!calls.includes("approve"));
  assert.ok(!calls.includes("reviewUI"));
  await assert.rejects(reviewedSource(final));
});
