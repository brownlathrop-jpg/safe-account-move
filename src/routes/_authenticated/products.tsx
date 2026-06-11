import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Folder, FolderPlus, FolderOpen, ChevronRight, ChevronDown } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Товары и услуги — КабинетCRM" }] }),
  component: ProductsPage,
});

type Product = {
  id: string; sku: string | null; name: string; unit: string;
  price: number; cost: number; stock: number; description: string | null;
  folder_id: string | null; kind: "product" | "service";
};

type FolderRow = { id: string; name: string; parent_id: string | null };

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const ALL = "__all";
const ROOT = "__root";
const KIND_PRODUCT = "__kind_product";
const KIND_SERVICE = "__kind_service";

function ProductsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folderDialog, setFolderDialog] = useState<{ open: boolean; parent_id: string | null; editing?: FolderRow }>({ open: false, parent_id: null });
  const [folderName, setFolderName] = useState("");

  const { data: products = [] } = useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase.from("products").select("*").order("name");
      if (error) throw error;
      return data as Product[];
    },
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["product_folders"],
    queryFn: async () => {
      const { data, error } = await supabase.from("product_folders").select("id,name,parent_id").order("name");
      if (error) throw error;
      return data as FolderRow[];
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: async () => {
      const { data, error } = await supabase.from("units").select("id,short_name").order("short_name");
      if (error) throw error;
      return (data ?? []) as { id: string; short_name: string }[];
    },
  });

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    folders.forEach(f => {
      const arr = map.get(f.parent_id) ?? [];
      arr.push(f); map.set(f.parent_id, arr);
    });
    return map;
  }, [folders]);

  const descendantsOf = (id: string): string[] => {
    const result: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      result.push(cur);
      (childrenOf.get(cur) ?? []).forEach(c => stack.push(c.id));
    }
    return result;
  };

  const upsert = useMutation({
    mutationFn: async (p: Partial<Product>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      const payload = {
        user_id: user.id,
        sku: p.sku || null,
        name: p.name!,
        unit: p.unit || "шт",
        price: Number(p.price ?? 0),
        cost: Number(p.cost ?? 0),
        stock: Number(p.stock ?? 0),
        description: p.description || null,
        folder_id: p.folder_id ?? null,
        kind: (p.kind ?? "product") as "product" | "service",
      };
      if (p.id) {
        const { error } = await supabase.from("products").update(payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("products").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["products"] });
      setOpen(false); setEditing(null);
      toast.success("Сохранено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveFolder = useMutation({
    mutationFn: async () => {
      const name = folderName.trim();
      if (!name) throw new Error("Введите название");
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (folderDialog.editing) {
        const { error } = await supabase.from("product_folders").update({ name }).eq("id", folderDialog.editing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("product_folders").insert({
          user_id: user.id, name, parent_id: folderDialog.parent_id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_folders"] });
      setFolderDialog({ open: false, parent_id: null });
      setFolderName("");
      toast.success("Сохранено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeFolder = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("product_folders").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["product_folders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      if (selectedFolder !== ALL && selectedFolder !== ROOT) setSelectedFolder(ALL);
      toast.success("Папка удалена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Folders shown as rows in the right pane (direct children of current folder)
  const rightFolders = useMemo(() => {
    if (search) return [];
    if (selectedFolder === ROOT || selectedFolder === KIND_PRODUCT || selectedFolder === KIND_SERVICE) return [];
    const parentId = selectedFolder === ALL ? null : selectedFolder;
    return childrenOf.get(parentId) ?? [];
  }, [selectedFolder, childrenOf, search]);

  // Products shown in the right pane
  const filtered = products.filter(p => {
    if (search) {
      const s = search.toLowerCase();
      return p.name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s);
    }
    if (selectedFolder === KIND_PRODUCT) return p.kind === "product";
    if (selectedFolder === KIND_SERVICE) return p.kind === "service";
    if (selectedFolder === ALL) return p.folder_id === null;
    if (selectedFolder === ROOT) return p.folder_id === null;
    return p.folder_id === selectedFolder;
  });

  const productCountIn = (folderId: string) => {
    const ids = new Set(descendantsOf(folderId));
    return products.filter(p => p.folder_id && ids.has(p.folder_id)).length;
  };

  const openNew = () => {
    const folder_id = selectedFolder === ALL || selectedFolder === ROOT || selectedFolder === KIND_PRODUCT || selectedFolder === KIND_SERVICE ? null : selectedFolder;
    const kind: "product" | "service" = selectedFolder === KIND_SERVICE ? "service" : "product";
    setEditing({ name: "", unit: kind === "service" ? "усл" : "шт", price: 0, cost: 0, stock: 0, folder_id, kind });
    setOpen(true);
  };
  const openEdit = (p: Product) => { setEditing(p); setOpen(true); };

  const renderFolderTree = (parentId: string | null, depth = 0) => {
    const list = childrenOf.get(parentId) ?? [];
    return list.map(f => {
      const hasChildren = (childrenOf.get(f.id) ?? []).length > 0;
      const isOpen = expanded[f.id] ?? true;
      const active = selectedFolder === f.id;
      return (
        <div key={f.id}>
          <div
            className={`group flex items-center gap-1 rounded-md text-sm cursor-pointer hover:bg-muted/60 ${active ? "bg-muted font-medium" : ""}`}
            style={{ paddingLeft: 8 + depth * 14, paddingRight: 4, paddingTop: 4, paddingBottom: 4 }}
            onClick={() => setSelectedFolder(f.id)}
          >
            <button
              type="button"
              className="h-4 w-4 flex items-center justify-center text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); setExpanded({ ...expanded, [f.id]: !isOpen }); }}
            >
              {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
            </button>
            {active ? <FolderOpen className="h-4 w-4 text-primary" /> : <Folder className="h-4 w-4 text-muted-foreground" />}
            <span className="truncate flex-1">{f.name}</span>
            <div className="opacity-0 group-hover:opacity-100 flex gap-0.5">
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Подпапка"
                onClick={(e) => { e.stopPropagation(); setFolderName(""); setFolderDialog({ open: true, parent_id: f.id }); }}>
                <FolderPlus className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Переименовать"
                onClick={(e) => { e.stopPropagation(); setFolderName(f.name); setFolderDialog({ open: true, parent_id: f.parent_id, editing: f }); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-6 w-6" title="Удалить"
                onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить папку "${f.name}"? Подпапки тоже будут удалены.`)) removeFolder.mutate(f.id); }}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          {hasChildren && isOpen && renderFolderTree(f.id, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Товары и услуги</h1>
          <p className="text-sm text-muted-foreground">Справочник с ценами, остатками и папками</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setFolderName(""); setFolderDialog({ open: true, parent_id: null }); }}>
            <FolderPlus className="h-4 w-4 mr-1" /> Добавить папку
          </Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-5">
        <Card className="p-3 h-fit">
          <div className="text-sm font-medium mb-2">Папки</div>
          <div className="space-y-0.5">
            <div className={`px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted/60 ${selectedFolder === ALL ? "bg-muted font-medium" : ""}`}
              onClick={() => setSelectedFolder(ALL)}>Все</div>
            <div className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted/60 ${selectedFolder === KIND_PRODUCT ? "bg-muted font-medium" : ""}`}
              onClick={() => setSelectedFolder(KIND_PRODUCT)}>
              <Folder className="h-4 w-4 text-muted-foreground" /> Товары
              <span className="ml-auto text-xs text-muted-foreground">{products.filter(p => p.kind === "product").length}</span>
            </div>
            <div className={`flex items-center gap-2 px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted/60 ${selectedFolder === KIND_SERVICE ? "bg-muted font-medium" : ""}`}
              onClick={() => setSelectedFolder(KIND_SERVICE)}>
              <Folder className="h-4 w-4 text-muted-foreground" /> Услуги
              <span className="ml-auto text-xs text-muted-foreground">{products.filter(p => p.kind === "service").length}</span>
            </div>
            <div className="pt-1">{renderFolderTree(null)}</div>
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="p-3 border-b flex items-center gap-2 text-sm">
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelectedFolder(ALL)}>Все товары</button>
            {(() => {
              if (selectedFolder === ALL || selectedFolder === ROOT) return null;
              const trail: FolderRow[] = [];
              let cur = folders.find(f => f.id === selectedFolder);
              while (cur) { trail.unshift(cur); cur = cur.parent_id ? folders.find(f => f.id === cur!.parent_id) : undefined; }
              return trail.map(f => (
                <span key={f.id} className="flex items-center gap-2">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  <button type="button" className="hover:text-primary font-medium" onClick={() => setSelectedFolder(f.id)}>{f.name}</button>
                </span>
              ));
            })()}
          </div>
          <div className="p-3 border-b flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input placeholder="Поиск по названию или артикулу" value={search} onChange={e => setSearch(e.target.value)} className="border-0 focus-visible:ring-0 shadow-none h-8" />
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Артикул</TableHead>
                <TableHead>Название</TableHead>
                <TableHead>Ед.</TableHead>
                <TableHead className="text-right">Себестоимость</TableHead>
                <TableHead className="text-right">Цена</TableHead>
                <TableHead className="text-right">Остаток</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rightFolders.length === 0 && filtered.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">Пусто</TableCell></TableRow>
              )}
              {rightFolders.map(f => (
                <TableRow key={f.id} className="cursor-pointer hover:bg-muted/40"
                  onClick={() => setSelectedFolder(f.id)}>
                  <TableCell className="text-muted-foreground"></TableCell>
                  <TableCell className="font-medium">
                    <span className="inline-flex items-center gap-2">
                      <Folder className="h-4 w-4 text-muted-foreground" />
                      {f.name}
                    </span>
                  </TableCell>
                  <TableCell colSpan={4} className="text-muted-foreground text-sm">
                    {productCountIn(f.id)} товаров
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setFolderName(f.name); setFolderDialog({ open: true, parent_id: f.parent_id, editing: f }); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); if (confirm(`Удалить папку "${f.name}"?`)) removeFolder.mutate(f.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-muted-foreground">{p.sku || "—"}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="text-right">{fmt.format(Number(p.cost))}</TableCell>
                  <TableCell className="text-right font-medium">{fmt.format(Number(p.price))}</TableCell>
                  <TableCell className="text-right">{Number(p.stock)}</TableCell>
                  <TableCell className="text-right">
                    <Button size="icon" variant="ghost" onClick={() => openEdit(p)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => { if (confirm(`Удалить "${p.name}"?`)) remove.mutate(p.id); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Редактировать товар или услугу" : "Новый товар или услуга"}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(editing); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input required value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Тип</Label>
                  <Select value={editing.kind ?? "product"} onValueChange={v => setEditing({ ...editing, kind: v as "product" | "service" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="product">Товар</SelectItem>
                      <SelectItem value="service">Услуга</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Артикул</Label>
                  <Input value={editing.sku ?? ""} onChange={e => setEditing({ ...editing, sku: e.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label>Единица</Label>
                  {units.length > 0 ? (
                    <Select
                      value={editing.unit ?? ""}
                      onValueChange={v => setEditing({ ...editing, unit: v })}
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите" /></SelectTrigger>
                      <SelectContent>
                        {/* show current value even if not in list */}
                        {editing.unit && !units.some(u => u.short_name === editing.unit) && (
                          <SelectItem value={editing.unit}>{editing.unit}</SelectItem>
                        )}
                        {units.map(u => <SelectItem key={u.id} value={u.short_name}>{u.short_name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input value={editing.unit ?? "шт"} onChange={e => setEditing({ ...editing, unit: e.target.value })} placeholder="Добавьте в Настройках → Справочники" />
                  )}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label>Себестоимость</Label>
                  <Input type="number" step="0.01" value={editing.cost ?? 0} onChange={e => setEditing({ ...editing, cost: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Цена продажи</Label>
                  <Input type="number" step="0.01" value={editing.price ?? 0} onChange={e => setEditing({ ...editing, price: Number(e.target.value) })} />
                </div>
                <div className="space-y-2">
                  <Label>Начальный остаток</Label>
                  <Input type="number" step="0.001" value={editing.stock ?? 0} onChange={e => setEditing({ ...editing, stock: Number(e.target.value) })} disabled={!!editing.id} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Описание</Label>
                <Textarea rows={2} value={editing.description ?? ""} onChange={e => setEditing({ ...editing, description: e.target.value })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button>
                <Button type="submit" disabled={upsert.isPending}>Сохранить</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={folderDialog.open} onOpenChange={(v) => setFolderDialog({ ...folderDialog, open: v })}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{folderDialog.editing ? "Переименовать папку" : "Новая папка"}</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); saveFolder.mutate(); }} className="space-y-4">
            <Input autoFocus placeholder="Название папки" value={folderName} onChange={e => setFolderName(e.target.value)} />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setFolderDialog({ open: false, parent_id: null })}>Отмена</Button>
              <Button type="submit" disabled={saveFolder.isPending}>Сохранить</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
