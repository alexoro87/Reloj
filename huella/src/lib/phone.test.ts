import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["55 1234 5678", "52", "525512345678"],
    ["(55) 1234-5678", "52", "525512345678"],
    ["+52 55 1234 5678", "52", "525512345678"],
    ["+34 612 345 678", "52", "34612345678"],
    ["612345678", "34", "34612345678"],
    ["0034612345678", "52", "34612345678"],
  ])("%s (lada %s) → %s", (input, cc, expected) => {
    expect(normalizePhone(input, cc)).toBe(expected);
  });

  it("rechaza números incompletos", () => {
    expect(normalizePhone("1234", "52")).toBeNull();
    expect(normalizePhone("", "52")).toBeNull();
  });
});

it("formatea para mostrar", () => {
  expect(formatPhone("525512345678")).toBe("+52 55 1234 5678");
});
