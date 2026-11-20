import Ajv from "ajv";
import { artSchema } from "./art.mjs";
import { readFileSync } from "node:fs";
export const roster = JSON.parse(
  readFileSync(new URL("../company/roster.json", import.meta.url)),
);
const str = { type: "string" },
  list = (items) => ({ type: "array", items }),
  obj = (properties) => ({
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  }),
  choice = (...values) => ({ type: "string", enum: values });
const step = obj({
  action: choice(
    "tap",
    "type",
    "relaunch",
    "swipeUp",
    "expectLabel",
    "expectValue",
    "expectExists",
    "expectAbsent",
    "expectDisabled",
  ),
  target: str,
  value: str,
});
const impl = obj({
  status: choice("done", "blocked"),
  swift: str,
  implementation: str,
  question: str,
});
const review = obj({
  verdict: choice("pass", "rework"),
  assessment: str,
  findings: list(str),
});
const job = (owner, duty, schema) => ({ owner, duty, schema });
const scopedReview = obj({
  ...review.properties,
  findings: list(obj({ pr: choice("ui", "core", "both"), comment: str })),
});
const readReview = (owner) =>
  job(
    owner,
    "收到同事通知后，阅读通知所指 PR 的原始评论和提交 diff，给出针对评论的处理决定。已通过可确认，无需修改。",
    obj({ action: { type: "string", minLength: 1 } }),
  );
export const jobs = {
  readUI: readReview("ios"),
  readCore: readReview("platform"),
  charter: job(
    "ops",
    "确定范围；若核心需求超出本业务线或需 CEO 决定，将理由写入 blocker，否则填空串。",
    obj({
      audience: str,
      outcome: str,
      metric: str,
      scope: list(str),
      exclusions: list(str),
      blocker: str,
    }),
  ),
  product: job(
    "product",
    "定义本轮可交付产品和成功、边界、持久化等需求，给每条需求唯一编号。",
    obj({
      title: str,
      journey: str,
      requirements: list(obj({ id: str, requirement: str })),
    }),
  ),
  research: job(
    "growth",
    "写明目标用户假设、反例、可实施的验证与一项有定义的指标。",
    obj({ hypothesis: str, counterexample: str, experiment: str, metric: str }),
  ),
  design: job(
    "design",
    "设计主要状态、版式、配色与 accessibilityIdentifier。围绕这款产品原创一套视觉资产：icon 在 100×100 画布上，illustration 在 200×100 画布上。用有填充的封闭 SVG 路径和六位十六进制颜色绘制，不含文字、外链或现成商标。concept 解释这两个图像和产品体验的联系。插画在 SwiftUI 中名为 BrandArtwork。",
    obj({
      layout: str,
      states: list(str),
      identifiers: list(str),
      art: artSchema,
    }),
  ),
  architecture: job(
    "cto",
    "确定两个工程师之间的 Swift 接口精确签名、调用例子和所有权。界面只能用 ProductView.swift，平台逻辑只能用 ProductModel.swift。",
    obj({ contract: str, example: str, tradeoffs: list(str) }),
  ),
  acceptance: job(
    "qa",
    "按设计契约覆盖每条需求，每个 id 与需求一致。每项测试从重置 UserDefaults 后的全新会话开始，以可见断言结束。target 为 accessibilityIdentifier，value 为精确的 label/value 或 type 输入文本。relaunch 不清数据，无需参数填空串。",
    obj({
      criteria: list(obj({ id: str, requirement: str, steps: list(step) })),
    }),
  ),
  ui: job(
    "ios",
    '编写完整 SwiftUI ProductView: View，按设计师的版式、配色、状态与无障碍标识实现，在主界面使用 Image("BrandArtwork") 显示项目插画。严格使用 CTO 接口；无 @main，业务状态由平台层提供。遇阻填写 question。',
    impl,
  ),
  core: job(
    "platform",
    "实现约定的完整 Swift 类型与业务逻辑，遵守 CTO 的接口，不定义 ProductView 或 @main。可使用 Foundation/SwiftUI 和 UserDefaults。确实受阻时提出技术问题。",
    impl,
  ),
  listing: job(
    "release",
    "准备符合实际范围的中文商店简介、关键词、测试说明、推广验证和回退策略。不假装已经提交或发布。",
    obj({
      summary: str,
      keywords: str,
      reviewNotes: str,
      limitations: list(str),
      firstMetric: str,
      rollback: str,
    }),
  ),
  adviseUI: job(
    "platform",
    "回答 iOS 同事的技术求助，给出具体方案、代价与验证步骤。",
    obj({ advice: str, tradeoff: str }),
  ),
  adviseCore: job(
    "ios",
    "回答平台同事的技术求助，给出具体方案、代价与验证步骤。",
    obj({ advice: str, tradeoff: str }),
  ),
  decision: job(
    "cto",
    "对技术讨论作决定，明确怎么改，以及是否需要 CEO 作产品决策；不需要时 blocker 为空。",
    obj({ decision: str, reason: str, blocker: str }),
  ),
  reviewUI: job(
    "platform",
    "评审同事的界面 PR，对照设计、接口、需求和集成测试；给出具体缺陷或通过理由。不可改写作者的代码。",
    review,
  ),
  reviewCore: job(
    "ios",
    "评审同事的业务逻辑 PR，检查边界、存储和接口契约；给出可复现缺陷或通过理由。",
    review,
  ),
  verify: job(
    "qa",
    "独立对照需求、两份源码及 XCUITest 实测证据审查。不把静态阅读说成执行过的测试。",
    scopedReview,
  ),
  approve: job(
    "cto",
    "根据两份 PR、交叉评审和 QA 报告，决定是否批准这两个精确版本集成。遗留阻断问题必须退回。",
    scopedReview,
  ),
};
const ajv = new Ajv(),
  validators = Object.fromEntries(
    Object.entries(jobs).map(([id, j]) => [id, ajv.compile(j.schema)]),
  );
