import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Database, Check, Settings2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { activeWorkspace, useActiveWorkspaceId, type Workspace } from "@/lib/workspace";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export function WorkspaceSwitcher() {
  const qc = useQueryClient();
  const activeId = useActiveWorkspaceId();

  const { data: list = [] } = useQuery({
    queryKey: ["workspaces"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("workspaces")
        .select("id,name,created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Workspace[];
    },
  });

  const current = list.find((w) => w.id === activeId);

  const switchTo = (id: string) => {
    if (id === activeId) return;
    activeWorkspace.set(id);
    // сбрасываем все кеши, чтобы данные подтянулись из выбранной базы
    qc.invalidateQueries();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-2 rounded-md border bg-background hover:bg-accent px-2 py-1.5 text-sm text-left"
          title="Активная база данных"
        >
          <Database className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex-1 min-w-0 truncate">
            {current?.name ?? "База не выбрана"}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">Мои базы данных</DropdownMenuLabel>
        {list.length === 0 && (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">Пока нет баз</div>
        )}
        {list.map((w) => (
          <DropdownMenuItem key={w.id} onClick={() => switchTo(w.id)} className="cursor-pointer">
            <Check className={`h-4 w-4 mr-2 ${w.id === activeId ? "opacity-100" : "opacity-0"}`} />
            <span className="truncate">{w.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/settings" search={{ tab: "workspaces" } as any} className="cursor-pointer">
            <Settings2 className="h-4 w-4 mr-2" />
            Управление базами
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}