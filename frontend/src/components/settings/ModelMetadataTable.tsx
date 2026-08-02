import { Check, Database, Pencil, Save, Search } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { NormalizedModelMetadata } from "../../services/modelMetadata";
import { toast } from "../../stores/toastStore";

type EditableMetadataField =
	| "id"
	| "name"
	| "description"
	| "ownedBy"
	| "contextWindow"
	| "maxOutputTokens"
	| "capabilities"
	| "inputModalities"
	| "outputModalities"
	| "apiEndpoints"
	| "documentationUrl"
	| "sourceUrl"
	| "pricing";

interface Column {
	field: EditableMetadataField;
	label: string;
	width: string;
	kind: "text" | "number" | "list" | "json";
}

const COLUMNS: Column[] = [
	{ field: "id", label: "Model ID", width: "min-w-56", kind: "text" },
	{ field: "name", label: "Name", width: "min-w-48", kind: "text" },
	{ field: "ownedBy", label: "Owned by", width: "min-w-32", kind: "text" },
	{
		field: "contextWindow",
		label: "Context",
		width: "min-w-28",
		kind: "number",
	},
	{
		field: "maxOutputTokens",
		label: "Max output",
		width: "min-w-28",
		kind: "number",
	},
	{
		field: "capabilities",
		label: "Capabilities",
		width: "min-w-56",
		kind: "list",
	},
	{
		field: "inputModalities",
		label: "Input",
		width: "min-w-36",
		kind: "list",
	},
	{
		field: "outputModalities",
		label: "Output",
		width: "min-w-36",
		kind: "list",
	},
	{
		field: "apiEndpoints",
		label: "API endpoints",
		width: "min-w-56",
		kind: "list",
	},
	{
		field: "documentationUrl",
		label: "Documentation",
		width: "min-w-64",
		kind: "text",
	},
	{ field: "sourceUrl", label: "Source", width: "min-w-64", kind: "text" },
	{ field: "pricing", label: "Pricing JSON", width: "min-w-72", kind: "json" },
	{
		field: "description",
		label: "Description",
		width: "min-w-80",
		kind: "text",
	},
];

interface Props {
	records: NormalizedModelMetadata[];
	providerName: string;
	onSave: (records: NormalizedModelMetadata[]) => Promise<void>;
}

function editorValue(record: NormalizedModelMetadata, column: Column): string {
	const value = record[column.field];
	if (value === undefined) return "";
	if (column.kind === "list") return (value as string[]).join(", ");
	if (column.kind === "json") return JSON.stringify(value, null, 2);
	return String(value);
}

function displayValue(record: NormalizedModelMetadata, column: Column): string {
	const value = record[column.field];
	if (value === undefined) return "—";
	if (column.kind === "list") return (value as string[]).join(", ");
	if (column.kind === "json") {
		const pricing = value as NonNullable<NormalizedModelMetadata["pricing"]>;
		return Object.entries(pricing)
			.map(([kind, tiers]) => `${kind} (${tiers.length})`)
			.join(", ");
	}
	if (column.kind === "number") return Number(value).toLocaleString();
	return String(value);
}

function parsedValue(column: Column, value: string): unknown {
	const trimmed = value.trim();
	if (!trimmed) return undefined;
	if (column.kind === "number") {
		const number = Number(trimmed);
		if (!Number.isFinite(number) || number < 0) {
			throw new Error(`${column.label} must be a non-negative number`);
		}
		return Math.trunc(number);
	}
	if (column.kind === "list") {
		return trimmed
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (column.kind === "json") {
		const parsed = JSON.parse(trimmed) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw new Error("Pricing must be a JSON object");
		}
		return parsed;
	}
	return trimmed;
}

