import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMGroupingResult, TabInfo } from "../types";
import { buildGroupingPrompt, buildRefinePrompt, buildSweepPrompt, SYSTEM_PROMPT } from "./prompts";

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

  // Safety: if no tabIds found at all, look harder
  if (!("tabIds" in out)) {
    // Check for any array of numbers as a fallback
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
    // Last resort: empty array
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

  // Pass through tabDescriptions as-is (Zod validates it)

  return obj;
}

export class GroupThinkAI {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({
      apiKey,
      dangerouslyAllowBrowser: true,
    });
    this.model = model;
  }

  async groupTabs(tabs: TabInfo[], specificity: number): Promise<LLMGroupingResult> {
    console.log(`[GroupThink] groupTabs: ${tabs.length} tabs, specificity=${specificity}`);

    const tabSummaries = tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
    }));

    const t0 = performance.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildGroupingPrompt(tabSummaries, specificity) }],
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM response in ${elapsed}ms, usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
    );

    return this.parseResponse(response);
  }

  async sweepUncategorized(
    existingGroups: { label: string; tabIds: number[] }[],
    ungroupedTabs: { id: number; title: string; url: string }[],
  ): Promise<LLMGroupingResult> {
    console.log(
      `[GroupThink] sweepUncategorized: ${ungroupedTabs.length} tabs across ${existingGroups.length} existing groups`,
    );

    const t0 = performance.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildSweepPrompt(existingGroups, ungroupedTabs) }],
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM sweep response in ${elapsed}ms, usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
    );

    return this.parseResponse(response);
  }

  async refineGrouping(
    currentGroupingJson: string,
    userInstruction: string,
    history: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<LLMGroupingResult> {
    console.log(
      `[GroupThink] refineGrouping: "${userInstruction}", ${history.length} history msgs`,
    );

    const messages: Anthropic.MessageParam[] = [
      ...history.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: buildRefinePrompt(currentGroupingJson, userInstruction) },
    ];

    const t0 = performance.now();
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages,
    });
    const elapsed = Math.round(performance.now() - t0);

    console.log(
      `[GroupThink] LLM refine response in ${elapsed}ms, usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens}`,
    );

    return this.parseResponse(response);
  }

  private parseResponse(response: Anthropic.Message): LLMGroupingResult {
    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // Strip markdown fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    console.log("[GroupThink] LLM raw JSON (first 500 chars):", cleaned.slice(0, 500));

    const parsed = JSON.parse(cleaned);

    // Log raw field names per group before normalization
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
