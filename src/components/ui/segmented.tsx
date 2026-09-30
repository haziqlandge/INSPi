'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

interface Option<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}

/** A small set of exclusive choices; the filled pill slides to the selection with a little spring. */
export function Segmented<T extends string>({ options, value, onChange, label, size = 'md' }: Props<T>) {
  const id = useId();
  const pad = size === 'sm' ? 'px-2.5 py-1.5 text-[0.8125rem]' : 'px-3.5 py-2 text-sm';
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-full border border-line bg-paper/60 p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={`relative rounded-full font-medium leading-none transition-colors ${pad} ${
              selected ? 'text-paper' : 'text-muted hover:text-head'
            }`}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${id}`}
                className="absolute inset-0 rounded-full bg-head"
                transition={{ type: 'spring', stiffness: 520, damping: 30, mass: 0.6 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 flex-none rounded-full border transition-colors disabled:opacity-60 ${
        checked ? 'border-head bg-head' : 'border-line bg-paper'
      }`}
    >
      <motion.span
        className={`absolute top-[3px] h-4 w-4 rounded-full ${checked ? 'bg-paper' : 'bg-muted'}`}
        animate={{ left: checked ? 19 : 3 }}
        transition={{ type: 'spring', stiffness: 600, damping: 32 }}
      />
    </button>
  );
}
