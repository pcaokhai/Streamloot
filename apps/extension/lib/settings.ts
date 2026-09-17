/**
 * Cấu hình người dùng. Nằm ở `storage.local` chứ không phải biến module: MV3 thu
 * hồi service worker bất kỳ lúc nào (ADR 0006 C3).
 */
export interface Settings {
  port: number;
  concurrency: number;
}

export const DEFAULTS: Settings = {
  // Không có apiKey: backend nhận diện extension qua header
  // `X-Streamloot-Extension-Id` khớp ID đã ghim trong manifest. (Đường qua
  // `Origin` đã bỏ — Chrome KHÔNG gửi Origin khi extension có host_permissions
  // cho host đó, đo được là backend nhận `Origin: None`.)
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
