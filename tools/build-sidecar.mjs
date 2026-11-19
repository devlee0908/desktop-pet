// Builds sidecar/server.ts into one self-contained executable (Node SEA) where Tauri expects it:
//   src-tauri/binaries/pet-mcp-<target-triple>[.exe]
// Works on macOS, Windows and Linux; run with Node 22+ (`nvm use` reads .nvmrc).
import { spawnSync } from "node:child_process";
import { copyFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { inject } from "postject";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`build-sidecar: Node 22+ required, found ${process.version}. Run \`nvm use\` (reads .nvmrc) and retry.`);
  process.exit(1);
}
const win = process.platform === "win32";
const mac = process.platform === "darwin";
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
  return r.stdout;
};

// target triple, e.g. aarch64-apple-darwin / x86_64-pc-windows-msvc
let rustc = "rustc";
if (spawnSync(rustc, ["-V"]).status !== 0) rustc = join(homedir(), ".cargo", "bin", win ? "rustc.exe" : "rustc");
const triple = /host: (\S+)/.exec(run(rustc, ["-vV"]))[1];
const out = join("src-tauri", "binaries", `pet-mcp-${triple}${win ? ".exe" : ""}`);
mkdirSync("dist-sidecar", { recursive: true });
mkdirSync(join("src-tauri", "binaries"), { recursive: true });

await build({
  entryPoints: ["sidecar/server.ts"], bundle: true, platform: "node", format: "cjs", target: "node22",
  outfile: "dist-sidecar/server.cjs", logLevel: "warning",
});
writeFileSync("dist-sidecar/sea-config.json",
  JSON.stringify({ main: "dist-sidecar/server.cjs", output: "dist-sidecar/sea.blob", disableExperimentalSEAWarning: true }));
run(process.execPath, ["--experimental-sea-config", "dist-sidecar/sea-config.json"]);

copyFileSync(process.execPath, out);
chmodSync(out, 0o755);
if (mac) run("codesign", ["--remove-signature", out]);
await inject(out, "NODE_SEA_BLOB", readFileSync("dist-sidecar/sea.blob"), {
  sentinelFuse: "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2",
  machoSegmentName: "NODE_SEA", // only used for Mach-O
});
if (mac) run("codesign", ["--sign", "-", out]);
// Windows: injecting invalidates node.exe's Authenticode signature. Fine for local use;
// sign the binary (signtool) before distributing.
console.log(`sidecar: ${out}`);
