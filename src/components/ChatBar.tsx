import type React from "react";
import { useEffect, useRef, useState } from "react";

interface ChatBarProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

export function ChatBar({ onSend, disabled, loading }: ChatBarProps) {
  const [input, setInput] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Focus input when not loading
    if (!loading) inputRef.current?.focus();
  }, [loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setInput("");
  };

  return (
    <form className="gt-chat" onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        className="gt-chat__input"
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={
          loading ? "Thinking..." : 'Refine groupings\u2026 (e.g., "merge News and Media")'
        }
        disabled={disabled || loading}
        autoComplete="off"
        spellCheck={false}
      />
      <button
        className="gt-chat__send"
        type="submit"
        disabled={!input.trim() || disabled || loading}
        aria-label="Send"
      >
        {loading ? (
          <span className="gt-chat__spinner" />
        ) : (
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        )}
      </button>
    </form>
  );
}
