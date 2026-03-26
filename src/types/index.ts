// ── Tab data ──

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  favIconUrl?: string;
  windowId: number;
  index: number;
  pinned: boolean;
  groupId: number;
  description?: string;
  thumbnail?: string;
  tags?: string[];
}

// ── Grouping ──

export interface TabGroup {
  id: string;
  label: string; // 1-3 words
  sublabel?: string; // 1-3 words, only when decomposed
  tabs: TabInfo[];
  collapsed: boolean;
  children?: TabGroup[];
}

export interface GroupingResponse {
  groups: TabGroup[];
  ungrouped: TabInfo[];
  specificity: number; // 1-10
  timestamp: number;
  focusGroupLabel?: string;
  focusChildLabel?: string;
}

// ── LLM response schema (before hydrating with TabInfo) ──

export interface LLMGroupItem {
  label: string;
  sublabel?: string;
  tabIds: number[];
  children?: LLMGroupItem[];
}

export interface LLMGroupingResult {
  groups: LLMGroupItem[];
  ungrouped: number[];
  tabDescriptions?: Record<string, string>;
  tabTags?: Record<string, string[]>;
  focusGroupLabel?: string;
  focusChildLabel?: string;
}

// ── Chat ──

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

// ── Config ──

export type LLMProvider = "ollama" | "anthropic";

export interface GroupThinkConfig {
  provider: LLMProvider;
  anthropicApiKey?: string;
  ollamaBaseUrl?: string;
  model: string;
  specificity: number;
  theme: "light" | "dark" | "auto";
  contextEnrichment: "off" | "basic" | "full";
}

export const DEFAULT_CONFIG: GroupThinkConfig = {
  provider: "ollama",
  model: "qwen2.5:7b",
  ollamaBaseUrl: "http://localhost:11434",
  specificity: 5,
  theme: "auto",
  contextEnrichment: "off",
};

// ── Messages (app ↔ background) ──

export type MessageType =
  | "get-config"
  | "set-config"
  | "get-tabs"
  | "group-tabs"
  | "refine-grouping"
  | "focus-tab"
  | "split-view-tab"
  | "close-tab"
  | "ping";

export interface Message {
  type: MessageType;
  [key: string]: unknown;
}
