import {
	AlertCircle,
	AlertTriangle,
	CheckCircle2,
	Info,
	X,
} from "lucide-react";
import {
	type Toast,
	type ToastKind,
	useToastStore,
} from "../../stores/toastStore";

const ICONS: Record<ToastKind, typeof Info> = {
	success: CheckCircle2,
	error: AlertCircle,
	warning: AlertTriangle,
	info: Info,
};

const ACCENT_STYLES: Record<ToastKind, string> = {
	success: "bg-success",
	error: "bg-danger",
	warning: "bg-warning",
	info: "bg-info",
};

const ICON_STYLES: Record<ToastKind, string> = {
	success: "bg-success-bg text-success",
	error: "bg-danger-bg text-danger",
	warning: "bg-warning-bg text-warning",
	info: "bg-info-bg text-info",
};

function ToastItem({ toast }: { toast: Toast }) {
	const dismiss = useToastStore((s) => s.dismiss);
	const Icon = ICONS[toast.kind];
	return (
		<output
			aria-live="polite"
			className="pointer-events-auto relative flex min-h-12 items-start gap-3 overflow-hidden rounded-lg border border-border bg-workspace py-3 pl-4 pr-2 text-sm text-text-primary shadow-[0_12px_32px_rgba(0,0,0,0.22)] animate-toast-in"
		>
			<span
				aria-hidden="true"
				className={`absolute inset-y-0 left-0 w-1 ${ACCENT_STYLES[toast.kind]}`}
			/>
			<span
				className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${ICON_STYLES[toast.kind]}`}
			>
				<Icon className="h-4 w-4" />
			</span>
			<span className="min-w-0 flex-1 break-words py-0.5 leading-5">
				{toast.message}
			</span>
			<button
				type="button"
				aria-label="Dismiss notification"
				onClick={() => dismiss(toast.id)}
				className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-control hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
			>
				<X className="h-4 w-4" />
			</button>
		</output>
	);
}

export default function ToastHost() {
	const toasts = useToastStore((s) => s.toasts);
	if (toasts.length === 0) return null;
	return (
		<section
			aria-label="Notifications"
			className="pointer-events-none fixed right-3 top-[4.75rem] z-[70] flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2 sm:right-4"
		>
			{toasts.map((t) => (
				<ToastItem key={t.id} toast={t} />
			))}
		</section>
	);
}
