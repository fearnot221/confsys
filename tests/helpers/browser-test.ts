import { test as base, expect } from "@playwright/test";
import {createHmac} from "node:crypto";
import {Redis} from "ioredis";
import {testUrl} from "./auth.js";
// Each independent browser flow starts with its own source budget. Limits remain
// active throughout the flow; never FLUSHDB or alter application rate thresholds.
export const test=base.extend<{isolatedSourceBudget:void}>({
 isolatedSourceBudget:[async ({browserName},use)=>{
  void browserName;
  const key=process.env.CONFSYS_E2E_RATE_KEY;
  if(!key || !/^[a-f0-9]{64}$/.test(key))throw new Error("Missing per-run browser rate isolation key");
  const redis=new Redis(testUrl("TEST_REDIS_URL","/1"));
  try {await redis.del(...["127.0.0.1","::ffff:127.0.0.1","::1"].map(source=>`auth-limit:source:${createHmac("sha256",key).update(source).digest("hex")}`));}
  finally {await redis.quit();}
  await use();
 },{auto:true}],
});
export {expect};
export type {Page} from "@playwright/test";
