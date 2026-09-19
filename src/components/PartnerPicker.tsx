import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { db } from "@/integrations/db";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

type PartnerRow = { id: string; name: string; kind: "customer" | "supplier"; inn: string | null };

/**
 * Выбор контрагента из справочника «Контрагенты».
 * kind="customer" — только покупатели, kind="supplier" — только поставщики.
 */
export function PartnerPicker({
  value,
  onChange,
  kind,
  disabled,
  className,
}: {
  value: string | null;
  onChange: (id: string) => void;
  kind: "customer" | "supplier";
  disabled?: boolean;
  className?: string;
}) {
  const wsId = useActiveWorkspaceId();
  const [open, setOpen] = useState(false);

  const { data: partners = [] } = useQuery({
    queryKey: ["partners", wsId],
    enabled: !!wsId,
    queryFn: async () =>
      ((await (db as any).from("partners").select("id,name,kind,inn").eq("workspace_id", wsId).order("name")).data ??
        []) as PartnerRow[],
  });

  const list = useMemo(() => partners.filter((p) => p.kind === kind), [partners, kind]);
  const selected = list.find((p) => p.id === value) ?? partners.find((p) => p.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          disabled={disabled}
          className={cn("h-8 w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected ? selected.name : kind === "customer" ? "Выберите покупателя" : "Выберите поставщика"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск по названию или ИНН" />
          <CommandList>
            <CommandEmpty>
              <div className="px-3 py-3 text-sm text-muted-foreground">
                Не найдено.{" "}
                <Link to="/partners" className="text-primary underline">
                  Добавить в справочник
                </Link>
              </div>
            </CommandEmpty>
            <CommandGroup heading={kind === "customer" ? "Покупатели" : "Поставщики"}>
              {list.map((p) => (
                <CommandItem
                  key={p.id}
                  value={`${p.name} ${p.inn ?? ""}`}
                  onSelect={() => {
                    onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <Check className={cn("mr-2 h-4 w-4", value === p.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{p.name}</span>
                  {p.inn && <span className="ml-auto pl-2 text-xs text-muted-foreground">{p.inn}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
