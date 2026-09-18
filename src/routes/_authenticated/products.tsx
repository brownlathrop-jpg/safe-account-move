import { createFileRoute } from "@tanstack/react-router";
// Кнопки «Excel» и «Печать» выгружают весь отфильтрованный список, не только текущую страницу.
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState, type DragEvent } from "react";
import { toast } from "sonner";
import { db } from "@/integrations/db";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Pencil, Trash2, Search, Folder, FolderPlus, FolderOpen, ChevronRight, ChevronDown, Upload, X, ImageIcon, MoreHorizontal, Download, Printer } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useActiveWorkspaceId } from "@/lib/workspace";
import { downloadCsv, type CsvColumn } from "@/lib/export-csv";
import { printList } from "@/lib/print-list";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { usePriceTypes, useMyPriceTypeId, priceOf } from "@/lib/price-types";


export const Route = createFileRoute("/_authenticated/products")({
  head: () => ({ meta: [{ title: "Товары и услуги — КабинетCRM" }] }),
  component: ProductsPage,
  errorComponent: ({ error }: { error: Error }) => (
    <div className="p-6 space-y-2">
      <h1 className="text-lg font-semibold">Не удалось открыть список товаров</h1>
      <p className="text-sm text-muted-foreground">{error?.message ?? "Неизвестная ошибка"}</p>
      <Button onClick={() => window.location.reload()}>Обновить</Button>
    </div>
  ),
});


type Product = {
  id: string; sku: string | null; name: string; unit: string;
  price: number; cost: number; stock: number; description: string | null;
  folder_id: string | null; kind: "product" | "service"; image_url: string | null;
  is_service?: boolean;
  vat_rate?: string | null;
  product_type_id?: string | null;
  prices?: Record<string, number> | null;
};

type FolderRow = { id: string; name: string; parent_id: string | null };
type FolderKind = "product" | "service";
type FolderDialogState = { open: boolean; parent_id: string | null; parentKind?: FolderKind; editing?: FolderRow };

const fmt = new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" });
const ALL = "__all";
const ROOT = "__root";
const KIND_PRODUCT = "__kind_product";
const KIND_SERVICE = "__kind_service";
const PRODUCT_ROOT_NAME = "Товары";
const SERVICE_ROOT_NAME = "Услуги";

