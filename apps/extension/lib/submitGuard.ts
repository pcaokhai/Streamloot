/**
 * Chặn bấm dồn khi một lệnh tải đang bay.
 *
 * Tách khỏi panel để chạy thử được bằng node — DOM (el.onclick, disabled) thì
 * không (ADR 0006). Bản thân quyết định chỉ có một dòng, nhưng dòng đó chính
 * là chỗ Task 4 vòng 1 thiếu, gây bấm hai lần tải trùng file.
 */
export function canSubmit(pending: boolean): boolean {
  return !pending;
}
