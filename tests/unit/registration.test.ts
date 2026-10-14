import { it, expect } from "vitest";
import { registrationConfigSchema } from "@confsys/contracts";
import {
  validateAnswers,
  registrationPrice,
  validateRegistrationConfig,
} from "../../apps/api/src/registration/rules.js";
const id = "20000000-0000-4000-8000-000000000001";
const config = registrationConfigSchema.parse({
  opensAt: "2027-01-01T00:00:00Z",
  closesAt: "2027-02-01T00:00:00Z",
  currency: "TWD",
  timezone: "Asia/Taipei",
  consent: "Synthetic consent",
  fields: [],
  tickets: [
    {
      id,
      name: "Participant",
      capacity: 1,
      waitlist: true,
      rates: [
        {
          startsAt: "2027-01-01T00:00:00Z",
          endsAt: "2027-01-15T00:00:00Z",
          amount: "1000",
        },
        {
          startsAt: "2027-01-15T00:00:00Z",
          endsAt: "2027-02-01T00:00:00Z",
          amount: "2000",
        },
      ],
    },
  ],
});
it("half-open server time windows tolerate equivalent ISO precision and select immutable exact amounts", () => {
  expect(
    registrationPrice(config, id, new Date("2027-01-01T00:00:00.000Z")).amount,
  ).toBe("1000");
  expect(
    registrationPrice(config, id, new Date("2027-01-15T00:00:00.000Z")).amount,
  ).toBe("2000");
  for (const date of ["2026-12-31T23:59:59Z", "2027-02-01T00:00:00Z"])
    expect(() => registrationPrice(config, id, new Date(date))).toThrow();
});
it("rejects overlapping rates, invalid windows and duplicated field identity", () => {
  const c = structuredClone(config);
  c.tickets[0]!.rates[1]!.startsAt = "2027-01-14T00:00:00Z";
  expect(() => validateRegistrationConfig(c)).toThrow();
  c.tickets[0]!.rates[1]!.startsAt = "2027-01-15T00:00:00Z";
  expect(() => validateRegistrationConfig(c)).not.toThrow();
  c.closesAt = c.opensAt;
  expect(() => validateRegistrationConfig(c)).toThrow();
});
it("rejects unknown answers, invalid dates, invalid choices and missing required consent", () => {
  const c = {
    ...config,
    fields: [
      {
        key: "date",
        label: "Date",
        type: "date" as const,
        required: true,
        options: [],
      },
      {
        key: "yes",
        label: "Yes",
        type: "checkbox" as const,
        required: true,
        options: [],
      },
    ],
  };
  expect(() =>
    validateAnswers(c, { date: "2027-02-28", yes: true }),
  ).not.toThrow();
  for (const a of [
    { date: "2027-02-29", yes: true },
    { date: "2027-02-28", yes: false },
    { date: "2027-02-28", yes: true, role: "admin" },
  ])
    expect(() => validateAnswers(c, a)).toThrow();
});
it("money transport rejects floats, negatives and excessive precision", () => {
  for (const amount of ["1.1", "-1", "01", "1000000000000"]) {
    const c = structuredClone(config);
    c.tickets[0]!.rates[0]!.amount = amount;
    expect(registrationConfigSchema.safeParse(c).success).toBe(false);
  }
});
it("conditional required fields reject forged hidden answers and invalid or cyclic references", () => {
  const c = registrationConfigSchema.parse({
    ...config,
    fields: [
      {
        key: "student",
        label: "Student",
        type: "checkbox",
        required: false,
        options: [],
      },
      {
        key: "school",
        label: "School",
        type: "text",
        required: true,
        options: [],
        showWhen: { fieldKey: "student", equals: true },
      },
      {
        key: "department",
        label: "Department",
        type: "text",
        required: true,
        options: [],
        showWhen: { fieldKey: "school", equals: "Example" },
      },
    ],
  });
  expect(() => validateRegistrationConfig(c)).not.toThrow();
  expect(() => validateAnswers(c, { student: false })).not.toThrow();
  expect(() =>
    validateAnswers(c, { student: true, school: "Elsewhere" }),
  ).not.toThrow();
  for (const answers of [
    { student: true },
    { student: false, school: "Example", department: "forged" },
    { student: true, school: "Example" },
  ])
    expect(() => validateAnswers(c, answers)).toThrow();
  expect(() =>
    validateAnswers(c, {
      student: true,
      school: "Example",
      department: "Science",
    }),
  ).not.toThrow();
  c.fields[1]!.showWhen = { fieldKey: "department", equals: "Science" };
  expect(() => validateRegistrationConfig(c)).toThrow();
  c.fields[1]!.showWhen = { fieldKey: "student", equals: "true" };
  expect(() => validateRegistrationConfig(c)).toThrow();
});
