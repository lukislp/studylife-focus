import { describe, expect, it } from "vitest";
import {
  ALLOW_LIST_RULE_ID,
  BLOCK_ALL_RULE_ID,
  BLOCK_LIST_RULE_ID,
  computeRules,
  isDomainAllowed,
  normalizeDomain,
  type RuleConfig,
} from "../src/rules";

const base: RuleConfig = {
  active: true,
  mode: "whitelist",
  whitelist: [],
  blacklist: [],
  alwaysAllowedDomains: [],
};

describe("normalizeDomain", () => {
  it("extracts the bare hostname from a full URL", () => {
    expect(normalizeDomain("https://Wikipedia.org/wiki/Foo")).toBe("wikipedia.org");
  });

  it("accepts a bare domain with no scheme", () => {
    expect(normalizeDomain("wikipedia.org")).toBe("wikipedia.org");
  });

  it("lowercases and trims whitespace", () => {
    expect(normalizeDomain("  Example.COM  ")).toBe("example.com");
  });

  it("returns an empty string for garbage input", () => {
    expect(normalizeDomain("not a domain !!")).toBe("");
    expect(normalizeDomain("")).toBe("");
  });
});

describe("computeRules", () => {
  it("returns no rules when no session is active, regardless of mode or lists", () => {
    expect(computeRules({ ...base, active: false, whitelist: ["wikipedia.org"] })).toEqual([]);
    expect(computeRules({ ...base, active: false, mode: "blacklist", blacklist: ["reddit.com"] })).toEqual([]);
  });

  it("whitelist mode with an empty list still blocks everything except alwaysAllowedDomains", () => {
    const rules = computeRules({ ...base, alwaysAllowedDomains: ["studylife.example.com"] });
    expect(rules).toHaveLength(2);
    const block = rules.find((r) => r.id === BLOCK_ALL_RULE_ID)!;
    expect(block.action.type).toBe("redirect");
    expect(block.condition.urlFilter).toBe("*");
    const allow = rules.find((r) => r.id === ALLOW_LIST_RULE_ID)!;
    expect(allow.action.type).toBe("allow");
    expect(allow.priority).toBeGreaterThan(block.priority!);
    expect(allow.condition.requestDomains).toEqual(["studylife.example.com"]);
  });

  it("whitelist mode merges the user's list with alwaysAllowedDomains, deduped", () => {
    const rules = computeRules({
      ...base,
      whitelist: ["Wikipedia.org", "wikipedia.org"],
      alwaysAllowedDomains: ["studylife.example.com"],
    });
    const allow = rules.find((r) => r.id === ALLOW_LIST_RULE_ID)!;
    expect(allow.condition.requestDomains).toEqual(["wikipedia.org", "studylife.example.com"]);
  });

  it("whitelist mode restricts both rules to main_frame only", () => {
    const rules = computeRules({ ...base, whitelist: ["wikipedia.org"] });
    for (const rule of rules) {
      expect(rule.condition.resourceTypes).toEqual(["main_frame"]);
    }
  });

  it("blacklist mode with an empty list blocks nothing", () => {
    expect(computeRules({ ...base, mode: "blacklist" })).toEqual([]);
  });

  it("blacklist mode blocks exactly the listed (deduped) domains", () => {
    const rules = computeRules({ ...base, mode: "blacklist", blacklist: ["reddit.com", "Reddit.com"] });
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe(BLOCK_LIST_RULE_ID);
    expect(rules[0]!.action.type).toBe("redirect");
    expect(rules[0]!.condition.requestDomains).toEqual(["reddit.com"]);
  });

  it("blacklist mode ignores alwaysAllowedDomains (no whitelist concept there)", () => {
    const rules = computeRules({
      ...base,
      mode: "blacklist",
      blacklist: ["reddit.com"],
      alwaysAllowedDomains: ["studylife.example.com"],
    });
    expect(rules).toHaveLength(1);
  });
});

describe("isDomainAllowed", () => {
  it("always true when inactive", () => {
    expect(isDomainAllowed("reddit.com", { ...base, active: false })).toBe(true);
  });

  describe("whitelist mode", () => {
    const config: RuleConfig = { ...base, whitelist: ["wikipedia.org"], alwaysAllowedDomains: ["studylife.example.com"] };

    it("allows the exact whitelisted domain", () => {
      expect(isDomainAllowed("wikipedia.org", config)).toBe(true);
    });

    it("allows a subdomain of a whitelisted domain", () => {
      expect(isDomainAllowed("en.wikipedia.org", config)).toBe(true);
    });

    it("allows the always-allowed (StudyLife) domain", () => {
      expect(isDomainAllowed("studylife.example.com", config)).toBe(true);
    });

    it("blocks anything not on the list", () => {
      expect(isDomainAllowed("reddit.com", config)).toBe(false);
    });

    it("does not allow a domain that merely CONTAINS the whitelisted domain as a substring", () => {
      // notwikipedia.org must not match wikipedia.org
      expect(isDomainAllowed("notwikipedia.org", config)).toBe(false);
    });
  });

  describe("blacklist mode", () => {
    const config: RuleConfig = { ...base, mode: "blacklist", blacklist: ["reddit.com"] };

    it("blocks the exact blacklisted domain", () => {
      expect(isDomainAllowed("reddit.com", config)).toBe(false);
    });

    it("blocks a subdomain of a blacklisted domain", () => {
      expect(isDomainAllowed("old.reddit.com", config)).toBe(false);
    });

    it("allows anything not on the list", () => {
      expect(isDomainAllowed("wikipedia.org", config)).toBe(true);
    });
  });
});
