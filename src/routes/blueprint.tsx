import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/shell";
import { LEVEL_LABEL, MISSION_LABEL, MISSION_PATH, OWNER_GATES, PAYMENT, PIPELINE, RUN_TOKEN } from "@/lib/nexus/company";

export const Route = createFileRoute("/blueprint")({ component: BlueprintPage });

function BlueprintPage() {
  return (
    <Shell>
      <article className="max-w-2xl py-6">
        <p className="font-mono text-xs text-muted">Operating contract · 2.0</p>
        <h1 className="mt-2 text-3xl font-medium">What this company can do</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          NEXUS is the owner’s command center for Atomic Dream Labs. A mission moves through a fixed workforce.
          Completion is a passing verification record plus your acceptance. An agent saying it is done does not count.
        </p>
        <Section title="The loop">
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {MISSION_PATH.map((step) => (
              <li key={step}>{MISSION_LABEL[step]}</li>
            ))}
          </ol>
        </Section>
        <Section title="Workforce on this release">
          <p className="font-mono text-xs leading-relaxed text-muted">{PIPELINE.join(" → ")}</p>
          <p className="mt-2 text-sm text-muted">
            Research, product, architecture, design, and implementation are written when you run that department.
            Quality is computed from the artifacts. Operations assembles the packet and does not change the result.
          </p>
        </Section>
        <Section title="Permission">
          <ul className="space-y-1 text-sm">
            {LEVEL_LABEL.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted">
            {OWNER_GATES.map((gate) => (
              <li key={gate}>{gate}</li>
            ))}
          </ul>
        </Section>
        <Section title="Run token">
          <p className="text-sm leading-relaxed text-muted">{RUN_TOKEN}</p>
        </Section>
        <Section title="Payments">
          <p className="text-sm leading-relaxed text-muted">
            {PAYMENT.business} receives money on {PAYMENT.method} at {PAYMENT.cashtag}. NEXUS shows that destination and stores a payment only when you record it. It does not charge a card, and it does not ask Cash App whether the money arrived.
          </p>
        </Section>
        <Section title="Honest limits">
          <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed text-muted">
            <li>One workspace per signed-in owner.</li>
            <li>Quality runs the implementation under OS limits: memory, CPU time, process count, file size, no network, and a private temp directory that is removed afterward. A throw, a missing control, a request for network or storage, or a missing limit fails the mission. A passing report is tied to that exact hash. Editing the implementation afterwards does not keep the pass.</li>
            <li>A mission can wait on another mission. Execution will not start until that mission is accepted. A dependency that loops is refused.</li>
            <li>Operations can run, pause, or stop the scheduler. While it is running, it starts the next authorized department and survives a restart. It does not authorize a plan, accept a packet, or change who owns the company. A lease older than 90 seconds cannot save.</li>
            <li>Confidential missions stay in this workspace even if public disclosure is on. Internal missions may use the free model only when that disclosure is on. Each dispatch records the provider, the model, the classification, and the execution id.</li>
            <li>An answer you save is read by the next plan and by every department. It does not authorize execution.</li>
            <li>A rejected packet can be rewritten, or the departments can be reset so the same plan runs again. Accepted work is not reopened.</li>
            <li>A recorded payment can be voided. The row stays, the total drops it, and voiding is not a refund.</li>
            <li>Rewriting a plan replaces that mission's unverified strategy. A verified decision stays.</li>
            <li>Department writing uses GPT-OSS 20B only when Governance allows the public model. Local mode keeps the objective in this workspace. If the model is down or the rate limit is hit, the local orchestrator writes the step and says so.</li>
            <li>Accepted missions become memory the next plan can read. A later acceptance of the same decision supersedes the older one. Proposed and contested notes are not treated as facts.</li>
            <li>The company record stays when you come back. A published deploy uses the hosted database when one is configured.</li>
            <li>A failed check is an open defect. Fix and retest redoes the department that owns it, then verifies again. A later pass closes the defect.</li>
            <li>The old project and task boards are closed. They do not run work.</li>
          </ul>
        </Section>
      </article>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}