export default function ModelMetadataTable({
	records,
	providerName,
	onSave,
}: Props) {
	const [draft, setDraft] = useState(records);
	const [query, setQuery] = useState("");
	const [editing, setEditing] = useState<{
		row: number;
		field: EditableMetadataField;
	} | null>(null);
	const [editor, setEditor] = useState("");
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		setDraft(records.map((record) => ({ ...record })));
		setEditing(null);
	}, [records]);

	const dirty = JSON.stringify(draft) !== JSON.stringify(records);
	const visibleRows = useMemo(() => {
		const normalized = query.trim().toLowerCase();
		return draft
			.map((record, index) => ({ record, index }))
			.filter(({ record }) => {
				if (!normalized) return true;
				return [
					record.id,
					record.name,
					record.ownedBy,
					record.description,
					...(record.capabilities ?? []),
				].some((value) => value?.toLowerCase().includes(normalized));
			});
	}, [draft, query]);

	const beginEdit = (row: number, column: Column) => {
		setEditing({ row, field: column.field });
		setEditor(editorValue(draft[row], column));
	};

	const commitCell = () => {
		if (!editing) return;
		const column = COLUMNS.find((item) => item.field === editing.field);
		if (!column) return;
		try {
			const value = parsedValue(column, editor);
			setDraft((current) =>
				current.map((record, index) =>
					index === editing.row
						? { ...record, [editing.field]: value }
						: record,
				),
			);
			setEditing(null);
		} catch (reason) {
			toast.error(
				reason instanceof Error ? reason.message : "Invalid metadata value",
			);
		}
	};

	const handleEditorKey = (
		event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
	) => {
		if (event.key === "Escape") {
			setEditing(null);
			return;
		}
		if (
			event.key === "Enter" &&
			!(event.shiftKey && editing?.field === "pricing")
		) {
			event.preventDefault();
			commitCell();
		}
	};

	const save = async () => {
		if (editing) commitCell();
		const ids = draft.map((record) => record.id.trim());
		if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
			toast.error("Model IDs must be present and unique");
			return;
		}
		setSaving(true);
		try {
			await onSave(draft);
			toast.success("Model metadata saved");
		} catch {
			toast.error("Failed to save model metadata");
		} finally {
			setSaving(false);
		}
	};

	return (
		<section
			className="flex min-h-0 flex-1 flex-col"
			aria-label="Metadata records"
		>
			<header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
				<div className="min-w-0">
					<h4 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
						<Database className="h-4 w-4 text-accent" />
						{providerName} data
					</h4>
					<p className="mt-0.5 text-xs text-text-muted">
						{draft.length.toLocaleString()} stored records. Double-click a cell
						to edit it.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<div className="relative">
						<Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
						<input
							autoComplete="off"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Filter records"
							aria-label="Filter metadata records"
							className="h-8 w-52 rounded-md border border-border bg-surface-alt pl-8 pr-2 text-xs text-text-primary placeholder:text-text-muted"
						/>
					</div>
					<button
						type="button"
						onClick={() => void save()}
						disabled={!dirty || saving}
						className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
					>
						{saving ? (
							<Check className="h-3.5 w-3.5" />
						) : (
							<Save className="h-3.5 w-3.5" />
						)}
						{saving ? "Saving" : "Save changes"}
					</button>
				</div>
			</header>

			<div className="min-h-0 flex-1 overflow-auto">
				<table className="w-max min-w-full border-collapse text-left text-xs">
					<thead className="sticky top-0 z-20 bg-surface-alt text-text-secondary shadow-[0_1px_0_var(--color-border)]">
						<tr>
							{COLUMNS.map((column, index) => (
								<th
									key={column.field}
									className={`h-9 border-r border-border px-3 font-semibold last:border-r-0 ${column.width} ${
										index === 0 ? "sticky left-0 z-30 bg-surface-alt" : ""
									}`}
								>
									{column.label}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{visibleRows.map(({ record, index: rowIndex }) => (
							<tr
								key={`${record.id}-${rowIndex}`}
								className="border-b border-border last:border-b-0 hover:bg-surface-hover/50"
							>
								{COLUMNS.map((column, columnIndex) => {
									const isEditing =
										editing?.row === rowIndex && editing.field === column.field;
									return (
										<td
											key={column.field}
											className={`h-10 border-r border-border px-3 align-middle last:border-r-0 ${column.width} ${
												columnIndex === 0
													? "sticky left-0 z-10 bg-surface font-mono text-text-primary"
													: "text-text-secondary"
											}`}
										>
											{isEditing ? (
												column.kind === "json" ? (
													<textarea
														autoComplete="off"
														value={editor}
														onChange={(event) => setEditor(event.target.value)}
														onBlur={commitCell}
														onKeyDown={handleEditorKey}
														aria-label={`Edit ${column.label} for ${record.id}`}
														// biome-ignore lint/a11y/noAutofocus: editing begins from an explicit cell action
														autoFocus
														className="h-24 w-full resize-none rounded border border-accent bg-surface px-2 py-1 font-mono text-[11px] text-text-primary"
													/>
												) : (
													<input
														autoComplete="off"
														value={editor}
														onChange={(event) => setEditor(event.target.value)}
														onBlur={commitCell}
														onKeyDown={handleEditorKey}
														aria-label={`Edit ${column.label} for ${record.id}`}
														// biome-ignore lint/a11y/noAutofocus: editing begins from an explicit cell action
														autoFocus
														className="h-7 w-full rounded border border-accent bg-surface px-2 text-xs text-text-primary"
													/>
												)
											) : (
												<button
													type="button"
													onDoubleClick={() => beginEdit(rowIndex, column)}
													onKeyDown={(event) => {
														if (event.key === "Enter")
															beginEdit(rowIndex, column);
													}}
													title="Double-click to edit"
													className="group flex w-full min-w-0 items-center gap-1.5 text-left"
												>
													<span className="block max-w-[24rem] truncate">
														{displayValue(record, column)}
													</span>
													<Pencil className="h-3 w-3 shrink-0 text-text-muted opacity-0 group-hover:opacity-100" />
												</button>
											)}
										</td>
									);
								})}
							</tr>
						))}
					</tbody>
				</table>
				{visibleRows.length === 0 && (
					<p className="px-4 py-12 text-center text-sm text-text-muted">
						{draft.length === 0
							? "Fetch this provider to store metadata records."
							: "No records match this filter."}
					</p>
				)}
			</div>
		</section>
	);
}
