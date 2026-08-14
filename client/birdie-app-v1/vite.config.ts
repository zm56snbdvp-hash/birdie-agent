import { readdir, readFile, writeFile } from "node:fs/promises";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

function birdieWorldServiceWorkerManifest() {
  return {
    name: "birdieworld-service-worker-manifest",
    apply: "build" as const,
    async closeBundle() {
      const assetsDirectory = new URL("./dist/assets/", import.meta.url);
      const serviceWorkerPath = new URL("./dist/sw.js", import.meta.url);
      const assets = (await readdir(assetsDirectory))
        .sort()
        .map((name) => `/assets/${name}`);
      const source = await readFile(serviceWorkerPath, "utf8");
      const output = source.replace(
        '"__BIRDIEWORLD_BUILD_ASSETS__"',
        JSON.stringify(assets)
      );
      if (output === source) {
        throw new Error("BirdieWorld service-worker manifest placeholder is missing");
      }
      await writeFile(serviceWorkerPath, output, "utf8");
    }
  };
}

export default defineConfig({
  plugins: [react(), birdieWorldServiceWorkerManifest()]
});
