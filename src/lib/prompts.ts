import type { LLMProvider } from "../types";

// ── System prompts ──

export const SYSTEM_PROMPT = `Tab organizer. Group by TOPIC/INTENT, never by website. Return valid JSON only.

Rules:
1. Group by page content, not host. YouTube video about React → React group, not "YouTube".
2. Labels: 1–3 words, evocative. No domain-based groups.
3. Field name for tab IDs is "tabIds" (camelCase). No variants.
4. Categorize every tab. "ungrouped" must be empty — use a catchall if needed.
5. No duplicate tab IDs across groups.
6. When specificity requires children: move ALL tabIds into children, parent tabIds=[].
7. Groups with ≤3 tabs: no children regardless of specificity.
8. Use browser context signals when provided (visit frequency, bookmarks, etc).

Schema: {"groups":[{"label":"str","sublabel?":"str","tabIds":[int],"children?":[{"label":"str","sublabel?":"str","tabIds":[int]}]}],"ungrouped":[int]}`;

const SYSTEM_PROMPT_LOCAL = `Tab organizer. Return valid JSON only.

Group by TOPIC or ACTIVITY. NEVER name a group after a website (GitHub, AWS, YouTube, Figma, Google, etc). Tabs from different websites that share a purpose go in the same group.

Rules:
1. Group by what the user is DOING, not where. An AWS billing page and a Stripe dashboard both belong in "Billing", not "AWS" and "Stripe".
2. Labels: 1–3 words, describe the activity or topic. FORBIDDEN labels: any domain name or brand.
3. Field name for tab IDs is "tabIds" (camelCase). No variants.
4. Categorize every tab. "ungrouped" must be empty — use a catchall if needed.
5. No duplicate tab IDs across groups.
6. When specificity requires children: move ALL tabIds into children, parent tabIds=[].
7. Groups with ≤3 tabs: no children regardless of specificity.

Schema: {"groups":[{"label":"str","sublabel?":"str","tabIds":[int],"children?":[{"label":"str","sublabel?":"str","tabIds":[int]}]}],"ungrouped":[int]}`;

export function getSystemPrompt(provider?: LLMProvider): string {
  return provider === "ollama" ? SYSTEM_PROMPT_LOCAL : SYSTEM_PROMPT;
}

// ── Grouping prompt ──

export function buildGroupingPrompt(
  tabs: { id: number; title: string; url: string }[],
  specificity: number,
  contextHints?: string,
  options?: { provider?: LLMProvider },
): string {
  const isLocal = options?.provider === "ollama";

  const tabList = tabs
    .map((t) => {
      try {
        const u = new URL(t.url);
        // Local models: hostname only (reduce domain signal). Cloud: hostname + path.
        return isLocal
          ? `${t.id}|${t.title}|${u.hostname}`
          : `${t.id}|${t.title}|${u.hostname}${u.pathname.slice(0, 50)}`;
      } catch {
        return `${t.id}|${t.title}|${t.url.slice(0, 60)}`;
      }
    })
    .join("\n");

  const childRule =
    specificity <= 3
      ? "No children. 3–5 broad groups."
      : specificity <= 6
        ? "Groups with 6+ tabs MUST have 2–4 children (min 2 tabs each)."
        : "Groups with 4+ tabs MUST have 2–5 children (min 2 tabs each).";

  const parts: string[] = [];

  parts.push(`Specificity: ${specificity}/10. ${childRule}`);

  // Few-shot examples for local models
  if (isLocal) {
    parts.push(`
Example:
Tabs: 101|S3 bucket policies|aws.amazon.com 102|React useState deep dive|youtube.com 103|Deploy Next.js to AWS|dev.to 104|GitHub Actions CI/CD|github.com 105|Terraform AWS modules|registry.terraform.io
Good: {"groups":[{"label":"Cloud Infra","tabIds":[101,105]},{"label":"Frontend Dev","tabIds":[102,103]},{"label":"CI/CD","tabIds":[104]}],"ungrouped":[]}
Bad: {"groups":[{"label":"AWS","tabIds":[101,105]},{"label":"YouTube","tabIds":[102]},{"label":"Dev.to","tabIds":[103]},{"label":"GitHub","tabIds":[104]}],"ungrouped":[]}
Domain names are NEVER used as group labels.`);

    if (specificity >= 5) {
      parts.push(`Example with children (specificity ${specificity}):
{"label":"Cloud Infra","tabIds":[],"children":[{"label":"Networking","tabIds":[201,202]},{"label":"Storage","tabIds":[203,204,205]}]}
Parent tabIds MUST be [] when children exist.`);
    }
  }

  parts.push(`Tabs (id|title|${isLocal ? "host" : "url"}):\n${tabList}`);

  // Only request tabDescriptions/tabTags for cloud models
  if (!isLocal) {
    parts.push(
      `Also return: "tabDescriptions":{"<id>":"5-10 word summary"}, "tabTags":{"<id>":["tag",...]}.\nTags: 1–3 lowercase topic words per tab.`,
    );
  }

  let prompt = parts.join("\n\n");

  if (contextHints) {
    prompt += `\n\n${contextHints}`;
  }

  return prompt;
}

