import { useEffect, useState } from "react";

function queryMatches(query: string): boolean {
	return typeof window !== "undefined" &&
		typeof window.matchMedia === "function"
		? window.matchMedia(query).matches
		: false;
}

export function useMediaQuery(query: string): boolean {
	const [matches, setMatches] = useState(() => queryMatches(query));

	useEffect(() => {
		if (typeof window.matchMedia !== "function") return;
		const media = window.matchMedia(query);
		const update = () => setMatches(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, [query]);

	return matches;
}
