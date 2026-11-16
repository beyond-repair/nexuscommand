import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import type { Thinker, Sql } from "./company-store";
import { WORKFORCE_MODEL } from "./company";
import {
  acceptMission,
  answerMission,
  authorizeMission,
  authorizeRevalidation,
  cancelMission,
  commandCenter,
  commandDevice,
  connectGithub,
  governance,
  knowledge,
  linkMissionProject,
  linkMissionTask,
  missionView,
  operations,
  payments,
  planMission,
  proposeSpecification,
  recordObservation,
  recordPayment,
  recordPrice,
  recoverRun,
  registerDevice,
  registerIntegration,
  rejectMission,
  reopenMission,
  requestExternalAction,
  refreshGithub,
  readGithubForDepartment,
  reserveFunds,
  rework,
  runNext,
  acceptSpecification,
  setCapacity,
  setCostPolicy,
  setDepartmentBudget,
  setDisclosure,
  setDependency,
  setClassification,
  setMilestone,
  setParent,
  setPriority,
  setScheduler,
  revokeGithub,
  setSpendingCeiling,
  setMissionBudget,
  submitMission,
  unlinkMissionTask,
  voidPayment,
  workforce,
} from "./company-store";
import { assertCommandRate } from "./command-rate";
import { schedulerTick } from "./scheduler";

async function think(input: { system: string; user: string }): Promise<{ text: string; model: string; unavailable?: boolean; outcome?: "succeeded" | "failed" | "timeout"; durationMs?: number; errorCategory?: string }> {
  const started = Date.now();
  try {
    const response = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model: "openai-fast",
        max_tokens: 1400,
        temperature: 0.3,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
    const durationMs = Date.now() - started;
    if (!response.ok) return { text: "", model: "", unavailable: true, outcome: "failed", durationMs, errorCategory: `http-${response.status}` };
    const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) return { text: "", model: "", unavailable: true, outcome: "failed", durationMs, errorCategory: "empty" };
    return { text, model: WORKFORCE_MODEL, outcome: "succeeded", durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    const timeout = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { text: "", model: "", unavailable: true, outcome: timeout ? "timeout" : "failed", durationMs, errorCategory: timeout ? "timeout" : "request" };
  }
}

function db(sql: unknown): Sql {
  return sql as Sql;
}

let schedulerStarted = false;

function ensureScheduler(): void {
  if (schedulerStarted || process.env.NEXUS_SCHEDULER === "off") return;
  schedulerStarted = true;
  const timer = setInterval(() => {
    void (async () => {
      try {
        await schedulerTick(db(await getSql()), think);
      } catch (error) {
        console.error("[scheduler]", error instanceof Error ? error.message : "tick failed");
      }
    })();
  }, 12_000);
  timer.unref?.();
}

export const loadCompany = createServerFn({ method: "POST" })
  .validator((input: { view: string; missionId?: string }) => {
    const view = input?.view;
    if (
      view !== "command" &&
      view !== "mission" &&
      view !== "workforce" &&
      view !== "operations" &&
      view !== "knowledge" &&
      view !== "governance" &&
      view !== "payments"
    ) {
      throw new Error("Unknown view");
    }
    return { view, missionId: typeof input.missionId === "string" ? input.missionId : "" };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    ensureScheduler();
    const sql = db(await getSql());
    if (data.view === "command") return commandCenter(sql, context.userId);
    if (data.view === "mission") return missionView(sql, context.userId, data.missionId);
    if (data.view === "workforce") return workforce(sql, context.userId);
    if (data.view === "operations") return operations(sql, context.userId);
    if (data.view === "knowledge") return knowledge(sql, context.userId);
    if (data.view === "payments") return payments(sql, context.userId);
    return governance(sql, context.userId);
  });

