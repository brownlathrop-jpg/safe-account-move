// Самостоятельный конфиг сборки — без пакета @lovable.dev/vite-tanstack-config.
// Нужен, когда проект развивается уже вне Lovable (полная независимость).
//
// Как переключиться:
//   1) mv vite.config.ts vite.config.lovable.ts
//   2) mv vite.config.standalone.ts vite.config.ts
//   3) bun remove @lovable.dev/vite-tanstack-config
//   4) bun run build && node selfhost/node-server.js   (проверить локально)
//
// Пока проект правится в Lovable, активным должен остаться vite.config.ts
// с пакетом платформы — иначе редактор и предпросмотр перестанут работать.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";

const postgresNodeEntry = fileURLToPath(
  new URL("./node_modules/postgres/src/index.js", import.meta.url),
);

export default defineConfig({
  server: { host: "::", port: 8080 },
  resolve: {
    alias: [
      // Приложение работает на обычном Node, поэтому берём node-версию
      // драйвера PostgreSQL (вариант для Cloudflare тянет cloudflare:sockets).
      { find: /^postgres$/, replacement: postgresNodeEntry },
    ],
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-query"],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      server: { entry: "server" },
    }),
    nitro({
      preset: "cloudflare-module",
      output: { dir: "dist", serverDir: "dist/server", publicDir: "dist/client" },
      cloudflare: { nodeCompat: true, deployConfig: true },
    }),
    viteReact(),
  ],
});
