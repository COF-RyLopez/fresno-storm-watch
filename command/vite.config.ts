import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
// The shared collectors remain independent files. Key their full dependency graph by
// content, so a new shell never loads a cached, incompatible adapter after deployment.
const sharedModules = {
  name: "command-shared-module-keys",
  transformIndexHtml: {
    order: "post" as const,
    async handler(html: string) {
      const imports: Record<string, string> = {};
      for (const directory of ["", "lib/"]) {
        const base = new URL("../site/" + directory, import.meta.url);
        for (const name of (await readdir(base))
          .filter((n) => /\.m?js$/.test(n))
          .sort()) {
          const hash = createHash("sha256")
            .update(await readFile(new URL(name, base)))
            .digest("hex")
            .slice(0, 10);
          const key = "../" + directory + name;
          imports[key] = key + "?v=" + hash;
        }
      }
      const json = JSON.stringify({ imports }),
        hash = createHash("sha256").update(json).digest("base64");
      return html
        .replace("script-src 'self'", `script-src 'sha256-${hash}' 'self'`)
        .replace(
          '<script type="module"',
          `<script type="importmap">${json}</script><script type="module"`,
        );
    },
  },
};
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "./",
  plugins: [sharedModules],
  build: {
    outDir: fileURLToPath(new URL("../site/command", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
  },
  server: { host: "127.0.0.1" },
});
