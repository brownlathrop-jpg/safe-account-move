/**
 * Подготовка логотипа организации к печати.
 *
 * Любая картинка приводится к единому «печатному» размеру: вписывается
 * в рамку LOGO_BOX (пропорции сохраняются, маленькая картинка не растягивается
 * сверх исходного разрешения более чем вдвое), чтобы во всех документах
 * шапка выглядела одинаково и не «прыгала» по высоте.
 */

/** Размер печатного бокса логотипа в пикселях (при печати ≈ 45×15 мм). */
export const LOGO_BOX = { width: 480, height: 160 };

export type LogoResult = { dataUrl: string; width: number; height: number };

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error("Не удалось прочитать файл"));
    fr.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Файл не похож на картинку"));
    img.src = src;
  });
}

/** Есть ли в картинке полупрозрачные пиксели (тогда сохраняем PNG). */
function hasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const d = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
  } catch {
    return true;
  }
  return false;
}

/**
 * Читает файл логотипа и возвращает data URL нужного размера.
 * SVG остаётся как есть (векторный, масштабируется без потерь).
 */
export async function prepareLogo(file: File): Promise<LogoResult> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ — выберите картинку меньше");
  const raw = await readFile(file);

  if (file.type === "image/svg+xml") {
    return { dataUrl: raw, width: LOGO_BOX.width, height: LOGO_BOX.height };
  }

  const img = await loadImage(raw);
  const scale = Math.min(LOGO_BOX.width / img.width, LOGO_BOX.height / img.height, 2);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не смог обработать картинку");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);

  const transparent = hasAlpha(ctx, w, h);
  const dataUrl = transparent ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.92);
  return { dataUrl, width: w, height: h };
}

/** Размер печати/факсимиле подписи (квадрат, при печати ≈ 35×35 мм). */
export const STAMP_BOX = { width: 420, height: 420 };

/**
 * Читает файл печати или подписи и возвращает data URL.
 * Прозрачный PNG сохраняется прозрачным — так оттиск ложится поверх линии подписи.
 */
export async function prepareStamp(file: File): Promise<LogoResult> {
  if (file.size > 8 * 1024 * 1024) throw new Error("Файл больше 8 МБ — выберите картинку меньше");
  const raw = await readFile(file);
  if (file.type === "image/svg+xml") {
    return { dataUrl: raw, width: STAMP_BOX.width, height: STAMP_BOX.height };
  }
  const img = await loadImage(raw);
  const scale = Math.min(STAMP_BOX.width / img.width, STAMP_BOX.height / img.height, 2);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Браузер не смог обработать картинку");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/png");
  return { dataUrl, width: w, height: h };
}
