/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_MODO?: "memoria" | "http";
  readonly VITE_API?: string;
}
interface ImportMeta { readonly env: ImportMetaEnv }
