import { afterEach, expect, it } from "vitest";
import { chmod, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import {
  assertPrivateStorage,
  digest,
  prepareContent,
  privatePath,
  readPrivate,
  scanContent,
  writePrivate,
} from "../../apps/api/src/files/storage.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
it("storage keys cannot escape private root; writes are exclusive and checksum verified", async () => {
  const root = await mkdtemp(join(tmpdir(), "confsys-files-"));
  dirs.push(root);
  for (const key of [
    "../secret",
    "/tmp/file",
    "abc",
    "00000000-0000-0000-0000-000000000000/../x",
  ])
    expect(() => privatePath(root, key)).toThrow();
  expect(() => privatePath("relative", randomUUID())).toThrow();
  const key = randomUUID(),
    bytes = Buffer.from("synthetic");
  await writePrivate(root, key, bytes);
  expect(await readPrivate(root, key, bytes.length, digest(bytes))).toEqual(
    bytes,
  );
  await expect(writePrivate(root, key, bytes)).rejects.toMatchObject({
    code: "EEXIST",
  });
  await expect(
    readPrivate(root, key, bytes.length, "0".repeat(64)),
  ).rejects.toThrow("checksum");
  await expect(
    readPrivate(root, key, bytes.length + 1, digest(bytes)),
  ).rejects.toThrow("integrity");
  const alias = randomUUID();
  await symlink(privatePath(root, key), privatePath(root, alias));
  await expect(
    readPrivate(root, alias, bytes.length, digest(bytes)),
  ).rejects.toThrow();
});
it("content policy rejects fake magic, active documents, bad base64 and oversized images; raster normalization strips payload", async () => {
  for (const content of [
    Buffer.from("<svg>bad</svg>"),
    Buffer.from("%PDF-1.7\n/JavaScript\n%%EOF"),
    Buffer.from("%PDF-1.7\ntruncated"),
  ])
    await expect(
      prepareContent(content.toString("base64"), "manuscript"),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  await expect(
    prepareContent("not base64", "manuscript"),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=",
    "base64",
  );
  const output = await prepareContent(
    Buffer.concat([png, Buffer.from("<script>payload</script>")]).toString(
      "base64",
    ),
    "site_media",
  );
  expect(output.mediaType).toBe("image/png");
  expect(output.bytes.includes(Buffer.from("<script>"))).toBe(false);
  const wide = Buffer.from(png);
  wide.writeUInt32BE(4097, 16);
  await expect(
    prepareContent(wide.toString("base64"), "site_media"),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
});
it("scanner protocol only accepts explicit terminated OK; infected/errors and interrupted socket never pass", async () => {
  for (const [reply, expected] of [
    ["stream: OK\0", "clean"],
    ["stream: Eicar-Test-Signature FOUND\0", "infected"],
    ["stream: size limit exceeded ERROR\0", "unavailable"],
    ["OK", "unavailable"],
  ] as const) {
    const server = createServer((socket) =>
      socket.once("data", () => socket.end(reply)),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("port missing");
    try {
      expect(
        await scanContent(Buffer.from("synthetic"), {
          root: "/unused",
          scannerHost: "127.0.0.1",
          scannerPort: address.port,
        }),
      ).toBe(expected);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});
it("PDF parser rejects malformed and zero-page documents while accepting a bounded structural PDF", async () => {
  const pdf = Buffer.from(
    "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF",
  );
  expect(
    (await prepareContent(pdf.toString("base64"), "manuscript")).mediaType,
  ).toBe("application/pdf");
  await expect(
    prepareContent(
      Buffer.from("%PDF-1.7\n%%EOF").toString("base64"),
      "manuscript",
    ),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  const active = Buffer.from(
    pdf.toString().replace("/MediaBox", "/J#53 (bad) /MediaBox"),
  );
  await expect(
    prepareContent(active.toString("base64"), "manuscript"),
  ).rejects.toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
});

it("startup refuses shared or symlink private roots instead of accepting an unusable deployment",async()=>{
 const root=await mkdtemp(join(tmpdir(),'confsys-storage-startup-'));dirs.push(root);
 await expect(assertPrivateStorage(root)).resolves.toBeUndefined();
 await chmod(root,0o755);
 await expect(assertPrivateStorage(root)).rejects.toThrow('owner-only');
 await chmod(root,0o700);
 const alias=join(root,'alias');await symlink(root,alias);
 await expect(assertPrivateStorage(alias)).rejects.toThrow('owner-only');
 await expect(assertPrivateStorage('relative')).rejects.toThrow('absolute');
 const nested=join(root,'new');await expect(assertPrivateStorage(nested)).resolves.toBeUndefined();
});
