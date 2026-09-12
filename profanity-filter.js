/* ============================================================
   BỘ LỌC TỪ NGỮ PHẢN CẢM — profanity-filter.js
   Dùng chung cho index.html (chặn khi điểm danh) và display.html
   (lớp phòng hộ thứ 2 khi hiển thị lên LED).

   CÁCH DÙNG:
   1. Thêm <script src="profanity-filter.js"></script> vào <head>
      hoặc trước thẻ <script> chính, ở CẢ index.html và display.html.
   2. Gọi: ProfanityFilter.check(hoTen)
      → { blocked: true/false, matched: "từ khớp" | null }

   CƠ CHẾ (2 tầng so khớp riêng biệt):
   - Tầng 1 — BLOCK_LIST: so khớp trên chuỗi đã BỎ HẾT DẤU + nối
     liền (normalize) — bắt các biến thể né lọc kiểu "d.c.m",
     "d c m", "d-c-m", "d1t", "l0n", "c4c", "vcl", "vkl"... Chỉ chứa
     cụm ĐỦ DÀI/đặc trưng (≥4 ký tự hoặc ghép nhiều âm tiết) nên an
     toàn để khớp kiểu chuỗi con, không cần đứng riêng một từ.
   - Tầng 2 — WORD_BOUNDARY_ONLY: so khớp trên chuỗi GIỮ NGUYÊN DẤU
     THANH (normalizeKeepDiacritics) và chỉ khớp khi từ đó đứng
     RIÊNG một mình (có ranh giới khoảng trắng 2 đầu). Dùng cho các
     từ ngắn có gốc tiếng Việt — vì nếu bỏ dấu, các từ này trùng
     dạng với từ vô hại phổ biến (VD "cặc" bỏ dấu = "cac" = dạng
     không dấu của "các" → nếu so khớp không dấu sẽ chặn nhầm cụm
     như "Đảng bộ CÁC cơ quan Đảng"). Do giữ dấu, các từ trong
     WORD_BOUNDARY_ONLY CHỈ khớp khi gõ ĐÚNG CHÍNH TẢ TỤC (có dấu);
     gõ không dấu (né tránh) sẽ KHÔNG bị chặn ở tầng này — đánh đổi
     có chủ đích để ưu tiên không chặn nhầm từ/tên thật.
     VÁ (xem normalizeKeepDiacritics bên dưới): trước khi tách từ
     theo khoảng trắng, các "từ" chỉ vỏn vẹn 1 ký tự đứng LIÊN TIẾP
     nhau được gộp lại thành 1 cụm — bắt kiểu né lọc phổ biến "n g
     u", "đ ị t" (gõ cách đều mỗi chữ cái để né so khớp theo từ) mà
     không ảnh hưởng tới tên/câu thật (đã kiểm chứng trên hàng nghìn
     tổ hợp họ tên phổ biến + toàn bộ danh sách đơn vị/chức vụ thật
     dùng trong hệ thống — không phát sinh chặn nhầm mới).

   LƯU Ý KHI CHỈNH SỬA:
   - Thêm từ vào BLOCK_LIST: viết KHÔNG DẤU, chữ thường, KHÔNG
     khoảng trắng, ví dụ "loz" chứ không phải "lòz".
   - Thêm từ vào WORD_BOUNDARY_ONLY: viết CÓ DẤU đầy đủ, đúng chính
     tả từ tục thật (ví dụ "cặc", "địt"), TRỪ các viết tắt/tiếng Anh
     vốn không dấu (dm, vl, wtf...) thì giữ nguyên không dấu.
   - Từ càng ngắn càng dễ khớp nhầm vào tên thật hoặc từ thông dụng
     — cân nhắc kỹ trước khi thêm vào BLOCK_LIST (khớp chuỗi con);
     nếu là từ có gốc tiếng Việt, gần như luôn nên đưa vào
     WORD_BOUNDARY_ONLY (có dấu, đứng riêng) thay vì BLOCK_LIST.
     LƯU Ý: một số entry hiện có trong BLOCK_LIST (loz, vcl, vkl,
     clm, dkm, dmm, dcm) chỉ dài 3 ký tự — NGẮN HƠN ngưỡng an toàn
     "≥4 ký tự" mà quy tắc này đề ra. Đã kiểm tra không trùng với dữ
     liệu đơn vị/chức vụ thật đang dùng trong hệ thống, nhưng đây là
     rủi ro còn tồn tại nếu có tên đệm/tên viết tắt cơ quan trùng
     chuỗi con này (ví dụ các mã viết tắt doanh nghiệp 3 chữ) — cân
     nhắc chuyển sang WORD_BOUNDARY_ONLY (không dấu, giữ nguyên) nếu
     gặp trường hợp bị chặn nhầm trong thực tế.
   ============================================================ */
