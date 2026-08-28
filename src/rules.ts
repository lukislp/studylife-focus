// Pure declarativeNetRequest rule computation - deliberately free of any chrome.* call so it's
// unit-testable without mocking, and so background.ts can treat "what should the ruleset look
// like right now" as a simple function of state, recomputed and reapplied idempotently on every
// poll (see background.ts) rather than something that has to track its own prior edits.
//
// Only ever main_frame navigation is matched (never sub-resources): blocking/allowing whole-page
// navigation is the actual goal, and matching sub-resource requests too would break embedded
// content (scripts/images/iframes from other domains) on pages that ARE allowed - every
// dependency of an allowed page would then need its own whitelist entry too.

export type BlockMode = "whitelist" | "blacklist";

export interface RuleConfig {
  /** Is a focus session currently running? false (or any list mode with nothing configured)
   * means "block nothing" - see computeRules below. */
  active: boolean;
  mode: BlockMode;
  /** Domains only (e.g. "wikipedia.org", never "https://wikipedia.org/path") - subdomains are
   * matched automatically by declarativeNetRequest's requestDomains condition, so one entry
   * covers the whole site, not just its exact hostname. */
  whitelist: string[];
  blacklist: string[];
  /** Always reachable in whitelist mode regardless of the user's own list - in practice just the
   * configured StudyLife server's own domain, so a user can never lock themselves out of the app
   * that started the focus session in the first place. */
  alwaysAllowedDomains: string[];
}

// Fixed, stable IDs for the (at most two) rules this extension ever manages - background.ts
// always removes exactly these three IDs before adding whatever computeRules returns, so
// switching mode or toggling active never leaves a stale rule from a previous computation behind.
export const BLOCK_ALL_RULE_ID = 1;
export const ALLOW_LIST_RULE_ID = 2;
export const BLOCK_LIST_RULE_ID = 3;
export const MANAGED_RULE_IDS = [BLOCK_ALL_RULE_ID, ALLOW_LIST_RULE_ID, BLOCK_LIST_RULE_ID] as const;

export const BLOCKED_PAGE_PATH = "/blocked.html";

const MAIN_FRAME_ONLY: chrome.declarativeNetRequest.ResourceType[] = ["main_frame" as chrome.declarativeNetRequest.ResourceType];

function redirectToBlockedPage(): chrome.declarativeNetRequest.RuleAction {
  return { type: "redirect" as chrome.declarativeNetRequest.RuleActionType, redirect: { extensionPath: BLOCKED_PAGE_PATH } };
}

/** Lowercases and strips any protocol/path/port/whitespace a user might have pasted - the
 * whitelist/blacklist inputs are meant to hold bare domains only (base domain, all subdomains/
 * subpages under it included automatically), same "just the base, not a specific page" principle
 * as settings.ts's normalizeServerUrl. */
export function normalizeDomain(raw: string): string {
  let value = raw.trim().toLowerCase();
  if (!value) return "";
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`;
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function dedupeNormalized(domains: readonly string[]): string[] {
  const set = new Set(domains.map(normalizeDomain).filter((d) => d.length > 0));
  return [...set];
}

export function computeRules(config: RuleConfig): chrome.declarativeNetRequest.Rule[] {
  if (!config.active) return [];

  if (config.mode === "blacklist") {
    const blocked = dedupeNormalized(config.blacklist);
    if (blocked.length === 0) return []; // nothing configured to block yet - no-op, not "block everything"
    return [
      {
        id: BLOCK_LIST_RULE_ID,
        priority: 1,
        action: redirectToBlockedPage(),
        condition: { requestDomains: blocked, resourceTypes: MAIN_FRAME_ONLY },
      },
    ];
  }

  // Whitelist mode: block every main_frame navigation by default (priority 1), then carve out an
  // exception for the allowed domains at a HIGHER priority (2) - declarativeNetRequest resolves
  // overlapping matches by priority, and an "allow" action at a higher priority than a "redirect"
  // always wins, regardless of match specificity.
  const allowed = dedupeNormalized([...config.whitelist, ...config.alwaysAllowedDomains]);
  const rules: chrome.declarativeNetRequest.Rule[] = [
    {
      id: BLOCK_ALL_RULE_ID,
      priority: 1,
      action: redirectToBlockedPage(),
      condition: { urlFilter: "*", resourceTypes: MAIN_FRAME_ONLY },
    },
  ];
  if (allowed.length > 0) {
    rules.push({
      id: ALLOW_LIST_RULE_ID,
      priority: 2,
      action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
      condition: { requestDomains: allowed, resourceTypes: MAIN_FRAME_ONLY },
    });
  }
  return rules;
}

/** Whether `hostname` (a tab's current URL host) is currently reachable under `config` - used by
 * background.ts's active-tab sweep to decide which already-open tabs to redirect when a focus
 * session starts, without needing to build+diff a full declarativeNetRequest ruleset per tab. */
export function isDomainAllowed(hostname: string, config: RuleConfig): boolean {
  if (!config.active) return true;
  const host = normalizeDomain(hostname) || hostname.toLowerCase();
  const matches = (domain: string) => host === domain || host.endsWith(`.${domain}`);

  if (config.mode === "blacklist") {
    return !dedupeNormalized(config.blacklist).some(matches);
  }
  const allowed = dedupeNormalized([...config.whitelist, ...config.alwaysAllowedDomains]);
  return allowed.some(matches);
}
