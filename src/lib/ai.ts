import { z } from "zod";
import type { GroupThinkConfig, LLMGroupingResult, LLMProvider, TabInfo } from "../types";
import { type LLMClient, createLLMClient } from "./llm-client";
import { buildGroupingPrompt, buildRefinePrompt, buildSweepPrompt, getSystemPrompt } from "./prompts";

// ── Zod schema for LLM response validation ──

const LLMChildSchema = z.object({
  label: z.string(),
  sublabel: z.string().optional(),
  tabIds: z.array(z.number()),
});

const LLMGroupSchema = z.object({
  label: z.string(),
  sublabel: z.string().optional(),
  tabIds: z.array(z.number()),
  children: z.array(LLMChildSchema).optional(),
});

const LLMResponseSchema = z.object({
  groups: z.array(LLMGroupSchema),
  ungrouped: z.array(z.number()),
  tabDescriptions: z.record(z.string(), z.string()).optional(),
  tabTags: z.record(z.string(), z.array(z.string())).optional(),
  focusGroupLabel: z.string().optional(),
  focusChildLabel: z.string().optional(),
});

// ── Normalize LLM field name variants before Zod validation ──

const TAB_ID_VARIANTS = new Set(["tabs", "tab_ids", "tabIDs", "tab_id", "Tabs", "TabIds"]);

function normalizeGroup(group: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(group)) {
    if (key === "tabIds") {
      out.tabIds = extractIds(value);
    } else if (TAB_ID_VARIANTS.has(key)) {
      console.log(
        `[GroupThink] normalize: renamed "${key}" → "tabIds" in group "${group.label ?? "?"}"`,
      );
      out.tabIds = extractIds(value);
    } else if (key === "children" && Array.isArray(value)) {
      out.children = value.map((child) =>
        typeof child === "object" && child !== null
          ? normalizeGroup(child as Record<string, unknown>)
          : child,
      );
    } else {
      out[key] = value;
    }
  }

  if (!("tabIds" in out)) {
    for (const [key, value] of Object.entries(group)) {
      if (
        Array.isArray(value) &&
        value.length > 0 &&
        typeof value[0] === "number" &&
        key !== "children"
      ) {
        console.warn(
          `[GroupThink] normalize: fallback — using "${key}" as tabIds in group "${group.label ?? "?"}"`,
        );
        out.tabIds = value;
        break;
      }
    }
    if (!("tabIds" in out)) {
      console.warn(
        `[GroupThink] normalize: no tab IDs found in group "${group.label ?? "?"}", keys: ${Object.keys(group).join(", ")}`,
      );
      out.tabIds = [];
    }
  }

  return out;
}

function extractIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: unknown) => {
      if (typeof item === "number") return item;
      if (typeof item === "object" && item !== null && "id" in item)
        return (item as { id: number }).id;
      return null;
    })
    .filter((id): id is number => id !== null);
}

function normalizeResponse(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const obj = parsed as Record<string, unknown>;

  if (Array.isArray(obj.groups)) {
    obj.groups = (obj.groups as unknown[]).map((g) =>
      typeof g === "object" && g !== null ? normalizeGroup(g as Record<string, unknown>) : g,
    );
  }

  if (!Array.isArray(obj.ungrouped)) {
    obj.ungrouped = [];
  }

  return obj;
}

export class GroupThinkAI {
  private client: LLMClient;
  private provider: LLMProvider;

  constructor(config: GroupThinkConfig) {
    this.client = createLLMClient(config);
    this.provider = config.provider;
  }

  async groupTabs(
    tabs: TabInfo[],
    specificity: number,
    contextHints?: string,
  ): Promise<LLMGroupingResult> {
    console.log(`[GroupThink] groupTabs: ${tabs.length} tabs, specificity=${specificity}`);

    const tabSummaries = tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
    }));

    const t0 = performance.now();
    const response = await this.client.complete({
      system: getSystemPrompt(this.provider),
      messages: [
        {
          role: "user",
          content: buildGroupingPrompt(tabSummaries, specificity, contextHints, {
            provider: this.provider,
          }),
        },
      ],
      maxTokens: this.provider === "ollama" ? 2048 : 4096,
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM response in ${elapsed}ms, usage: input=${response.inputTokens ?? "?"} output=${response.outputTokens ?? "?"}`,
    );

    return this.parseResponse(response.text);
  }

  async sweepUncategorized(
    existingGroups: { label: string; tabIds: number[] }[],
    ungroupedTabs: { id: number; title: string; url: string }[],
  ): Promise<LLMGroupingResult> {
    console.log(
      `[GroupThink] sweepUncategorized: ${ungroupedTabs.length} tabs across ${existingGroups.length} existing groups`,
    );

    const t0 = performance.now();
    const response = await this.client.complete({
      system: getSystemPrompt(this.provider),
      messages: [{ role: "user", content: buildSweepPrompt(existingGroups, ungroupedTabs) }],
      maxTokens: 1024,
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM sweep response in ${elapsed}ms, usage: input=${response.inputTokens ?? "?"} output=${response.outputTokens ?? "?"}`,
    );

    return this.parseResponse(response.text);
  }

  async refineGrouping(
    currentGroupingJson: string,
    userInstruction: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<LLMGroupingResult> {
    console.log(
      `[GroupThink] refineGrouping: "${userInstruction}", ${history.length} history msgs`,
    );

    const messages = [
      ...history,
      { role: "user" as const, content: buildRefinePrompt(currentGroupingJson, userInstruction) },
    ];

    const t0 = performance.now();
    const response = await this.client.complete({
      system: getSystemPrompt(this.provider),
      messages,
      maxTokens: 2048,
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM refine response in ${elapsed}ms, usage: input=${response.inputTokens ?? "?"} output=${response.outputTokens ?? "?"}`,
    );

    return this.parseResponse(response.text);
  }

  private parseResponse(text: string): LLMGroupingResult {
    // Strip markdown fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    console.log("[GroupThink] LLM raw JSON (first 500 chars):", cleaned.slice(0, 500));

    const parsed = JSON.parse(cleaned);

    if (Array.isArray(parsed.groups)) {
      parsed.groups.forEach((g: Record<string, unknown>, i: number) => {
        console.log(
          `[GroupThink] raw group[${i}] "${g.label}" keys: [${Object.keys(g).join(", ")}]`,
        );
      });
    }

    const normalized = normalizeResponse(parsed);

    console.log(
      "[GroupThink] normalized result:",
      JSON.stringify(normalized, null, 2).slice(0, 1000),
    );

    const validated = LLMResponseSchema.parse(normalized);

    console.log(
      `[GroupThink] validation passed: ${validated.groups.length} groups, ${validated.ungrouped.length} ungrouped`,
    );
    validated.groups.forEach((g, i) => {
      console.log(
        `[GroupThink]   group[${i}] "${g.label}": ${g.tabIds.length} tabs${g.children ? `, ${g.children.length} children` : ""}`,
      );
    });

    return validated;
  }
}
