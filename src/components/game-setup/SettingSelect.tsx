'use client';

interface SettingSelectProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}

export function SettingSelect<T extends string>({
  label,
  value,
  options,
  onChange
}: SettingSelectProps<T>) {
  return (
    <div className="flex items-center justify-between py-1 border-b border-void-800/50 last:border-b-0">
      <span className="text-void-300 text-xs">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="bg-void-900 border border-void-700 rounded px-2 py-0.5 text-white text-xs
                   focus:outline-none focus:border-void-500 cursor-pointer"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}
