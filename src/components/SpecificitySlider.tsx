import type React from "react";
import { useCallback, useRef } from "react";

interface SpecificitySliderProps {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

export function SpecificitySlider({ value, onChange, disabled }: SpecificitySliderProps) {
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newVal = Number(e.target.value);
      // Debounce the callback to avoid rapid re-prompts
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onChange(newVal), 400);
    },
    [onChange],
  );

  return (
    <div className="gt-slider">
      <label className="gt-slider__label gt-slider__label--left">Broad</label>
      <input
        className="gt-slider__input"
        type="range"
        min={1}
        max={10}
        step={1}
        defaultValue={value}
        onChange={handleChange}
        disabled={disabled}
        aria-label="Grouping specificity"
      />
      <label className="gt-slider__label gt-slider__label--right">Specific</label>
    </div>
  );
}
