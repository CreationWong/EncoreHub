import { ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
	type DatabaseOverview,
	type DatabasePage,
	devtools,
	inTauri,
} from "../../services/devtools";

const DATABASE_PAGE_SIZE = 100;

function errorMessage(error: unknown, fallback: string) {
	if (error instanceof Error && error.message.trim()) return error.message;
	if (typeof error === "string" && error.trim()) return error;
	return fallback;
}

export default function DatabasePanel() {
	const [overview, setOverview] = useState<DatabaseOverview | null>(null);
	const [page, setPage] = useState<DatabasePage | null>(null);
	const [selectedTable, setSelectedTable] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const tauri = inTauri();

	const loadRows = useCallback(async (table: string, offset = 0) => {
		setLoading(true);
		setError("");
		try {
			const nextPage = await devtools.databaseRows(
				table,
				DATABASE_PAGE_SIZE,
				offset,
			);
			setSelectedTable(table);
			setPage(nextPage);
		} catch (loadError) {
			setError(errorMessage(loadError, "Failed to read database table"));
		} finally {
			setLoading(false);
		}
	}, []);

	const loadDatabase = useCallback(async () => {
		if (!tauri) return;
		setLoading(true);
		setError("");
		try {
			const nextOverview = await devtools.databaseOverview();
			setOverview(nextOverview);
			const nextTable =
				nextOverview.tables.find((table) => table.name === selectedTable)
					?.name ?? nextOverview.tables[0]?.name;
			if (nextTable) {
				const nextPage = await devtools.databaseRows(
					nextTable,
					DATABASE_PAGE_SIZE,
					0,
				);
				setSelectedTable(nextTable);
				setPage(nextPage);
			} else {
				setSelectedTable("");
				setPage(null);
			}
		} catch (loadError) {
			setError(errorMessage(loadError, "Failed to inspect database"));
		} finally {
			setLoading(false);
		}
	}, [selectedTable, tauri]);

	useEffect(() => {
		if (overview === null) void loadDatabase();
	}, [loadDatabase, overview]);

	if (!tauri) {
		return (
			<p className="p-10 text-center text-sm text-text-muted">
				Database inspection is only available in the desktop app.
			</p>
		);
	}

	return (
		<div className="flex h-full min-h-0 p-5">
			<div className="flex min-h-[360px] min-w-0 flex-1 overflow-hidden rounded-md border border-border">
				<aside className="w-52 shrink-0 overflow-y-auto border-r border-border bg-surface-alt/30 p-2 max-[760px]:w-40">
					<div className="mb-2 flex items-center justify-between px-1">
						<span className="text-[10px] font-semibold text-text-muted">
							TABLES
						</span>
						<button
							type="button"
							onClick={() => void loadDatabase()}
							disabled={loading}
							aria-label="Refresh database"
							title="Refresh database"
							className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-surface-hover hover:text-text-primary disabled:opacity-40"
						>
							<RefreshCw
								className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
							/>
						</button>
					</div>
					{overview?.tables.map((table) => (
						<button
							key={table.name}
							type="button"
							onClick={() => void loadRows(table.name)}
							aria-current={selectedTable === table.name ? "page" : undefined}
							className={`mb-0.5 flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-xs ${
								selectedTable === table.name
									? "bg-selected text-text-primary"
									: "text-text-secondary hover:bg-surface-hover hover:text-text-primary"
							}`}
						>
							<span className="truncate font-mono">{table.name}</span>
							<span className="shrink-0 text-[10px] text-text-muted">
								{table.row_count}
							</span>
						</button>
					))}
				</aside>

				<section className="flex min-w-0 flex-1 flex-col">
					<header className="flex min-h-11 items-center justify-between gap-3 border-b border-border px-3 py-2">
						<div className="min-w-0">
							<p className="truncate font-mono text-xs font-semibold text-text-primary">
								{selectedTable || "Database"}
							</p>
							<p
								className="truncate text-[10px] text-text-muted"
								title={overview?.path}
							>
								{overview?.path || "Read-only local database browser"}
							</p>
						</div>
						{page && (
							<div className="flex shrink-0 items-center gap-1 text-[10px] text-text-muted">
								<span>
									{page.total_rows === 0
										? "0 rows"
										: `${page.offset + 1}-${Math.min(
												page.offset + page.rows.length,
												page.total_rows,
											)} of ${page.total_rows}`}
								</span>
								<button
									type="button"
									onClick={() =>
										void loadRows(
											page.table,
											Math.max(0, page.offset - page.limit),
										)
									}
									disabled={page.offset === 0 || loading}
									aria-label="Previous database page"
									className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
								>
									<ChevronLeft className="h-3.5 w-3.5" />
								</button>
								<button
									type="button"
									onClick={() =>
										void loadRows(page.table, page.offset + page.limit)
									}
									disabled={
										loading || page.offset + page.limit >= page.total_rows
									}
									aria-label="Next database page"
									className="rounded p-1 hover:bg-surface-hover disabled:opacity-30"
								>
									<ChevronRight className="h-3.5 w-3.5" />
								</button>
							</div>
						)}
					</header>

					<div className="min-h-0 flex-1 overflow-auto">
						{error ? (
							<p className="p-5 text-sm text-danger">{error}</p>
						) : loading && !page ? (
							<div className="flex h-full items-center justify-center text-text-muted">
								<RefreshCw className="h-4 w-4 animate-spin" />
							</div>
						) : page ? (
							<table className="min-w-full border-collapse text-left font-mono text-[10px]">
								<thead className="sticky top-0 z-10 bg-surface-alt text-text-muted">
									<tr>
										{page.columns.map((column) => (
											<th
												key={column}
												className="whitespace-nowrap border-b border-r border-border px-2 py-1.5 font-semibold last:border-r-0"
											>
												{column}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{page.rows.map((row, rowIndex) => (
										<tr
											key={`${page.offset + rowIndex}`}
											className="border-b border-border last:border-b-0"
										>
											{row.map((cell, cellIndex) => (
												<td
													key={page.columns[cellIndex]}
													className="max-w-72 whitespace-pre-wrap break-all border-r border-border px-2 py-1.5 align-top text-text-secondary last:border-r-0"
												>
													{cell === null ? (
														<span className="italic text-text-muted">NULL</span>
													) : (
														cell
													)}
												</td>
											))}
										</tr>
									))}
								</tbody>
							</table>
						) : (
							<p className="p-5 text-sm text-text-muted">No database tables.</p>
						)}
					</div>
				</section>
			</div>
		</div>
	);
}
