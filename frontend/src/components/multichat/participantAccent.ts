// Deterministic accent colors for group members.
//
// Colors are identity accents only (avatar dot, name, bubble edge), not status
// colors, so they live outside the semantic token set. The palette is indexed
// by roster position, which keeps a member's color stable across reloads.

const MEMBER_ACCENTS = [
	"#4263eb",
	"#0ca678",
	"#e8590c",
	"#7048e8",
	"#d6336c",
	"#1098ad",
	"#f08c00",
	"#0b7285",
] as const;

/** Return the stable accent color for a zero-based roster position. */
export function participantAccent(position: number): string {
	const index =
		((position % MEMBER_ACCENTS.length) + MEMBER_ACCENTS.length) %
		MEMBER_ACCENTS.length;
	return MEMBER_ACCENTS[index];
}

/**
 * Convert one #rrggbb accent into an rgba() string.
 *
 * Tinted bubbles only need the accent's hue at low opacity; returning a color
 * instead of a Tailwind class keeps identity colors out of the semantic token
 * set while staying theme-agnostic (the tint reads on light and dark surfaces).
 * Invalid input returns a fully transparent color so a bad value cannot paint.
 */
export function colorWithAlpha(hex: string, alpha: number): string {
	const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return "rgba(0, 0, 0, 0)";
	const value = Number.parseInt(match[1], 16);
	const red = (value >> 16) & 0xff;
	const green = (value >> 8) & 0xff;
	const blue = value & 0xff;
	return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
