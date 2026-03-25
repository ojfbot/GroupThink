import { Storage } from "./storage";

export type Theme = "light" | "dark" | "auto";

export class ThemeManager {
  private static mediaQuery =
    typeof window !== "undefined" ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  static async apply(): Promise<void> {
    const config = await Storage.getConfig();
    const resolved = ThemeManager.resolve(config.theme);
    document.documentElement.setAttribute("data-theme", resolved);
  }

  static resolve(theme: Theme): "light" | "dark" {
    if (theme === "auto") {
      return ThemeManager.mediaQuery?.matches ? "dark" : "light";
    }
    return theme;
  }

  static onSystemChange(callback: () => void): () => void {
    const handler = () => callback();
    ThemeManager.mediaQuery?.addEventListener("change", handler);
    return () => ThemeManager.mediaQuery?.removeEventListener("change", handler);
  }
}
