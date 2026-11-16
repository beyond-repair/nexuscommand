import { useState, type FormEvent } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { PayCard } from "@/components/company-notes";
import { Shell, useReadySession } from "@/components/shell";
import { Alert, Button, controlClass, when } from "@/components/nexus-ui";
import { DEPARTMENTS, formatMoney, dollarsToCents } from "@/lib/nexus/company";
import { companyCommand } from "@/lib/nexus/company-api";
import type { PaymentsView } from "@/lib/nexus/company-store";
import { errorText, useCompany } from "@/lib/nexus/use-company";

export const Route = createFileRoute("/payments")({ component: PaymentsPage });

function PaymentsPage() {
  const { user, pending } = useReadySession();
  return (
    <Shell>
      {pending ? <p className="py-8 text-sm text-muted">Checking session</p> : user ? <Ledger /> : (
        <p className="py-8 text-sm"><Link to="/login" className="text-accent">Sign in</Link> to see payments.</p>
      )}
    </Shell>
  );
}

function Ledger() {
  const { data, error, loading, reload } = useCompany<PaymentsView>("payments");
  const [payer, setPayer] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [missionId, setMissionId] = useState("");
  const [department, setDepartment] = useState("");
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const cents = dollarsToCents(amount);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await companyCommand({ data: { type: "record-payment", payer, amount, note, missionId, department } });
      setPayer("");
      setAmount("");
      setNote("");
      setMissionId("");
      setDepartment("");
      reload();
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading && !data) return <p className="py-8 text-sm text-muted">Loading payments</p>;
  if (!data) {
    return (
      <div className="py-8">
        <Alert>{error ?? "Payments did not load."}</Alert>
        <button type="button" className="mt-3 text-sm text-accent" onClick={reload}>Retry</button>
      </div>
    );
  }

  return (
    <div className="grid gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div>
        <h1 className="text-2xl font-medium">Payments</h1>
        <p className="mt-2 max-w-xl text-sm text-muted">
          {data.destination.business} is paid at {data.destination.cashtag}. This ledger is what you write down after the money arrives. It is not a receipt from Cash App.
        </p>
        <p className="mt-4 font-mono text-lg tabular-nums">Recorded {formatMoney(data.totalCents)}</p>
        <p className="mt-2 max-w-xl text-sm text-muted">
          Reserved {formatMoney(data.finance.reservedCents)}. Estimates {formatMoney(data.finance.estimateCents)} are not charges.
          {data.finance.ceilingCents == null
            ? " No spending ceiling is set, so remaining budget is not shown."
            : ` Ceiling ${formatMoney(data.finance.ceilingCents)}. Remaining ${formatMoney(data.finance.remainingCents ?? 0)}.`}
        </p>
        <Ceiling busy={busy} onDone={reload} onError={setFormError} />
        <DepartmentBudget busy={busy} onDone={reload} onError={setFormError} />

        <form onSubmit={(event) => void submit(event)} className="mt-8 max-w-xl space-y-3">
          <label className="block text-sm">
            Who paid
            <input value={payer} onChange={(event) => setPayer(event.target.value)} className={`${controlClass} mt-1 h-11`} />
          </label>
          <label className="block text-sm">
            Amount
            <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="25.00" className={`${controlClass} mt-1 h-11`} />
          </label>
          {amount.trim() && cents == null ? <p className="text-sm text-danger">Use an amount like 25 or 25.00.</p> : null}
          <label className="block text-sm">
            Mission
            <select value={missionId} onChange={(event) => setMissionId(event.target.value)} className={`${controlClass} mt-1 h-11`}>
              <option value="">Not tied to a mission</option>
              {data.missions.map((mission) => (
                <option key={mission.id} value={mission.id}>{mission.title}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Department
            <select value={department} onChange={(event) => setDepartment(event.target.value)} className={`${controlClass} mt-1 h-11`}>
              <option value="">Company ceiling only</option>
              {DEPARTMENTS.map((item) => (
                <option key={item.slug} value={item.slug}>{item.name}</option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Note
            <input value={note} onChange={(event) => setNote(event.target.value)} className={`${controlClass} mt-1 h-11`} />
          </label>
          {formError ? <Alert>{formError}</Alert> : null}
          <Button type="submit" disabled={busy || payer.trim().length < 2 || cents == null}>
            {busy ? "Recording…" : cents ? `Record ${formatMoney(cents)}` : "Record the payment"}
          </Button>
        </form>

        {data.rows.length === 0 ? (
          <p className="mt-8 text-sm text-muted">Nothing recorded yet.</p>
        ) : (
          <ul className="mt-8 divide-y divide-line border-y border-line">
            {data.rows.map((row) => (
              <li key={row.id} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className={`text-sm ${row.voidedAt ? "text-muted line-through" : ""}`}>{row.payer}</span>
                  <span className="font-mono text-sm tabular-nums">{formatMoney(row.amountCents)}</span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {row.voidedAt ? "Voided · " : ""}{row.method} {row.destination} · {when(row.createdAt)}
                </p>
                {row.missionId && row.missionTitle ? (
                  <p className="mt-1 text-sm">
                    <Link to="/missions/$missionId" params={{ missionId: row.missionId }} className="text-accent">
                      {row.missionTitle}
                    </Link>
                  </p>
                ) : null}
                {row.note ? <p className="mt-1 text-sm text-muted">{row.note}</p> : null}
                {row.voidedAt ? (
                  <p className="mt-1 text-xs text-muted">Voided {when(row.voidedAt)}. The row stays. This is not a refund.</p>
                ) : (
                  <button
                    type="button"
                    className="mt-2 inline-flex h-11 items-center text-sm text-danger"
                    disabled={busy}
                    onClick={() => {
                      if (voiding !== row.id) {
                        setVoiding(row.id);
                        return;
                      }
                      setBusy(true);
                      setFormError(null);
                      void companyCommand({ data: { type: "void-payment", paymentId: row.id } })
                        .then(() => {
                          setVoiding(null);
                          reload();
                        })
                        .catch((err: unknown) => setFormError(errorText(err)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    {voiding === row.id ? "Confirm void" : "Void this record"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error ? (
          <button type="button" className="mt-4 text-sm text-danger" onClick={reload}>
            {error} Retry
          </button>
        ) : null}
      </div>
      <PayCard poster />
    </div>
  );
}

function Ceiling({ busy, onDone, onError }: { busy: boolean; onDone: () => void; onError: (message: string | null) => void }) {
  const [amount, setAmount] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    onError(null);
    try {
      await companyCommand({ data: { type: "ceiling", amount } });
      setAmount("");
      onDone();
    } catch (err) {
      onError(errorText(err));
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="mt-4 max-w-sm">
      <label className="block text-sm">
        Spending ceiling
        <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="100.00" className={`${controlClass} mt-1 h-11`} />
      </label>
      <Button type="submit" variant="quiet" className="mt-2" disabled={busy || dollarsToCents(amount) == null}>Set ceiling</Button>
      <p className="mt-2 text-sm text-muted">Only you can raise or lower this. It does not move money, and it does not change payments already recorded.</p>
    </form>
  );
}

function DepartmentBudget({ busy, onDone, onError }: { busy: boolean; onDone: () => void; onError: (message: string | null) => void }) {
  const [slug, setSlug] = useState(DEPARTMENTS[0]?.slug ?? "engineering");
  const [amount, setAmount] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    onError(null);
    try {
      await companyCommand({ data: { type: "department-budget", note: slug, amount } });
      setAmount("");
      onDone();
    } catch (err) {
      onError(errorText(err));
    }
  }
  return (
    <form onSubmit={(event) => void save(event)} className="mt-4 max-w-sm">
      <label className="block text-sm">
        Department allocation
        <select value={slug} onChange={(event) => setSlug(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-line bg-bg px-3 text-sm">
          {DEPARTMENTS.map((department) => (
            <option key={department.slug} value={department.slug}>{department.name}</option>
          ))}
        </select>
      </label>
      <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="40.00" className={`${controlClass} mt-2 h-11`} />
      <Button type="submit" variant="quiet" className="mt-2" disabled={busy || dollarsToCents(amount) == null}>Set allocation</Button>
      <p className="mt-2 text-sm text-muted">Applies when a charge names that department. A blank department is checked only against the company ceiling and the mission budget.</p>
    </form>
  );
}
