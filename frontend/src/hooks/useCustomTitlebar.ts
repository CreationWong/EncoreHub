import { useEffect, useState } from "react";
import { getCustomTitlebarEnabled } from "../services/runtimePlatform";

export function useCustomTitlebar(): boolean {
	const [enabled, setEnabled] = useState(false);

	useEffect(() => {
		let disposed = false;
		void getCustomTitlebarEnabled().then((value) => {
			if (!disposed) setEnabled(value);
		});
		return () => {
			disposed = true;
		};
	}, []);

	return enabled;
}
