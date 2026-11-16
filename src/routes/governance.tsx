import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { RunTokenNote } from "@/components/company-notes";
import { Shell, useReadySession } from "@/components/shell";
import { Alert, Button, when } from "@/components/nexus-ui";
import { LEVEL_LABEL, OWNER_GATES } from "@/lib/nexus/company";
import { companyCommand } from "@/lib/nexus/company-api";
import type { GovernanceView } from "@/lib/nexus/company-store";
import { errorText, useCompany } from "@/lib/nexus/use-company";

export const Route = createFileRoute("/governance")({ component: GovernancePage });

function GovernancePage() {
  const { user, pending } = useReadySession();
  return (
    <Shell>
      {pending ? <p className="py-8 text-sm text-muted">Checking session</p> : user ? <Record /> : (
        <p className="py-8 text-sm"><Link to="/login" className="text-accent">Sign in</Link> to read governance.</p>
      )}
    </Shell>
  );
}

function Record() {
  const { data, error, loading, reload } = useCompany<GovernanceView>("governance");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  if (loading && !data) return <p className="py-8 text-sm text-muted">Loading the record</p>;
  if (!data) {
    return (
      <div className="py-8">
        <Alert>{error ?? "Governance did not load."}</Alert>
        <button type="button" className="mt-3 text-sm text-accent" onClick={reload}>Retry</button>
      </div>
    );
  }

  async function setPolicy(policy: "local" | "public") {
    setBusy(true);
    setFormError(null);
    try {
      await companyCommand({ data: { type: "disclosure", policy } });
      reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-6">
      <h1 className="text-2xl font-medium">Governance</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        The owner is the only person who can authorize a plan or accept a delivery. An agent cannot widen its own permission.
      </p>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Permission levels</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {LEVEL_LABEL.map((label) => (
            <li key={label} className="border-t border-line pt-2">{label}</li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Always the owner</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted">
          {OWNER_GATES.map((gate) => (
            <li key={gate}>{gate}</li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Model disclosure</h2>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {data.disclosure === "public"
            ? "Public is on. An authorized run of internal work may send the objective and the plan to the free model. Confidential work is not sent. The provider and model are written on the dispatch."
            : "Local only. Department writing stays in this workspace. Nothing is sent to a model provider."}
        </p>
        <p className="mt-2 text-sm text-muted">
          Leased {data.workers.leased} · retry {data.workers.retry} · dead {data.workers.dead} · scheduler {data.scheduler.status}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button disabled={busy || data.disclosure === "local"} onClick={() => void setPolicy("local")}>Keep it local</Button>
          <Button variant="quiet" disabled={busy || data.disclosure === "public"} onClick={() => void setPolicy("public")}>Allow the free model</Button>
        </div>
        {formError ? <div className="mt-3"><Alert>{formError}</Alert></div> : null}
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Run token</h2>
        <div className="mt-2 max-w-xl">
          <RunTokenNote />
        </div>
        <p className="mt-2 max-w-xl text-sm text-muted">
          The token is not a permission. It only decides which write is still current. A lost lease cannot save. Recording a Cash App payment does not let an agent spend.
        </p>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Audit</h2>
        {data.events.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No events yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {data.events.map((event) => (
              <li key={event.id} className="text-sm">
                <span className="font-mono text-xs text-muted">{when(event.createdAt)}</span>{" "}
                <span className="font-mono text-xs">{event.action}</span>
                {event.toState ? <span className="text-muted"> → {event.toState}</span> : null}
                {event.detail ? <span className="mt-0.5 block text-muted">{event.detail}</span> : null}
                {event.target?.startsWith("msn_") ? (
                  <Link to="/missions/$missionId" params={{ missionId: event.target }} className="mt-0.5 block text-xs text-accent">
                    Open the mission
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="mt-8 text-sm">
        <Link to="/blueprint" className="text-accent">Operating contract</Link>
      </p>
    </div>
  );
}
