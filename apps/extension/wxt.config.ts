import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Streamloot',

    // Public key ghim => extension ID cố định qua mọi lần load unpacked.
    // Backend tin đúng ID này, nên KHÔNG cần người dùng dán API key (ADR 0006
    // §4.2). Keypair ở packaging/extension-key/ — private.pem gitignored.
    // Public key nằm trong manifest của mọi extension đã publish, công khai là bình thường.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA2mH7KefgqfsP3l+ZOgg3uGjB1k9H8m5yn7yJgv9qI12sSRhs38PA9xbrkeFp4M7+3f0BfcwpgJOP+EMy0ZIfnddnrS73NUH3Shj5MqLHbcldJ8NoA+/zwoMQsMf1FuPcjOWkqU81YpNFeAK3XxDovqOAjCYE5e+rWY6Z9e8ZXYu1JvqtIRU254JmiJ3FugyqBo8CHURjsmsi1zp0yD+lfNisRacl3WlQJaDBS2drRbo/kzGZ3+MwBD5a3RXShJ23n+wMMf1SWB3h4H3R5765d9uZGLINLiV5t0QW5iFPHZHJP5H3CDCKiNlQW0/EqQ1nrsEXzoOiu9ZSKXCVo0+XFwIDAQAB',
    description:
      'Bắt stream trong phiên duyệt web của bạn rồi bàn giao cho app Streamloot trên máy tải. Không gửi dữ liệu ra ngoài máy.',

    // CỐ Ý không xin `cookies`: phép đo B14 (ADR 0005 §7.3) cho thấy mọi host
    // phục vụ byte media đều không nhận cookie, nên quyền đó là thừa. Chrome Web
    // Store soi permission rất kỹ, và người dùng cũng vậy.
    // `alarms`: nhịp 60s khi không có bề mặt nào mở (spec §4.2). Không dùng
    // setInterval trong service worker — MV3 thu hồi worker và bộ đếm chết theo.
    // `declarativeNetRequest`: đường DUY NHẤT hợp lệ để đặt `Referer` cho
    // `fetch` của chính extension (fetch cấm header này). Nhờ đó service worker
    // tự đọc được master m3u8 và liệt kê chất lượng ngay, không phải đợi backend
    // spawn yt-dlp. Rule được tạo theo phiên và gỡ ngay sau mỗi lần gọi.
    permissions: ['webRequest', 'storage', 'tabs', 'alarms', 'declarativeNetRequest'],

    // Extension phải quan sát được site bất kỳ người dùng mở. Đây là quyền rộng
    // nhất Chrome có — thu hẹp được thì nên thu, nhưng danh sách site không biết
    // trước.
    host_permissions: ['<all_urls>'],

    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },

    // default_icon khai tường minh: setIcon lúc chạy ghi đè lên nó để vẽ vòng
    // tiến trình. Thiếu khai báo thì Chrome mượn tạm `icons`, và trạng thái
    // "icon trần" lúc rảnh phụ thuộc vào cách mượn đó thay vì vào thứ ta khai.
    action: {
      default_title: 'Streamloot',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        128: 'icon/128.png',
      },
    },
    options_ui: { open_in_tab: true },
  },
});
