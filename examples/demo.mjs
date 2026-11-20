import { readFile } from "node:fs/promises";
export const direction =
  "给独立开发者做一个 iPhone 专注轮次记录器：一键记录、支持撤销、重开保留记录。";
const step = (action, target = "", value = "") => ({ action, target, value });
export async function fixture(role, context) {
  switch (role) {
    case "readUI":
    case "readCore":
      return {
        action: "已核对本提交对应的评审意见；需要修改的项目会进入下一轮。",
      };
    case "charter":
      return {
        audience: "独立开发者",
        outcome: "轻松积累已完成的专注工作轮次",
        metric: "邀请五人试用，观察首次记录完成率",
        scope: ["本机记录、撤销、保存"],
        exclusions: ["计时器、账号、同步"],
        blocker: "",
      };
    case "product":
      return {
        title: "专注轮次",
        journey: "完成、撤销、重开",
        requirements: (await fixture("acceptance")).criteria.map(
          ({ id, requirement }) => ({ id, requirement }),
        ),
      };
    case "acceptance":
      return {
        criteria: [
          {
            id: "F1",
            requirement: "初始为零，记录一次变为一轮",
            steps: [
              step("expectLabel", "count", "0"),
              step("tap", "add"),
              step("expectLabel", "count", "1"),
            ],
          },
          {
            id: "F2",
            requirement: "完成后撤销，归零且不能继续撤销",
            steps: [
              step("tap", "add"),
              step("tap", "undo"),
              step("expectLabel", "count", "0"),
              step("expectDisabled", "undo"),
            ],
          },
          {
            id: "F3",
            requirement: "重开 App 后保留已完成的两轮",
            steps: [
              step("tap", "add"),
              step("tap", "add"),
              step("relaunch"),
              step("expectLabel", "count", "2"),
            ],
          },
        ],
      };
    case "adviseUI":
      return {
        advice:
          "在 ProductModel 初始化时同步恢复 UserDefaults；视图只读 rounds。",
        tradeoff: "本机读取很小，启动时无需异步或二次刷新。",
      };
    case "decision":
      return {
        decision: "平台层同步恢复数据，界面只持有一个 StateObject。",
        reason: "一个模型是轮次状态的唯一所有者；以重开测试验证。",
        blocker: "",
      };
    case "ui":
      if (context && !context.feedback)
        return {
          status: "blocked",
          swift: "",
          implementation: "已核对接口，等待恢复时序决定。",
          question:
            "首屏从缓存恢复是由视图还是模型负责？异步恢复会不会短暂显示 0？",
        };
      return {
        status: "done",
        question: "",
        swift: await readFile(
          new URL("./ProductView.swift", import.meta.url),
          "utf8",
        ),
        implementation: "SwiftUI 绑定 ProductModel，界面不直接读写存储。",
      };
    case "core":
      return {
        status: "done",
        question: "",
        swift: await readFile(
          new URL("./ProductModel.swift", import.meta.url),
          "utf8",
        ),
        implementation: "独立的可观察状态和持久化模型。",
      };
    case "architecture":
      return {
        contract:
          "ProductModel: ObservableObject; @Published private(set) var rounds: Int; func record(); func undo()",
        example: "@StateObject var model = ProductModel()",
        tradeoffs: ["只支持本机状态"],
      };
    case "research":
      return {
        hypothesis: "独立开发者愿意手动记录",
        counterexample: "计时器自动记录可能更有吸引力",
        experiment: "请五位用户记录一次并观察摩擦",
        metric: "完成首次记录的人数 / 参与试用人数",
      };
    case "design":
      return {
        layout: "轮次卡片，主按钮完成，次按钮撤销",
        states: ["初始为零", "完成后可撤销"],
        identifiers: ["count", "add", "undo"],
        art: {
          concept:
            "把一次专注画成一个刻度：图标用三道逐渐升高的折页，插画像打开的工作手记，用夕阳和山脊表示每一轮的推进。",
          icon: {
            background: "#153D34",
            layers: [
              { fill: "#B1D7A7", path: "M18 72 L18 51 L34 40 L34 72 Z" },
              { fill: "#F1E6CA", path: "M42 72 L42 37 L58 26 L58 72 Z" },
              { fill: "#F3A667", path: "M66 72 L66 24 L82 13 L82 72 Z" },
            ],
          },
          illustration: {
            background: "#F1E6CA",
            layers: [
              {
                fill: "#F3A667",
                path: "M131 35 A17 17 0 1 0 165 35 A17 17 0 1 0 131 35 Z",
              },
              {
                fill: "#A7C6A0",
                path: "M0 75 Q40 23 75 54 T155 55 T210 42 L200 100 H0 Z",
              },
              {
                fill: "#417060",
                path: "M0 75 Q38 65 72 79 T150 67 T205 66 V100 H0 Z",
              },
              { fill: "#153D34", path: "M0 93 Q45 65 94 87 T200 74 V100 H0 Z" },
            ],
          },
        },
      };
    case "approve":
    case "reviewUI":
    case "reviewCore":
    case "verify":
      return {
        verdict: "pass",
        assessment: "演习使用固定审查意见；每条 XCUITest 均由模拟器真实执行。",
        findings: [],
      };
    case "listing":
      return {
        summary:
          "在 iPhone 上记录完成的专注轮次。点一下即可记录，记错能撤销，重开可继续。",
        keywords: "专注,工作,记录",
        reviewNotes:
          "打开 App，点击完成一轮，退出重开即可核对本机保存。无需账号。",
        limitations: ["仅本机保存"],
        firstMetric: "观察试用者是否能够在 10 秒内记下第一轮。",
        rollback:
          "若发现回归，在 App Store Connect 停止分阶段发布并提交修复版本；已更新用户不能直接降级。",
      };
    default:
      throw Error("未知演示岗位");
  }
}
