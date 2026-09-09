import { build } from "esbuild";
await build({
  entryPoints: ["src/runtime/entry.ts"],
  outfile: "assets/supervisor.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: false,
  minify: false,
  legalComments: "inline",
});
