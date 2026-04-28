import { describe, it, expect } from "vitest";
import { validateQuery } from "@/scripts/validate-ssi-queries";

// Minimal hand-rolled snapshot for tests. Mirrors the relevant slice of
// scripts/ssi-schema-snapshot.json without the test depending on the live
// snapshot file (that one shifts when SSI ships schema changes; the tests
// should stay stable regardless).
const snapshot = {
  RootQuery: [
    {
      name: "event",
      type: "EventInterface!",
      args: [
        { name: "content_type", type: "Int!" },
        { name: "id", type: "String!" },
      ],
    },
    {
      name: "events",
      type: "[EventInterface!]!",
      args: [
        { name: "search", type: "String" },
        { name: "rule", type: "String" },
      ],
    },
  ],
  EventInterface: [
    { name: "id", type: "ID!", args: [] },
    { name: "name", type: "String!", args: [] },
    { name: "scoring_completed", type: "Decimal!", args: [] },
  ],
  IpscMatchNode: [
    { name: "id", type: "ID!", args: [] },
    { name: "name", type: "String!", args: [] },
    { name: "scoring_completed", type: "Decimal!", args: [] },
    { name: "sub_rule", type: "String!", args: [] },
    { name: "level", type: "String!", args: [] },
    {
      name: "scorecards",
      type: "[IpscScoreCardNode!]!",
      args: [{ name: "updated_after", type: "String!" }],
    },
  ],
  IpscScoreCardNode: [
    { name: "points", type: "Decimal!", args: [] },
    { name: "hitfactor", type: "Decimal!", args: [] },
  ],
};

describe("validateQuery", () => {
  it("accepts a query whose every field exists on the parent type", () => {
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        id
        name
        ... on IpscMatchNode {
          sub_rule
          level
        }
      }
    }`;
    expect(validateQuery("Q", src, snapshot)).toEqual([]);
  });

  it("flags a field not on the parent interface", () => {
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        id
        bogus_field_xyz
      }
    }`;
    const errs = validateQuery("Q", src, snapshot);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("bogus_field_xyz");
    expect(errs[0].message).toContain("EventInterface");
  });

  it("flags a subtype field selected outside its inline fragment", () => {
    // `sub_rule` is on IpscMatchNode but not on EventInterface in this snapshot.
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        id
        sub_rule
      }
    }`;
    const errs = validateQuery("Q", src, snapshot);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("sub_rule");
    expect(errs[0].message).toContain("EventInterface");
  });

  it("flags an undeclared argument", () => {
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id, nonexistent_arg: "x") {
        id
      }
    }`;
    const errs = validateQuery("Q", src, snapshot);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("nonexistent_arg");
  });

  it("descends into nested selection sets via the field's return type", () => {
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        ... on IpscMatchNode {
          scorecards(updated_after: "2026-04-01T00:00:00Z") {
            points
            bogus_card_field
          }
        }
      }
    }`;
    const errs = validateQuery("Q", src, snapshot);
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("bogus_card_field");
    expect(errs[0].message).toContain("IpscScoreCardNode");
  });

  it("skips field validation for types not in the snapshot", () => {
    // `image` would return SafeImageType which isn't tracked — descendants
    // shouldn't trigger errors.
    const limited = {
      ...snapshot,
      IpscMatchNode: [
        ...snapshot.IpscMatchNode,
        { name: "image", type: "SafeImageType", args: [] },
      ],
    };
    const src = `query Q($ct: Int!, $id: String!) {
      event(content_type: $ct, id: $id) {
        ... on IpscMatchNode {
          image { url width height }
        }
      }
    }`;
    expect(validateQuery("Q", src, limited)).toEqual([]);
  });

  it("returns a single parse error when the query is malformed", () => {
    const src = `query { event { id `; // unbalanced braces
    const errs = validateQuery("Q", src, snapshot);
    expect(errs).toHaveLength(1);
    expect(errs[0].path).toBe("(parse)");
  });
});
