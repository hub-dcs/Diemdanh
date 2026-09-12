/* ============================================================
   config.js — CẤU HÌNH DÙNG CHUNG cho index.html, display.html,
   checkin-rollcall.html.

   MỤC ĐÍCH: trước đây URL Apps Script Web App được hard-code lặp
   lại ở CẢ 3 file (mỗi lần đổi tài khoản Google / deploy lại Apps
   Script phải nhớ sửa đủ cả 3 nơi, rất dễ sót). Giờ chỉ cần sửa
   ĐÚNG 1 GIÁ TRỊ DUY NHẤT bên dưới, cả 3 trang sẽ tự động dùng giá
   trị mới.

   CÁCH DÙNG KHI CHUYỂN SANG TÀI KHOẢN GOOGLE / GIT MỚI:
   1. Tạo Google Sheet mới trên tài khoản mới.
   2. Extensions → Apps Script, dán nội dung GAS.gs vào, chạy hàm
      setupSheets() một lần.
   3. Deploy → New deployment → Web app (Execute as: Me, Who has
      access: Anyone) → copy URL kết thúc bằng "/exec".
   4. Dán URL đó thay vào GOOGLE_APPS_SCRIPT_URL bên dưới.
   5. Commit + push toàn bộ thư mục (bao gồm file này) lên Git mới.
      KHÔNG cần sửa gì trong index.html / display.html /
      checkin-rollcall.html.

   LƯU Ý: file này phải được nạp bằng thẻ
   <script src="config.js"></script> TRƯỚC script chính của mỗi
   trang (index.html, display.html, checkin-rollcall.html), vì các
   trang đó đọc biến window.GOOGLE_APPS_SCRIPT_URL ngay khi chạy.
   Nếu đặt config.js SAU script chính, biến sẽ chưa tồn tại lúc cần
   dùng và điểm danh sẽ báo lỗi kết nối.
   ============================================================ */
(function (global) {
    'use strict';

    // ★★★ GIÁ TRỊ DUY NHẤT CẦN SỬA KHI ĐỔI TÀI KHOẢN GOOGLE ★★★
    // URL deploy Google Apps Script Web App (kết thúc bằng /exec).
    const GOOGLE_APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzoJirrnHSazvKRTeiUTdVD12bAgk7Q-2-m15-fj3y06Mal6MugM_LkAc4P81A3pvk3/exec';

    // Mật khẩu admin — dùng để đăng nhập trang Admin (index.html?mode=admin)
    // và mở "Điểm danh thay". Vốn trước đây chỉ nằm trong index.html; đưa
    // vào đây cùng chỗ vì cũng là cấu hình triển khai, không phải mã nguồn.
    const ADMIN_PASSWORD = 'admin123';

    // Bán kính GPS dự phòng (mét) — dùng khi 1 cuộc họp chưa lưu bán kính
    // riêng qua trang Admin (mỗi cuộc họp có thể tự đặt bán kính riêng,
    // giá trị này chỉ là mặc định cho cuộc họp cũ/chưa cấu hình).
    const DEFAULT_GPS_RADIUS = 30;

    // Gắn vào window để index.html, display.html, checkin-rollcall.html
    // đọc được như biến toàn cục — giữ đúng tên biến các file đó đã dùng
    // (GOOGLE_APPS_SCRIPT_URL) để không phải sửa phần code còn lại của
    // từng trang, chỉ thay chỗ KHAI BÁO bằng chỗ ĐỌC TỪ FILE NÀY.
    global.GOOGLE_APPS_SCRIPT_URL = GOOGLE_APPS_SCRIPT_URL;
    global.ADMIN_PASSWORD = ADMIN_PASSWORD;
    global.DEFAULT_GPS_RADIUS = DEFAULT_GPS_RADIUS;
   // Trống đồng: https://greohu.github.io/Diemdanh/assets/anh-trong-dong.png
   // Nền đỏ: https://greohu.github.io/Diemdanh/assets/nen-do.png

})(typeof window !== 'undefined' ? window : this);
