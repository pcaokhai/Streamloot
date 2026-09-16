import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Streamloot',
    description:
      'Bắt stream trong phiên duyệt web của bạn rồi bàn giao cho app Streamloot trên máy tải. Không gửi dữ liệu ra ngoài máy.',

    // CỐ Ý không xin `cookies`: phép đo B14 (ADR 0005 §7.3) cho thấy mọi host
    // phục vụ byte media đều không nhận cookie, nên quyền đó là thừa. Chrome Web
    // Store soi permission rất kỹ, và người dùng cũng vậy.
    permissions: ['webRequest', 'storage', 'tabs'],

    // Extension phải quan sát được site bất kỳ người dùng mở. Đây là quyền rộng
    // nhất Chrome có — thu hẹp được thì nên thu, nhưng danh sách site không biết
    // trước.
    host_permissions: ['<all_urls>'],

    action: { default_title: 'Streamloot' },
    options_ui: { open_in_tab: true },
  },
});
