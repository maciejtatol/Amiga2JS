import type { AgentResult } from "@retroport/schemas";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  InvalidWorkflowError,
  createPhase0Workflow,
  directDependencyResults,
  phase0StepIds,
  runWorkflow,
  type WorkflowDefinition,
  type WorkflowHandler,
  type WorkflowStep,
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
type EmptyContext = Record<string, never>;
const semanticOutput = {
  assertionId: "movement",
  claim: "player X follows input-dependent velocity",
  evidenceIds: ["static-1", "runtime-1"], addresses: ["0x1000"],
  traceIds: ["trace-1"], reproducibleExperiments: ["experiment-1"],
  analystNarrative: "must not reach downstream consumers",
};
const allowDecision = {
  decision: "allow" as const, faithfulGeneration: true as const,
  assertionIds: ["movement"],
  assessments: [{ assertionId: "movement", status: "SUPPORTED" as const, channels: ["dynamic-trace" as const, "static-analysis" as const], reasons: [] }],
  reasons: [],
};
const handler = (status?: AgentResult<unknown>["status"]): WorkflowHandler<EmptyContext> =>
  vi.fn(async () => result(status));
const step = (
  id: string,
  dependsOn: readonly string[],
  run: WorkflowHandler<EmptyContext> = handler(),
  outputSchema: z.ZodType<null | string> = z.null(),
): WorkflowStep<EmptyContext> => ({
  id,
  dependsOn,
  run,
  outputSchema,
  projectDependencies: directDependencyResults,
});

describe("workflow runner", () => {
  it("runs fan-out branches before their join in stable order", async () => {
    const release: (() => void)[] = [];
    const branch = vi.fn(() => new Promise<AgentResult<unknown>>((resolve) => {
      release.push(() => resolve(result()));
    }));
    const join = handler();
    const workflow: WorkflowDefinition<EmptyContext> = {
      id: "fan-out",
      steps: [
        step("join", ["a", "b"], join),
        step("b", ["root"], branch),
        step("root", []),
        step("a", ["root"], branch),
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
        step("explode", [], async () => { throw new Error("boom"); }),
        step("dependent", ["explode"], dependent),
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
    const join = vi.fn(async ({ dependencyInput }) => {
      expect((dependencyInput.left as { output: string }).output).toBe("left-output");
      expect((dependencyInput.right as { output: string }).output).toBe("right-output");
      return result();
    });
    const outputHandler = (output: string): WorkflowHandler<EmptyContext> => async () => ({
      ...result(),
      output,
    });
    await runWorkflow({
      id: "dataflow",
      steps: [
        step("left", [], outputHandler("left-output"), z.string()),
        step("right", [], outputHandler("right-output"), z.string()),
        step("join", ["left", "right"], join),
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
    await runWorkflow({ id: "immutable", steps: [{
      ...step("step", []),
      run: mutate,
    }] }, context);
    expect(context.nested.value).toBe(1);
  });

  it("normalizes malformed handler output as a failed step", async () => {
    const run = await runWorkflow({
      id: "invalid-output",
      steps: [step(
        "invalid",
        [],
        async () => ({ ...result(), output: "wrong-output-type" }),
      )],
    }, {});
    expect(run.status).toBe("failed");
    expect(run.steps.invalid?.result?.warnings[0]?.code).toBe("core.workflow.step_exception");
  });

  it("rejects non-JSON workflow context before executing handlers", async () => {
    const run = runWorkflow({ id: "invalid-context", steps: [step("step", [])] }, {
      mutable: new Map([["key", "value"]]),
    } as unknown as EmptyContext);
    await expect(run).rejects.toThrow("Non-JSON object");
  });

  it.each([
    ["duplicate", [
      step("a", []),
      step("a", []),
    ]],
    ["missing", [step("a", ["missing"])]],
    ["cycle", [
      step("a", ["b"]),
      step("b", ["a"]),
    ]],
  ])("rejects an invalid %s graph", async (_name, steps) => {
    await expect(runWorkflow({ id: "invalid", steps }, {})).rejects.toBeInstanceOf(
      InvalidWorkflowError,
    );
  });

  it("defines the Phase 0 workflow as an executable graph", async () => {
    const handlers = Object.fromEntries(phase0StepIds.map((id) => [id, {
      run: id === "semantic-analysis"
        ? vi.fn(async () => ({ ...result(), output: {
          ...semanticOutput,
        } }))
        : id === "evidence-gate"
          ? vi.fn(async () => ({ ...result(), output: allowDecision }))
        : handler(),
      outputSchema: z.null(),
    }])) as unknown as Parameters<typeof createPhase0Workflow<EmptyContext>>[0];
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
    const reviewer = handlers["skeptical-review"].run as ReturnType<typeof vi.fn>;
    expect(reviewer).toHaveBeenCalledWith(expect.objectContaining({
      dependencyInput: expect.not.objectContaining({ analystNarrative: expect.anything() }),
    }));
    const emitter = handlers["emit-semantic-ir"].run as ReturnType<typeof vi.fn>;
    expect(emitter).toHaveBeenCalledWith(expect.objectContaining({
      dependencyInput: {
        gate: allowDecision,
        semanticAnalysis: expect.not.objectContaining({ analystNarrative: expect.anything() }),
      },
    }));
  });

  it.each([
    ["blocked result", "blocked", { decision: "block", faithfulGeneration: false, assertionIds: ["movement"], assessments: [], reasons: [] }, "blocked"],
    ["inconsistent success/block result", "success", { decision: "block", faithfulGeneration: false, assertionIds: ["movement"], assessments: [], reasons: [] }, "failed"],
    ["partial allow result", "partial", allowDecision, "failed"],
    ["gate bound to another assertion", "success", {
      ...allowDecision,
      assertionIds: ["other"],
      assessments: [{ ...allowDecision.assessments[0]!, assertionId: "other" }],
    }, "failed"],
  ] as const)("prevents generation for a %s", async (_case, gateStatus, gateOutput, expectedStatus) => {
    const handlers = Object.fromEntries(phase0StepIds.map((id) => [id, {
      run: id === "semantic-analysis"
        ? vi.fn(async () => ({ ...result(), output: semanticOutput }))
        : id === "evidence-gate"
          ? vi.fn(async () => ({ ...result(gateStatus), output: gateOutput }))
          : handler(),
      outputSchema: z.null(),
    }])) as unknown as Parameters<typeof createPhase0Workflow<EmptyContext>>[0];
    const run = await runWorkflow(createPhase0Workflow(handlers), {});
    expect(run.status).toBe(expectedStatus);
    expect(run.steps["emit-semantic-ir"]?.status).toBe(gateStatus === "blocked" ? "skipped" : "failed");
    expect(run.steps["generate-target"]?.status).toBe("skipped");
    expect(handlers["emit-semantic-ir"].run).not.toHaveBeenCalled();
    expect(handlers["generate-target"].run).not.toHaveBeenCalled();
  });
});
