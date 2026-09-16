/**
 * Cấu hình người dùng. Nằm ở `storage.local` chứ không phải biến module: MV3 thu
 * hồi service worker bất kỳ lúc nào (ADR 0006 C3).
 */
export interface Settings {
  port: number;
  concurrency: number;
}

export const DEFAULTS: Settings = {
  // Không có apiKey: backend tin extension này qua header `Origin` khớp ID đã
  // ghim trong manifest. Trình duyệt luôn tự đặt Origin và JS của trang không
  // ghi đè được, nên trang web độc hại không mạo danh được extension.
  // Trùng DESKTOP_PORT ở apps/desktop/main.py.
  port: 8001,
  // B10 — yt-dlp đã nhận -N từ trước (ADR 0005 §6.2.3), chỉ thiếu chỗ chỉnh.
  concurrency: 4,
};

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get('settings');
  return { ...DEFAULTS, ...((stored as { settings?: Partial<Settings> }).settings ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await loadSettings()), ...patch };
  await browser.storage.local.set({ settings: next });
  return next;
}
