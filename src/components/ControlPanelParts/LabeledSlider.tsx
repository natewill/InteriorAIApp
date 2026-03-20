interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  suffix?: string;
  helperLeft?: string;
  helperRight?: string;
}

export default function LabeledSlider({
  label,
  value,
  min,
  max,
  onChange,
  suffix,
  helperLeft,
  helperRight,
}: LabeledSliderProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
          {label}
        </label>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {value}
          {suffix ?? ''}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-zinc-200 accent-blue-600 dark:bg-zinc-700"
      />
      {(helperLeft || helperRight) && (
        <div className="flex justify-between text-xs text-zinc-400 dark:text-zinc-500">
          <span>{helperLeft}</span>
          <span>{helperRight}</span>
        </div>
      )}
    </div>
  );
}
