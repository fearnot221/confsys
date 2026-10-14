import {it,expect} from "vitest";
import {passToken,passHash} from "../../apps/api/src/onsite/token.js";
import {onsiteToken,onsiteCheckinInput,onsiteRedeemInput} from "@confsys/contracts";
it("opaque pass is deterministic only under its dedicated key and rotation invalidates previous digest",()=>{
 const key="ab".repeat(32),id="f2350d32-079b-4e5b-87fc-b458ae9234ca",token=passToken(id,key);
 expect(onsiteToken.parse(token)).toBe(token);expect(passToken(id,key)).toBe(token);expect(token).not.toContain(id);expect(passToken(id,"cd".repeat(32))).not.toBe(token);expect(passToken("other",key)).not.toBe(token);expect(passHash(token)).toMatch(/^[a-f0-9]{64}$/);
 expect(onsiteToken.safeParse("a".repeat(43)).success).toBe(false);
});
it("onsite commands require opaque pass, bounded quantity and explicit replay key",()=>{
 const token=passToken("fixture","ab".repeat(32)),id="f2350d32-079b-4e5b-87fc-b458ae9234ca";
 expect(onsiteCheckinInput.safeParse({token}).success).toBe(false);
 expect(onsiteRedeemInput.safeParse({token,idempotencyKey:id,bookingId:id,quantity:21}).success).toBe(false);
 expect(onsiteRedeemInput.safeParse({token,idempotencyKey:id,bookingId:id,quantity:1,userId:id}).success).toBe(false);
});
