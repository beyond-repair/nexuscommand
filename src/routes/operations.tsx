import { useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PayCard } from "@/components/company-notes";
import { Shell, useReadySession } from "@/components/shell";
import { Alert, Button, when } from "@/components/nexus-ui";
import { ASSIGNMENT_LABEL } from "@/lib/nexus/company";
import { companyCommand } from "@/lib/nexus/company-api";
import type { OperationsView } from "@/lib/nexus/company-store";
import { errorText, useCompany } from "@/lib/nexus/use-company";

export const Route = createFileRoute("/operations")({ component: OperationsPage });

function OperationsPage() {
  const { user, pending } = useReadySession();
  return (
    <Shell>
      {pending ? <p className="py-8 text-sm text-muted">Checking session</p> : user ? <Board /> : (
        <p className="py-8 text-sm"><Link to="/login" className="text-accent">Sign in</Link> to see operations.</p>
      )}
    </Shell>
  );
}

function Board() {
  const { data, error, loading, reload } = useCompany<OperationsView>("operations");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  if (loading && !data) return <p className="py-8 text-sm text-muted">Loading operations</p>;
  if (!data) {
    return (
      <div className="py-8">
        <Alert>{error ?? "Operations did not load."}</Alert>
        <button type="button" className="mt-3 text-sm text-accent" onClick={reload}>Retry</button>
      </div>
    );
  }

  async function setScheduler(status: "running" | "paused" | "stopped") {
    setBusy(true);
    setFormError(null);
    try {
      await companyCommand({ data: { type: "scheduler", scheduler: status } });
      reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function setCapacity(value: string) {
    setBusy(true);
    setFormError(null);
    try {
      await companyCommand({ data: { type: "capacity", priority: value } });
      reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const scheduler = data.scheduler;
  return (
    <div className="py-6">
      <h1 className="text-2xl font-medium">Operations</h1>
      <p className="mt-2 max-w-xl text-sm text-muted">
        {scheduler.status === "running"
          ? "The scheduler is operating. It starts the next authorized department and stops there. It cannot authorize a plan or accept a packet."
          : scheduler.status === "paused"
            ? "The scheduler is paused. Nothing new starts until you resume it. A run already in flight can still finish."
            : "The scheduler is stopped. Authorized work waits until you start it."}
      </p>
      <p className="mt-2 text-sm text-muted">
        Queue {scheduler.queue} · capacity {data.capacity} · leased {data.workers.leased} · retry {data.workers.retry} · dead {data.workers.dead}
        {scheduler.lastTick ? ` · last tick ${when(scheduler.lastTick)}` : ""}
      </p>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Delivery queue</h2>
        <p className="mt-2 text-sm text-muted">
          Pending {data.outbox.pending}. Processing {data.outbox.processing}. Waiting to retry {data.outbox.failed}. Dead {data.outbox.dead}. Completed {data.outbox.completed}.
          {data.outbox.oldestSeconds == null ? " No event is waiting." : ` Oldest waiting event is ${data.outbox.oldestSeconds} seconds.`}
          {" "}A queued event is not a finished operation, and delivering it does not authorize or accept anything.
          {" "}The scheduler drains this queue only while it is running. Paused and stopped do not. Opening this page still does.
        </p>
        <p className="mt-2 text-sm text-muted">
          This process is tracking {data.rateLimit.tracked} command-rate {data.rateLimit.tracked === 1 ? "entry" : "entries"}. Idle entries dropped: {data.rateLimit.dropped}. Limit {data.rateLimit.limit} commands per {Math.round(data.rateLimit.windowMs / 1000)} seconds. This is one process, not a cluster-wide limit.
        </p>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Measured operations</h2>
        <ul className="mt-3 space-y-3">
          {data.metrics.map((metric) => (
            <li key={metric.name} className="border-t border-line pt-3 text-sm">
              <p>{metric.name}</p>
              <p className="mt-1 text-muted">
                {metric.kind === "unavailable" || metric.value == null
                  ? metric.note
                  : `${metric.value} ${metric.unit}, from ${metric.sample} observation${metric.sample === 1 ? "" : "s"}. ${metric.note}`}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Recommendations</h2>
        <ul className="mt-3 space-y-2">
          {data.recommendations.map((note) => (
            <li key={note} className="text-sm text-muted">{note}</li>
          ))}
        </ul>
      </section>
      <section className="mt-8">
        <h2 className="text-sm font-medium">Maintenance</h2>
        {data.maintenance.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No maintenance condition is currently proposed. An empty list is not a health score.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {data.maintenance.map((item) => (
              <li key={item.id} className="border-t border-line pt-3 text-sm">
                <p>{item.title}</p>
                <p className="mt-1 text-muted">{item.evidence}</p>
                <p className="mt-1 font-mono text-xs text-muted">{item.status} · {item.risk} risk · {item.autonomous ? "may run without a new approval" : "owner"} · {item.result}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      {scheduler.lastError ? <p className="mt-2 text-sm text-danger">{scheduler.lastError}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy || scheduler.status === "running"} onClick={() => void setScheduler("running")}>Operate</Button>
        <Button variant="quiet" disabled={busy || scheduler.status === "paused"} onClick={() => void setScheduler("paused")}>Pause</Button>
        <Button variant="quiet" disabled={busy || scheduler.status === "stopped"} onClick={() => void setScheduler("stopped")}>Stop</Button>
      </div>
      {formError ? <div className="mt-3"><Alert>{formError}</Alert></div> : null}
      <section className="mt-6 max-w-sm">
        <h2 className="text-sm font-medium">Concurrent departments</h2>
        <p className="mt-2 text-sm text-muted">The owner sets how many departments may run at once. The default is one. This does not raise a budget.</p>
        <select
          value={String(data.capacity)}
          disabled={busy}
          onChange={(event) => void setCapacity(event.target.value)}
          className="mt-3 h-11 w-full rounded-md border border-line bg-bg px-3 text-sm"
        >
          {[1, 2, 3, 4].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </section>
      <section className="mt-6">
        <h2 className="text-sm font-medium">Leases</h2>
        {data.leases.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No lease is active. An expired lease is released on the next tick and cannot save.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {data.leases.map((lease) => (
              <li key={`${lease.missionId}:${lease.agentName}`} className="text-sm text-muted">{lease.agentName} · {lease.missionTitle} · until {when(lease.until)}</li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-6">
        <h2 className="text-sm font-medium">Last sandbox</h2>
        {data.sandbox ? (
          <p className="mt-2 text-sm text-muted">
            {data.sandbox.policy || data.sandbox.suite || "unrecorded"}
            {data.sandbox.filesystem ? ` · root ${data.sandbox.filesystem}` : ""}
            {data.sandbox.identity ? ` · ${data.sandbox.identity}` : ""}
            {data.sandbox.capabilities ? ` · capabilities ${data.sandbox.capabilities}` : ""}
            {data.sandbox.seccomp ? ` · ${data.sandbox.seccomp}` : ""}
            {data.sandbox.network ? ` · network ${data.sandbox.network}` : ""}
            {data.sandbox.proc ? ` · proc ${data.sandbox.proc}` : ""}
            {data.sandbox.env ? ` · env ${data.sandbox.env}` : ""}
            {" · "}{Math.round(data.sandbox.memoryBytes / 1048576) || "?"} MB · {data.sandbox.cpuSeconds}s cpu · {data.sandbox.processes} processes · {data.sandbox.fileBytes} byte disk
            {" · "}{data.sandbox.enforced ? "boundary applied" : "boundary was not applied"}
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">No quality report has been stored yet.</p>
        )}
      </section>
      {data.recoveries.length > 0 ? (
        <ul className="mt-4 space-y-1">
          {data.recoveries.map((row) => (
            <li key={row.id} className="text-sm text-muted">{when(row.createdAt)} · {row.detail}</li>
          ))}
        </ul>
      ) : null}
      <div className="mt-6 max-w-sm">
        <PayCard />
      </div>
      {data.rows.length === 0 ? (
        <p className="mt-6 text-sm text-muted">No assignments yet. Establish a mission and develop its strategy.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {data.rows.map((row) => (
            <li key={row.id}>
              <Link to="/missions/$missionId" params={{ missionId: row.missionId }} className="flex min-h-11 items-center justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-sm">{row.agentName} · {row.title}</span>
                  <span className="block truncate text-xs text-muted">{row.missionTitle}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={`block font-mono text-xs ${row.status === "FAILED" ? "text-danger" : "text-muted"}`}>{ASSIGNMENT_LABEL[row.status]}</span>
                  <span className="font-mono text-xs text-muted">{when(row.updatedAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