// ── Sweep prompt ──

export function buildSweepPrompt(
  existingGroups: { label: string; tabIds: number[] }[],
  ungroupedTabs: { id: number; title: string; url: string }[],
): string {
  const groupList = existingGroups.map((g) => `${g.label} (${g.tabIds.length})`).join(", ");

  const tabList = ungroupedTabs
    .map((t) => {
      try {
        return `${t.id}|${t.title}|${new URL(t.url).hostname}`;
      } catch {
        return `${t.id}|${t.title}`;
      }
    })
    .join("\n");

  return `Assign each uncategorized tab to an existing group or create 1–2 new groups. Use EXACT label strings. ungrouped must be empty. No tabDescriptions/tabTags needed.

Groups: ${groupList}

Tabs (id|title|host):
${tabList}`;
}

// ── Context hints ──

export function buildContextHints(
  context: import("./browser-context").BrowserContext,
  tabs: { id: number }[],
): string | undefined {
  const lines: string[] = [];

  for (const tab of tabs) {
    const ctx = context.tabs.get(tab.id);
    if (!ctx) continue;

    const parts: string[] = [];
    if (ctx.visitCount !== undefined && ctx.visitCount > 1) {
      parts.push(`visited ${ctx.visitCount} times`);
    }
    if (ctx.lastVisitTime) {
      const ago = Math.round((Date.now() - ctx.lastVisitTime) / 60_000);
      if (ago < 60) parts.push(`last visited ${ago}min ago`);
      else if (ago < 1440) parts.push(`last visited ${Math.round(ago / 60)}h ago`);
    }
    if (ctx.isBookmarked) {
      parts.push(ctx.bookmarkFolder ? `bookmarked in "${ctx.bookmarkFolder}"` : "bookmarked");
    }
    if (ctx.isTopSite) {
      parts.push("top site");
    }

    if (parts.length > 0) {
      lines.push(`- Tab [${tab.id}]: ${parts.join(", ")}`);
    }
  }

  const sections: string[] = [];

  if (lines.length > 0) {
    sections.push(`User context signals (use to inform grouping decisions):\n${lines.join("\n")}`);
  }

  if (context.recentlyClosed.length > 0) {
    const closedLines = context.recentlyClosed.map((t) => {
      try {
        return `- "${t.title}" — ${new URL(t.url).hostname}`;
      } catch {
        return `- "${t.title}"`;
      }
    });
    sections.push(
      `Recently closed tabs (indicates ended/paused tasks):\n${closedLines.join("\n")}`,
    );
  }

  return sections.length > 0 ? sections.join("\n\n") : undefined;
}

// ── Refine prompt ──

export function buildRefinePrompt(currentGroupingJson: string, userInstruction: string): string {
  return `Grouping: ${currentGroupingJson}

Instruction: "${userInstruction}"

Apply the instruction. Return complete revised grouping JSON. No tabDescriptions/tabTags needed.

FOCUS: If user wants to view/explore a topic, add "focusGroupLabel" (exact label) and optionally "focusChildLabel". If the topic isn't a group yet, create it. Omit for structural changes (merge/rename/split).
Focus examples: "show AI tabs", "focus on shopping", "zoom into research"
No-focus examples: "merge News and Media", "rename Shopping to Commerce"`;
}
