export type PermissionDecision = "allow" | "deny" | "ask";

export interface PermissionRequest {
  id: string;
  type: string;
  pattern?: string | string[];
  title: string;
  sessionID: string;
}

export interface PermissionPolicyConfig {
  auto_allow: string[];
  auto_deny: string[];
  ask: boolean;
}

const READ_COMMANDS = new Set([
  "cat", "ls", "pwd", "echo", "printf", "grep", "rg", "find", "head", "tail",
  "wc", "which", "whoami", "env", "date", "true", "false", "sort", "uniq",
  "sed", "awk", "diff", "stat", "du", "df", "basename", "dirname", "readlink",
]);

const GIT_READ = /^git\s+(status|log|diff|show|branch|remote|rev-parse|ls-files|shortlog|blame)\b/;

function isReadOnlyBash(pattern: string | undefined): boolean {
  if (!pattern) return false;
  const cmd = pattern.trim().split(/\s+/);
  const first = cmd[0];
  if (!first) return false;
  if (READ_COMMANDS.has(first)) return true;
  if (first === "git" && GIT_READ.test(pattern.trim())) return true;
  return false;
}

/** Rule matching: exact type, "prefix*" wildcard, or special "bash:read". */
function ruleMatches(rule: string, type: string, pattern: string | undefined): boolean {
  if (rule === type) return true;
  if (rule === "bash:read") return type === "bash" && isReadOnlyBash(pattern);
  if (rule.endsWith("*") && rule.length > 1) return type.startsWith(rule.slice(0, -1));
  return false;
}

/**
 * Decides whether the brain may run a requested tool. Auto-allow / auto-deny
 * rules are listed in cortex.json. Deny is the default for anything unlisted.
 */
export class PermissionPolicy {
  /** Runtime additions (via /allow) evaluated before the config rules. */
  readonly runtimeAllow = new Set<string>();

  constructor(private config: PermissionPolicyConfig) {}

  decide(perm: PermissionRequest): PermissionDecision {
    const patterns = Array.isArray(perm.pattern) ? perm.pattern : [perm.pattern];
    for (const rule of this.runtimeAllow) {
      if (patterns.some((p) => ruleMatches(rule, perm.type, p))) return "allow";
    }
    for (const rule of this.config.auto_deny) {
      if (patterns.some((p) => ruleMatches(rule, perm.type, p))) return "deny";
    }
    for (const rule of this.config.auto_allow) {
      if (patterns.some((p) => ruleMatches(rule, perm.type, p))) return "allow";
    }
    if (this.config.ask) return "ask";
    return "deny";
  }

  describe(): string {
    const allow = this.config.auto_allow.join(", ") || "(none)";
    const deny = this.config.auto_deny.join(", ") || "(none)";
    return `allow: ${allow}; deny: ${deny}; ask: ${this.config.ask}`;
  }
}
