import { expect, it } from 'vitest';
import { translateActivityConflict } from '../../apps/api/src/activities/conflicts.js';
it('translates only recognized activity constraint identities',()=>{
 expect.assertions(6);
 for(const error of [{code:'23505',constraint:'bookings_active'},{code:'23514',constraint:'booking_redemption_guard'}]) {
  expect(()=>translateActivityConflict(error)).toThrow('CONFLICT');
 }
 for(const error of [{code:'23505',constraint:'unrelated_unique'},{code:'23514'},{code:'ECONNRESET'},new Error('audit unavailable')]) {
  try { translateActivityConflict(error); } catch(received) { expect(received).toBe(error); }
 }
});
