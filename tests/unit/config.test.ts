import { it, expect } from "vitest";
import { loadConfig } from "@confsys/config";
it("fails closed on missing configuration without exposing secret values", () => {
  expect(() => loadConfig({ DATABASE_URL: "sensitive-not-a-url" })).toThrow(
    "Invalid environment fields",
  );
  try {
    loadConfig({ DATABASE_URL: "sensitive-not-a-url" });
  } catch (error) {
    expect(String(error)).not.toContain("sensitive-not-a-url");
  }
});

it('validates independent capture sender identities and refuses real domains or header injection', async () => {
 const {loadWorkerConfig}=await import('@confsys/config');
 const env={WORKER_DATABASE_URL:'postgres://test@127.0.0.1/test',REDIS_URL:'redis://127.0.0.1:6379',MAIL_KEY_VERSION:'v1',MAIL_ENCRYPTION_KEY:'a'.repeat(64),QR_SIGNING_KEY:'b'.repeat(64)};
 const configured=loadWorkerConfig({...env,MAIL_FROM_ADDRESS:'event@example.invalid',MAIL_REPLY_TO_ADDRESS:'help@example.invalid',MAIL_ENVELOPE_FROM:'returns@example.invalid'});
 expect(configured.MAIL_FROM_ADDRESS).toBe('event@example.invalid');
 expect(configured.MAIL_REPLY_TO_ADDRESS).toBe('help@example.invalid');
 expect(configured.MAIL_ENVELOPE_FROM).toBe('returns@example.invalid');
 for(const field of ['MAIL_FROM_ADDRESS','MAIL_REPLY_TO_ADDRESS','MAIL_ENVELOPE_FROM']){
  expect(()=>loadWorkerConfig({...env,[field]:'real@example.com'})).toThrow(field);
  expect(()=>loadWorkerConfig({...env,[field]:'safe@example.invalid\r\nBcc:real@example.com'})).toThrow(field);
 }
});
