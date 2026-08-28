import type { AgentResult } from "@retroport/schemas";
import { describe, expect, it, vi } from "vitest";
import {
  InvalidWorkflowError,
  createPhase0Workflow,
  phase0StepIds,
  runWorkflow,
  type WorkflowDefinition,
  type WorkflowHandler,
} from "../src/index.js";

const result = (status: AgentResult<unknown>["status"] = "success"): AgentResult<unknown> => ({
  status,
  output: null,
  evidence: [],
  assumptions: [],
  warnings: [],
  confidence: status === "success" ? 1 : 0,
  nextActions: [],
});
const handler = (status?: AgentResult<unknown>["status"]): WorkflowHandler<object> =>
  vi.fn(async () => result(status));

describe("workflow runner", () => {
  it("runs fan-out branches before their join in stable order", async () => {
    const release: (() => void)[] = [];
    const branch = vi.fn(() => new Promise<AgentResult<unknown>>((resolve) => {
      release.push(() => resolve(result()));
    }));
    const join = handler();
    const workflow: WorkflowDefinition<object> = {
      id: "fan-out",
      steps: [
        { id: "join", dependsOn: ["a", "b"], run: join },
        { id: "b", dependsOn: ["root"], run: branch },
        { id: "root", dependsOn: [], run: handler() },
        { id: "a", dependsOn: ["root"], run: branch },
      ],
    };
    const pending = runWorkflow(workflow, {});
    await vi.waitFor(() => expect(branch).toHaveBeenCalledTimes(2));
    expect(join).not.toHaveBeenCalled();
    release.forEach((resolve) => resolve());
    const run = await pending;
    expect(run.executionOrder).toEqual(["root", "a", "b", "join"]);
    expect(run.scheduledOrder).toEqual(run.executionOrder);
    expect(join).toHaveBeenCalledOnce();
    expect(run.status).toBe("success");
  });

  it("skips dependents of failed steps and normalizes exceptions", async () => {
    const dependent = handler();
    const run = await runWorkflow({
      id: "failure",
      steps: [
        { id: "explode", dependsOn: [], run: async () => { throw new Error("boom"); } },
        { id: "dependent", dependsOn: ["explode"], run: dependent },
      ],
    }, {});
    expect(run.status).toBe("failed");
    expect(run.steps.explode?.result?.warnings[0]?.code).toBe("core.workflow.step_exception");
    expect(run.steps.dependent).toMatchObject({ status: "skipped", blockedBy: ["explode"] });
    expect(run.executionOrder).toEqual(["explode"]);
    expect(run.scheduledOrder).toEqual(["explode", "dependent"]);
    expect(dependent).not.toHaveBeenCalled();
  });

  it("passes validated dependency results to joins", async () => {
    const join = vi.fn(async ({ dependencies }) => {
      expect(dependencies.left?.output).toBe("left-output");
      expect(dependencies.right?.output).toBe("right-output");
      return result();
    });
    const outputHandler = (output: string): WorkflowHandler<object> => async () => ({
      ...result(),
      output,
    });
    await runWorkflow({
      id: "dataflow",
      steps: [
        { id: "left", dependsOn: [], run: outputHandler("left-output") },
        { id: "right", dependsOn: [], run: outputHandler("right-output") },
        { id: "join", dependsOn: ["left", "right"], run: join },
      ],
    }, {});
    expect(join).toHaveBeenCalledOnce();
  });

  it("isolates handlers from mutable context", async () => {
    const mutate: WorkflowHandler<{ nested: { value: number } }> = async ({ context }) => {
      expect(Object.isFrozen(context.nested)).toBe(true);
      expect(() => {
        (context.nested as { value: number }).value = 2;
      }).toThrow();
      return result();
    };
    const context = { nested: { value: 1 } };
    await runWorkflow({ id: "immutable", steps: [{ id: "step", dependsOn: [], run: mutate }] }, context);
    expect(context.nested.value).toBe(1);
  });

  it("normalizes malformed handler output as a failed step", async () => {
    const run = await runWorkflow({
      id: "invalid-output",
      steps: [{
        id: "invalid",
        dependsOn: [],
        run: async () => ({ status: "success" }) as AgentResult<unknown>,
      }],
    }, {});
    expect(run.status).toBe("failed");
    expect(run.steps.invalid?.result?.warnings[0]?.code).toBe("core.workflow.step_exception");
  });

  it.each([
    ["duplicate", [
      { id: "a", dependsOn: [], run: handler() },
      { id: "a", dependsOn: [], run: handler() },
    ]],
    ["missing", [{ id: "a", dependsOn: ["missing"], run: handler() }]],
    ["cycle", [
      { id: "a", dependsOn: ["b"], run: handler() },
      { id: "b", dependsOn: ["a"], run: handler() },
    ]],
  ])("rejects an invalid %s graph", async (_name, steps) => {
    await expect(runWorkflow({ id: "invalid", steps }, {})).rejects.toBeInstanceOf(
      InvalidWorkflowError,
    );
  });

  it("defines the Phase 0 workflow as an executable graph", async () => {
    const handlers = Object.fromEntries(phase0StepIds.map((id) => [id, handler()])) as
      Record<(typeof phase0StepIds)[number], WorkflowHandler<object>>;
    const run = await runWorkflow(createPhase0Workflow(handlers), {});
    expect(run.executionOrder).toEqual([
      "check-compatibility", "check-legal-boundary", "inspect-input",
      "triage-gate",
      "dynamic-discovery", "static-discovery",
      "semantic-analysis",
      "skeptical-review",
      "design-experiment",
      "run-experiment",
      "evidence-gate",
      "emit-semantic-ir",
      "generate-target",
      "code-review",
      "behavioral-verification", "determinism-verification",
      "acceptance-gate",
    ]);
    expect(run.status).toBe("success");
  });
});