function ProductsPage() {
  const qc = useQueryClient();
  const wsId = useActiveWorkspaceId();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  const [open, setOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [zoomImage, setZoomImage] = useState<string | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>(ALL);
  const selectedFolderRef = useRef<string>(ALL);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [folderDialog, setFolderDialog] = useState<FolderDialogState>({ open: false, parent_id: null });
  const [folderName, setFolderName] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState<string>(ROOT);
  const lastClickedRef = useRef<string | null>(null);
  const dragIdsRef = useRef<string[]>([]);
  const dragFolderIdsRef = useRef<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);
  const lastFolderClickRef = useRef<string | null>(null);

  const [dropFolder, setDropFolder] = useState<string | null>(null);
  const [deleteFolder, setDeleteFolder] = useState<FolderRow | null>(null);
  const [deleteManyOpen, setDeleteManyOpen] = useState(false);
  const [page, setPage] = useState(0);


  const { data: products = [] } = useQuery({
    queryKey: ["products", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const all: Product[] = [];
      const step = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await (db as any)
          .from("products").select("*").eq("workspace_id", wsId)
          .order("name").range(from, from + step - 1);
        if (error) throw error;
        const chunk = (data ?? []) as unknown as Product[];
        all.push(...chunk);
        if (chunk.length < step) break;
        from += step;
      }
      return all;
    },
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["product_folders", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const all: FolderRow[] = [];
      const step = 1000;
      let from = 0;
      for (;;) {
        const { data, error } = await (db as any)
          .from("product_folders").select("id,name,parent_id").eq("workspace_id", wsId)
          .order("name").range(from, from + step - 1);
        if (error) throw error;
        const chunk = (data ?? []) as FolderRow[];
        all.push(...chunk);
        if (chunk.length < step) break;
        from += step;
      }
      return all;
    },
  });

  const { data: units = [] } = useQuery({
    queryKey: ["units", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any).from("units").select("id,short_name").eq("workspace_id", wsId).order("short_name");
      if (error) throw error;
      return (data ?? []) as { id: string; short_name: string }[];
    },
  });

  const { data: productTypes = [] } = useQuery({
    queryKey: ["product_types", wsId],
    enabled: !!wsId,
    queryFn: async () => {
      const { data, error } = await (db as any).from("product_types")
        .select("id,name,is_service").eq("workspace_id", wsId).order("name");
      if (error) throw error;
      return (data ?? []) as { id: string; name: string; is_service: boolean }[];
    },
  });

  const { data: priceTypes = [] } = usePriceTypes(wsId);
  const myPriceTypeId = useMyPriceTypeId(wsId);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    const ids = new Set(folders.map(f => f.id));
    folders.forEach(f => {
      // защита от битых ссылок: папка не может быть родителем сама себе,
      // а ссылка на несуществующую папку считается корневой
      const parent = f.parent_id && f.parent_id !== f.id && ids.has(f.parent_id) ? f.parent_id : null;
      const arr = map.get(parent) ?? [];
      arr.push(f); map.set(parent, arr);
    });
    return map;
  }, [folders]);


  const folderIds = useMemo(() => new Set(folders.map(f => f.id)), [folders]);
  const productRootFolder = useMemo(() => folders.find(f => f.parent_id === null && f.name.trim().toLowerCase() === PRODUCT_ROOT_NAME.toLowerCase()) ?? null, [folders]);
  const serviceRootFolder = useMemo(() => folders.find(f => f.parent_id === null && f.name.trim().toLowerCase() === SERVICE_ROOT_NAME.toLowerCase()) ?? null, [folders]);
  const virtualRootIds = useMemo(() => new Set([productRootFolder?.id, serviceRootFolder?.id].filter(Boolean) as string[]), [productRootFolder?.id, serviceRootFolder?.id]);
  const rootFolders = childrenOf.get(null) ?? [];
  const visibleRootFolders = rootFolders.filter(f => !virtualRootIds.has(f.id));
  const productCategoryFolders = [...(productRootFolder ? childrenOf.get(productRootFolder.id) ?? [] : []), ...visibleRootFolders];
  const serviceCategoryFolders = serviceRootFolder ? childrenOf.get(serviceRootFolder.id) ?? [] : [];
  const selectFolder = (id: string) => {
    selectedFolderRef.current = id;
    setSelectedFolder(id);
    setPage(0);
  };
  const getSelectedRealFolderId = () => folderIds.has(selectedFolderRef.current) ? selectedFolderRef.current : null;
  const getNewFolderTarget = (): { parent_id: string | null; parentKind?: FolderKind } => {
    const parent_id = getSelectedRealFolderId();
    if (parent_id) return { parent_id };
    if (selectedFolderRef.current === KIND_PRODUCT) return { parent_id: productRootFolder?.id ?? null, parentKind: "product" };
    if (selectedFolderRef.current === KIND_SERVICE) return { parent_id: serviceRootFolder?.id ?? null, parentKind: "service" };
    return { parent_id: null };
  };

  const descendantsOf = (id: string): string[] => {
    const result: string[] = [];
    const seen = new Set<string>();
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      result.push(cur);
      (childrenOf.get(cur) ?? []).forEach(c => stack.push(c.id));
    }
    return result;
  };


  const upsert = useMutation({
    mutationFn: async (p: Partial<Product>) => {
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      // Цены по типам; основная цена = цена типа «по умолчанию» (для совместимости).
      const prices: Record<string, number> = {};
      for (const t of priceTypes) {
        const v = Number((p.prices ?? {})[t.id] ?? 0);
        if (!Number.isNaN(v)) prices[t.id] = v;
      }
      const baseTypeId = priceTypes.find(t => t.is_default)?.id ?? null;
      const basePrice = baseTypeId && prices[baseTypeId] != null ? prices[baseTypeId] : Number(p.price ?? 0);
      const payload = {
        user_id: user.id,
        workspace_id: wsId,
        sku: p.sku || null,
        name: p.name!,
        unit: p.unit || "шт",
        price: Number(basePrice ?? 0),
        prices,
        cost: Number(p.cost ?? 0),
        stock: Number(p.stock ?? 0),
        description: p.description || null,
        folder_id: p.folder_id ?? null,
        kind: (p.kind ?? "product") as "product" | "service",
        image_url: p.image_url ?? null,
        is_service: (p.kind ?? "product") === "service",
        vat_rate: p.vat_rate || "none",
        product_type_id: p.product_type_id ?? null,
      };
      if (p.id) {
        const { error } = await db.from("products").update(payload as never).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await db.from("products").insert(payload as never);
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
      const { error } = await db.from("products").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["products"] }); toast.success("Удалено"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMany = useMutation({
    mutationFn: async ({ productIds, folderIds }: { productIds: string[]; folderIds: string[] }) => {
      if (!productIds.length && !folderIds.length) throw new Error("Ничего не выбрано");
      // Удаляем папки рекурсивно: потомки + содержимое.
      const allFolderIds = new Set<string>();
      folderIds.forEach(id => descendantsOf(id).forEach(d => allFolderIds.add(d)));
      if (allFolderIds.size) {
        const folderIdList = [...allFolderIds];
        const { error: prodErr } = await db.from("products").delete().in("folder_id", folderIdList);
        if (prodErr) throw prodErr;
        const { error: foldErr } = await db.from("product_folders").delete().in("id", folderIdList);
        if (foldErr) throw foldErr;
      }
      if (productIds.length) {
        const { error } = await db.from("products").delete().in("id", productIds);
        if (error) throw error;
      }
      return { productIds, folderIds: [...allFolderIds] };
    },
    onSuccess: ({ productIds, folderIds }) => {
      const goneFolders = new Set(folderIds);
      const goneProducts = new Set(productIds);
      qc.setQueryData(["product_folders", wsId], (old?: FolderRow[]) =>
        old ? old.filter(f => !goneFolders.has(f.id)) : old);
      qc.setQueryData(["products", wsId], (old?: Product[]) =>
        old ? old.filter(p => !goneProducts.has(p.id) && !(p.folder_id && goneFolders.has(p.folder_id))) : old);
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["product_folders"] });
      if (selectedFolder !== ALL && selectedFolder !== ROOT && goneFolders.has(selectedFolder)) {
        setSelectedFolder(ALL);
      }
      setSelectedIds([]);
      setSelectedFolderIds([]);
      setDeleteManyOpen(false);
      toast.success("Удалено");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveFolder = useMutation({
    mutationFn: async () => {
      const name = folderName.trim();
      if (!name) throw new Error("Введите название");
      const { data: { user } } = await db.auth.getUser();
      if (!user) throw new Error("Нет сессии");
      if (!wsId) throw new Error("Не выбрана база данных");
      if (folderDialog.editing) {
        const { error } = await db.from("product_folders").update({ name }).eq("id", folderDialog.editing.id);
        if (error) throw error;
      } else {
        let parent_id = folderDialog.parent_id;
        if (!parent_id && folderDialog.parentKind) {
          const rootName = folderDialog.parentKind === "service" ? SERVICE_ROOT_NAME : PRODUCT_ROOT_NAME;
          const existingRoot = folderDialog.parentKind === "service" ? serviceRootFolder : productRootFolder;
          if (existingRoot) {
            parent_id = existingRoot.id;
          } else {
            const { data: rootFolder, error: rootError } = await (db as any)
              .from("product_folders")
              .insert({ user_id: user.id, workspace_id: wsId, name: rootName, parent_id: null })
              .select("id,name,parent_id")
              .single();
            if (rootError) throw rootError;
            parent_id = rootFolder.id;
          }
        }
        const { error } = await (db as any).from("product_folders").insert({
          user_id: user.id, workspace_id: wsId, name, parent_id,
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
      const folderIdsToDelete = descendantsOf(id);
      // Удаляем одним массовым запросом вместо поштучного перебора.
      const { error: prodErr } = await db.from("products").delete().in("folder_id", folderIdsToDelete);
      if (prodErr) throw prodErr;
      const { error: foldErr } = await db.from("product_folders").delete().in("id", folderIdsToDelete);
      if (foldErr) throw foldErr;
      return folderIdsToDelete;
    },
    onSuccess: (folderIdsToDelete: string[]) => {
      const gone = new Set(folderIdsToDelete);
      // Сразу убираем удалённое из кэша, чтобы список не ждал ответа сервера.
      qc.setQueryData(["product_folders", wsId], (old?: FolderRow[]) =>
        old ? old.filter((f) => !gone.has(f.id)) : old);
      qc.setQueryData(["products", wsId], (old?: Product[]) =>
        old ? old.filter((p) => !(p.folder_id && gone.has(p.folder_id))) : old);
      qc.invalidateQueries({ queryKey: ["product_folders"] });
      qc.invalidateQueries({ queryKey: ["products"] });
      if (selectedFolder !== ALL && selectedFolder !== ROOT) setSelectedFolder(ALL);
      setDeleteFolder(null);
      setSelectedFolderIds([]);
      toast.success("Папка и её содержимое удалены");
    },
    onError: (e: Error) => toast.error(e.message),
  });


  // Folders shown as rows in the right pane (direct children of current folder)
  const rightFolders = useMemo(() => {
    if (search) return [];
    if (selectedFolder === KIND_PRODUCT) return productCategoryFolders;
    if (selectedFolder === KIND_SERVICE) return serviceCategoryFolders;
    if (selectedFolder === ROOT) return visibleRootFolders;
    if (selectedFolder === ALL) return visibleRootFolders;
    return childrenOf.get(selectedFolder) ?? [];
  }, [selectedFolder, childrenOf, search, productCategoryFolders, serviceCategoryFolders, visibleRootFolders]);

  // Products shown in the right pane
  const PAGE_SIZE = 50;
  const filtered = products.filter(p => {
    if (search) {
      const s = search.toLowerCase();
      return p.name.toLowerCase().includes(s) || (p.sku ?? "").toLowerCase().includes(s);
    }
    if (selectedFolder === KIND_PRODUCT) return p.kind === "product";
    if (selectedFolder === KIND_SERVICE) return p.kind === "service";
    if (selectedFolder === ALL) return true;
    if (selectedFolder === ROOT) return p.folder_id === null;
    if (folderIds.has(selectedFolder)) {
      const ids = new Set(descendantsOf(selectedFolder));
      return !!p.folder_id && ids.has(p.folder_id);
    }
    return p.folder_id === selectedFolder;
  });

  // Постраничный показ: длинные списки не рендерим целиком.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const listColumns = (): CsvColumn<Product>[] => {
    const folderName = new Map((folders as FolderRow[]).map(f => [f.id, f.name]));
    return [
      { header: "Артикул", value: p => p.sku },
      { header: "Название", value: p => p.name },
      { header: "Папка", value: p => (p.folder_id ? folderName.get(p.folder_id) ?? "" : "") },
      { header: "Вид", value: p => (p.kind === "service" ? "Услуга" : "Товар") },
      { header: "Ед.", value: p => p.unit },
      { header: "Цена", value: p => priceOf(p, myPriceTypeId) },
      { header: "Себестоимость", value: p => Number(p.cost || 0) },
      { header: "Остаток", value: p => Number(p.stock || 0) },
      { header: "НДС", value: p => p.vat_rate ?? "" },
      { header: "Описание", value: p => p.description },
    ];
  };
  const exportCsv = () => downloadCsv("товары", filtered, listColumns());
  const printProducts = () => printList("Товары и услуги", filtered, listColumns());


  const productCountIn = (folderId: string) => {
    const ids = new Set(descendantsOf(folderId));
    return products.filter(p => p.folder_id && ids.has(p.folder_id)).length;
  };

  // Плоский список папок с путём — для выбора папки при переносе
  const folderOptions = useMemo(() => {
    const out: { id: string; label: string }[] = [];
    const seen = new Set<string>();
    const walk = (parentId: string | null, prefix: string) => {
      for (const f of childrenOf.get(parentId) ?? []) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
        const label = prefix ? `${prefix} / ${f.name}` : f.name;
        out.push({ id: f.id, label });
        walk(f.id, label);
      }
    };
    walk(null, "");
    return out.sort((a, b) => a.label.localeCompare(b.label, "ru"));
  }, [childrenOf]);


  // Клик с Shift выделяет всё между предыдущим и текущим товаром.
  const toggleSelected = (id: string, shift = false) => {
    setSelectedIds(prev => {
      if (shift && lastClickedRef.current) {
        const list = filtered.map(p => p.id);
        const a = list.indexOf(lastClickedRef.current);
        const b = list.indexOf(id);
        if (a !== -1 && b !== -1) {
          const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
          const merged = new Set([...prev, ...range]);
          lastClickedRef.current = id;
          return [...merged];
        }
      }
      lastClickedRef.current = id;
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
  };

  // Клик с Shift выделяет все папки между предыдущей и текущей.
  const toggleFolderSelected = (id: string, shift = false) => {
    setSelectedFolderIds(prev => {
      if (shift && lastFolderClickRef.current) {
        const list = rightFolders.map(f => f.id);
        const a = list.indexOf(lastFolderClickRef.current);
        const b = list.indexOf(id);
        if (a !== -1 && b !== -1) {
          const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
          lastFolderClickRef.current = id;
          return [...new Set([...prev, ...range])];
        }
      }
      lastFolderClickRef.current = id;
      return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
    });
  };

  const moveProducts = useMutation({
    mutationFn: async ({ ids, folderId }: { ids: string[]; folderId: string | null }) => {
      if (!ids.length) throw new Error("Не выбраны товары");
      // Один массовый запрос вместо поштучного перебора.
      const { error } = await db.from("products").update({ folder_id: folderId } as never).in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ["products"] });
      toast.success(`Перенесено: ${count}`);
      setSelectedIds([]);
      setMoveOpen(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const moveFolders = useMutation({
    mutationFn: async ({ ids, parentId }: { ids: string[]; parentId: string | null }) => {
      if (!ids.length) throw new Error("Не выбраны папки");
      const { error } = await db.from("product_folders").update({ parent_id: parentId } as never).in("id", ids);
      if (error) throw error;
      return { ids, parentId };
    },
    onSuccess: ({ ids, parentId }) => {
      const moved = new Set(ids);
      qc.setQueryData(["product_folders", wsId], (old?: FolderRow[]) =>
        old ? old.map(f => (moved.has(f.id) ? { ...f, parent_id: parentId } : f)) : old);
      qc.invalidateQueries({ queryKey: ["product_folders"] });
      setSelectedFolderIds([]);
      toast.success(ids.length > 1 ? `Перенесено папок: ${ids.length}` : "Папка перенесена");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Папки, запрещённые как приёмник для перетаскиваемых папок (сами себя и своё содержимое).
  const forbiddenTargets = (draggedFolders: string[]) => {
    const set = new Set<string>();
    draggedFolders.forEach(id => descendantsOf(id).forEach(d => set.add(d)));
    return set;
  };

  const dropOnFolder = (folderId: string | null) => {
    const draggedFolders = dragFolderIdsRef.current;
    dragFolderIdsRef.current = [];
    setDropFolder(null);
    if (draggedFolders.length) {
      const forbidden = forbiddenTargets(draggedFolders);
      if (folderId && forbidden.has(folderId)) {
        toast.error("Нельзя перенести папку внутрь самой себя");
        return;
      }
      const ids = draggedFolders.filter(id => {
        const cur = folders.find(f => f.id === id);
        return cur && (cur.parent_id ?? null) !== folderId;
      });
      if (!ids.length) return;
      moveFolders.mutate({ ids, parentId: folderId });
      return;
    }
    const ids = dragIdsRef.current.length ? dragIdsRef.current : selectedIds;
    dragIdsRef.current = [];
    if (!ids.length) return;
    moveProducts.mutate({ ids, folderId });
  };

  // Свойства для папки-приёмника при перетаскивании товаров или папок.
  const dropProps = (folderId: string | null, key: string) => ({
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      const dragged = dragFolderIdsRef.current;
      const forbidden = dragged.length > 0 && !!folderId && forbiddenTargets(dragged).has(folderId);
      e.dataTransfer.dropEffect = forbidden ? "none" : "move";
      setDropFolder(forbidden ? null : key);
    },
    onDragLeave: () => setDropFolder(cur => (cur === key ? null : cur)),
    onDrop: (e: DragEvent) => { e.preventDefault(); e.stopPropagation(); dropOnFolder(folderId); },
  });

  // Свойства для перетаскиваемой папки: если папка отмечена, тянутся все отмеченные.
  const folderDragProps = (folderId: string) => ({
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation();
      dragFolderIdsRef.current = selectedFolderIds.includes(folderId) ? selectedFolderIds : [folderId];
      dragIdsRef.current = [];
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragFolderIdsRef.current.join(","));
    },
    onDragEnd: () => { dragFolderIdsRef.current = []; setDropFolder(null); },
  });


  const openNew = () => {
    const folder_id = getSelectedRealFolderId();
    const kind: "product" | "service" = selectedFolder === KIND_SERVICE ? "service" : "product";
    setEditing({ name: "", unit: kind === "service" ? "усл" : "шт", price: 0, cost: 0, stock: 0, folder_id, kind, image_url: null });
    setOpen(true);
  };
  const openEdit = (p: Product) => { setEditing(p); setOpen(true); };

  const openFolderDialog = (parent_id: string | null, editingFolder?: FolderRow, parentKind?: FolderKind) => {
    setFolderName(editingFolder?.name ?? "");
    setFolderDialog({ open: true, parent_id, editing: editingFolder, parentKind });
  };

  const renderFolderTree = (parentId: string | null, depth = 0, overrideList?: FolderRow[]) => {
    if (depth > 20) return null;
    const list = overrideList ?? childrenOf.get(parentId) ?? [];

    return list.map(f => {
      const hasChildren = (childrenOf.get(f.id) ?? []).length > 0;
      const isOpen = expanded[f.id] ?? true;
      const active = selectedFolder === f.id;
      return (
        <div key={f.id}>
          <div
            className={`group flex items-start gap-1 rounded-md text-sm cursor-pointer hover:bg-muted/60 ${active ? "bg-muted font-medium" : ""} ${dropFolder === f.id ? "ring-2 ring-primary bg-primary/10" : ""}`}
            style={{ paddingLeft: 6 + depth * 12, paddingRight: 4, paddingTop: 4, paddingBottom: 4 }}
            onClick={() => selectFolder(f.id)}
            title={f.name}
            {...dropProps(f.id, f.id)}
            {...folderDragProps(f.id)}

          >
            <button
              type="button"
              className="h-4 w-4 mt-0.5 shrink-0 flex items-center justify-center text-muted-foreground"
              onClick={(e) => { e.stopPropagation(); setExpanded({ ...expanded, [f.id]: !isOpen }); }}
            >
              {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
            </button>
            {active ? <FolderOpen className="h-4 w-4 mt-0.5 shrink-0 text-primary" /> : <Folder className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
            <span className={`flex-1 min-w-0 leading-snug ${active ? "whitespace-normal break-words" : "truncate"}`}>{f.name}</span>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100">
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={() => openFolderDialog(f.id)}>
                  <FolderPlus className="h-4 w-4 mr-2" /> Добавить подпапку
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openFolderDialog(f.parent_id, f)}>
                  <Pencil className="h-4 w-4 mr-2" /> Переименовать
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteFolder(f)}
                >
                  <Trash2 className="h-4 w-4 mr-2" /> Удалить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {hasChildren && isOpen && renderFolderTree(f.id, depth + 1)}
        </div>
      );
    });
  };

  const renderKindRoot = (id: typeof KIND_PRODUCT | typeof KIND_SERVICE, label: string, count: number, list: FolderRow[]) => {
    const active = selectedFolder === id;
    const isOpen = expanded[id] ?? true;
    const hasChildren = list.length > 0;
    return (
      <div>
        <div
          className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted/60 ${active ? "bg-muted font-medium" : ""}`}
          onClick={() => selectFolder(id)}
        >
          <button
            type="button"
            className="h-4 w-4 shrink-0 flex items-center justify-center text-muted-foreground"
            onClick={(e) => { e.stopPropagation(); setExpanded({ ...expanded, [id]: !isOpen }); }}
          >
            {hasChildren ? (isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />) : null}
          </button>
          {active ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />}
          <span className="flex-1 min-w-0 truncate">{label}</span>
          <span className="text-xs text-muted-foreground shrink-0">{count}</span>
        </div>
        {hasChildren && isOpen && renderFolderTree(null, 1, list)}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Товары и услуги</h1>
          <p className="text-sm text-muted-foreground">Справочник с ценами, остатками и папками</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length} title="Выгрузить в Excel">
            <Download className="h-4 w-4 mr-1" /> Excel
          </Button>
          <Button variant="outline" onClick={printProducts} disabled={!filtered.length} title="Печать списка / сохранить в PDF">
            <Printer className="h-4 w-4 mr-1" /> Печать
          </Button>
          <Button variant="outline" onClick={() => {
            const target = getNewFolderTarget();
            openFolderDialog(target.parent_id, undefined, target.parentKind);
          }}>
            <FolderPlus className="h-4 w-4 mr-1" /> Добавить папку
          </Button>
          <Button onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Добавить</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(280px,340px)_1fr] xl:grid-cols-[minmax(320px,380px)_1fr] gap-5">
        <Card className="p-3 h-fit md:sticky md:top-4 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto">
          <div className="text-sm font-medium mb-2 px-1">Папки</div>
          <div className="space-y-0.5 min-w-0">
            <div className={`px-2 py-1.5 text-sm rounded-md cursor-pointer hover:bg-muted/60 ${selectedFolder === ALL ? "bg-muted font-medium" : ""}`}
              onClick={() => selectFolder(ALL)}>Все</div>
            {renderKindRoot(KIND_PRODUCT, PRODUCT_ROOT_NAME, products.filter(p => p.kind === "product").length, productCategoryFolders)}
            {renderKindRoot(KIND_SERVICE, SERVICE_ROOT_NAME, products.filter(p => p.kind === "service").length, serviceCategoryFolders)}
          </div>
        </Card>

        <Card className="p-0 overflow-hidden">
          <div className="p-3 border-b flex items-center gap-2 text-sm">
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => selectFolder(ALL)}>Все товары</button>
            {(() => {
              if (selectedFolder === ALL || selectedFolder === ROOT) return null;
              if (selectedFolder === KIND_PRODUCT || selectedFolder === KIND_SERVICE) {
                return (
                  <span className="flex items-center gap-2">
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="font-medium">{selectedFolder === KIND_PRODUCT ? PRODUCT_ROOT_NAME : SERVICE_ROOT_NAME}</span>
                  </span>
                );
              }
              const trail: FolderRow[] = [];
              let cur = folders.find(f => f.id === selectedFolder);
              while (cur) {
                if (!virtualRootIds.has(cur.id)) trail.unshift(cur);
                cur = cur.parent_id ? folders.find(f => f.id === cur!.parent_id) : undefined;
              }
              return trail.map(f => (
                <span key={f.id} className="flex items-center gap-2">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                   <button type="button" className="hover:text-primary font-medium" onClick={() => selectFolder(f.id)}>{f.name}</button>
                </span>
              ));
            })()}
          </div>
          <div className="p-3 border-b flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input placeholder="Поиск по названию или артикулу" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} className="border-0 focus-visible:ring-0 shadow-none h-8" />
          </div>
          {(selectedIds.length > 0 || selectedFolderIds.length > 0) && (
            <div className="p-3 border-b flex items-center gap-3 bg-muted/40 text-sm">
              <span>
                Выбрано:{" "}
                {[selectedFolderIds.length ? `папок — ${selectedFolderIds.length}` : null,
                  selectedIds.length ? `товаров — ${selectedIds.length}` : null].filter(Boolean).join(", ")}
              </span>
              <Button size="sm" variant="outline" onClick={() => { setMoveTarget(getSelectedRealFolderId() ?? ROOT); setMoveOpen(true); }}>
                <FolderOpen className="h-4 w-4 mr-1" /> Перенести в папку
              </Button>
              <Button size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => setDeleteManyOpen(true)}>
                <Trash2 className="h-4 w-4 mr-1" /> Удалить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setSelectedIds([]); setSelectedFolderIds([]); }}>Снять выделение</Button>
              <span className="text-xs text-muted-foreground ml-auto hidden md:inline">
                Можно перетащить все выбранные строки на папку. Shift+клик — выбрать диапазон.
              </span>
            </div>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={(filtered.length > 0 || rightFolders.length > 0)
                      && filtered.every(p => selectedIds.includes(p.id))
                      && rightFolders.every(f => selectedFolderIds.includes(f.id))}
                    onCheckedChange={(v) => {
                      setSelectedIds(v ? filtered.map(p => p.id) : []);
                      setSelectedFolderIds(v ? rightFolders.map(f => f.id) : []);
                    }}
                  />
                </TableHead>
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
                <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-10">Пусто</TableCell></TableRow>
              )}
              {rightFolders.map(f => (
                <TableRow
                  key={f.id}
                  data-state={selectedFolderIds.includes(f.id) ? "selected" : undefined}
                  className={`cursor-pointer hover:bg-muted/40 ${dropFolder === `row-${f.id}` ? "bg-primary/10" : ""}`}
                  onClick={() => selectFolder(f.id)}
                  {...dropProps(f.id, `row-${f.id}`)}
                  {...folderDragProps(f.id)}

                >
                  <TableCell onClick={(e) => { e.stopPropagation(); toggleFolderSelected(f.id, e.shiftKey); }}>
                    <Checkbox checked={selectedFolderIds.includes(f.id)} onCheckedChange={() => {}} />
                  </TableCell>
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
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openFolderDialog(f.parent_id, f); }}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setDeleteFolder(f); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {pageItems.map(p => (
                <TableRow
                  key={p.id}
                  data-state={selectedIds.includes(p.id) ? "selected" : undefined}
                  draggable
                  onDragStart={(e) => {
                    dragIdsRef.current = selectedIds.includes(p.id) ? selectedIds : [p.id];
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", dragIdsRef.current.join(","));
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <TableCell onClick={(e) => { e.stopPropagation(); toggleSelected(p.id, e.shiftKey); }}>
                    <Checkbox checked={selectedIds.includes(p.id)} onCheckedChange={() => {}} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{p.sku || "—"}</TableCell>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{p.unit}</TableCell>
                  <TableCell className="text-right">{fmt.format(Number(p.cost))}</TableCell>
                  <TableCell className="text-right font-medium">{fmt.format(priceOf(p, myPriceTypeId))}</TableCell>
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
          {filtered.length > PAGE_SIZE && (
            <div className="p-3 border-t flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Показаны {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} из {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="outline" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>Назад</Button>
                <span className="px-2 text-muted-foreground">{safePage + 1} / {pageCount}</span>
                <Button size="sm" variant="outline" disabled={safePage >= pageCount - 1} onClick={() => setPage(safePage + 1)}>Вперёд</Button>
              </div>
            </div>
          )}
        </Card>
      </div>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Перенести в папку ({selectedFolderIds.length + selectedIds.length})</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Папка</Label>
            <Select value={moveTarget} onValueChange={setMoveTarget}>
              <SelectTrigger><SelectValue placeholder="Выберите папку" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value={ROOT}>Без папки</SelectItem>
                {folderOptions.map(o => <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveOpen(false)}>Отмена</Button>
            <Button
              onClick={() => {
                const target = moveTarget === ROOT ? null : moveTarget;
                if (selectedFolderIds.length) {
                  const forbidden = forbiddenTargets(selectedFolderIds);
                  if (target && forbidden.has(target)) {
                    toast.error("Нельзя перенести папку внутрь самой себя");
                    return;
                  }
                  moveFolders.mutate({ ids: selectedFolderIds, parentId: target });
                }
                if (selectedIds.length) moveProducts.mutate({ ids: selectedIds, folderId: target });
                setMoveOpen(false);
              }}
              disabled={moveProducts.isPending || moveFolders.isPending}
            >Перенести</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editing?.id ? "Редактировать товар или услугу" : "Новый товар или услуга"}</DialogTitle></DialogHeader>
          {editing && (
            <form onSubmit={(e) => { e.preventDefault(); upsert.mutate(editing); }} className="space-y-4">
              <div className="space-y-2">
                <Label>Название *</Label>
                <Input required value={editing.name ?? ""} onChange={e => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Фото</Label>
                <div className="flex items-center gap-3">
                  <div
                    className={`h-20 w-20 rounded-md border bg-muted/40 flex items-center justify-center overflow-hidden shrink-0 ${editing.image_url ? "cursor-zoom-in" : ""}`}
                    onClick={() => { if (editing?.image_url) setZoomImage(editing.image_url); }}
                    title={editing.image_url ? "Открыть фото" : undefined}
                  >
                    {editing.image_url ? (
                      <img src={editing.image_url} alt="" className="max-h-full max-w-full object-contain" />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className="inline-flex items-center gap-2 text-sm cursor-pointer px-3 h-8 rounded-md border hover:bg-accent">
                      <Upload className="h-4 w-4" />
                      {uploadingImage ? "Загрузка…" : "Загрузить"}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={uploadingImage}
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (!file) return;
                          try {
                            setUploadingImage(true);
                            const { data: { user } } = await db.auth.getUser();
                            if (!user) throw new Error("Нет сессии");
                            const ext = file.name.split(".").pop() || "jpg";
                            const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
                            const { error: upErr } = await db.storage.from("product-images").upload(path, file, { contentType: file.type });
                            if (upErr) throw upErr;
                            const { data: pub } = await db.storage.from("product-images").getUrl(path);
                            setEditing(cur => cur ? { ...cur, image_url: pub.publicUrl } : cur);
                          } catch (err) {
                            toast.error(err instanceof Error ? err.message : "Ошибка загрузки");
                          } finally {
                            setUploadingImage(false);
                          }
                        }}
                      />
                    </label>
                    {editing.image_url && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => setEditing({ ...editing, image_url: null })}
                      >
                        <X className="h-3 w-3" /> Убрать фото
                      </button>
                    )}
                  </div>
                </div>
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
                {priceTypes.length === 0 && (
                  <div className="space-y-2">
                    <Label>Цена продажи</Label>
                    <Input type="number" step="0.01" value={editing.price ?? 0} onChange={e => setEditing({ ...editing, price: Number(e.target.value) })} />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Начальный остаток</Label>
                  <Input type="number" step="0.001" value={editing.stock ?? 0} onChange={e => setEditing({ ...editing, stock: Number(e.target.value) })} disabled={!!editing.id} />
                </div>
              </div>
              {priceTypes.length > 0 && (
                <div className="space-y-2">
                  <Label>Цены по типам</Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    {priceTypes.map(t => (
                      <div key={t.id} className="space-y-1">
                        <Label className="text-xs font-normal text-muted-foreground">
                          {t.name}{t.is_default ? " (основной)" : ""}
                        </Label>
                        <Input
                          type="number" step="0.01"
                          value={(editing.prices ?? {})[t.id] ?? (t.is_default ? Number(editing.price ?? 0) : 0)}
                          onChange={e => setEditing({
                            ...editing,
                            prices: { ...(editing.prices ?? {}), [t.id]: Number(e.target.value) },
                          })}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Типы цен добавляются в Настройках → Справочники. В документы подставляется тип цены, выбранный пользователем.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Вид номенклатуры</Label>
                  <Select value={editing.product_type_id ?? "__none"} onValueChange={v => setEditing({ ...editing, product_type_id: v === "__none" ? null : v })}>
                    <SelectTrigger><SelectValue placeholder="Не выбран" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— не выбран —</SelectItem>
                      {productTypes.map(t => (
                        <SelectItem key={t.id} value={t.id}>{t.name}{t.is_service ? " (услуга)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Ставка НДС</Label>
                  <Select value={editing.vat_rate ?? "none"} onValueChange={v => setEditing({ ...editing, vat_rate: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Без НДС</SelectItem>
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="10">10%</SelectItem>
                      <SelectItem value="20">20%</SelectItem>
                    </SelectContent>
                  </Select>
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

      <Dialog open={folderDialog.open} onOpenChange={(v) => setFolderDialog(current => v ? { ...current, open: true } : { open: false, parent_id: null })}>
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

      <Dialog open={!!zoomImage} onOpenChange={(v) => { if (!v) setZoomImage(null); }}>
        <DialogContent className="max-w-3xl p-2 bg-transparent border-0 shadow-none">
          <DialogHeader className="sr-only"><DialogTitle>Фото</DialogTitle></DialogHeader>
          {zoomImage && (
            <img src={zoomImage} alt="" className="w-full h-auto max-h-[85vh] object-contain rounded-md" />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteFolder} onOpenChange={(v) => { if (!v) setDeleteFolder(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить папку «{deleteFolder?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteFolder ? (() => {
                const ids = descendantsOf(deleteFolder.id);
                const count = products.filter(p => p.folder_id && ids.includes(p.folder_id)).length;
                const sub = ids.length - 1;
                return `Будут удалены все данные из папки: ${count} товаров${sub > 0 ? ` и ${sub} вложенных папок` : ""}. Действие нельзя отменить.`;
              })() : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeFolder.isPending}
              onClick={(e) => { e.preventDefault(); if (deleteFolder) removeFolder.mutate(deleteFolder.id); }}
            >
              {removeFolder.isPending ? "Удаляем…" : "Удалить всё"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteManyOpen} onOpenChange={setDeleteManyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить выбранное?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedFolderIds.length > 0 && selectedIds.length > 0
                ? `Будут удалены: товаров — ${selectedIds.length}, папок — ${selectedFolderIds.length} (со всем содержимым).`
                : selectedFolderIds.length > 0
                  ? `Будет удалено папок — ${selectedFolderIds.length}, включая все вложенные папки и товары в них.`
                  : `Будет удалено товаров — ${selectedIds.length}.`}
              {" "}Действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteManyOpen(false)}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeMany.isPending}
              onClick={(e) => { e.preventDefault(); removeMany.mutate({ productIds: selectedIds, folderIds: selectedFolderIds }); }}
            >
              {removeMany.isPending ? "Удаляем…" : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
}
