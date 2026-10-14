// Bounded copy implementation shared by the container helper and local regression tests.
import {
  readdir,
  mkdir,
  open,
  writeFile,
  readFile,
  chown,
  chmod,
} from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
type Entry = { key: string; size: number; sha256: string };
function validManifest(value: unknown): value is Entry[] {
  return (
    Array.isArray(value) &&
    value.length <= 1000 &&
    value.every((item: unknown) => {
      if (typeof item !== "object" || item === null) return false;
      const row = item as Record<string, unknown>;
      return (
        typeof row.key === "string" &&
        /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
          row.key,
        ) &&
        typeof row.size === "number" &&
        Number.isInteger(row.size) &&
        row.size >= 1 &&
        row.size <= 8388608 &&
        typeof row.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(row.sha256)
      );
    })
  );
}
export async function copyPrivateVolume(
  mode: "backup" | "restore" | "verify",
  sourceRoot: string,
  destination: string,
  ownerUid: number,
  ownerGid: number,
) {
  if (!["backup", "restore", "verify"].includes(mode))
    throw new Error("Expected backup, restore or verify");
  if (
    !Number.isInteger(ownerUid) ||
    ownerUid < 0 ||
    !Number.isInteger(ownerGid) ||
    ownerGid < 0
  )
    throw new Error("Explicit destination owner required");
  const maximumFiles = 1000,
    maximumTotal = 1024 * 1024 * 1024,
    maximumFile = 8388608;
  const keyPattern =
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const parsed =
    mode === "backup"
      ? null
      : (JSON.parse(
          await readFile(`${sourceRoot}/manifest.json`, "utf8"),
        ) as unknown);
  if (mode !== "backup" && !validManifest(parsed))
    throw new Error("Invalid manifest");
  const expected = parsed as Entry[] | null;
  const source = mode === "backup" ? sourceRoot : `${sourceRoot}/files`;
  const names = (await readdir(source)).sort();
  if (
    names.length > maximumFiles ||
    names.some((name) => !keyPattern.test(name))
  )
    throw new Error("Unexpected or excessive private volume entries");
  if (
    expected &&
    JSON.stringify(names) !==
      JSON.stringify(expected.map((item) => item.key).sort())
  )
    throw new Error("Manifest inventory differs");
  if (mode !== "verify") {
    if ((await readdir(destination)).length)
      throw new Error("Destination must be empty");
    if (mode === "backup") await mkdir(`${destination}/files`, { mode: 0o700 });
  }
  let total = 0;
  const manifest: Entry[] = [];
  for (const key of names) {
    const file = await open(
      `${source}/${key}`,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > maximumFile || stat.size < 1)
        throw new Error("Invalid private file size/type");
      total += stat.size;
      if (total > maximumTotal)
        throw new Error("Backup exceeds bounded drill size");
      bytes = await file.readFile();
      if (bytes.length !== stat.size)
        throw new Error("File changed during copy");
    } finally {
      await file.close();
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (expected) {
      const item = expected.find((item) => item.key === key);
      if (item?.size !== bytes.length || item?.sha256 !== sha256)
        throw new Error("Private file checksum mismatch");
    }
    if (mode !== "verify")
      await writeFile(
        `${mode === "backup" ? `${destination}/files` : destination}/${key}`,
        bytes,
        { flag: "wx", mode: 0o600 },
      );
    if (mode !== "verify") {
      const target = `${mode === "backup" ? `${destination}/files` : destination}/${key}`;
      const saved = await open(target, constants.O_RDWR | constants.O_NOFOLLOW);
      try {
        await saved.sync();
        if (
          createHash("sha256")
            .update(await saved.readFile())
            .digest("hex") !== sha256
        )
          throw new Error("Copied file checksum mismatch");
      } finally {
        await saved.close();
      }
      await chown(target, ownerUid, ownerGid);
    }
    manifest.push({ key, size: bytes.length, sha256 });
  }
  if (mode === "backup")
    await writeFile(
      `${destination}/manifest.json`,
      JSON.stringify(manifest, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  if (mode === "backup") {
    await chown(`${destination}/files`, ownerUid, ownerGid);
    await chown(`${destination}/manifest.json`, ownerUid, ownerGid);
  }
  if (mode === "restore") {
    await chown(destination, ownerUid, ownerGid);
    await chmod(destination, 0o700);
  }
  return { files: manifest.length, bytes: total };
}
