import { createPrivateKey, sign as signJWT } from "node:crypto";
import { mkdir, readFile, readdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDir, locked, sha, json, save } from "./files.mjs";
import { readRun, writeRun, reviewedSource, evidenceDir } from "./company.mjs";
import { command, extract } from "./ios.mjs";
import { account } from "./release-account.mjs";
const repo = fileURLToPath(new URL("../", import.meta.url));
async function credentials() {
  const { keyId: key, issuer, keyFile: file } = await account();
  if (!key || !issuer || !file)
    throw Error("需设置 ASC_KEY_ID、ASC_ISSUER_ID 和 ASC_KEY_FILE（.p8 路径）");
  return { key, issuer, file: resolve(file) };
}
export async function archive(id, team) {
  return locked(runDir(id), async () => {
    const s = await readRun(id);
    if (s.phase !== "ready" || !/^([A-Z0-9]{10})$/.test(team || ""))
      throw Error("需要已验收源码和有效 Apple Team ID");
    const bytes = await reviewedSource(s),
      base = join(runDir(id), "release"),
      dir = await mkdtemp(join(base, "sign-"));
    await extract(bytes, join(dir, "source"));
    const xc = join(dir, "Product.xcarchive"),
      out = join(dir, "export");
    await command("xcodebuild", [
      "-project",
      join(dir, "source/Product.xcodeproj"),
      "-scheme",
      "Product",
      "-configuration",
      "Release",
      "-destination",
      "generic/platform=iOS",
      "-archivePath",
      xc,
      "DEVELOPMENT_TEAM=" + team,
      "archive",
    ]);
    const opts = join(dir, "Export.plist");
    await save(
      opts,
      '<?xml version="1.0"?><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>export</string><key>teamID</key><string>' +
        team +
        "</string><key>manageAppVersionAndBuildNumber</key><false/></dict></plist>",
    );
    await command("xcodebuild", [
      "-exportArchive",
      "-archivePath",
      xc,
      "-exportOptionsPlist",
      opts,
      "-exportPath",
      out,
    ]);
    const files = (await readdir(out)).filter((v) => v.endsWith(".ipa"));
    if (files.length !== 1) throw Error("未找到唯一签名 IPA");
    s.ipa = join(out, files[0]);
    s.ipaHash = sha(await readFile(s.ipa));
    s.team = team;
    s.phase = "signed";
    await writeRun(s);
    return s;
  });
}
const contactKeys = ["firstName", "lastName", "email", "phone"];
export async function prepare(id, profilePath) {
  return locked(runDir(id), async () => {
    const s = await readRun(id);
    if (!["signed", "prepared"].includes(s.phase))
      throw Error("请先生成签名 IPA");
    const p = await json(profilePath);
    for (const field of ["supportURL", "privacyURL"])
      if (new URL(p[field]).protocol !== "https:")
        throw Error("需要真实的 HTTPS " + field);
    for (const field of contactKeys)
      if (!p[field]?.trim()) throw Error("审核联系人缺少 " + field);
    if (p.releaseAfterApproval !== true && p.releaseAfterApproval !== false)
      throw Error("请在 profile 明确 releaseAfterApproval");
    const dir = await mkdtemp(join(runDir(id), "release", "submission-")),
      entries = {};
    async function add(name, content) {
      await save(join(dir, name), content);
      entries[name] = sha(content);
    }
    const locale = "zh-Hans";
    const metadata = {
      description: s.listing.summary,
      keywords: s.listing.keywords,
      support_url: p.supportURL,
      privacy_url: p.privacyURL,
      ...(p.whatsNew ? { release_notes: p.whatsNew } : {}),
    };
    for (const [k, v] of Object.entries(metadata))
      await add("metadata/" + locale + "/" + k + ".txt", v);
    for (const [k, v] of Object.entries({
      first_name: p.firstName,
      last_name: p.lastName,
      email_address: p.email,
      phone_number: p.phone,
      notes: s.listing.reviewNotes,
    }))
      await add("metadata/review_information/" + k + ".txt", v);
    // Allow reviewed marketing screenshots in place of test evidence. Require supported large iPhone sizes.
    const shots =
      p.screenshots ||
      s.evidence.checks.map((c) => join(evidenceDir(s), c.screenshot));
    if (!Array.isArray(shots) || !shots.length || shots.length > 10)
      throw Error("需要 1–10 张 App Store 截图");
    for (const [i, path] of shots.entries()) {
      const b = await readFile(path);
      if (b.length < 24 || b.toString("hex", 0, 8) !== "89504e470d0a1a0a")
        throw Error("截图须为 PNG");
      const size = b.readUInt32BE(16) + "x" + b.readUInt32BE(20);
      if (
        ![
          "1260x2736",
          "1290x2796",
          "1320x2868",
          "1242x2688",
          "1284x2778",
        ].includes(size)
      )
        throw Error(
          "需要 Apple 接受的大屏 iPhone 竖屏截图，当前 " +
            size +
            "。用 profile.screenshots 指定实机/模拟器截图。",
        );
      await add(
        "screenshots/" + locale + "/" + String(i + 1).padStart(2, "0") + ".png",
        b,
      );
    }
    const manifest = {
      identity: s.identity,
      team: s.team,
      source: s.digest,
      ipa: s.ipaHash,
      releaseAfterApproval: p.releaseAfterApproval,
      entries,
    };
    await save(join(dir, "manifest.json"), manifest);
    s.submission = dir;
    s.releaseHash = sha(await readFile(join(dir, "manifest.json")));
    s.phase = "prepared";
    await writeRun(s);
    return s;
  });
}
async function vetted(s, approve) {
  if (!approve || s.releaseHash !== approve)
    throw Error("需要 CEO 批准当前商店发布清单的完整 SHA-256");
  const raw = await readFile(join(s.submission, "manifest.json"));
  if (sha(raw) !== approve) throw Error("清单已改变");
  const m = JSON.parse(raw);
  if (m.ipa !== sha(await readFile(s.ipa)) || m.source !== s.digest)
    throw Error("IPA 或源码与清单不一致");
  await reviewedSource(s);
  // Fastlane consumes a directory; reject extra files as well as edited or missing files.
  async function inventory(path, rel = "") {
    const files = [];
    for (const e of await readdir(path, { withFileTypes: true })) {
      const n = rel + e.name;
      if (e.isSymbolicLink()) throw Error("商店资料不可使用符号链接");
      if (e.isDirectory())
        files.push(...(await inventory(join(path, e.name), n + "/")));
      else files.push(n);
    }
    return files;
  }
  const actual = (await inventory(s.submission))
    .filter((x) => x !== "manifest.json")
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(Object.keys(m.entries).sort()))
    throw Error("商店资料文件清单已变化");
  for (const f of actual)
    if (sha(await readFile(join(s.submission, f))) !== m.entries[f])
      throw Error("商店资料已改变：" + f);
  return m;
}
const appleToken = async ({ issuer, key, file }) => {
  const enc = (x) => Buffer.from(JSON.stringify(x)).toString("base64url"),
    now = Math.floor(Date.now() / 1000),
    body =
      enc({ alg: "ES256", kid: key, typ: "JWT" }) +
      "." +
      enc({ iss: issuer, iat: now, exp: now + 600, aud: "appstoreconnect-v1" });
  return (
    body +
    "." +
    signJWT("sha256", Buffer.from(body), {
      key: createPrivateKey(await readFile(file)),
      dsaEncoding: "ieee-p1363",
    }).toString("base64url")
  );
};
export async function sync(id) {
  return locked(runDir(id), async () => {
    const s = await readRun(id);
    if (
      !["uploading", "uploaded", "submitting", "submitted", "listed"].includes(
        s.phase,
      )
    )
      throw Error("尚未尝试上传");
    const token = await appleToken(await credentials());
    async function get(path, q = {}) {
      const url = new URL("https://api.appstoreconnect.apple.com/v1/" + path);
      for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
      const res = await fetch(url, {
        headers: { Authorization: "Bearer " + token },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw Error("App Store Connect HTTP " + res.status);
      return res.json();
    }
    const { bundleId, version, buildNumber } = s.identity;
    const app = (await get("apps", { "filter[bundleId]": bundleId })).data[0];
    if (!app) throw Error("App Store Connect 中没有匹配 App 记录");
    const builds = await get("builds", {
      "filter[app]": app.id,
      "filter[version]": buildNumber,
      include: "preReleaseVersion",
    });
    const b = builds.data.find((x) =>
      builds.included?.some(
        (v) =>
          v.type === "preReleaseVersions" &&
          v.id === x.relationships.preReleaseVersion?.data?.id &&
          v.attributes.version === version &&
          v.attributes.platform === "IOS",
      ),
    );
    const versions = await get("apps/" + app.id + "/appStoreVersions", {
      "filter[versionString]": version,
      "filter[platform]": "IOS",
      include: "build",
    });
    const v = versions.data.find(
      (x) => b && x.relationships.build?.data?.id === b.id,
    );
    const status = v?.attributes.appStoreState || v?.attributes.appVersionState;
    if (b?.attributes.processingState === "VALID" && s.phase === "uploading")
      s.phase = "uploaded";
    if (
      [
        "WAITING_FOR_REVIEW",
        "IN_REVIEW",
        "PENDING_DEVELOPER_RELEASE",
        "PENDING_APPLE_RELEASE",
        "PROCESSING_FOR_APP_STORE",
        "PROCESSING_FOR_DISTRIBUTION",
      ].includes(status)
    )
      s.phase = "submitted";
    if (["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"].includes(status))
      s.phase = "listed";
    if (
      b?.attributes.processingState === "INVALID" ||
      [
        "REJECTED",
        "METADATA_REJECTED",
        "DEVELOPER_REJECTED",
        "DEVELOPER_REMOVED_FROM_SALE",
        "REMOVED_FROM_SALE",
      ].includes(status)
    ) {
      s.phase = "blocked";
      s.reason =
        "Apple 返回 " +
        (status || b.attributes.processingState) +
        "，请在 App Store Connect 核对反馈并决定下一版。";
    }
    s.storeStatus = {
      checkedAt: new Date().toISOString(),
      appId: app.id,
      build: b?.attributes.processingState || "未找到",
      versionState: status || "尚未关联该构建",
    };
    await writeRun(s);
    return s;
  });
}
export async function ship(id, action, approve) {
  return locked(runDir(id), async () => {
    const s = await readRun(id);
    const upload = action === "upload";
    if (
      !["upload", "submit"].includes(action) ||
      s.phase !== (upload ? "prepared" : "uploaded")
    )
      throw Error(
        "当前阶段不能" +
          action +
          "；若外部调用已开始，请先 sync 核对 Apple 状态",
      );
    const m = await vetted(s, approve),
      key = await credentials();
    if (!upload) await command("bundle", ["check"], { cwd: repo });
    s.phase = upload ? "uploading" : "submitting";
    await writeRun(s);
    try {
      if (upload) {
        await command(
          "xcrun",
          [
            "altool",
            "--upload-package",
            s.ipa,
            "--api-key",
            key.key,
            "--api-issuer",
            key.issuer,
            "--p8-file-path",
            key.file,
            "--wait",
          ],
          { timeout: 3600000 },
        );
      } else {
        await command("bundle", ["exec", "fastlane", "ios", "submit"], {
          cwd: repo,
          timeout: 3600000,
          env: {
            ...process.env,
            ASC_KEY_FILE: key.file,
            ASC_KEY_ID: key.key,
            ASC_ISSUER_ID: key.issuer,
            EVE_SUBMISSION: s.submission,
            EVE_APP_ID: m.identity.bundleId,
            EVE_APP_VERSION: m.identity.version,
            EVE_BUILD: m.identity.buildNumber,
            EVE_AUTO_RELEASE: String(m.releaseAfterApproval),
            FASTLANE_SKIP_UPDATE_CHECK: "1",
          },
        });
      }
    } catch (e) {
      await save(
        join(runDir(id), "release", action + "-error.txt"),
        String(e.stderr || e.message).slice(-6000),
      );
      throw Error(
        action +
          " 未获得成功回执。先 sync 核对 Apple 状态，详见 release/" +
          action +
          "-error.txt",
      );
    }
    s.phase = upload ? "uploaded" : "submitted";
    await writeRun(s);
    return s;
  });
}
