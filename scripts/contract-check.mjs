// Guards against StudyLife's server-side TimerStateDto drifting out from under this extension's
// hand-mirrored TimerStateDtoPayload (src/api.ts) without anyone noticing until a Web Store review
// finally lets the drifted build reach users - by then a fix is days away, not minutes. Diffs the
// fields this extension actually reads against the main repo's committed OpenAPI spec
// (docs/api/openapi.json) and confirms the routes it calls still exist. Mirrors
// studylife-capture's scripts/contract-check.mjs exactly, adapted to this extension's own
// (much narrower) API surface - GET /api/timerstate and POST /api/auth/focusguard-assertion-exchange,
// nothing else, matching ApiKeyScopes.FocusGuard in the studylife repo.
import { existsSync, readFileSync } from "node:fs";

const API_TS_PATH = new URL("../src/api.ts", import.meta.url);
const TIMERSTATE_PATH = "/api/timerstate";
const ASSERTION_EXCHANGE_PATH = "/api/auth/focusguard-assertion-exchange";
const DEFAULT_SPEC_SOURCE = "https://raw.githubusercontent.com/lukislp/studylife/main/docs/api/openapi.json";

async function main() {
  const specSource = process.env.STUDYLIFE_OPENAPI_SPEC || DEFAULT_SPEC_SOURCE;
  const payloadFields = readPayloadFields();
  console.log(`Checking ${payloadFields.length} TimerStateDtoPayload field(s) against ${specSource}`);

  const spec = await loadSpec(specSource);

  const errors = [];
  errors.push(...checkTimerStateRouteExists(spec));
  errors.push(...checkPayloadFieldsExist(spec, payloadFields));
  errors.push(...checkAssertionExchangeRouteExists(spec));

  if (errors.length > 0) {
    console.error("\nContract check FAILED - the extension's TimerStateDto payload has drifted from the API spec:\n");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    console.error(`\nSource of truth: ${specSource}`);
    process.exit(1);
  }

  console.log("Contract check passed: /api/timerstate and TimerStateDtoPayload fields all match the spec.");
}

// Parses `export const TIMER_STATE_FIELDS = [...] as const satisfies ...;` out of src/api.ts's
// source text. Deliberately a plain regex, not a TS parser, to keep this script dependency-free.
function readPayloadFields() {
  const source = readFileSync(API_TS_PATH, "utf-8");
  const match = source.match(/TIMER_STATE_FIELDS\s*=\s*\[([\s\S]*?)\]/);
  if (!match) {
    console.error(`Could not find TIMER_STATE_FIELDS in ${API_TS_PATH.pathname}`);
    process.exit(1);
  }
  const fields = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  if (fields.length === 0) {
    console.error(`Found TIMER_STATE_FIELDS in ${API_TS_PATH.pathname} but parsed zero field names out of it.`);
    process.exit(1);
  }
  return fields;
}

// `source` is a file path (resolved relative to the current working directory, i.e. the repo
// root when run via `npm run contract-check`) unless it looks like a URL.
async function loadSpec(source) {
  const isUrl = /^https?:\/\//i.test(source);
  let text;
  try {
    if (isUrl) {
      const response = await fetch(source);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      text = await response.text();
    } else {
      if (!existsSync(source)) {
        throw new Error("file not found");
      }
      text = readFileSync(source, "utf-8");
    }
  } catch (error) {
    console.error(`Could not load the OpenAPI spec from ${source}: ${error.message}`);
    process.exit(1);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`OpenAPI spec at ${source} is not valid JSON: ${error.message}`);
    process.exit(1);
  }
}

function checkTimerStateRouteExists(spec) {
  const pathItem = spec?.paths?.[TIMERSTATE_PATH];
  if (!pathItem) {
    return [`Spec has no "${TIMERSTATE_PATH}" path at all (expected GET).`];
  }
  if (!pathItem.get) {
    return [`Spec is missing GET ${TIMERSTATE_PATH} (pollTimerState() depends on it).`];
  }
  return [];
}

// Guards the browser-connect flow's exchange call (src/api.ts's exchangeFocusGuardAssertion) the
// same way checkTimerStateRouteExists() guards pollTimerState() - fails loudly here instead of
// only surfacing as a 404 once a build reaches users.
function checkAssertionExchangeRouteExists(spec) {
  const pathItem = spec?.paths?.[ASSERTION_EXCHANGE_PATH];
  if (!pathItem) {
    return [`Spec has no "${ASSERTION_EXCHANGE_PATH}" path (expected POST, used by the browser-connect flow).`];
  }
  if (!pathItem.post) {
    return [`Spec is missing POST ${ASSERTION_EXCHANGE_PATH} (exchangeFocusGuardAssertion() depends on it).`];
  }
  return [];
}

function checkPayloadFieldsExist(spec, payloadFields) {
  const schema = findTimerStateDtoSchema(spec);
  if (!schema) {
    return [`Spec has no "TimerStateDto" component schema (checked components.schemas for an exact or suffix match).`];
  }

  const specFields = new Set(Object.keys(schema.properties ?? {}));
  const errors = [];
  for (const field of payloadFields) {
    if (!specFields.has(field)) {
      errors.push(
        `TimerStateDtoPayload reads "${field}", but the spec's TimerStateDto schema has no such property (drift or rename?).`,
      );
    }
  }
  return errors;
}

// The schema key may be the bare "TimerStateDto" or a fully-qualified name like
// "StudyLifeSharedDtosTimerStateDto" depending on how the generator names components - try an
// exact match first, then fall back to any key ending in "TimerStateDto".
function findTimerStateDtoSchema(spec) {
  const schemas = spec?.components?.schemas;
  if (!schemas) return undefined;
  if (schemas.TimerStateDto) return schemas.TimerStateDto;
  const suffixKey = Object.keys(schemas).find((key) => key !== "TimerStateDto" && /TimerStateDto$/.test(key));
  return suffixKey ? schemas[suffixKey] : undefined;
}

main().catch((error) => {
  console.error("Contract check crashed unexpectedly:", error);
  process.exit(1);
});
