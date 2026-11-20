// HTTP model IDs, independent of the model running the CEO's chat client.
export const DEFAULT_MODEL = "gpt-6.2-astra";
export const DEFAULT_EFFORT = "high";
export function checkedEffort(value) {
  if (!["low", "medium", "high", "provider"].includes(value))
    throw Error("推理强度应为 low、medium、high 或 provider（不发送该参数）。");
  return value;
}
export function roleOverride(owner, env = process.env) {
  const suffix = owner.toUpperCase();
  return {
    model: env["EVE_MODEL_" + suffix] || "",
    effort: env["EVE_REASONING_EFFORT_" + suffix] || "",
  };
}
export function modelPolicy(owner, env = process.env) {
  const defaults = {
    model: env.EVE_MODEL || DEFAULT_MODEL,
    effort: env.EVE_REASONING_EFFORT || DEFAULT_EFFORT,
  };
  const custom = owner ? roleOverride(owner, env) : {};
  return {
    model: custom.model || defaults.model,
    effort: checkedEffort(custom.effort || defaults.effort),
  };
}
