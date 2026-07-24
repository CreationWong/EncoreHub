import ReactDOM from "react-dom/client";
import ClientUiBaseline, { seedClientUiBaseline } from "./ClientUiBaseline";
import { parseClientUiBaselineOptions } from "./clientUiFixtures";
import "../styles/globals.css";

if (!import.meta.env.DEV) {
	throw new Error(
		"The client UI baseline is available only in development mode",
	);
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Root element #root not found");

const options = parseClientUiBaselineOptions(window.location.search);
const scenario = seedClientUiBaseline(options);
document.title = `EncoreHub UI Baseline - ${scenario.id} - ${options.theme}`;

ReactDOM.createRoot(rootElement).render(<ClientUiBaseline />);

requestAnimationFrame(() => {
	requestAnimationFrame(() => {
		if (scenario.id === "providers-locked") {
			const providerButton = Array.from(
				document.querySelectorAll<HTMLButtonElement>("dialog button"),
			).find((button) => button.textContent?.includes("DeepSeek"));
			providerButton?.click();
		}

		requestAnimationFrame(() => {
			document.documentElement.dataset.uiBaselineReady = "true";
		});
	});
});
