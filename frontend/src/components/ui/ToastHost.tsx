import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import {
	type Toast,
	type ToastKind,
	useToastStore,
} from "../../stores/toastStore";

const ICONS: Record<ToastKind, typeof Info> = {
	success: CheckCircle2,
	error: AlertCircle,
	info: Info,
};

const STYLES: Record<ToastKind, string> = {
	success: "border-success-border bg-success-bg text-success",
	error: "border-danger-border bg-danger-bg text-danger",
	info: "border-info-border bg-info-bg text-info",
};

function ToastItem({ toast }: { toast: Toast }) {
	const dismiss = useToastStore((s) => s.dismiss);
	const Icon = ICONS[toast.kind];
	return (
		<output
			aria-live="polite"
			className={`pointer-events-auto flex items-start gap-2 rounded-lg border px-3 py-2 text-sm shadow-lg animate-slide-up ${STYLES[toast.kind]}`}
		>
			<Icon className="mt-0.5 h-4 w-4 shrink-0" />
			<span className="flex-1 text-text-primary">{toast.message}</span>
			<button
				type="button"
				aria-label="Dismiss notification"
				onClick={() => dismiss(toast.id)}
				className="shrink-0 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
			>
				<X className="h-3.5 w-3.5" />
			</button>
		</output>
	);
}

export default function ToastHost() {
	const toasts = useToastStore((s) => s.toasts);
	if (toasts.length === 0) return null;
	return (
		<div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} />
			))}
		</div>
	);
}
