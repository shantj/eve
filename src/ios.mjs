import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, readdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, unzipSync } from "fflate";
import { save, sha } from "./files.mjs";
import { renderArt } from "./art.mjs";
const exec = promisify(execFile);
export async function command(tool, args, opts = {}) {
  const r = await exec(tool, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 900000,
    ...opts,
  });
  return r.stdout;
}
const template = fileURLToPath(new URL("../ios-template/", import.meta.url));
async function readTree(dir, prefix = "") {
  const out = {};
  for (const e of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix + e.name;
    if (
      e.name.startsWith(".") ||
      ["xcuserdata", "project.xcworkspace"].includes(e.name)
    )
      continue;
    if (e.isDirectory()) Object.assign(out, await readTree(dir, path + "/"));
    else if (e.isFile()) out[path] = await readFile(join(dir, path));
  }
  return out;
}
export function validIdentity({ bundleId, version, buildNumber }) {
  if (
    !/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(bundleId) ||
    !/^\d+(\.\d+){0,2}$/.test(version) ||
    !/^[1-9]\d{0,8}$/.test(buildNumber)
  )
    throw Error("需要有效的 Bundle ID、版本号和正整数构建号");
}
const literal = (s) =>
  '"' +
  [...s]
    .map((c) =>
      c === '"' || c === "\\"
        ? "\\" + c
        : c.codePointAt(0) < 32
          ? "\\u{" + c.codePointAt(0).toString(16) + "}"
          : c,
    )
    .join("") +
  '"';
