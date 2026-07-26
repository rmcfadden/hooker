// Post-build step for the published package: place the recorder hooks alongside the compiled
// output (paths.ts derives profileHome from the lib dir, so dist/lib + dist/hooks must be
// siblings — mirroring the dev layout of lib/ + hooks/), repoint them at the compiled CLI, and
// mark the executables. Run via `node scripts/postbuild.ts` after `tsc`.
import { chmod, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const dist = "dist";

await rm(join(dist, "hooks"), { recursive: true, force: true });
await cp("hooks", join(dist, "hooks"), { recursive: true });

for (const file of await readdir(join(dist, "hooks"))) {
  const path = join(dist, "hooks", file);
  const text = await readFile(path, "utf8");
  await writeFile(path, text.replaceAll("../bin/hooker.ts", "../bin/hooker.js"));
  await chmod(path, 0o755);
}

await chmod(join(dist, "bin", "hooker.js"), 0o755);
process.stdout.write("postbuild: copied hooks into dist/ + chmod'd executables\n");