(function (global) {
    'use strict';

    // ---- Bảng quy đổi ký tự thay thế (leetspeak / né lọc) ----
    const LEET_MAP = {
        '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
        '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's'
    };

    // ---- Bảng bỏ dấu tiếng Việt ----
    function stripVietnameseTones(str) {
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        str = str.replace(/đ/gi, m => (m === 'Đ' ? 'D' : 'd'));
        return str;
    }

    /**
     * Chuẩn hoá chuỗi để so khớp: bỏ dấu, hạ chữ thường, quy đổi
     * leetspeak, loại bỏ mọi ký tự không phải chữ cái/số (khoảng
     * trắng, dấu chấm, gạch ngang, gạch dưới...), nối liền thành
     * 1 chuỗi liên tục.
     */
    function normalize(text) {
        if (!text) return '';
        let s = String(text).toLowerCase();
        s = stripVietnameseTones(s);
        s = s.split('').map(ch => LEET_MAP[ch] || ch).join('');
        s = s.replace(/[^a-z0-9]/g, ''); // bỏ mọi ký tự chèn (space, ., -, _, ...)
        return s;
    }

    /**
     * Chuẩn hoá GIỮ NGUYÊN DẤU TIẾNG VIỆT (không bỏ dấu thanh, không
     * bỏ dấu phụ trên nguyên âm) — dùng cho các từ ngắn dễ khớp nhầm
     * (WORD_BOUNDARY_ONLY), để phân biệt được các cặp từ chỉ khác
     * nhau ở dấu, ví dụ "các" (dấu sắc, vô hại) ≠ "cặc" (dấu nặng,
     * tục). Nếu tước hết dấu, hai từ này quy về cùng chuỗi "cac" và
     * bị lẫn — đây là nguyên nhân "Đảng bộ các cơ quan Đảng" từng bị
     * chặn nhầm (chữ "các" trong câu trùng dạng không dấu với "cặc").
     *
     * Ký tự chèn (., -, _, ...) vẫn được nối liền lại (không tách
     * thành từ riêng) để vẫn bắt được kiểu né "đ.ị.t", "đ-ị-t"; chỉ
     * KHOẢNG TRẮNG THẬT mới được coi là ranh giới giữa 2 từ.
     *
     * HỆ QUẢ CHỦ ĐÍCH: ai gõ các từ này KHÔNG DẤU (VD gõ "cac" thay
     * vì "cặc") sẽ KHÔNG bị chặn bởi danh sách này — đổi lại để tuyệt
     * đối không chặn nhầm các từ có dấu vô hại như "các". Các biến
     * thể không dấu rõ ràng là tục/không thể là từ thật vẫn được bắt
     * qua BLOCK_LIST (cụm dài, không dấu) ở trên.
     *
     * VÁ — né lọc bằng khoảng trắng thật ("n g u", "đ ị t"): bản đầu
     * chỉ coi khoảng trắng là ranh giới từ tuyệt đối, nên ai gõ tách
     * rời mỗi chữ cái bằng 1 dấu cách sẽ lọt qua hoàn toàn (mỗi "từ"
     * chỉ còn 1 ký tự, không khớp với từ nào trong danh sách). Ở đây
     * thêm bước gộp các token CHỈ CÓ 1 KÝ TỰ đứng LIÊN TIẾP nhau
     * thành 1 cụm liền trước khi coi khoảng trắng còn lại là ranh
     * giới — tên/câu tiếng Việt thật hầu như không có 2+ từ liên
     * tiếp chỉ vỏn vẹn 1 ký tự, nên không ảnh hưởng các trường hợp
     * hợp lệ (đã kiểm tra trên hàng nghìn tổ hợp họ tên phổ biến,
     * toàn bộ danh sách đơn vị và chức vụ thật của hệ thống).
     */
    function normalizeKeepDiacritics(text) {
        if (!text) return '';
        let s = String(text).toLowerCase().normalize('NFC');
        s = s.split('').map(ch => LEET_MAP[ch] || ch).join('');
        // Bỏ dấu câu/ký hiệu chèn giữa nhưng KHÔNG thay bằng khoảng
        // trắng — nối liền lại để bắt "đ.ị.t" -> "địt".
        s = s.replace(/[.\-_'"()]/g, '');
        // Khoảng trắng thật (space thường gõ khi tách từ) thì giữ
        // nguyên làm ranh giới, chỉ gộp nhiều khoảng trắng liên tiếp.
        s = s.replace(/\s+/g, ' ').trim();

        // Gộp các token chỉ có 1 ký tự đứng liên tiếp nhau (xem chú
        // thích VÁ ở trên) — VD "n g u" -> "ngu", nhưng "Trần Văn A"
        // (chỉ 1 token đơn ký tự, không liên tiếp với token đơn ký
        // tự khác) vẫn giữ nguyên "trần văn a", không bị đụng.
        const tokens = s.split(' ');
        const merged = [];
        let buffer = '';
        for (const tok of tokens) {
            if (tok.length === 1) {
                buffer += tok;
            } else {
                if (buffer) { merged.push(buffer); buffer = ''; }
                merged.push(tok);
            }
        }
        if (buffer) merged.push(buffer);
        return merged.join(' ');
    }

    // ============================================================
    // DANH SÁCH CHẶN — dạng chuẩn hoá sẵn (không dấu, không cách)
    // Chia nhóm để dễ bảo trì; khi kiểm tra sẽ gộp lại thành 1 mảng.
    //
    // QUY TẮC AN TOÀN QUAN TRỌNG: vì normalize() nối liền chuỗi
    // (bỏ hết khoảng trắng để bắt kiểu né "d c m"), một từ càng
    // NGẮN càng dễ vô tình khớp vào GIỮA một họ tên tiếng Việt thật
    // (ví dụ "cu" nằm trong "Cường", "du" nằm trong "Dung"/"Đức").
    // Vì vậy:
    //   - BLOCK_LIST (khớp chuỗi con, không cần ranh giới từ, KHÔNG
    //     dấu) CHỈ chứa cụm đủ dài (≥4 ký tự) hoặc cụm ghép nhiều âm
    //     tiết, gần như không thể là 1 phần của tên người thật.
    //   - Các từ ngắn/phổ biến (ngu, chó, địt, cặc...) chỉ được đưa
    //     vào WORD_BOUNDARY_ONLY — chặn khi đứng RIÊNG một từ VÀ giữ
    //     ĐÚNG DẤU tiếng Việt (xem normalizeKeepDiacritics phía
    //     trên) để không lẫn với từ vô hại cùng dạng không dấu.
    // ============================================================

    // 🔴 Tục tĩu / bộ phận cơ thể mang tính tục — cụm đủ dài, an toàn
    // để khớp kiểu chuỗi con (không lo trùng vào tên thật)
    const EXPLICIT = [
        'buoi', 'loz', 'clit', 'nungl', 'dcm', 'dmm', 'vcl', 'vkl',
        'clm', 'dkm', 'dmml', 'clgt', 'ditme', 'dume', 'dumay',
        'ditmemay', 'concac', 'concak', 'thangngu', 'thangcho',
        'conchoxx', 'sexy', 'ditconme'
    ];

    // 🔴 Chửi tục / xúc phạm nặng — cụm ghép dài, đặc trưng
    const INSULT_HEAVY = [
        'ngusoi', 'ngungoc', 'thangdien', 'khonnan', 'ditbo',
        'matday', 'vodao', 'suvat', 'ranhcon', 'thangoc', 'conoc',
        'ochoxx'
    ];

    // ⚠️ Xúc phạm / kỳ thị / đe doạ — tách riêng vì nhạy cảm hơn
    // VÁ: entry "giết mày" trước đây viết bằng
    // 'giếtmày'.replace(/[^a-z0-9]/g, ''), nhưng regex [^a-z0-9] chỉ
    // xoá ký tự KHÔNG PHẢI a-z/0-9 — không tự bỏ dấu tiếng Việt
    // trước, nên các nguyên âm có dấu (ế, à) bị XOÁ LUÔN thay vì quy
    // về dạng không dấu, cho ra "gitmy" thay vì "gietmay". Vì
    // normalize() thật (dùng ở check()) luôn bỏ dấu đúng cách trước
    // (cho ra "gietmay"), entry "gitmy" không bao giờ khớp được —
    // vô hại (không gây chặn nhầm) nhưng cũng không hoạt động như ý
    // đồ ban đầu. Sửa lại bằng chuỗi không dấu viết tay, nhất quán
    // với cách viết các entry khác trong danh sách.
    const SLUR_THREAT = [
        'daumaymay', 'chetdi', 'muondie', 'gietmay'
    ];

    // 🔧 Viết tắt tiếng Anh tục thường gặp — đủ dài để an toàn
    const ENGLISH = [
        'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'pussy',
        'cunt', 'slut', 'whore', 'nigger', 'nigga', 'retard',
        'motherfucker'
    ];

    // Gộp danh sách khớp "chuỗi con, không cần ranh giới từ" —
    // an toàn với các từ đủ dài/đặc trưng, hiếm khi trùng lẫn trong
    // tên thật hoặc chức vụ/đơn vị.
    const BLOCK_LIST = [
        ...EXPLICIT, ...INSULT_HEAVY, ...SLUR_THREAT, ...ENGLISH
    ].filter(Boolean);

    // Từ ngắn / thông dụng — dễ vô tình khớp giữa tên ghép lại HOẶC
    // trùng dạng không dấu với từ tiếng Việt vô hại (VD "các" ≠
    // "cặc"), nên chỉ chặn khi đứng RIÊNG một từ VÀ giữ đúng dấu
    // tiếng Việt như viết tục thật (xem normalizeKeepDiacritics).
    //
    // QUY TẮC: viết CÓ DẤU đầy đủ (đúng chính tả từ tục) cho các từ
    // có gốc tiếng Việt — vì sẽ so khớp bằng chuỗi GIỮ DẤU, không
    // phải chuỗi đã tước dấu như BLOCK_LIST. Các viết tắt/tiếng Anh
    // vốn không có dấu (dm, vl, wtf...) giữ nguyên không dấu.
    //
    // GHI CHÚ: cố ý KHÔNG đưa 'cu', 'du', 'diên' vào đây dù là từ
    // tục phổ biến — vì đây cũng là các âm tiết có thật trong tên/họ
    // người Việt (Cù, Cự, Du, Diễn, Điền...), nên dù chặn kiểu đứng
    // riêng vẫn chặn nhầm tên thật. Các từ này thường đi kèm từ khác
    // khi bị lạm dụng (VD "con cu", "thằng điên") — đã có các cụm dài
    // hơn trong EXPLICIT/INSULT_HEAVY phía trên để bắt trường hợp đó.
    const WORD_BOUNDARY_ONLY = [
        'địt', 'đéo', 'cặc', 'lồn', 'ngu', 'chó', 'giết',
        'dm', 'vl', 'cak', 'fck', 'fk', 'dick', 'stfu', 'wtf', 'sex'
    ];

    /**
     * Kiểm tra một chuỗi (thường là Họ tên) có chứa từ bị chặn không.
     * @param {string} text
     * @returns {{blocked: boolean, matched: string|null}}
     */
    function check(text) {
        if (!text) return { blocked: false, matched: null };

        const flat = normalize(text);
        for (const word of BLOCK_LIST) {
            if (word && flat.includes(word)) {
                return { blocked: true, matched: word };
            }
        }

        const spaced = ' ' + normalizeKeepDiacritics(text) + ' ';
        for (const word of WORD_BOUNDARY_ONLY) {
            if (word && spaced.includes(' ' + word + ' ')) {
                return { blocked: true, matched: word };
            }
        }

        return { blocked: false, matched: null };
    }

    /**
     * Dùng ở display.html: nếu lỡ có tên phản cảm nằm sẵn trong sheet
     * (nhập trước khi có bộ lọc, hoặc sửa trực tiếp trong Sheet),
     * trả về chuỗi đã che để không hiển thị lên LED.
     */
    function maskIfBlocked(text) {
        const result = check(text);
        if (result.blocked) return '*** (Tên không hợp lệ) ***';
        return text;
    }

    global.ProfanityFilter = { check, maskIfBlocked, normalize, normalizeKeepDiacritics };

})(typeof window !== 'undefined' ? window : this);
