import type { ConversationMessage, GroupingResponse, GroupThinkConfig } from "../types";

const KEYS = {
  CONFIG: "groupthink_config",
  GROUPING: "groupthink_grouping",
  CONVERSATION: "groupthink_conversation",
} as const;

export class Storage {
  // ── Config ──

  static async getConfig(): Promise<GroupThinkConfig> {
    const result = await chrome.storage.local.get(KEYS.CONFIG);
    return (
      result[KEYS.CONFIG] ?? {
        model: "claude-sonnet-4-20250514",
        specificity: 5,
        theme: "auto",
      }
    );
  }

  static async setConfig(config: Partial<GroupThinkConfig>): Promise<void> {
    const current = await Storage.getConfig();
    await chrome.storage.local.set({
      [KEYS.CONFIG]: { ...current, ...config },
    });
  }

  // ── Grouping state ──

  static async getGrouping(): Promise<GroupingResponse | null> {
    const result = await chrome.storage.local.get(KEYS.GROUPING);
    return result[KEYS.GROUPING] ?? null;
  }

  static async setGrouping(grouping: GroupingResponse): Promise<void> {
    await chrome.storage.local.set({ [KEYS.GROUPING]: grouping });
  }

  static async clearGrouping(): Promise<void> {
    await chrome.storage.local.remove(KEYS.GROUPING);
  }

  // ── Conversation history ──

  static async getConversation(): Promise<ConversationMessage[]> {
    const result = await chrome.storage.local.get(KEYS.CONVERSATION);
    return result[KEYS.CONVERSATION] ?? [];
  }

  static async addMessage(message: ConversationMessage): Promise<ConversationMessage[]> {
    const history = await Storage.getConversation();
    // Keep last 20 messages for context window management
    const updated = [...history, message].slice(-20);
    await chrome.storage.local.set({ [KEYS.CONVERSATION]: updated });
    return updated;
  }

  static async clearConversation(): Promise<void> {
    await chrome.storage.local.remove(KEYS.CONVERSATION);
  }
}
