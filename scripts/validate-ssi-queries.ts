#!/usr/bin/env tsx
/**
 * Static validation of our outbound GraphQL queries against the SSI schema
 * snapshot (scripts/ssi-schema-snapshot.json).
 *
 * WHY: caches and call sites assume the queries we send are well-formed against
 * the schema we mirror. When a field is renamed, removed, or moved between an
 * interface and a subtype upstream, our queries silently start returning errors
 * the next time the schema snapshot is refreshed. This script walks each query
 * AST against the snapshot and refuses to pass if a selection or argument
 * doesn't line up.
 *
 * USAGE:
 *   pnpm validate:ssi-queries          # report errors, exit 1 if any
 *   pnpm validate:ssi-queries --json   # machine-readable output
 *
 * SCOPE / KNOWN GAPS:
 *   - Catches: missing fields, missing arguments, fields on a type that does
 *     not exist in the snapshot.
 *   - Does NOT catch resolver-level bugs (e.g. #367) where a field is declared
 *     on an interface in the schema but the underlying Django model on a
 *     subtype throws AttributeError at runtime. That class of bug requires a
 *     live dry-run smoke test, not static schema introspection.
 *   - For types that aren't in the snapshot (e.g. SafeImageType, ShooterNode,
 *     CompetitorInterface), the walker descends but skips field-existence
 *     checks rather than erroring — keeps the validator focused without
 *     requiring the snapshot to mirror the entire SSI schema.
 *
 * To extend coverage, add the relevant type names to TRACKED_TYPES in
 * scripts/check-ssi-schema.ts and refresh the snapshot.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, Kind } from "graphql";
import type {
  DocumentNode,
  SelectionSetNode,
  OperationDefinitionNode,
  FieldNode,
  InlineFragmentNode,
} from "graphql";

import {
  MATCH_QUERY,
  MATCH_UPDATED_PROBE_QUERY,
  EVENTS_QUERY,
  UPCOMING_STATUS_QUERY,
  SCORECARDS_QUERY,
  SCORECARDS_DELTA_QUERY,
} from "../lib/graphql";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SNAPSHOT_PATH = resolve(__dirname, "ssi-schema-snapshot.json");

interface FieldArg {
  name: string;
  type: string;
}

interface FieldEntry {
  name: string;
  type: string;
  args: FieldArg[];
}

type Snapshot = Record<string, FieldEntry[]>;

export interface ValidationError {
  query: string;
  path: string;
  message: string;
}

const QUERIES: { name: string; src: string }[] = [
  { name: "MATCH_QUERY", src: MATCH_QUERY },
  { name: "MATCH_UPDATED_PROBE_QUERY", src: MATCH_UPDATED_PROBE_QUERY },
  { name: "EVENTS_QUERY", src: EVENTS_QUERY },
  { name: "UPCOMING_STATUS_QUERY", src: UPCOMING_STATUS_QUERY },
  { name: "SCORECARDS_QUERY", src: SCORECARDS_QUERY },
  { name: "SCORECARDS_DELTA_QUERY", src: SCORECARDS_DELTA_QUERY },
];

export function loadSnapshot(): Snapshot {
  if (!existsSync(SNAPSHOT_PATH)) {
    throw new Error(`snapshot missing at ${SNAPSHOT_PATH} — run \`pnpm check:ssi-schema --update\` first`);
  }
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
}

/** Strip GraphQL type wrappers (`!`, `[]`) to get the named type, e.g.
 *  "[EventInterface!]!" -> "EventInterface". */
function namedType(t: string): string {
  return t.replace(/[![\]]/g, "");
}

function operationRootType(op: OperationDefinitionNode): string {
  switch (op.operation) {
    case "mutation": return "RootMutation";
    case "subscription": return "RootSubscription";
    case "query":
    default: return "RootQuery";
  }
}

function validateSelectionSet(
  set: SelectionSetNode,
  parentType: string,
  snapshot: Snapshot,
  path: string[],
  errors: Omit<ValidationError, "query">[],
): void {
  const parentFields = snapshot[parentType];
  // Type isn't tracked — skip field validation but still walk into nested
  // selections so a `... on TrackedType` deeper down still gets checked.
  const tracked = parentFields != null;
  const fieldByName: Map<string, FieldEntry> | null = tracked
    ? new Map(parentFields.map((f) => [f.name, f]))
    : null;

  for (const sel of set.selections) {
    if (sel.kind === Kind.FIELD) {
      validateField(sel, parentType, fieldByName, snapshot, path, errors);
    } else if (sel.kind === Kind.INLINE_FRAGMENT) {
      validateInlineFragment(sel, snapshot, path, errors);
    }
    // FRAGMENT_SPREAD: we don't use named fragments anywhere, so skip.
  }
}

