import { fileURLToPath, pathToFileURL } from "node:url";
import { finalizeReview } from "./finalize.mjs";
import { persist, prepareReview } from "./prepare.mjs";
import { GATE_NAMES, GATE_SCHEMA, META, REPRO_SCHEMA, evaluateGate } from "./schema.mjs";

export { GATE_NAMES, GATE_SCHEMA, META, REPRO_SCHEMA };
export { reviewerPrompt, reproPrompt } from "./prompt.mjs";
export { prepareReview, checkCompanions } from "./prepare.mjs";
export { finalizeReview, finalizeRun } from "./finalize.mjs";

function noop() {}

export function generateWorkflowAdapter(coreFileUrl) {
  const url = coreFileUrl || pathToFileURL(fileURLToPath(import.meta.url)).href;
  return `${"export const meta = "}${JSON.stringify(META, null, 2)};
const { runReviewGate } = await import(${JSON.stringify(url)});
return await runReviewGate(args, { agent, parallel, phase, log });
`;
}

export async function runReviewGate(rawArgs, runtime = {}) {
  const agent = runtime.agent;
  const parallel = runtime.parallel || (async (thunks) => Promise.all(thunks.map((t) => t())));
  const phase = runtime.phase || noop;
  const log = runtime.log || noop;
  if (typeof agent !== "function") throw new Error("review-gate: runtime.agent is required");

  const state = await prepareReview(rawArgs, runtime);
  const { result, runDir, prompts } = state;
  try {
    phase("Review");
    const calls = GATE_NAMES.map((gate, index) => async () => {
      const prompt = prompts[index];
      let raw = null;
      try {
        raw = await agent(prompt, { label: gate, phase: "Review", schema: GATE_SCHEMA });
      } catch (err) {
        result.diagnostics.agentFailures.push({ gate, error: err.message });
        log(`agent ${gate} threw: ${err.message}`);
      }
      result.reviews[index] = evaluateGate(gate, raw);
      persist(runDir, result);
      return result.reviews[index];
    });
    const reviews = await parallel(calls);
    return await finalizeReview(state, reviews, runtime);
  } catch (err) {
    result.executionStatus = "incomplete";
    result.overall = "INVALID";
    result.passed = false;
    result.error = err.message;
    try { persist(runDir, result); } catch (saveError) { log(`could not preserve result: ${saveError.message}`); }
    throw err;
  }
}