export const companyCommand = createServerFn({ method: "POST" })
  .validator((input: { type?: string; missionId?: string; objective?: string; note?: string; payer?: string; amount?: string; paymentId?: string; policy?: string; dependsOn?: string; scheduler?: string; classification?: string; parentId?: string; priority?: string; department?: string; secret?: string }) => {
    if (!input || typeof input.type !== "string" || !input.type) throw new Error("Unknown command");
    return {
      type: input.type,
      missionId: typeof input.missionId === "string" ? input.missionId : "",
      objective: typeof input.objective === "string" ? input.objective : "",
      note: typeof input.note === "string" ? input.note : "",
      payer: typeof input.payer === "string" ? input.payer : "",
      amount: typeof input.amount === "string" ? input.amount : "",
      paymentId: typeof input.paymentId === "string" ? input.paymentId : "",
      policy: typeof input.policy === "string" ? input.policy : "",
      dependsOn: typeof input.dependsOn === "string" ? input.dependsOn : "",
      scheduler: typeof input.scheduler === "string" ? input.scheduler : "",
      classification: typeof input.classification === "string" ? input.classification : "",
      parentId: typeof input.parentId === "string" ? input.parentId : "",
      priority: typeof input.priority === "string" ? input.priority : "",
      department: typeof input.department === "string" ? input.department : "",
      secret: typeof input.secret === "string" ? input.secret : "",
    };
  })
  .middleware([authMiddleware])
  .handler(async ({ context, data }) => {
    ensureScheduler();
    assertCommandRate(context.userId);
    const sql = db(await getSql());
    const thinker: Thinker = think;
    const missionId = data.missionId ?? "";
    if (data.type === "submit") return submitMission(sql, context.userId, data.objective ?? "");
    if (data.type === "plan") {
      await planMission(sql, context.userId, missionId, thinker);
      return { ok: true as const };
    }
    if (data.type === "authorize") {
      await authorizeMission(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "run") return runNext(sql, context.userId, missionId, thinker);
    if (data.type === "recover") {
      await recoverRun(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "rework") return rework(sql, context.userId, missionId);
    if (data.type === "accept") {
      await acceptMission(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "reject") {
      await rejectMission(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "cancel") {
      await cancelMission(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "reopen") {
      await reopenMission(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "answer") {
      await answerMission(sql, context.userId, missionId, data.note);
      return { ok: true as const };
    }
    if (data.type === "record-payment") {
      await recordPayment(sql, context.userId, {
        payer: data.payer,
        amount: data.amount,
        note: data.note,
        missionId,
        department: data.department ?? "",
      });
      return { ok: true as const };
    }
    if (data.type === "void-payment") {
      await voidPayment(sql, context.userId, data.paymentId);
      return { ok: true as const };
    }
    if (data.type === "disclosure") {
      await setDisclosure(sql, context.userId, data.policy);
      return { ok: true as const };
    }
    if (data.type === "depend") {
      await setDependency(sql, context.userId, missionId, data.dependsOn);
      return { ok: true as const };
    }
    if (data.type === "scheduler") {
      await setScheduler(sql, context.userId, data.scheduler);
      return { ok: true as const };
    }
    if (data.type === "classification") {
      await setClassification(sql, context.userId, missionId, data.classification);
      return { ok: true as const };
    }
    if (data.type === "parent") {
      await setParent(sql, context.userId, missionId, data.parentId ?? "");
      return { ok: true as const };
    }
    if (data.type === "priority") {
      await setPriority(sql, context.userId, missionId, data.priority ?? "");
      return { ok: true as const };
    }
    if (data.type === "milestone") {
      await setMilestone(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "capacity") {
      await setCapacity(sql, context.userId, data.priority ?? "");
      return { ok: true as const };
    }
    if (data.type === "ceiling") {
      await setSpendingCeiling(sql, context.userId, data.amount ?? "");
      return { ok: true as const };
    }
    if (data.type === "mission-budget") {
      await setMissionBudget(sql, context.userId, missionId, data.amount ?? "");
      return { ok: true as const };
    }
    if (data.type === "department-budget") {
      await setDepartmentBudget(sql, context.userId, data.note ?? "", data.amount ?? "");
      return { ok: true as const };
    }
    if (data.type === "reserve" || data.type === "estimate") {
      await reserveFunds(sql, context.userId, { amount: data.amount ?? "", note: data.note ?? "", missionId, kind: data.type === "estimate" ? "estimate" : "reserved" });
      return { ok: true as const };
    }
    if (data.type === "propose-spec") {
      await proposeSpecification(sql, context.userId, missionId, data.objective ?? "");
      return { ok: true as const };
    }
    if (data.type === "accept-spec") {
      await acceptSpecification(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "revalidate") {
      await authorizeRevalidation(sql, context.userId, missionId);
      return { ok: true as const };
    }
    if (data.type === "cost-policy") {
      await setCostPolicy(sql, context.userId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "price") {
      const [provider, model] = (data.note ?? "").split("/");
      await recordPrice(sql, context.userId, { provider: provider ?? "", model: model ?? "", inputRate: data.amount ?? "", outputRate: data.objective ?? "" });
      return { ok: true as const };
    }
    if (data.type === "integration") {
      await registerIntegration(sql, context.userId, { name: data.note ?? "", category: data.policy ?? "", scopes: data.objective ?? "" });
      return { ok: true as const };
    }
    if (data.type === "external-action") {
      await requestExternalAction(sql, context.userId, {
        integrationId: data.note ?? "",
        operation: data.objective ?? "",
        actionClass: Number(data.priority ?? "1"),
        classification: data.classification ?? "internal",
      });
      return { ok: true as const };
    }
    if (data.type === "device") {
      await registerDevice(sql, context.userId, { name: data.note ?? "", permission: data.policy ?? "" });
      return { ok: true as const };
    }
    if (data.type === "device-command") {
      await commandDevice(sql, context.userId, data.note ?? "", data.objective ?? "");
      return { ok: true as const };
    }
    if (data.type === "observe") {
      await recordObservation(sql, context.userId, missionId, data.note ?? "", data.objective ?? "");
      return { ok: true as const };
    }
    if (data.type === "github-connect") {
      await connectGithub(sql, context.userId, data.secret ?? "", data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "github-revoke") {
      await revokeGithub(sql, context.userId, "revoked");
      return { ok: true as const };
    }
    if (data.type === "github-disconnect") {
      await revokeGithub(sql, context.userId, "disconnected");
      return { ok: true as const };
    }
    if (data.type === "github-refresh") {
      await refreshGithub(sql, context.userId);
      return { ok: true as const };
    }
    if (data.type === "github-read") {
      await readGithubForDepartment(sql, context.userId, {
        operation: data.objective ?? "",
        resource: data.note ?? "",
        department: data.department ?? "",
        missionId,
        page: data.priority ?? "1",
      });
      return { ok: true as const };
    }
    if (data.type === "link-project") {
      await linkMissionProject(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "link-task") {
      await linkMissionTask(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    if (data.type === "unlink-task") {
      await unlinkMissionTask(sql, context.userId, missionId, data.note ?? "");
      return { ok: true as const };
    }
    throw new Error("Unknown command");
  });
