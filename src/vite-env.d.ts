/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WALLET_URL?: string;
  readonly VITE_WELCOME_BOT?: string;
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
