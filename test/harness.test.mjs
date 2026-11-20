import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { generateKeyPairSync } from "node:crypto";
import { PNG } from "pngjs";
import { unzipSync } from "fflate";
import { fixture } from "../examples/demo.mjs";
const dir = await mkdtemp(join(tmpdir(), "eve-integrations-"));
process.env.EVE_HOME = join(dir, "runs");
after(() => rm(dir, { recursive: true, force: true }));
const { create, writeRun, readRun } = await import("../src/company.mjs");
const { deliver } = await import("../src/drivers.mjs");
const { saveAccount, account, publicAccount } = await import(
  "../src/release-account.mjs"
);
const { mailWatcher, pollMailbox } = await import("../src/mail-watch.mjs");
const { makeSource } = await import("../src/ios.mjs");
const { postReview, correspondence } = await import("../src/review-mail.mjs");

test("default Maestro Responses uses each role policy and extracts only assistant text", async (t) => {
  const saved = process.env.EVE_MODEL_URL;
  delete process.env.EVE_MODEL_URL;
  t.after(() => {
    if (saved !== undefined) process.env.EVE_MODEL_URL = saved;
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://127.0.0.1:23333/api/openai/v1/responses");
    const b = JSON.parse(options.body);
    assert.deepEqual(b.reasoning, { effort: "high" });
    assert.equal(b.model, "gpt-6.2-astra");
    assert.equal(b.text.format.name, "readUI");
    assert.equal(JSON.parse(b.input).ticket, "pr");
    return Response.json({
      output: [
        { type: "reasoning" },
        {
          type: "message",
          content: [{ type: "output_text", text: '{"action":"收到"}' }],
        },
      ],
    });
  });
  assert.deepEqual(
    await deliver({
      driver: "model",
      dir,
      key: "test",
      kind: "readUI",
      inputs: { ticket: "pr" },
    }),
    { action: "收到" },
  );
});
test("the source candidate contains both designer assets; different art changes the packaged pixels", async () => {
  const design = await fixture("design");
  const s = {
    design,
    spec: { title: "sample" },
    identity: {
      bundleId: "com.example.sample",
      version: "1.0",
      buildNumber: "1",
    },
    acceptance: await fixture("acceptance"),
    ui: await fixture("ui"),
    core: await fixture("core"),
  };
  const files = unzipSync(await makeSource(s)),
    base = "Product/Assets.xcassets/",
    icon = base + "AppIcon.appiconset/Icon.png";
  const bytes = Buffer.from(files[icon]);
  assert.equal(bytes[25], 2);
  assert.equal(PNG.sync.read(bytes).width, 1024);
  assert.equal(
    PNG.sync.read(
      Buffer.from(files[base + "BrandArtwork.imageset/Artwork.png"]),
    ).width,
    900,
  );
  assert.match(
    Buffer.from(files["Product/ProductView.swift"]).toString(),
    /Image\("BrandArtwork"\)/,
  );
  design.art.icon.background = "#443366";
  assert.notDeepEqual(unzipSync(await makeSource(s))[icon], files[icon]);
  design.art.icon.layers[0].path = "M0 0<script>";
  await assert.rejects(makeSource(s), /图层/);
});
test("a posted advisory survives reader failure and retry; only the correct PR owner receives it", async () => {
  const s = {
      attempt: 1,
      pull: {
        prs: { ui: { head: "aaaa", author: "ios", diff: "diff for author" } },
      },
    },
    r = {
      verdict: "pass",
      assessment: "nonblocking",
      findings: ["提高对比度"],
    };
  await assert.rejects(
    postReview(dir, s, "reviewUI", r, async () => {
      throw Error("offline");
    }),
    /offline/,
  );
  const [unread] = await correspondence(dir);
  assert.equal(unread.receipt, null);
  assert.equal(unread.to, "ios");
  const reply = async (kind, key, input) => {
    assert.equal(kind, "readUI");
    assert.equal(input.pr.diff, "diff for author");
    assert.equal(input.comments[0].id, unread.id);
    assert.equal(input.notification.findings, undefined);
    return { action: "核对后保留设计" };
  };
  await postReview(dir, s, "reviewUI", r, reply);
  await postReview(dir, s, "reviewUI", r, () => assert.fail("duplicate read"));
  const read = await correspondence(dir);
  assert.equal(read.length, 1);
  assert.equal(read[0].sentAt, unread.sentAt);
  assert.equal(read[0].receipt.employee, "ios");
});
test("read-only mailbox uses UID cursor; no body fetch; a lookalike sender is not Apple", async () => {
  let address = "notice@apple.com.other.example",
    queries = [];
  const fake = (options) => ({
    on() {},
    async connect() {
      assert.equal(options.secure, true);
    },
    async mailboxOpen(box, opt) {
      assert.equal(box, "INBOX");
      assert.equal(opt.readOnly, true);
      return { uidValidity: 2n, uidNext: 12 };
    },
    async search(q) {
      queries.push(q);
      return [11];
    },
    async fetchAll(ids, q, opt) {
      assert.deepEqual(q, { envelope: true });
      assert.equal(opt.uid, true);
      return [{ envelope: { from: [{ address }] } }];
    },
    close() {},
  });
  const first = await pollMailbox({}, null, false, fake);
  assert.equal(first.matched, false);
  assert.ok(queries[0].since);
  await pollMailbox({}, first.cursor, false, fake);
  assert.equal(queries.length, 1);
  address = "notice@email.apple.com";
  assert.equal(
    (await pollMailbox({}, { validity: "2", last: 10 }, false, fake)).matched,
    true,
  );
  assert.equal(queries.at(-1).uid, "11:11");
  assert.equal(queries.at(-1).since, undefined);
  await pollMailbox({}, { validity: "1", last: 300 }, false, fake);
  assert.ok(queries.at(-1).since);
});
test("mail only triggers ASC reconciliation: wrong build stays submitted, matching rejected build blocks, duplicates do not resync", async (t) => {
  const keyFile = join(dir, "Auth.p8");
  await writeFile(
    keyFile,
    generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({
      format: "pem",
      type: "pkcs8",
    }),
  );
  const cfg = {
    email: "ceo@example.org",
    keyId: "EXAMPLE001",
    issuer: "00000000-0000-0000-0000-000000000001",
    keyFile,
    host: "imap.example.org",
    user: "inbox",
    password: "test-secret",
    enabled: true,
  };
  await saveAccount(cfg);
  assert.equal(
    (await stat(join(dir, "release-account.json"))).mode & 0o777,
    0o600,
  );
  assert.ok(
    !JSON.stringify(publicAccount(await account())).includes(cfg.password),
  );
  const s = await create("field notes");
  s.phase = "submitted";
  await writeRun(s);
  let applies = false,
    wakeup = true,
    reads = 0,
    apiCalls = 0,
    failApple = false;
  const watcher = mailWatcher({
    read: async () => {
      reads++;
      return { cursor: { validity: "1", last: reads }, matched: wakeup };
    },
    candidates: async () => [
      s,
      { id: "unused", driver: "demo", phase: "submitted" },
    ],
  });
  t.mock.method(globalThis, "fetch", async (url) => {
    apiCalls++;
    if (failApple) return new Response("", { status: 503 });
    const p = url.pathname.split("/").pop();
    let data, included;
    if (p === "apps") {
      assert.equal(
        url.searchParams.get("filter[bundleId]"),
        s.identity.bundleId,
      );
      data = [{ id: "one" }];
    } else if (p === "builds") {
      data = [
        {
          id: "correct",
          relationships: { preReleaseVersion: { data: { id: "version" } } },
          attributes: { processingState: "VALID" },
        },
      ];
      included = [
        {
          type: "preReleaseVersions",
          id: "version",
          attributes: { version: "1.0", platform: "IOS" },
        },
      ];
    } else
      data = [
        {
          attributes: { appStoreState: "REJECTED" },
          relationships: {
            build: { data: { id: applies ? "correct" : "wrong" } },
          },
        },
      ];
    return Response.json({ data, included });
  });
  assert.ok(!(await watcher.check()).error);
  assert.equal((await readRun(s.id)).phase, "submitted");
  wakeup = false;
  await watcher.check();
  assert.equal(apiCalls, 3);
  wakeup = true;
  failApple = true;
  assert.ok((await watcher.check()).retry);
  wakeup = false;
  applies = true;
  failApple = false;
  await watcher.check();
  assert.equal((await readRun(s.id)).phase, "blocked");
  assert.match((await readRun(s.id)).reason, /REJECTED/);
  await saveAccount({ host: "another.example.org", enabled: false });
  assert.equal((await account()).password, "");
  const before = reads;
  await watcher.check();
  assert.equal(reads, before);
});