function suite(criteria) {
  function line(s) {
    const e = "el(" + literal(s.target) + ")",
      v = literal(s.value);
    switch (s.action) {
      case "tap":
        return e + ".tap()";
      case "type":
        return e + ".tap(); " + e + ".typeText(" + v + ")";
      case "swipeUp":
        return "app.swipeUp()";
      case "relaunch":
        return "app.terminate(); app.launchArguments = []; app.launch()";
      case "expectLabel":
        return (
          "XCTAssertTrue(" +
          e +
          ".waitForExistence(timeout: 5)); XCTAssertEqual(" +
          e +
          ".label, " +
          v +
          ")"
        );
      case "expectValue":
        return (
          "XCTAssertTrue(" +
          e +
          ".waitForExistence(timeout: 5)); XCTAssertEqual(" +
          e +
          ".value as? String, " +
          v +
          ")"
        );
      case "expectExists":
        return "XCTAssertTrue(" + e + ".waitForExistence(timeout: 5))";
      case "expectDisabled":
        return (
          "XCTAssertTrue(" +
          e +
          ".waitForExistence(timeout: 5)); XCTAssertFalse(" +
          e +
          ".isEnabled)"
        );
      case "expectAbsent":
        return "XCTAssertFalse(" + e + ".exists)";
      default:
        throw Error("未知 iOS 操作：" + s.action);
    }
  }
  return (
    "import XCTest\nfinal class AcceptanceTests: XCTestCase {\n" +
    criteria
      .map((c, i) =>
        [
          "  @MainActor func testCase" + (i + 1) + "() {",
          "    continueAfterFailure = false",
          "    let app = XCUIApplication()",
          '    app.launchArguments = ["-eve-reset"]; app.launch()',
          "    func el(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }",
          ...c.steps.map((s) => "    " + line(s)),
          '    let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "case-' +
            (i + 1) +
            '"; shot.lifetime = .keepAlways; add(shot)',
          "  }",
        ].join("\n"),
      )
      .join("\n") +
    "\n}\n"
  );
}
export async function makeSource(s) {
  validIdentity(s.identity);
  const files = await readTree(template);
  if (s.design?.art) {
    for (const [name, bytes] of Object.entries(renderArt(s.design.art)))
      files["Product/Assets.xcassets/" + name] = bytes;
  }
  const pbx = "Product.xcodeproj/project.pbxproj";
  files[pbx] = Buffer.from(
    files[pbx]
      .toString()
      .replaceAll("com.example.eve.product", s.identity.bundleId)
      .replaceAll(
        "MARKETING_VERSION = 1.0;",
        "MARKETING_VERSION = " + s.identity.version + ";",
      )
      .replaceAll(
        "CURRENT_PROJECT_VERSION = 1;",
        "CURRENT_PROJECT_VERSION = " + s.identity.buildNumber + ";",
      ),
  );
  files["Product/Info.plist"] = Buffer.from(
    files["Product/Info.plist"]
      .toString()
      .replace("EVE_PRODUCT_TITLE", () =>
        s.spec.title
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;"),
      ),
  );
  files["Product/ProductView.swift"] = Buffer.from(s.ui.swift);
  files["Product/ProductModel.swift"] = Buffer.from(s.core.swift);
  files["Acceptance/AcceptanceTests.swift"] = Buffer.from(
    suite(s.acceptance.criteria),
  );
  return zipSync(files, { mtime: new Date(2000, 0, 1) });
}
export async function extract(bytes, dir) {
  for (const [path, content] of Object.entries(unzipSync(bytes))) {
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").includes("..")
    )
      throw Error("无效源文件路径");
    await save(join(dir, path), content);
  }
}
export async function simulator() {
  const data = JSON.parse(
    await command("xcrun", ["simctl", "list", "devices", "available", "-j"]),
  );
  const phones = Object.entries(data.devices)
    .filter(([k]) => k.includes(".iOS-"))
    .flatMap(([, v]) => v)
    .filter((x) => x.isAvailable && x.deviceTypeIdentifier?.includes("iPhone"));
  const selected = process.env.EVE_SIMULATOR_UDID
    ? phones.find((d) => d.udid === process.env.EVE_SIMULATOR_UDID)
    : phones.find((d) => d.state === "Booted") ||
      phones.find((d) => d.name.endsWith("Pro Max")) ||
      phones[0];
  if (!selected)
    throw Error("没有可用 iPhone；安装模拟器或检查 EVE_SIMULATOR_UDID");
  return selected;
}
export async function inspect(s, dir, bytes) {
  const device = await simulator();
  const attempt = await mkdtemp(join(dir, "test-"));
  const result = join(attempt, "Acceptance.xcresult"),
    work = join(attempt, "project");
  await extract(bytes, work);
  const args = [
    "-project",
    join(work, "Product.xcodeproj"),
    "-scheme",
    "Product",
    "-configuration",
    "Debug",
    "-destination",
    "platform=iOS Simulator,id=" + device.udid,
    "-parallel-testing-enabled",
    "NO",
    "-derivedDataPath",
    join(attempt, "derived"),
    "-resultBundlePath",
    result,
    "test",
  ];
  let failure = "";
  try {
    await command("xcodebuild", args);
  } catch (e) {
    failure = (e.stdout || "") + "\n" + (e.stderr || "");
    await save(join(attempt, "xcodebuild.log"), failure);
    if (
      !/error:|Test Case .*failed|test(s|ing) failed/i.test(failure) ||
      /Unable to find a destination|Failed to boot|Failed to prepare device|not enough disk space|timed out waiting for/i.test(
        failure,
      )
    )
      throw Error(
        "Xcode 环境异常，项目可续跑：" + join(attempt, "xcodebuild.log"),
      );
  }
  let summary;
  try {
    summary = JSON.parse(
      await command("xcrun", [
        "xcresulttool",
        "get",
        "test-results",
        "summary",
        "--path",
        result,
      ]),
    );
  } catch (e) {
    if (!failure) throw e;
  }
  if (
    failure ||
    !summary ||
    summary.result !== "Passed" ||
    summary.passedTests !== s.acceptance.criteria.length ||
    summary.skippedTests ||
    summary.failedTests
  ) {
    const reason =
      [
        ...(summary?.testFailures || []).map(
          (x) => x.failureText || x.testName,
        ),
        ...failure
          .split("\n")
          .filter((l) => l.includes("error:"))
          .slice(-10),
      ].join("\n") ||
      failure.slice(-1200) ||
      "验收数不匹配";
    return { passed: false, reason, result, device: device.name };
  }
  const shots = join(attempt, "screenshots");
  await mkdir(shots);
  await command("xcrun", [
    "xcresulttool",
    "export",
    "attachments",
    "--path",
    result,
    "--output-path",
    shots,
    "--filter",
    "*.png",
  ]);
  const manifest = JSON.parse(
    await readFile(join(shots, "manifest.json"), "utf8"),
  );
  const checks = [];
  for (const [i, c] of s.acceptance.criteria.entries()) {
    const attachment = manifest
      .flatMap((t) => t.attachments || [])
      .find(
        (a) =>
          a.suggestedHumanReadableName?.startsWith("case-" + (i + 1) + "_") ||
          a.suggestedHumanReadableName === "case-" + (i + 1) + ".png",
      );
    if (!attachment)
      throw Error("已通过测试但未找到截图：" + c.id + "，请检查 " + shots);
    const screenshot = "case-" + (i + 1) + ".png";
    await save(
      join(dir, screenshot),
      await readFile(join(shots, attachment.exportedFileName)),
    );
    checks.push({
      id: c.id,
      requirement: c.requirement,
      passed: true,
      screenshot,
    });
  }
  await save(join(dir, "tested-source.zip"), bytes);
  return {
    passed: true,
    checks,
    result,
    device: device.name,
    deviceId: device.udid,
    sourceHash: sha(bytes),
    project: work,
  };
}
