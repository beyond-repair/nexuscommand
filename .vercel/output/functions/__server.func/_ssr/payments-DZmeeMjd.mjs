import { o as __toESM } from "../_runtime.mjs";
import { S as formatMoney, a as DEPARTMENTS, b as dollarsToCents } from "./company-CTrhEwiG.mjs";
import { C as require_jsx_runtime, X as require_react, b as Link } from "../_libs/@tanstack/react-router+[...].mjs";
import { n as useReadySession, t as Shell } from "./shell-PybG2xey.mjs";
import { t as PayCard } from "./company-notes-rWDJZ1cg.mjs";
import { a as when, i as controlClass, n as Button, t as Alert } from "./nexus-ui-D8VU1C9e.mjs";
import { n as errorText, r as useCompany, t as companyCommand } from "./use-company-Bul2pimC.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/payments-DZmeeMjd.js
var import_react = /* @__PURE__ */ __toESM(require_react());
var import_jsx_runtime = require_jsx_runtime();
function PaymentsPage() {
	const { user, pending } = useReadySession();
	return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Shell, { children: pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "py-8 text-sm text-muted",
		children: "Checking session"
	}) : user ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ledger, {}) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
		className: "py-8 text-sm",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
			to: "/login",
			className: "text-accent",
			children: "Sign in"
		}), " to see payments."]
	}) });
}
function Ledger() {
	const { data, error, loading, reload } = useCompany("payments");
	const [payer, setPayer] = (0, import_react.useState)("");
	const [amount, setAmount] = (0, import_react.useState)("");
	const [note, setNote] = (0, import_react.useState)("");
	const [missionId, setMissionId] = (0, import_react.useState)("");
	const [department, setDepartment] = (0, import_react.useState)("");
	const [busy, setBusy] = (0, import_react.useState)(false);
	const [voiding, setVoiding] = (0, import_react.useState)(null);
	const [formError, setFormError] = (0, import_react.useState)(null);
	const cents = dollarsToCents(amount);
	async function submit(event) {
		event.preventDefault();
		setBusy(true);
		setFormError(null);
		try {
			await companyCommand({ data: {
				type: "record-payment",
				payer,
				amount,
				note,
				missionId,
				department
			} });
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
	if (loading && !data) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
		className: "py-8 text-sm text-muted",
		children: "Loading payments"
	});
	if (!data) return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "py-8",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Alert, { children: error ?? "Payments did not load." }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
			type: "button",
			className: "mt-3 text-sm text-accent",
			onClick: reload,
			children: "Retry"
		})]
	});
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
		className: "grid gap-10 py-6 lg:grid-cols-[minmax(0,1fr)_18rem]",
		children: [/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("h1", {
				className: "text-2xl font-medium",
				children: "Payments"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 max-w-xl text-sm text-muted",
				children: [
					data.destination.business,
					" is paid at ",
					data.destination.cashtag,
					". This ledger is what you write down after the money arrives. It is not a receipt from Cash App."
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-4 font-mono text-lg tabular-nums",
				children: ["Recorded ", formatMoney(data.totalCents)]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
				className: "mt-2 max-w-xl text-sm text-muted",
				children: [
					"Reserved ",
					formatMoney(data.finance.reservedCents),
					". Estimates ",
					formatMoney(data.finance.estimateCents),
					" are not charges.",
					data.finance.ceilingCents == null ? " No spending ceiling is set, so remaining budget is not shown." : ` Ceiling ${formatMoney(data.finance.ceilingCents)}. Remaining ${formatMoney(data.finance.remainingCents ?? 0)}.`
				]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Ceiling, {
				busy,
				onDone: reload,
				onError: setFormError
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(DepartmentBudget, {
				busy,
				onDone: reload,
				onError: setFormError
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
				onSubmit: (event) => void submit(event),
				className: "mt-8 max-w-xl space-y-3",
				children: [
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "block text-sm",
						children: ["Who paid", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: payer,
							onChange: (event) => setPayer(event.target.value),
							className: `${controlClass} mt-1 h-11`
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "block text-sm",
						children: ["Amount", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: amount,
							onChange: (event) => setAmount(event.target.value),
							inputMode: "decimal",
							placeholder: "25.00",
							className: `${controlClass} mt-1 h-11`
						})]
					}),
					amount.trim() && cents == null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
						className: "text-sm text-danger",
						children: "Use an amount like 25 or 25.00."
					}) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "block text-sm",
						children: ["Mission", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							value: missionId,
							onChange: (event) => setMissionId(event.target.value),
							className: `${controlClass} mt-1 h-11`,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "",
								children: "Not tied to a mission"
							}), data.missions.map((mission) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: mission.id,
								children: mission.title
							}, mission.id))]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "block text-sm",
						children: ["Department", /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", {
							value: department,
							onChange: (event) => setDepartment(event.target.value),
							className: `${controlClass} mt-1 h-11`,
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: "",
								children: "Company ceiling only"
							}), DEPARTMENTS.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
								value: item.slug,
								children: item.name
							}, item.slug))]
						})]
					}),
					/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
						className: "block text-sm",
						children: ["Note", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
							value: note,
							onChange: (event) => setNote(event.target.value),
							className: `${controlClass} mt-1 h-11`
						})]
					}),
					formError ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Alert, { children: formError }) : null,
					/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
						type: "submit",
						disabled: busy || payer.trim().length < 2 || cents == null,
						children: busy ? "Recording…" : cents ? `Record ${formatMoney(cents)}` : "Record the payment"
					})
				]
			}),
			data.rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-8 text-sm text-muted",
				children: "Nothing recorded yet."
			}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", {
				className: "mt-8 divide-y divide-line border-y border-line",
				children: data.rows.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", {
					className: "py-3",
					children: [
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", {
							className: "flex items-baseline justify-between gap-3",
							children: [/* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: `text-sm ${row.voidedAt ? "text-muted line-through" : ""}`,
								children: row.payer
							}), /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", {
								className: "font-mono text-sm tabular-nums",
								children: formatMoney(row.amountCents)
							})]
						}),
						/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-1 text-xs text-muted",
							children: [
								row.voidedAt ? "Voided · " : "",
								row.method,
								" ",
								row.destination,
								" · ",
								when(row.createdAt)
							]
						}),
						row.missionId && row.missionTitle ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm",
							children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(Link, {
								to: "/missions/$missionId",
								params: { missionId: row.missionId },
								className: "text-accent",
								children: row.missionTitle
							})
						}) : null,
						row.note ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
							className: "mt-1 text-sm text-muted",
							children: row.note
						}) : null,
						row.voidedAt ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", {
							className: "mt-1 text-xs text-muted",
							children: [
								"Voided ",
								when(row.voidedAt),
								". The row stays. This is not a refund."
							]
						}) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", {
							type: "button",
							className: "mt-2 inline-flex h-11 items-center text-sm text-danger",
							disabled: busy,
							onClick: () => {
								if (voiding !== row.id) {
									setVoiding(row.id);
									return;
								}
								setBusy(true);
								setFormError(null);
								companyCommand({ data: {
									type: "void-payment",
									paymentId: row.id
								} }).then(() => {
									setVoiding(null);
									reload();
								}).catch((err) => setFormError(errorText(err))).finally(() => setBusy(false));
							},
							children: voiding === row.id ? "Confirm void" : "Void this record"
						})
					]
				}, row.id))
			}),
			error ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "mt-4 text-sm text-danger",
				onClick: reload,
				children: [error, " Retry"]
			}) : null
		] }), /* @__PURE__ */ (0, import_jsx_runtime.jsx)(PayCard, { poster: true })]
	});
}
function Ceiling({ busy, onDone, onError }) {
	const [amount, setAmount] = (0, import_react.useState)("");
	async function save(event) {
		event.preventDefault();
		onError(null);
		try {
			await companyCommand({ data: {
				type: "ceiling",
				amount
			} });
			setAmount("");
			onDone();
		} catch (err) {
			onError(errorText(err));
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit: (event) => void save(event),
		className: "mt-4 max-w-sm",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "block text-sm",
				children: ["Spending ceiling", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
					value: amount,
					onChange: (event) => setAmount(event.target.value),
					inputMode: "decimal",
					placeholder: "100.00",
					className: `${controlClass} mt-1 h-11`
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				variant: "quiet",
				className: "mt-2",
				disabled: busy || dollarsToCents(amount) == null,
				children: "Set ceiling"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Only you can raise or lower this. It does not move money, and it does not change payments already recorded."
			})
		]
	});
}
function DepartmentBudget({ busy, onDone, onError }) {
	const [slug, setSlug] = (0, import_react.useState)(DEPARTMENTS[0]?.slug ?? "engineering");
	const [amount, setAmount] = (0, import_react.useState)("");
	async function save(event) {
		event.preventDefault();
		onError(null);
		try {
			await companyCommand({ data: {
				type: "department-budget",
				note: slug,
				amount
			} });
			setAmount("");
			onDone();
		} catch (err) {
			onError(errorText(err));
		}
	}
	return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("form", {
		onSubmit: (event) => void save(event),
		className: "mt-4 max-w-sm",
		children: [
			/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", {
				className: "block text-sm",
				children: ["Department allocation", /* @__PURE__ */ (0, import_jsx_runtime.jsx)("select", {
					value: slug,
					onChange: (event) => setSlug(event.target.value),
					className: "mt-1 h-11 w-full rounded-md border border-line bg-bg px-3 text-sm",
					children: DEPARTMENTS.map((department) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", {
						value: department.slug,
						children: department.name
					}, department.slug))
				})]
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", {
				value: amount,
				onChange: (event) => setAmount(event.target.value),
				inputMode: "decimal",
				placeholder: "40.00",
				className: `${controlClass} mt-2 h-11`
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)(Button, {
				type: "submit",
				variant: "quiet",
				className: "mt-2",
				disabled: busy || dollarsToCents(amount) == null,
				children: "Set allocation"
			}),
			/* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", {
				className: "mt-2 text-sm text-muted",
				children: "Applies when a charge names that department. A blank department is checked only against the company ceiling and the mission budget."
			})
		]
	});
}
//#endregion
export { PaymentsPage as component };
