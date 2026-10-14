import { it, expect } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
const up = async () => {};
it("reports dependency failures as 503 while liveness stays available", async () => {
  const app = buildApp({
    postgres: up,
    redis: async () => {
      throw new Error("secret");
    },
    worker: up,
  });
  try {
    const result = await app.inject("/api/health/ready");
    expect(result.statusCode).toBe(503);
    expect(result.json().dependencies.redis).toBe("down");
    expect(result.body).not.toContain("secret");
    expect((await app.inject("/api/health/live")).statusCode).toBe(200);
  } finally {
    await app.close();
  }
});
it("returns structured 404 instead of fake login, payment or submission success", async () => {
  const app = buildApp({ postgres: up, redis: up, worker: up });
  try {
    for (const url of ["/api/login", "/api/payments", "/api/submissions"]) {
      const result = await app.inject({ method: "POST", url });
      expect(result.statusCode).toBe(404);
      expect(result.json().error.code).toBe("NOT_FOUND");
      expect(result.headers["x-request-id"]).toBeTruthy();
    }
  } finally {
    await app.close();
  }
});
it("does not trust caller supplied request IDs", async () => {
  const app = buildApp({ postgres: up, redis: up, worker: up });
  try {
    const result = await app.inject({
      url: "/api/health/live",
      headers: { "x-request-id": "attacker" },
    });
    expect(result.headers["x-request-id"]).not.toBe("attacker");
  } finally {
    await app.close();
  }
});
