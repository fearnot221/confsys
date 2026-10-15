import { afterEach, it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { copyPrivateVolume } from "../../scripts/private-volume-copy.js";
const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "confsys-drill-test-"));
  roots.push(root);
  const source = join(root, "source"),
    backup = join(root, "backup"),
    restore = join(root, "restore");
  await Promise.all(
    [source, backup, restore].map((path) => mkdir(path, { mode: 0o700 })),
  );
  return { root, source, backup, restore };
}
const uid = process.getuid!(),
  gid = process.getgid!();
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
it("bounded backup and fresh restore preserve actual bytes, checksum manifest and private modes", async () => {
  const f = await fixture(),
    key = randomUUID(),
    bytes = Buffer.from("Synthetic private document");
  await writeFile(join(f.source, key), bytes, { mode: 0o600 });
  expect(
    await copyPrivateVolume("backup", f.source, f.backup, uid, gid),
  ).toEqual({ files: 1, bytes: bytes.length });
  expect(
    await copyPrivateVolume("restore", f.backup, f.restore, uid, gid),
  ).toEqual({ files: 1, bytes: bytes.length });
  expect(await readFile(join(f.restore, key))).toEqual(bytes);
  expect((await stat(join(f.restore, key))).mode & 0o777).toBe(0o600);
  expect((await stat(f.restore)).mode & 0o777).toBe(0o700);
  await expect(
    copyPrivateVolume("restore", f.backup, f.restore, uid, gid),
  ).rejects.toThrow("Destination must be empty");
});
it("restore rejects corrupted content and a missing manifest inventory", async () => {
  const f = await fixture(),
    key = randomUUID();
  await writeFile(join(f.source, key), "Synthetic");
  await copyPrivateVolume("backup", f.source, f.backup, uid, gid);
  await writeFile(join(f.backup, "files", key), "Corrupted");
  await expect(
    copyPrivateVolume("restore", f.backup, f.restore, uid, gid),
  ).rejects.toThrow("checksum mismatch");
  await writeFile(join(f.backup, "manifest.json"), "null");
  await expect(
    copyPrivateVolume("restore", f.backup, f.restore, uid, gid),
  ).rejects.toThrow("Invalid manifest");
});
it("source symlinks, unknown names and oversized entries fail closed", async () => {
  const f = await fixture(),
    key = randomUUID(),
    outside = join(f.root, "outside");
  await writeFile(outside, "Synthetic");
  await symlink(outside, join(f.source, key));
  await expect(
    copyPrivateVolume("backup", f.source, f.backup, uid, gid),
  ).rejects.toMatchObject({ code: "ELOOP" });
  const g = await fixture();
  await writeFile(join(g.source, "unexpected.txt"), "Synthetic");
  await expect(
    copyPrivateVolume("backup", g.source, g.backup, uid, gid),
  ).rejects.toThrow("Unexpected");
  const h = await fixture();
  await writeFile(join(h.source, randomUUID()), Buffer.alloc(8388609));
  await expect(
    copyPrivateVolume("backup", h.source, h.backup, uid, gid),
  ).rejects.toThrow("Invalid private file size/type");
});
