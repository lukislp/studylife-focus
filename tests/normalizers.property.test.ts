// Property-based tests (fast-check) for the two normalizers that turn whatever a user pastes
// into the settings and block lists into something the extension relies on: bare hostnames for
// the rules engine and a bare origin for API URL concatenation. Both must be total functions
// (never throw) and idempotent, and normalizeDomain must never keep a scheme, port or path.
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizeDomain } from "../src/rules";
import { normalizeServerUrl } from "../src/settings";

const hostname = fc.stringMatching(/^[a-z][a-z0-9-]{0,20}(\.[a-z][a-z0-9-]{0,10}){1,3}$/);

describe("normalizeDomain (property-based)", () => {
  it("never throws and always returns a string", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        expect(typeof normalizeDomain(raw)).toBe("string");
      }),
      { numRuns: 2000 },
    );
  });

  it("is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const once = normalizeDomain(raw);
        expect(normalizeDomain(once)).toBe(once);
      }),
      { numRuns: 1000 },
    );
  });

  it("strips scheme, port, path, query and case from a pasted URL down to the hostname", () => {
    fc.assert(
      fc.property(
        hostname,
        fc.constantFrom("", "http://", "https://", "HTTPS://"),
        fc.option(fc.integer({ min: 1, max: 65535 }), { nil: undefined }),
        fc.constantFrom("", "/", "/some/page?x=1#frag"),
        (host, scheme, port, path) => {
          const pasted = `${scheme}${host.toUpperCase()}${port ? `:${port}` : ""}${path}`;
          expect(normalizeDomain(pasted)).toBe(host);
        },
      ),
      { numRuns: 1000 },
    );
  });
});

describe("normalizeServerUrl (property-based)", () => {
  it("never throws and is idempotent", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (raw) => {
        const once = normalizeServerUrl(raw);
        expect(typeof once).toBe("string");
        expect(normalizeServerUrl(once)).toBe(once);
      }),
      { numRuns: 2000 },
    );
  });

  it("reduces any https URL to its origin, whatever path or trailing slashes were pasted", () => {
    fc.assert(
      fc.property(
        hostname,
        // 443 is the https default port and is dropped from the origin by the URL parser.
        fc.option(fc.integer({ min: 1, max: 65535 }).filter((p) => p !== 443), { nil: undefined }),
        fc.constantFrom("", "/", "//", "/setup", "/setup/", "/api/v1?x=1#y"),
        (host, port, path) => {
          const origin = `https://${host}${port ? `:${port}` : ""}`;
          expect(normalizeServerUrl(`${origin}${path}`)).toBe(origin);
        },
      ),
      { numRuns: 1000 },
    );
  });
});
