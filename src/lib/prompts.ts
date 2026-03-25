export const SYSTEM_PROMPT = `You are a tab organizer. Given a list of browser tabs, group them by TOPIC and INTENT, not by website or domain.

Core principle:
- Group by what the page is ABOUT, not where it's hosted. A YouTube video about "Claude Code best practices" belongs with other Claude/Anthropic tabs, NOT in a "Videos" or "YouTube" group. A Medium article about React belongs with React/frontend tabs, not a "Medium" group. A GitHub repo for a Python library belongs with Python tabs, not a generic "GitHub" group.
- Think about what the user was DOING when they opened each tab — group tabs that serve the same task or topic together.
- When browser context signals are provided (visit frequency, bookmarks, recently closed tabs), use them to make better grouping decisions: high visit counts indicate active projects, bookmark folders reveal the user's mental model, recently closed tabs hint at completed or paused tasks.

Rules:
- Return ONLY valid JSON, no markdown fences, no commentary
- Each group has a "label" of 1–3 words (concise, like a magazine section header)
- CRITICAL: When the specificity level calls for subcategories (see user prompt), you MUST use "children" to decompose qualifying groups. A group that qualifies for decomposition MUST NOT have an empty or missing "children" array. When you create children, move all tab IDs into the children — the parent's "tabIds" should be empty.
- Children have their own "label" (1–3 words) and optionally a "sublabel" (1–3 words) for extra context
- Groups with 3 or fewer tabs should stay broad regardless of specificity
- You MUST categorize every tab. The "ungrouped" array should be empty. Create a catchall group (e.g. "Miscellany") rather than leaving any tab ungrouped.
- Never repeat a tab ID across multiple groups
- Be witty and precise with labels — prefer evocative over generic
- NEVER create groups based on website/domain (no "YouTube", "GitHub", "Medium", "Reddit" groups). Always group by the content's topic.
- CRITICAL: The field for tab IDs must be exactly "tabIds" (camelCase). Never use "tabs", "tab_ids", or other variants.
- For each tab, write a 5–10 word description summarizing the page content. Include these in a top-level "tabDescriptions" map keyed by tab ID (as string).
- For each tab, provide 1–3 short tags (1–2 words each) describing the page's topic or purpose. Include these in a top-level "tabTags" map keyed by tab ID (as string). Tags should be lowercase, concise topic labels (e.g., "ai", "docs", "pricing", "tutorial", "api reference").

JSON schema:
{
  "groups": [
    {
      "label": "string (1-3 words)",
      "sublabel": "string (1-3 words, optional)",
      "tabIds": [number],
      "children": [
        {
          "label": "string",
          "sublabel": "string (optional)",
          "tabIds": [number]
        }
      ]
    }
  ],
  "ungrouped": [number],
  "tabDescriptions": { "<tabId>": "string (5-10 word description)" },
  "tabTags": { "<tabId>": ["string (1-2 word tag)", ...] }
}`;

export function buildGroupingPrompt(
  tabs: { id: number; title: string; url: string }[],
  specificity: number,
  contextHints?: string,
): string {
  const tabList = tabs
    .map(
      (t) =>
        `[${t.id}] "${t.title}" — ${new URL(t.url).hostname}${new URL(t.url).pathname.slice(0, 60)}`,
    )
    .join("\n");

  let prompt = `Specificity level: ${specificity}/10

Guidelines for this level:
- 1–3: Use 3–5 very broad categories. No subcategories.
- 4–6: Moderate detail. Any group with 6+ tabs MUST be decomposed into 2–4 children subcategories. Each child must have at least 2 tabs.
- 7–10: Fine-grained. Any group with 4+ tabs MUST be decomposed into 2–5 children subcategories. Each child must have at least 2 tabs. This is a hard requirement.

Tabs:
${tabList}`;

  if (contextHints) {
    prompt += `\n\n${contextHints}`;
  }

  prompt += `\n\nBefore returning, verify: at this specificity level, every group above the tab threshold has "children". If not, fix it.

Return JSON only.`;

  return prompt;
}

export function buildSweepPrompt(
  existingGroups: { label: string; tabIds: number[] }[],
  ungroupedTabs: { id: number; title: string; url: string }[],
): string {
  const groupList = existingGroups
    .map((g) => `• "${g.label}" (${g.tabIds.length} tabs)`)
    .join("\n");

  const tabList = ungroupedTabs
    .map((t) => {
      try {
        return `[${t.id}] "${t.title}" — ${new URL(t.url).hostname}${new URL(t.url).pathname.slice(0, 60)}`;
      } catch {
        return `[${t.id}] "${t.title}" — ${t.url}`;
      }
    })
    .join("\n");

  return `These tabs were left uncategorized in a previous pass. Assign EVERY one to an existing group or create 1–2 new groups.

Existing groups:
${groupList}

Uncategorized tabs:
${tabList}

Rules:
- To assign to an existing group, use the EXACT label string from above.
- Create a new group only if no existing group fits.
- Every tab must appear in exactly one group.
- The "ungrouped" array MUST be empty.
- Use "tabIds" (camelCase) for the tab ID field.

Return JSON only (same schema).`;
}

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

export function buildRefinePrompt(currentGroupingJson: string, userInstruction: string): string {
  return `Current tab grouping:
${currentGroupingJson}

User instruction: "${userInstruction}"

Apply the user's instruction to the current grouping. Return the complete revised grouping as JSON (same schema).

FOCUS: If the user's message implies they want to look at, focus on, explore, or zoom into a specific group or topic, include a "focusGroupLabel" field set to the EXACT label of the group to focus. If they also mention a specific subgroup or child, include "focusChildLabel" with the EXACT child label. If the user asks to focus a topic that doesn't have its own group yet, restructure the grouping so that topic becomes a distinct group, then set "focusGroupLabel" to it. If the user's instruction is purely structural (merge, rename, split) with no focus intent, omit these fields.

Examples of focus intent: "show me my AI tabs", "focus on shopping", "what do I have open about React?", "zoom into the research group", "let me see the Claude stuff"
Examples of no focus intent: "merge News and Media", "rename Shopping to Commerce", "split Development into Frontend and Backend"

Return JSON only.`;
}