function validateField(
  field: FieldNode,
  parentType: string,
  fieldByName: Map<string, FieldEntry> | null,
  snapshot: Snapshot,
  path: string[],
  errors: Omit<ValidationError, "query">[],
): void {
  const fieldName = field.name.value;
  const fieldPath = [...path, fieldName];

  // Skip introspection meta-fields.
  if (fieldName.startsWith("__")) return;

  let returnType: string | null = null;
  if (fieldByName != null) {
    const entry = fieldByName.get(fieldName);
    if (!entry) {
      errors.push({
        path: fieldPath.join("."),
        message: `field \`${fieldName}\` not found on type \`${parentType}\``,
      });
      return;
    }

    // Validate provided arguments exist on the field signature. We do not
    // type-check argument values — variable types come from the operation
    // definition and would need a separate walk.
    if (field.arguments && field.arguments.length > 0) {
      const argByName = new Map(entry.args.map((a) => [a.name, a]));
      for (const arg of field.arguments) {
        if (!argByName.has(arg.name.value)) {
          errors.push({
            path: fieldPath.join("."),
            message: `argument \`${arg.name.value}\` not declared on \`${parentType}.${fieldName}\` (declared args: ${entry.args.map((a) => a.name).join(", ") || "none"})`,
          });
        }
      }
    }

    returnType = namedType(entry.type);
  }

  if (field.selectionSet) {
    // If we couldn't resolve the return type (parent type untracked), pass an
    // unknown sentinel so descendant fragments still validate themselves.
    validateSelectionSet(
      field.selectionSet,
      returnType ?? "__unknown__",
      snapshot,
      fieldPath,
      errors,
    );
  }
}

function validateInlineFragment(
  frag: InlineFragmentNode,
  snapshot: Snapshot,
  path: string[],
  errors: Omit<ValidationError, "query">[],
): void {
  const typeName = frag.typeCondition?.name.value;
  if (!typeName) return; // unconditional inline fragment — rare, skip

  const fragPath = [...path, `... on ${typeName}`];
  // If the named type is in the snapshot, validate; otherwise descend with
  // unknown parent so deeper tracked fragments still get checked.
  validateSelectionSet(frag.selectionSet, typeName, snapshot, fragPath, errors);
}

export function validateQuery(name: string, src: string, snapshot: Snapshot): ValidationError[] {
  let doc: DocumentNode;
  try {
    doc = parse(src);
  } catch (err) {
    return [{ query: name, path: "(parse)", message: err instanceof Error ? err.message : String(err) }];
  }
  const errors: Omit<ValidationError, "query">[] = [];
  for (const def of doc.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    const rootType = operationRootType(def);
    validateSelectionSet(def.selectionSet, rootType, snapshot, [rootType], errors);
  }
  return errors.map((e) => ({ query: name, ...e }));
}

function main(): void {
  const jsonMode = process.argv.includes("--json");
  const snapshot = loadSnapshot();

  const allErrors: ValidationError[] = [];
  for (const q of QUERIES) {
    allErrors.push(...validateQuery(q.name, q.src, snapshot));
  }

  if (jsonMode) {
    console.log(JSON.stringify(allErrors, null, 2));
    process.exit(allErrors.length > 0 ? 1 : 0);
  }

  if (allErrors.length === 0) {
    console.log(`[validate-ssi-queries] OK — ${QUERIES.length} queries valid against snapshot`);
    return;
  }

  console.error(`[validate-ssi-queries] ${allErrors.length} error(s):\n`);
  for (const err of allErrors) {
    console.error(`  ${err.query}  ${err.path}`);
    console.error(`    -> ${err.message}\n`);
  }
  console.error(
    "If the snapshot is stale, run `pnpm check:ssi-schema --update` to refresh it.\n" +
    "If the schema actually changed, update the affected query and bump\n" +
    "CACHE_SCHEMA_VERSION as described in CLAUDE.md -> 'Delta-merge contract'.",
  );
  process.exit(1);
}

// Run as CLI when invoked directly; stay quiet when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
