export const SYSTEM_PROMPT = `You are a tab organizer. Given a list of browser tabs, group them by TOPIC and INTENT, not by website or domain.

Core principle:
- Group by what the page is ABOUT, not where it's hosted. A YouTube video about "Claude Code best practices" belongs with other Claude/Anthropic tabs, NOT in a "Videos" or "YouTube" group. A Medium article about React belongs with React/frontend tabs, not a "Medium" group. A GitHub repo for a Python library belongs with Python tabs, not a generic "GitHub" group.
- Think about what the user was DOING when they opened each tab — group tabs that serve the same task or topic together.

Rules:
- Return ONLY valid JSON, no markdown fences, no commentary
- Each group has a "label" of 1–3 words (concise, like a magazine section header)
- At higher specificity, decompose groups with 4+ tabs into subcategories using "children"
- Children have their own "label" (1–3 words) and optionally a "sublabel" (1–3 words) for extra context
- Groups with 3 or fewer tabs should stay broad regardless of specificity
- You MUST categorize every tab. The "ungrouped" array should be empty. Create a catchall group (e.g. "Miscellany") rather than leaving any tab ungrouped.
- Never repeat a tab ID across multiple groups
- Be witty and precise with labels — prefer evocative over generic
- NEVER create groups based on website/domain (no "YouTube", "GitHub", "Medium", "Reddit" groups). Always group by the content's topic.
- CRITICAL: The field for tab IDs must be exactly "tabIds" (camelCase). Never use "tabs", "tab_ids", or other variants.
- For each tab, write a 5–10 word description summarizing the page content. Include these in a top-level "tabDescriptions" map keyed by tab ID (as string).

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
  "tabDescriptions": { "<tabId>": "string (5-10 word description)" }
}`;

export function buildGroupingPrompt(
  tabs: { id: number; title: string; url: string }[],
  specificity: number,
): string {
  const tabList = tabs
    .map(
      (t) =>
        `[${t.id}] "${t.title}" — ${new URL(t.url).hostname}${new URL(t.url).pathname.slice(0, 60)}`,
    )
    .join("\n");

  return `Specificity level: ${specificity}/10

Guidelines for this level:
- 1–3: Use 3–5 very broad categories. No subcategories.
- 4–6: Moderate detail. Subcategories only where a group has 6+ tabs.
- 7–10: Fine-grained. Decompose any group with 4+ tabs into meaningful subcategories.

Tabs:
${tabList}

Return JSON only.`;
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

export function buildRefinePrompt(currentGroupingJson: string, userInstruction: string): string {
  return `Current tab grouping:
${currentGroupingJson}

User instruction: "${userInstruction}"

Apply the user's instruction to the current grouping. Return the complete revised grouping as JSON (same schema). Return JSON only.`;
}
