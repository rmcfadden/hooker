import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Read a JSON file, returning `{}` when it doesn't exist. */
export async function readJson(file) {
  const text = await readFile(file, "utf8").catch((err) => {
    if (err.code === "ENOENT") {
      return null;
    }
    throw err;
  });
  return text === null ? {} : JSON.parse(text);
}

/** Write a value as pretty JSON, creating the parent directory. */
export async function writeJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