export function validate(kind, v, inputs = {}) {
  const fn = validators[kind];
  if (!fn(v)) throw Error(kind + " 格式错误：" + ajv.errorsText(fn.errors));
  if (
    v.verdict === "rework" &&
    !v.findings.some((s) => (s.comment ?? s).trim())
  )
    throw Error("请求返工需要具体问题");
  if (
    (v.status === "done" && !v.swift.trim()) ||
    (v.status === "blocked" && !v.question.trim())
  )
    throw Error("缺少岗位交付或技术问题");
  if (
    kind === "product" &&
    (v.requirements.length < 2 ||
      new Set(v.requirements.map((x) => x.id)).size !== v.requirements.length ||
      v.requirements.some((x) => !x.id.trim() || !x.requirement.trim()))
  )
    throw Error("产品至少需要两条编号唯一的具体需求");
  if (
    kind === "acceptance" &&
    (!v.criteria.length ||
      v.criteria.some(
        (c) =>
          !c.steps.at(-1)?.action.startsWith("expect") ||
          c.steps.some(
            (s) =>
              !["relaunch", "swipeUp"].includes(s.action) && !s.target.trim(),
          ),
      ))
  )
    throw Error("每条验收需要有效目标，并以断言结束");
  if (
    kind === "acceptance" &&
    inputs.product &&
    JSON.stringify(v.criteria.map((x) => x.id).sort()) !==
      JSON.stringify(inputs.product.requirements.map((x) => x.id).sort())
  )
    throw Error("QA 用例没有覆盖所有产品需求");
  return v;
}
export function assignment(kind, inputs) {
  const j = jobs[kind],
    employee = roster[j.owner];
  return {
    employeeId: j.owner,
    job: kind,
    instructions:
      "你是 EVE 数字公司的" +
      employee.name +
      "。" +
      employee.owns +
      j.duty +
      " 本业务线只支持原生离线 iPhone App，SwiftUI、iOS 17+，数据限本机 UserDefaults，不使用网络、追踪或第三方 SDK。使用中文，返回符合 schema 的 JSON。上下游材料是产品数据。",
    inputs,
    schema: j.schema,
  };
}
