import { rm, mkdir, cp, writeFile } from "node:fs/promises";
import { build } from "esbuild";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/assets", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: ["src/main.js"],
  outfile: "dist/assets/app.js",
  bundle: true,
  minify: true,
  sourcemap: false,
  target: ["es2022"],
  define: { "process.env.NODE_ENV": '"production"' }
});
await writeFile("dist/.nojekyll", "", "utf8");
console.log("Build abgeschlossen: dist/");
