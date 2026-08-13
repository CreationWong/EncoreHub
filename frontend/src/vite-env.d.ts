/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_GATEWAY_URL?: string;
	readonly VITE_AUTH_TOKEN?: string;
	readonly VITE_BUILD_ID?: string;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}
