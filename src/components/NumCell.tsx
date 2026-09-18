import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  value: number;
  onCommit: (v: number) => void;
  disabled?: boolean;
  step?: string;
  className?: string;
  /** Имя таблицы для навигации стрелками */
  grid?: string;
  row?: number;
  col?: number;
  placeholder?: string;
};

function focusCell(grid: string, row: number, col: number) {
  const el = document.querySelector<HTMLInputElement>(
    `input[data-grid="${grid}"][data-row="${row}"][data-col="${col}"]`,
  );
  if (el) {
    el.focus();
    el.select();
    return true;
  }
  return false;
}

/**
 * Числовое поле для табличных ячеек:
 * - поле можно полностью очистить (нет «нестираемого нуля»)
 * - значение применяется по Enter или при уходе из поля
 * - стрелки вверх/вниз/влево/вправо перемещают курсор по таблице
 */
export function NumCell({
  value,
  onCommit,
  disabled,
  step = "1",
  className,
  grid,
  row,
  col,
  placeholder,
}: Props) {
  const [text, setText] = useState(value === 0 ? "" : String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value === 0 ? "" : String(value));
  }, [value]);

  const commit = () => {
    const normalized = text.replace(",", ".").trim();
    const num = normalized === "" ? 0 : Number(normalized);
    const next = Number.isFinite(num) ? num : 0;
    setText(next === 0 ? "" : String(next));
    if (next !== value) onCommit(next);
    return next;
  };

  const move = (dr: number, dc: number) => {
    if (!grid || row === undefined || col === undefined) return false;
    return focusCell(grid, row + dr, col + dc);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      step={step}
      placeholder={placeholder ?? "0"}
      disabled={disabled}
      className={cn("text-right", className)}
      data-grid={grid}
      data-row={row}
      data-col={col}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          move(1, 0);
          return;
        }
        if (e.key === "Escape") {
          setText(value === 0 ? "" : String(value));
          e.currentTarget.blur();
          return;
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          commit();
          move(e.key === "ArrowDown" ? 1 : -1, 0);
          return;
        }
        const input = e.currentTarget;
        const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
        const atEnd =
          input.selectionStart === input.value.length &&
          input.selectionEnd === input.value.length;
        const whole =
          input.selectionStart === 0 && input.selectionEnd === input.value.length;
        if (e.key === "ArrowLeft" && (atStart || whole)) {
          if (move(0, -1)) {
            e.preventDefault();
            commit();
          }
          return;
        }
        if (e.key === "ArrowRight" && (atEnd || whole)) {
          if (move(0, 1)) {
            e.preventDefault();
            commit();
          }
        }
      }}
    />
  );
}
