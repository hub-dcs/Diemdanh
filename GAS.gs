// ============================================================
// Google Apps Script - Hệ Thống Điểm Danh QR (v4)
// Chạy trên Google Sheets
// ============================================================
// THAY ĐỔI SO VỚI BẢN TRƯỚC (v3):
// 1. SỬA LỖI: gợi ý Chức Vụ không cập nhật dữ liệu mới — nguyên nhân là
//    CacheService giữ cache 1 giờ theo key cố định, không có cách nào xóa
//    sớm khi có dữ liệu mới. Giờ mỗi lần ghi 1 giá trị mới vào
//    learned_positions, cache liên quan bị XÓA NGAY LẬP TỨC (cache.remove),
//    lần đọc tiếp theo sẽ đọc lại thẳng từ Sheet thay vì trả bản cũ.
// 2. BỎ cơ chế "tự học" Đơn Vị — Đơn Vị giờ dùng danh sách CỐ ĐỊNH (xem
//    UNIT_LIST bên dưới), không còn ghi vào learned_departments nữa.
//    Sheet learned_departments không bị xóa (giữ lại dữ liệu cũ nếu cần
//    tra cứu), nhưng không còn được dùng để gợi ý.
// 3. THÊM: QR giờ chỉ chứa 1 mã ngắn (Short Code) thay vì nhúng toàn bộ
//    cấu hình cuộc họp vào URL (giúp QR ít ô hơn, dễ quét từ xa). Cấu hình
//    đầy đủ được lưu vào sheet "meeting_configs", tra cứu qua mã ngắn bằng
//    action mới "resolveMeetingCode" (doGet, JSONP — vì đây cũng là lệnh
//    chạy tự động lúc trang checkin.html vừa mở, giống 2 lệnh gợi ý).
// 4. SỬA (đồng bộ với index.html): admin gọi "getRollCallList" qua callGAS
//    (tức HTTP POST), nhưng bản trước chỉ nối action này vào doGet — mọi
//    lượt bấm "Xem danh sách đã xác nhận lần 2" trên trang Admin đều rơi
//    vào nhánh "Action không hợp lệ" của doPost và lỗi âm thầm. Đã thêm
//    nhánh doPost tương ứng bên dưới (xem trong doPost).
// ============================================================

const SHEET_HISTORY = "edit_history";
const SHEET_POSITIONS = "learned_positions";
const SHEET_DEPARTMENTS = "learned_departments"; // không còn dùng để gợi ý, giữ lại cho dữ liệu cũ
const SHEET_SHORTLINKS = "short_links";
const SHEET_MEETING_CONFIGS = "meeting_configs"; // MỚI: lưu cấu hình đầy đủ theo mã ngắn
// Mỗi cuộc họp có 1 sheet riêng, tên sheet = Meeting ID.

// Cột trong mỗi sheet cuộc họp:
// STT | Họ Tên | Chức Vụ | Đơn Vị | Meeting ID | Thời Gian | Ngày | Device Token | Số Lần | Timestamp | Xác Nhận Lần 2
const COL = {
  STT: 1, HOTEN: 2, CHUCVU: 3, DONVI: 4, MEETINGID: 5,
  THOIGIAN: 6, NGAY: 7, DEVICE_TOKEN: 8, SOLAN: 9, TIMESTAMP: 10,
  XACNHAN2: 11 // MỚI: Điểm danh lần 2 đột xuất (Flash Roll-Call) — ghi ngay
               // vào hàng của người đó, nối thêm mỗi đợt xác nhận (VD "15:02,
               // 16:31") thay vì tách ra sheet riêng, để admin nhìn 1 sheet là
               // biết ai còn ở lại qua các đợt kiểm tra khác nhau.
};

// Cột trong sheet "short_links":
const COL_SHORT = {
  SHORT_URL: 1, URL_GOC: 2, MEETINGID: 3, NGAY_TAO: 4
};

// Cột trong sheet "meeting_configs" (MỚI):
// Short Code | Meeting ID | Config JSON | Ngày Tạo
const COL_MCFG = {
  SHORT_CODE: 1, MEETINGID: 2, CONFIG_JSON: 3, NGAY_TAO: 4
};

const LOCK_TIMEOUT_MS = 30000;

// ============================================================
// SỬA LỚN — TOÀN BỘ ACTION GHI DỮ LIỆU CHUYỂN TỪ doPost SANG doGet (JSONP)
// ============================================================
// NGUYÊN NHÂN: index.html gọi các action ghi dữ liệu (submitAttendance,
// saveMeetingConfig, listMeetings, startRollCall, stopRollCall,
// getRollCallList, shortenLink, submitRollCall, checkAttendance) bằng
// fetch() POST — bị trình duyệt CHẶN BỞI CORS ngay cả khi Web App đã
// deploy đúng "Anyone" + "Execute as: Me". Lý do: Apps Script Web App trả
// về HTTP 302 redirect sang script.googleusercontent.com, và bước redirect
// đó không có header Access-Control-Allow-Origin — fetch() (mode: 'cors'
// mặc định) bị trình duyệt chặn ngay khi follow redirect này. Đây là hạn
// chế cố hữu của Apps Script Web App, không sửa được từ phía cấu hình
// deploy hay code doPost.
//
// GIẢI PHÁP: chuyển toàn bộ các action này sang gọi qua doGet bằng kỹ
// thuật JSONP (thẻ <script src="...?callback=...">) — JSONP không bị CORS
// chặn vì trình duyệt luôn cho phép tải <script> từ bất kỳ origin nào,
// không áp Same-Origin/CORS như với fetch()/XMLHttpRequest. Xem hàm
// callGASJsonp() / callGASJsonpOnce() trong index.html.
//
// doPost() BÊN DƯỚI ĐƯỢC GIỮ NGUYÊN (không xoá) để tương thích ngược —
// nếu sau này bạn tự gọi trực tiếp API bằng công cụ khác (Postman, một
// script backend khác không bị giới hạn bởi CORS của trình duyệt), POST
// vẫn hoạt động bình thường. Nhưng index.html/display.html/
// checkin-rollcall.html hiện tại KHÔNG còn gọi doPost nữa — tất cả đã
// chuyển sang doGet (xem cuối file).
// ============================================================
function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    if (payload.action === 'submitAttendance') {
      return handleSubmitAttendance(payload);
    } else if (payload.action === 'checkAttendance') {
      return handleCheckAttendance(payload);
    } else if (payload.action === 'getAttendanceList') {
      return handleGetAttendanceList(payload);
    } else if (payload.action === 'getPositionSuggestions') {
      return handleGetPositionSuggestions(payload);
    } else if (payload.action === 'getDepartmentSuggestions') {
      return handleGetDepartmentSuggestions(payload);
    } else if (payload.action === 'shortenLink') {
      return handleShortenLink(payload);
    } else if (payload.action === 'listMeetings') {
      return handleListMeetings(payload);
    } else if (payload.action === 'saveMeetingConfig') {
      return handleSaveMeetingConfig(payload);
    } else if (payload.action === 'startRollCall') {
      return handleStartRollCall(payload);
    } else if (payload.action === 'stopRollCall') {
      return handleStopRollCall(payload);
    } else if (payload.action === 'submitRollCall') {
      return handleSubmitRollCall(payload);
    } else if (payload.action === 'getRollCallList') {
      // MỚI: index.html (trang Admin, hàm refreshRollCallList) gọi action
      // này bằng callGAS — tức HTTP POST — không phải callGASJsonp/doGet
      // như getRollCallStatus. Trước đây handleGetRollCallList chỉ được nối
      // vào doGet nên mọi lượt gọi từ Admin đều rơi vào nhánh "Action không
      // hợp lệ" bên dưới. Thêm đúng nhánh này để khớp với cách client gọi.
      return handleGetRollCallList(payload);
    }

    return sendResponse(false, 'Action không hợp lệ');
  } catch (error) {
    Logger.log('Error: ' + error);
    return sendResponse(false, 'Lỗi server: ' + error);
  }
}

// ============ LẤY (HOẶC TẠO MỚI) SHEET CHO 1 CUỘC HỌP ============
function getOrCreateMeetingSheet(meetingID) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = sanitizeSheetName(meetingID);
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow([
      'STT', 'Họ Tên', 'Chức Vụ', 'Đơn Vị', 'Meeting ID',
      'Thời Gian', 'Ngày', 'Device Token', 'Số Lần', 'Timestamp', 'Xác Nhận Lần 2'
    ]);
    sheet.setFrozenRows(1);
    Logger.log('✅ Đã tạo sheet mới cho cuộc họp: ' + sheetName);
  } else {
    // Vá header cho sheet CŨ (tạo từ trước khi có cột Xác Nhận Lần 2) — chỉ
    // điền tên cột nếu ô đó đang trống, không đụng gì tới dữ liệu đã có.
    const headerCell = sheet.getRange(1, COL.XACNHAN2);
    if (!headerCell.getValue()) {
      headerCell.setValue('Xác Nhận Lần 2');
    }
  }

  return sheet;
}

function sanitizeSheetName(meetingID) {
  let name = String(meetingID).replace(/[:\\\/\?\*\[\]]/g, '-');
  if (name.length > 100) name = name.substring(0, 100);
  return name;
}

// ============ XỬ LÝ SUBMIT ĐIỂM DANH ============
function handleSubmitAttendance(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (lockError) {
    Logger.log('handleSubmitAttendance: không giành được khóa - ' + lockError);
    return sendResponse(false, 'Hệ thống đang xử lý nhiều lượt điểm danh cùng lúc, vui lòng thử lại sau vài giây.');
  }

  try {
    // Chỉ còn "học" Chức Vụ (Đơn Vị giờ dùng danh sách cố định UNIT_LIST,
    // không ghi vào sheet learned_departments nữa).
    recordLearnedValue(SHEET_POSITIONS, 'Chức Vụ', payload.position, 'position_suggestions_v4');

    const sheet = getOrCreateMeetingSheet(payload.meetingID);
    const data = sheet.getDataRange().getValues();
    const deviceToken = payload.deviceToken || '';

    let rowIndexByDevice = -1;
    let rowIndexByName = -1;

    for (let i = 1; i < data.length; i++) {
      if (deviceToken && data[i][COL.DEVICE_TOKEN - 1] === deviceToken) {
        rowIndexByDevice = i;
      }
      if (data[i][COL.HOTEN - 1] === payload.fullName) {
        rowIndexByName = i;
      }
    }

    const timestamp = new Date();
    const dateStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd/MM/yyyy');
    const timeStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm:ss');

    if (rowIndexByDevice !== -1) {
      const existingName = data[rowIndexByDevice][COL.HOTEN - 1];
      // SỬA: payload.isEdit giờ có thể tới từ 2 nguồn khác nhau — doPost (JSON
      // body thật) truyền boolean đúng nghĩa (true/false), còn doGet/JSONP (query
      // string) LUÔN truyền string, nên "false" (chuỗi) vẫn là giá trị truthy và
      // !"false" sẽ SAI thành false thay vì true nếu so sánh trực tiếp. Chuẩn hoá
      // về boolean thật trước khi dùng, chấp nhận cả 2 dạng.
      const isEditFlag = payload.isEdit === true || payload.isEdit === 'true';
      if (existingName !== payload.fullName && !isEditFlag) {
        return sendResponse(false,
          'Thiết bị này đã điểm danh cho "' + existingName + '". Không thể điểm danh hộ người khác trên cùng thiết bị.',
          { blockedDeviceReuse: true, existingName: existingName }
        );
      }

      const newRowIndex = rowIndexByDevice + 1;
      sheet.getRange(newRowIndex, COL.HOTEN).setValue(payload.fullName);
      sheet.getRange(newRowIndex, COL.CHUCVU).setValue(payload.position || '');
      sheet.getRange(newRowIndex, COL.DONVI).setValue(payload.department || '');
      sheet.getRange(newRowIndex, COL.THOIGIAN).setValue(timeStr);
      const soLanCu = data[rowIndexByDevice][COL.SOLAN - 1] || 1;
      sheet.getRange(newRowIndex, COL.SOLAN).setValue(soLanCu + 1);
      sheet.getRange(newRowIndex, COL.STT).setValue(newRowIndex - 1);

      logEdit(payload.meetingID, payload.fullName, payload.position, payload.department, timeStr, dateStr);
      return sendResponse(true, 'Cập nhật điểm danh thành công');
    }

    if (rowIndexByName !== -1) {
      const newRowIndex = rowIndexByName + 1;
      sheet.getRange(newRowIndex, COL.CHUCVU).setValue(payload.position || '');
      sheet.getRange(newRowIndex, COL.DONVI).setValue(payload.department || '');
      sheet.getRange(newRowIndex, COL.THOIGIAN).setValue(timeStr);
      sheet.getRange(newRowIndex, COL.DEVICE_TOKEN).setValue(deviceToken);
      const soLanCu = data[rowIndexByName][COL.SOLAN - 1] || 1;
      sheet.getRange(newRowIndex, COL.SOLAN).setValue(soLanCu + 1);
      sheet.getRange(newRowIndex, COL.STT).setValue(newRowIndex - 1);

      logEdit(payload.meetingID, payload.fullName, payload.position, payload.department, timeStr, dateStr);
      return sendResponse(true, 'Cập nhật điểm danh thành công');
    }

    const newRowNumber = sheet.getLastRow() + 1;
    sheet.appendRow([
      newRowNumber - 1,
      payload.fullName,
      payload.position || '',
      payload.department || '',
      payload.meetingID,
      timeStr,
      dateStr,
      deviceToken,
      1,
      payload.timestamp
    ]);

    return sendResponse(true, 'Điểm danh thành công');
  } catch (error) {
    Logger.log('handleSubmitAttendance error: ' + error);
    return sendResponse(false, 'Lỗi khi lưu dữ liệu: ' + error);
  } finally {
    lock.releaseLock();
  }
}

// ============ KIỂM TRA THIẾT BỊ ĐÃ ĐIỂM DANH CHƯA ============
function handleCheckAttendance(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sanitizeSheetName(payload.meetingID));

    if (!sheet) {
      return sendResponse(true, 'Chưa điểm danh', { alreadyCheckedIn: false });
    }

    const data = sheet.getDataRange().getValues();
    const deviceToken = payload.deviceToken || '';

    if (deviceToken) {
      for (let i = 1; i < data.length; i++) {
        if (data[i][COL.DEVICE_TOKEN - 1] === deviceToken) {
          return sendResponse(true, 'Đã điểm danh', {
            alreadyCheckedIn: true,
            lockedToDevice: true,
            data: {
              fullName: data[i][COL.HOTEN - 1],
              position: data[i][COL.CHUCVU - 1],
              department: data[i][COL.DONVI - 1],
              meetingID: payload.meetingID
            }
          });
        }
      }
    }

    return sendResponse(true, 'Chưa điểm danh', { alreadyCheckedIn: false });
  } catch (error) {
    Logger.log('handleCheckAttendance error: ' + error);
    return sendResponse(true, 'Chưa điểm danh', { alreadyCheckedIn: false });
  }
}

// ============ LẤY DANH SÁCH ĐIỂM DANH (dùng cho trang Admin) ============
function handleGetAttendanceList(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sanitizeSheetName(payload.meetingID));

    if (!sheet) {
      return sendResponse(true, 'Chưa có ai điểm danh', { list: [] });
    }

    const data = sheet.getDataRange().getValues();
    const list = [];

    for (let i = 1; i < data.length; i++) {
      if (!data[i][COL.HOTEN - 1]) continue;
      list.push({
        stt: list.length + 1,
        fullName: data[i][COL.HOTEN - 1],
        position: data[i][COL.CHUCVU - 1],
        department: data[i][COL.DONVI - 1],
        time: data[i][COL.THOIGIAN - 1],
        date: data[i][COL.NGAY - 1],
        soLan: data[i][COL.SOLAN - 1] || 1,
        xacNhanLan2: data[i][COL.XACNHAN2 - 1] || ''
      });
    }

    return sendResponse(true, 'OK', { list: list, total: list.length });
  } catch (error) {
    Logger.log('handleGetAttendanceList error: ' + error);
    return sendResponse(false, 'Lỗi khi lấy danh sách: ' + error, { list: [] });
  }
}

// ============ LẤY DANH SÁCH CÁC CUỘC HỌP ĐÃ CÓ SHEET (dùng cho trang Admin) ============
function handleListMeetings(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheets = ss.getSheets();
    const reserved = [SHEET_HISTORY, SHEET_POSITIONS, SHEET_DEPARTMENTS, SHEET_SHORTLINKS, SHEET_MEETING_CONFIGS, 'responses'];
    const meetings = [];

    sheets.forEach(sheet => {
      const name = sheet.getName();
      if (reserved.indexOf(name) !== -1) return;
      const lastRow = sheet.getLastRow();
      const count = lastRow > 1 ? lastRow - 1 : 0;
      meetings.push({
        meetingID: name,
        count: count,
        lastUpdated: sheet.getLastRow() > 0 ? true : false
      });
    });

    meetings.sort((a, b) => b.meetingID.localeCompare(a.meetingID));

    return sendResponse(true, 'OK', { meetings: meetings.slice(0, 50) });
  } catch (error) {
    Logger.log('handleListMeetings error: ' + error);
    return sendResponse(false, 'Lỗi khi lấy danh sách cuộc họp: ' + error, { meetings: [] });
  }
}

// ============ GHI NHẬN 1 GIÁ TRỊ CHỨC VỤ (SỬA: xóa cache ngay sau khi ghi) ============
// SỬA LỖI QUAN TRỌNG so với bản trước: trước đây hàm này chỉ ghi vào Sheet,
// còn cache gợi ý (CacheService, 1 giờ) không hề biết dữ liệu vừa đổi — nên
// dù Sheet đã có giá trị mới, gợi ý vẫn trả về bản cache cũ (có thể là rỗng
// nếu cache được tạo từ lúc hệ thống mới, chưa ai điểm danh) cho tới khi cache
// tự hết hạn sau 1 tiếng. Giờ mỗi lần ghi xong, cache.remove(cacheKey) NGAY,
// để lần load tiếp theo (VD người tiếp theo mở form) đọc thẳng lại từ Sheet.
function recordLearnedValue(sheetName, headerLabel, value, cacheKeyToInvalidate) {
  try {
    const val = String(value || '').trim();
    if (!val) return;

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.appendRow([headerLabel, 'Số Lần Gặp', 'Lần Cập Nhật Gần Nhất']);
      sheet.setFrozenRows(1);
    }

    const data = sheet.getDataRange().getValues();
    const valLower = val.toLowerCase();
    let foundRow = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').toLowerCase() === valLower) {
        foundRow = i + 1;
        break;
      }
    }

    const now = new Date().toLocaleString('vi-VN');
    let changed = false;

    if (foundRow !== -1) {
      const currentCount = sheet.getRange(foundRow, 2).getValue() || 0;
      sheet.getRange(foundRow, 2).setValue(currentCount + 1);
      sheet.getRange(foundRow, 3).setValue(now);
      changed = true;
    } else {
      sheet.appendRow([val, 1, now]);
      changed = true; // giá trị MỚI hoàn toàn -> chắc chắn phải xóa cache
    }

    // Xóa cache ngay để lần đọc tiếp theo lấy dữ liệu mới nhất từ Sheet.
    if (changed && cacheKeyToInvalidate) {
      try {
        CacheService.getScriptCache().remove(cacheKeyToInvalidate);
      } catch (cacheErr) {
        Logger.log('Không xóa được cache ' + cacheKeyToInvalidate + ': ' + cacheErr);
      }
    }
  } catch (error) {
    Logger.log('recordLearnedValue(' + sheetName + ') error: ' + error);
  }
}

// ============ GỢI Ý CHỨC VỤ (tự học từ toàn bộ dữ liệu đã điểm danh) ============
const DEFAULT_POSITIONS = [
  'Bí thư Đảng ủy', 'Phó Bí thư Đảng ủy', 'Chủ tịch UBND', 'Phó Chủ tịch UBND',
  'Chủ tịch HĐND', 'Phó Chủ tịch HĐND', 'Chủ tịch Ủy ban MTTQ', 'Phó Chủ tịch Ủy ban MTTQ',
  'Trưởng ban Tổ chức', 'Trưởng ban Tuyên giáo', 'Trưởng ban Dân vận', 'Chủ nhiệm Ủy ban Kiểm tra',
  'Bí thư Chi bộ', 'Phó Bí thư Chi bộ', 'Trưởng khu phố', 'Phó Trưởng khu phố',
  'Cán bộ', 'Chuyên viên', 'Công chức', 'Đảng viên',
  'Bí thư Đoàn Thanh niên', 'Chủ tịch Hội Liên hiệp Phụ nữ', 'Chủ tịch Hội Nông dân',
  'Chủ tịch Hội Cựu chiến binh', 'Trưởng Công an phường', 'Chỉ huy trưởng Quân sự'
];

const POSITION_CACHE_KEY = 'position_suggestions_v4'; // đổi version để không dính cache cũ (v3) còn sót lại

function handleGetPositionSuggestions(payload) {
  return getLearnedSuggestions(SHEET_POSITIONS, DEFAULT_POSITIONS, POSITION_CACHE_KEY);
}

// ============ ĐƠN VỊ: DANH SÁCH CỐ ĐỊNH (không còn tự học) ============
// Trước đây gợi ý Đơn Vị "tự học" từ dữ liệu người dùng nhập — dễ nhiễu vì
// người điểm danh có thể gõ sai/viết tắt khác nhau cho cùng 1 đơn vị. Giờ
// dùng đúng danh sách 112 đơn vị thật của phường Trị An (theo yêu cầu),
// vẫn cho phép người dùng gõ thêm tên khác nếu không có trong danh sách —
// action getDepartmentSuggestions chỉ đơn giản trả về UNIT_LIST, không đọc
// Sheet nữa (nên không cần cache, luôn đúng ngay lập tức).
const UNIT_LIST = [
  "Đảng bộ phường Trị An","Đảng bộ trường TH và THCS Trị An","Chi bộ 1 - TH-THCS Trị An","Chi bộ 2 - TH-THCS Trị An","Chi bộ 3 - TH-THCS Trị An","Chi bộ khu phố Vĩnh An 2","Chi bộ Khu phố Trị An","Chi bộ khu phố Vĩnh An 1","Đảng bộ trường MN Trị An","Chi bộ 1 - MN Trị An","Chi bộ 2 - MN Trị An","Chi bộ 3 - MN Trị An","Đảng bộ trường MN Mã Đà","Chi bộ 1 - MN Mã Đà","Chi bộ 2 - MN Mã Đà","Chi bộ 3 - MN Mã Đà","Đảng bộ Trung tâm Y tế khu vực Vĩnh Cửu","Chi bộ 1 - TTYT Vĩnh Cửu","Chi bộ 2 - TTYT Vĩnh Cửu","Chi bộ 3 - TTYT Vĩnh Cửu","Chi bộ Khu phố Mã Đà","Chi bộ Khu phố Hiếu Liêm","Chi bộ Trung tâm GDNN - GDTX khu vực 9","Chi bộ khu phố Bà Hào","Đảng bộ trường THPT Trị An","Chi bộ 1 - THPT Trị An","Chi bộ 2 - THPT Trị An","Chi bộ 3 - THPT Trị An","Đảng bộ UBND","Chi bộ Văn hóa","Chi bộ Trung tâm phục vụ hành chính công","Chi bộ phòng kinh tế, Hạ tầng và Đô thị","Chi bộ Văn phòng HĐND - UBND","Chi bộ Trung tâm dịch vụ tổng hợp","Đảng bộ các cơ quan Đảng","Chi bộ UBKT","Chi bộ MTTQ","Chi bộ Văn phòng Đảng ủy","Chi bộ Ban xây dựng Đảng","Chi bộ Trường TH Cây Gáo B","Chi bộ Quân Sự","Chi bộ Trạm Y tế","Đảng bộ Công An","Chi bộ Cảnh sát khu vực","Chi bộ An Ninh","Chi bộ Cảnh sát trật tự","Chi bộ Cảnh sát phòng, chống tội phạm","Chi bộ Tổng hợp","Đảng bộ Trường TH - THCS Mã Đà","Chi bộ 1 - TH-THCS Mã Đà","Chi bộ 2 - TH-THCS Mã Đà","Chi bộ 3 - TH-THCS Mã Đà","Đảng bộ Trường TH Cây Gáo A","Chi bộ 1 - CGA","Chi bộ 2 - CGA","Chi bộ 3 - CGA","Đảng bộ Trường MN Sơn Ca","Chi bộ 1 - MN Sơn Ca","Chi bộ 2 - MN Sơn Ca","Chi bộ 3 - MN Sơn Ca","Đảng bộ Công ty Thủy điện Trị An","Chi bộ Phòng Hành chính và Lao động","Chi bộ Phân xưởng sửa chữa","Chi bộ Phòng Kế hoạch và Kỹ thuật","Chi bộ Phòng Tài chính Kế toán","Chi bộ Phân xưởng vận hành","Đảng bộ Trường THCS Vĩnh An","Chi bộ 1 - THCS Vĩnh An","Chi bộ 2 - THCS Vĩnh An","Chi bộ 3 - THCS Vĩnh An","Phường Trị An","Trường TH và THCS Trị An","Trường MN Trị An","Trường MN Mã Đà","Trường THPT Trị An","Trường TH Cây Gáo B","Trường TH - THCS Mã Đà","Trường TH Cây Gáo A","Trường MN Sơn Ca","Trường THCS Vĩnh An","Trung tâm Y tế khu vực Vĩnh Cửu","Trạm Y tế","Khu phố Vĩnh An 2","Khu phố Trị An","Khu phố Vĩnh An 1","Khu phố Mã Đà","Khu phố Hiếu Liêm","Khu phố Bà Hào","UBND","Văn hóa","Trung tâm phục vụ hành chính công","Phòng Kinh tế, Hạ tầng và Đô thị","Văn phòng HĐND - UBND","Trung tâm dịch vụ tổng hợp","UBKT","MTTQ","Văn phòng Đảng ủy","Ban xây dựng Đảng","Công An","Cảnh sát khu vực","An Ninh","Cảnh sát trật tự","Cảnh sát phòng, chống tội phạm","Tổng hợp","Trung tâm GDNN - GDTX khu vực 9","Quân Sự","Công ty Thủy điện Trị An","Phòng Hành chính và Lao động","Phân xưởng sửa chữa","Phòng Kế hoạch và Kỹ thuật","Phòng Tài chính Kế toán","Phân xưởng vận hành"
];

function handleGetDepartmentSuggestions(payload) {
  // Không đọc Sheet nữa — trả thẳng danh sách cố định, luôn nhất quán,
  // không có vấn đề cache-cũ như Chức Vụ từng gặp.
  return sendResponse(true, 'OK', { positions: UNIT_LIST, fromCache: false });
}

// Hàm dùng chung để đọc gợi ý đã học + trộn mặc định (CHỈ còn dùng cho Chức Vụ).
function getLearnedSuggestions(sheetName, defaultList, cacheKey) {
  try {
    const cache = CacheService.getScriptCache();
    const cached = cache.get(cacheKey);

    if (cached) {
      return sendResponse(true, 'OK', { positions: JSON.parse(cached), fromCache: true });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(sheetName);

    const rows = [];
    if (sheet) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        const val = String(data[i][0] || '').trim();
        const count = Number(data[i][1]) || 0;
        if (!val) continue;
        rows.push({ val, count });
      }
    }

    rows.sort((a, b) => b.count - a.count);
    const learned = rows.map(r => r.val);

    const seen = new Set(learned.map(v => v.toLowerCase()));
    const merged = learned.slice();
    defaultList.forEach(val => {
      if (!seen.has(val.toLowerCase())) {
        merged.push(val);
        seen.add(val.toLowerCase());
      }
    });

    const values = merged.slice(0, 200);

    // Cache 1 giờ như cũ — nhưng giờ được XÓA CHỦ ĐỘNG ngay khi có ghi mới
    // (xem recordLearnedValue), nên "1 giờ" chỉ còn là giới hạn TRẦN, không
    // còn là nguyên nhân khiến dữ liệu bị trễ như trước.
    cache.put(cacheKey, JSON.stringify(values), 3600);

    return sendResponse(true, 'OK', { positions: values, fromCache: false });
  } catch (error) {
    Logger.log('getLearnedSuggestions(' + sheetName + ') error: ' + error);
    return sendResponse(true, 'OK', { positions: defaultList, fromCache: false, fallback: true });
  }
}

// ============ LƯU CẤU HÌNH CUỘC HỌP + SINH MÃ NGẮN (MỚI) ============
// Thay cho việc nhúng toàn bộ config (base64) vào URL QR — giờ admin gọi
// action này TRƯỚC khi tạo QR, server sinh 1 mã ngắn (6 ký tự, dễ đọc),
// lưu cấu hình đầy đủ vào sheet "meeting_configs", trả mã ngắn về cho
// client dùng làm nội dung QR. checkin.html khi quét sẽ gọi
// resolveMeetingCode (qua doGet/JSONP) để lấy lại cấu hình đầy đủ.
function handleSaveMeetingConfig(payload) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_MEETING_CONFIGS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_MEETING_CONFIGS);
      sheet.appendRow(['Short Code', 'Meeting ID', 'Config JSON', 'Ngày Tạo']);
      sheet.setFrozenRows(1);
    }

    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) {
      return sendResponse(false, 'Thiếu Meeting ID');
    }

    const configJson = JSON.stringify(payload.config || {});

    // Nếu cuộc họp này đã có mã ngắn rồi (VD admin bấm Lưu lại), tái sử dụng
    // đúng mã cũ thay vì sinh mã mới — tránh QR cũ đã phát ra bị mất hiệu lực.
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL_MCFG.MEETINGID - 1]) === meetingID) {
        sheet.getRange(i + 1, COL_MCFG.CONFIG_JSON).setValue(configJson);
        return sendResponse(true, 'Đã cập nhật cấu hình', { shortCode: data[i][COL_MCFG.SHORT_CODE - 1] });
      }
    }

    const shortCode = generateUniqueShortCode(sheet);
    sheet.appendRow([shortCode, meetingID, configJson, new Date().toLocaleString('vi-VN')]);

    return sendResponse(true, 'Đã lưu cấu hình', { shortCode: shortCode });
  } catch (error) {
    Logger.log('handleSaveMeetingConfig error: ' + error);
    return sendResponse(false, 'Lỗi khi lưu cấu hình: ' + error);
  }
}

// Sinh mã ngắn 6 ký tự (chữ hoa + số, bỏ ký tự dễ nhầm như 0/O, 1/I) và
// đảm bảo không trùng với mã đã có trong sheet.
function generateUniqueShortCode(sheet) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ 0,O,1,I
  const existing = new Set(
    sheet.getDataRange().getValues().slice(1).map(row => String(row[COL_MCFG.SHORT_CODE - 1]))
  );

  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    if (!existing.has(code)) return code;
  }
  // Cực hiếm khi xảy ra (20 lần đều trùng) — thêm timestamp để chắc chắn duy nhất
  return 'X' + Date.now().toString(36).toUpperCase().slice(-5);
}

// Tra cứu cấu hình đầy đủ từ mã ngắn — dùng cho doGet/JSONP, vì checkin.html
// gọi lệnh này tự động ngay lúc trang vừa mở (trước khi người dùng tương tác).
function handleResolveMeetingCode(payload) {
  try {
    const shortCode = String(payload.code || '').trim().toUpperCase();
    if (!shortCode) {
      return sendResponse(false, 'Thiếu mã cuộc họp');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_MEETING_CONFIGS);
    if (!sheet) {
      return sendResponse(false, 'Chưa có cuộc họp nào được cấu hình');
    }

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL_MCFG.SHORT_CODE - 1]).toUpperCase() === shortCode) {
        const configJson = data[i][COL_MCFG.CONFIG_JSON - 1];
        return sendResponse(true, 'OK', {
          meetingID: data[i][COL_MCFG.MEETINGID - 1],
          config: JSON.parse(configJson)
        });
      }
    }

    return sendResponse(false, 'Không tìm thấy cuộc họp ứng với mã này. Vui lòng kiểm tra lại mã hoặc liên hệ admin.');
  } catch (error) {
    Logger.log('handleResolveMeetingCode error: ' + error);
    return sendResponse(false, 'Lỗi khi tra cứu cấu hình: ' + error);
  }
}

// ============ TRA CẤU HÌNH TRỰC TIẾP BẰNG MEETING ID ============
// Dùng cho display.html (Màn Hình Chiếu) khi mở trên máy KHÁC với máy admin
// đã lưu cấu hình — localStorage không có sẵn nên phải tra qua server bằng
// chính meetingID (đã biết từ URL ?id=..., không cần mã ngắn).
function handleGetMeetingConfigByID(payload) {
  try {
    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) {
      return sendResponse(false, 'Thiếu meetingID');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_MEETING_CONFIGS);
    if (!sheet) {
      return sendResponse(false, 'Chưa có cuộc họp nào được cấu hình');
    }

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][COL_MCFG.MEETINGID - 1]) === meetingID) {
        const configJson = data[i][COL_MCFG.CONFIG_JSON - 1];
        return sendResponse(true, 'OK', {
          meetingID: meetingID,
          config: JSON.parse(configJson)
        });
      }
    }

    return sendResponse(false, 'Không tìm thấy cấu hình cho cuộc họp này');
  } catch (error) {
    Logger.log('handleGetMeetingConfigByID error: ' + error);
    return sendResponse(false, 'Lỗi khi tra cứu cấu hình: ' + error);
  }
}

// ============ ĐIỂM DANH LẦN 2 ĐỘT XUẤT (FLASH ROLL-CALL) ============
// Trạng thái của 1 đợt roll-call (token, thời điểm bắt đầu/hết hạn) được lưu
// NGAY TRONG config JSON của cuộc họp (field "rollCall") — tận dụng đúng cơ
// chế saveMeetingConfig/getMeetingConfigByID đã có sẵn và ĐANG được cả admin
// (localStorage) lẫn display.html (poll mỗi vài giây) đọc, nên không cần
// thêm action polling riêng cho display.html.
//
// Lượt XÁC NHẬN lần 2 được ghi NGAY VÀO HÀNG của người đó trên chính sheet
// điểm danh gốc (cột "Xác Nhận Lần 2", COL.XACNHAN2) — không tách sheet riêng,
// để admin mở 1 sheet là thấy đủ cả điểm danh lần 1 lẫn lần 2 trên cùng hàng.
// Nếu admin kích hoạt roll-call NHIỀU LẦN trong cùng cuộc họp, mỗi lượt xác
// nhận được NỐI THÊM vào cùng ô (VD "15:02, 16:31") thay vì ghi đè — nhờ vậy
// nhìn 1 ô là biết người đó có mặt ở NHỮNG đợt kiểm tra nào, không chỉ đợt
// gần nhất.

// Đọc config hiện tại của 1 cuộc họp (dùng lại đúng sheet meeting_configs).
// Trả về { rowIndex, meetingID, config } hoặc null nếu chưa có cấu hình.
function readMeetingConfigRow(meetingID) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_MEETING_CONFIGS);
  if (!sheet) return null;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][COL_MCFG.MEETINGID - 1]) === meetingID) {
      let config = {};
      try { config = JSON.parse(data[i][COL_MCFG.CONFIG_JSON - 1] || '{}'); } catch (e) { config = {}; }
      return { sheet, rowIndex: i + 1, meetingID, config };
    }
  }
  return null;
}

// Admin bấm "⚡ Điểm danh đột xuất": sinh token ngắn hạn, ghi thời điểm hết
// hạn vào config, banner trên display.html sẽ tự đổi khi poll thấy rollCall
// đang active (xem applyMeetingMeta trong display.html).
function handleStartRollCall(payload) {
  try {
    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) return sendResponse(false, 'Thiếu Meeting ID');

    const durationMinutes = Math.min(15, Math.max(2, Number(payload.durationMinutes) || 5));
    const row = readMeetingConfigRow(meetingID);
    if (!row) return sendResponse(false, 'Cuộc họp này chưa có cấu hình được lưu — hãy Lưu cấu hình trước.');

    const token = generateRollCallToken();
    const now = Date.now();
    const rollCall = {
      token: token,
      startedAt: now,
      expiresAt: now + durationMinutes * 60 * 1000
    };
    row.config.rollCall = rollCall;
    row.sheet.getRange(row.rowIndex, COL_MCFG.CONFIG_JSON).setValue(JSON.stringify(row.config));

    return sendResponse(true, 'Đã kích hoạt điểm danh lần 2', { rollCall: rollCall });
  } catch (error) {
    Logger.log('handleStartRollCall error: ' + error);
    return sendResponse(false, 'Lỗi khi kích hoạt điểm danh lần 2: ' + error);
  }
}

// Admin có thể tắt sớm thủ công (VD kích hoạt nhầm) — xoá rollCall khỏi config.
function handleStopRollCall(payload) {
  try {
    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) return sendResponse(false, 'Thiếu Meeting ID');

    const row = readMeetingConfigRow(meetingID);
    if (!row) return sendResponse(false, 'Không tìm thấy cấu hình cuộc họp');

    delete row.config.rollCall;
    row.sheet.getRange(row.rowIndex, COL_MCFG.CONFIG_JSON).setValue(JSON.stringify(row.config));

    return sendResponse(true, 'Đã tắt điểm danh lần 2');
  } catch (error) {
    Logger.log('handleStopRollCall error: ' + error);
    return sendResponse(false, 'Lỗi khi tắt điểm danh lần 2: ' + error);
  }
}

// Đại biểu quét QR lần 2, bấm "Xác nhận có mặt" trên trang riêng — hệ thống
// tìm đúng hàng của họ trên sheet điểm danh gốc (qua deviceToken, giống cách
// điểm danh lần 1 nhận diện thiết bị) rồi NỐI THÊM giờ xác nhận vào cột "Xác
// Nhận Lần 2" của đúng hàng đó. Không cho xác nhận nếu token sai/đã hết hạn,
// và không nối trùng nếu bấm nhiều lần trong CÙNG 1 đợt (kiểm tra token đã
// từng ghi trong ô chưa trước khi nối thêm).
function handleSubmitRollCall(payload) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(LOCK_TIMEOUT_MS);
  } catch (lockError) {
    return sendResponse(false, 'Hệ thống đang xử lý, vui lòng thử lại sau vài giây.');
  }

  try {
    const meetingID = String(payload.meetingID || '').trim();
    const token = String(payload.token || '').trim();
    const deviceToken = String(payload.deviceToken || '').trim();
    if (!meetingID || !token) return sendResponse(false, 'Thiếu thông tin xác nhận');

    const row = readMeetingConfigRow(meetingID);
    const rollCall = row && row.config && row.config.rollCall;
    if (!rollCall || rollCall.token !== token) {
      return sendResponse(false, 'Mã đã hết hiệu lực, vui lòng liên hệ Ban Tổ chức.');
    }
    if (Date.now() > rollCall.expiresAt) {
      return sendResponse(false, 'Mã đã hết hiệu lực, vui lòng liên hệ Ban Tổ chức.');
    }
    if (!deviceToken) {
      return sendResponse(false, 'Không xác định được thiết bị. Vui lòng liên hệ Ban Tổ chức.');
    }

    // BẮT BUỘC kiểm tra GPS ở SERVER (không chỉ tin client) — đây là lớp chặn
    // THẬT, để ngăn trường hợp người đã rời hội trường được người khác chụp
    // gửi QR/link rồi tự quét từ xa (VD từ nhà) để "xác nhận có mặt" giả. Toạ
    // độ hội trường + bán kính cho phép lấy ĐÚNG từ config đã lưu (gpsRadius,
    // coordinates) — cùng nguồn dữ liệu với điểm danh lần 1, không cấu hình
    // lại riêng.
    const lat = Number(payload.latitude);
    const lng = Number(payload.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return sendResponse(false, 'Không xác định được vị trí GPS của bạn. Vui lòng bật định vị và thử lại.');
    }
    const venueCoords = String((row.config && row.config.coordinates) || '').split(',');
    const venueLat = parseFloat((venueCoords[0] || '').trim());
    const venueLng = parseFloat((venueCoords[1] || '').trim());
    if (!Number.isFinite(venueLat) || !Number.isFinite(venueLng)) {
      Logger.log('handleSubmitRollCall: thiếu toạ độ hội trường trong config, bỏ qua kiểm tra GPS');
    } else {
      const allowedRadius = Number(row.config.gpsRadius) || 30;
      const distance = haversineDistanceMeters(lat, lng, venueLat, venueLng);
      if (distance > allowedRadius) {
        Logger.log('handleSubmitRollCall: GPS quá xa - ' + Math.round(distance) + 'm (cho phép ' + allowedRadius + 'm), deviceToken=' + deviceToken);
        return sendResponse(false, 'Vị trí hiện tại cách hội trường ' + Math.round(distance) + 'm, vượt quá phạm vi cho phép (' + allowedRadius + 'm).');
      }
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sanitizeSheetName(meetingID));
    if (!sheet) {
      return sendResponse(false, 'Không tìm thấy dữ liệu điểm danh lần 1 của cuộc họp này.');
    }

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][COL.DEVICE_TOKEN - 1] === deviceToken) {
        rowIndex = i;
        break;
      }
    }
    if (rowIndex === -1) {
      return sendResponse(false, 'Không tìm thấy thông tin điểm danh lần 1 trên thiết bị này. Vui lòng liên hệ Ban Tổ chức.');
    }

    const fullName = data[rowIndex][COL.HOTEN - 1];
    const sheetRowNumber = rowIndex + 1;
    const cell = sheet.getRange(sheetRowNumber, COL.XACNHAN2);
    const existingRaw = String(cell.getValue() || '').trim();

    // Ghi giờ xác nhận (HH:mm) — nếu đã có xác nhận từ đợt TRƯỚC, nối thêm vào
    // cùng ô bằng dấu phẩy thay vì ghi đè, để admin thấy được người này có mặt
    // ở NHỮNG đợt kiểm tra nào (VD "15:02, 16:31" cho 2 đợt roll-call khác nhau).
    const timestamp = new Date();
    const timeStr = Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm');

    const alreadyInThisRound = wasConfirmedInRound(row.config, deviceToken, rollCall.token);
    if (alreadyInThisRound) {
      return sendResponse(true, 'Bạn đã xác nhận có mặt cho lượt này rồi', { alreadyConfirmed: true, fullName: fullName });
    }

    const newValue = existingRaw ? existingRaw + ', ' + timeStr : timeStr;
    cell.setValue(newValue);
    recordConfirmedInRound(row, deviceToken, rollCall.token);

    return sendResponse(true, 'Xác nhận có mặt thành công', { fullName: fullName });
  } catch (error) {
    Logger.log('handleSubmitRollCall error: ' + error);
    return sendResponse(false, 'Lỗi khi xác nhận: ' + error);
  } finally {
    lock.releaseLock();
  }
}

// Haversine — tính khoảng cách (mét) giữa 2 toạ độ GPS. Dùng RIÊNG cho kiểm
// tra GPS phía SERVER của điểm danh lần 2 (client cũng có hàm tương tự trong
// index.html/checkin-rollcall.html cho UX, nhưng chặn THẬT phải nằm ở server
// vì client luôn có thể bị can thiệp/giả lập vị trí).
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (deg) => deg * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Chống bấm xác nhận trùng nhiều lần TRONG CÙNG 1 đợt roll-call (cùng token):
// danh sách deviceToken đã xác nhận của đợt hiện tại được lưu tạm trong chính
// config (field "rollCall.confirmedDevices"), tự xoá khi đợt mới bắt đầu
// (handleStartRollCall ghi đè object rollCall hoàn toàn mới).
function wasConfirmedInRound(config, deviceToken, token) {
  const rc = config.rollCall;
  if (!rc || rc.token !== token || !rc.confirmedDevices) return false;
  return rc.confirmedDevices.indexOf(deviceToken) !== -1;
}

function recordConfirmedInRound(row, deviceToken, token) {
  const rc = row.config.rollCall;
  if (!rc || rc.token !== token) return;
  if (!rc.confirmedDevices) rc.confirmedDevices = [];
  rc.confirmedDevices.push(deviceToken);
  row.sheet.getRange(row.rowIndex, COL_MCFG.CONFIG_JSON).setValue(JSON.stringify(row.config));
}

// Trạng thái đợt roll-call hiện tại (cho display.html poll và cho trang xác
// nhận lần 2 kiểm tra trước khi cho bấm nút). Dùng doGet/JSONP.
function handleGetRollCallStatus(payload) {
  try {
    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) return sendResponse(false, 'Thiếu meetingID');

    const row = readMeetingConfigRow(meetingID);
    const rollCall = row && row.config && row.config.rollCall;
    if (!rollCall) return sendResponse(true, 'OK', { active: false });

    const active = Date.now() <= rollCall.expiresAt;
    // Không trả confirmedDevices ra ngoài (chỉ dùng nội bộ để chống bấm
    // trùng) — giữ payload trả về gọn nhẹ cho display.html/trang xác nhận.
    const publicRollCall = { token: rollCall.token, startedAt: rollCall.startedAt, expiresAt: rollCall.expiresAt };
    return sendResponse(true, 'OK', { active: active, rollCall: publicRollCall });
  } catch (error) {
    Logger.log('handleGetRollCallStatus error: ' + error);
    return sendResponse(true, 'OK', { active: false });
  }
}

// Danh sách đã xác nhận lần 2 — đọc trực tiếp cột "Xác Nhận Lần 2" trên sheet
// điểm danh gốc, dùng cho trang Admin so khớp ai chưa xác nhận (nghi rời sớm).
function handleGetRollCallList(payload) {
  try {
    const meetingID = String(payload.meetingID || '').trim();
    if (!meetingID) return sendResponse(false, 'Thiếu meetingID', { list: [] });

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sanitizeSheetName(meetingID));
    if (!sheet) return sendResponse(true, 'Chưa có dữ liệu điểm danh', { list: [] });

    const data = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < data.length; i++) {
      if (!data[i][COL.HOTEN - 1]) continue;
      const confirmations = String(data[i][COL.XACNHAN2 - 1] || '').trim();
      if (confirmations) {
        list.push({ fullName: data[i][COL.HOTEN - 1], confirmations: confirmations });
      }
    }

    return sendResponse(true, 'OK', { list: list });
  } catch (error) {
    Logger.log('handleGetRollCallList error: ' + error);
    return sendResponse(false, 'Lỗi khi lấy danh sách xác nhận lần 2: ' + error, { list: [] });
  }
}

function generateRollCallToken() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return code;
}


// ============ RÚT GỌN LINK (TinyURL, dự phòng is.gd) ============
function handleShortenLink(payload) {
  try {
    const longUrl = String(payload.longUrl || '').trim();
    const meetingID = String(payload.meetingID || '').trim();

    if (!longUrl) {
      return sendResponse(false, 'Thiếu URL cần rút gọn');
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_SHORTLINKS);
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_SHORTLINKS);
      sheet.appendRow(['Short URL', 'URL Gốc', 'Meeting ID', 'Ngày Tạo']);
      sheet.setFrozenRows(1);
    }

    const data = sheet.getDataRange().getValues();

    if (meetingID) {
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][COL_SHORT.MEETINGID - 1]) === meetingID) {
          return sendResponse(true, 'Đã có link rút gọn cho cuộc họp này', {
            shortUrl: data[i][COL_SHORT.SHORT_URL - 1]
          });
        }
      }
    }

    const shortUrl = tryShortenUrl(longUrl);

    if (!shortUrl) {
      return sendResponse(false, 'Không rút gọn được link (cả TinyURL và phương án dự phòng đều lỗi). Vui lòng thử lại sau ít phút, hoặc gửi link đầy đủ.');
    }

    sheet.appendRow([shortUrl, longUrl, meetingID, new Date().toLocaleString('vi-VN')]);

    return sendResponse(true, 'Rút gọn link thành công', { shortUrl: shortUrl });
  } catch (error) {
    Logger.log('handleShortenLink error: ' + error);
    return sendResponse(false, 'Lỗi khi rút gọn link: ' + error);
  }
}

function tryShortenUrl(longUrl) {
  try {
    const tinyUrlApi = 'https://tinyurl.com/api-create.php?url=' + encodeURIComponent(longUrl);
    const response = UrlFetchApp.fetch(tinyUrlApi, { muteHttpExceptions: true });
    const responseCode = response.getResponseCode();
    const body = response.getContentText().trim();

    Logger.log('TinyURL responseCode=' + responseCode + ' body=' + body);

    if (responseCode === 200 && body.indexOf('http') === 0 && body.indexOf(' ') === -1) {
      return body;
    }
    Logger.log('TinyURL trả về không hợp lệ, thử phương án dự phòng (is.gd)');
  } catch (err) {
    Logger.log('TinyURL fetch lỗi: ' + err);
  }

  try {
    const isGdApi = 'https://is.gd/create.php?format=simple&url=' + encodeURIComponent(longUrl);
    const response2 = UrlFetchApp.fetch(isGdApi, { muteHttpExceptions: true });
    const responseCode2 = response2.getResponseCode();
    const body2 = response2.getContentText().trim();

    Logger.log('is.gd responseCode=' + responseCode2 + ' body=' + body2);

    if (responseCode2 === 200 && body2.indexOf('http') === 0 && body2.indexOf(' ') === -1) {
      return body2;
    }
    Logger.log('is.gd cũng trả về không hợp lệ');
  } catch (err2) {
    Logger.log('is.gd fetch lỗi: ' + err2);
  }

  return null;
}

// ============ GHI LỊCH SỬ EDIT ============
function logEdit(meetingID, fullName, position, department, time, date) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let historySheet = ss.getSheetByName(SHEET_HISTORY);

    if (!historySheet) {
      historySheet = ss.insertSheet(SHEET_HISTORY);
      historySheet.appendRow(['STT', 'Meeting ID', 'Họ Tên', 'Chức Vụ', 'Đơn Vị', 'Thời Gian', 'Ngày', 'Lần Edit']);
    }

    const rowCount = historySheet.getLastRow();
    historySheet.appendRow([
      rowCount, meetingID, fullName, position || '', department || '', time, date,
      new Date().toLocaleString('vi-VN')
    ]);
  } catch (error) {
    Logger.log('logEdit error: ' + error);
  }
}

// ============ GỬI RESPONSE ============
function sendResponse(success, message, data = null) {
  const output = ContentService.createTextOutput();
  output.setMimeType(ContentService.MimeType.JSON);

  const response = { success: success, message: message };
  if (data) Object.assign(response, data);

  output.setContent(JSON.stringify(response));
  return output;
}

// ============ SETUP BAN ĐẦU ============
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let historySheet = ss.getSheetByName(SHEET_HISTORY);
  if (!historySheet) {
    historySheet = ss.insertSheet(SHEET_HISTORY);
    historySheet.appendRow(['STT', 'Meeting ID', 'Họ Tên', 'Chức Vụ', 'Đơn Vị', 'Thời Gian', 'Ngày', 'Lần Edit']);
    Logger.log('✅ Created sheet: ' + SHEET_HISTORY);
  }

  let positionsSheet = ss.getSheetByName(SHEET_POSITIONS);
  if (!positionsSheet) {
    positionsSheet = ss.insertSheet(SHEET_POSITIONS);
    positionsSheet.appendRow(['Chức Vụ', 'Số Lần Gặp', 'Lần Cập Nhật Gần Nhất']);
    positionsSheet.setFrozenRows(1);
    Logger.log('✅ Created sheet: ' + SHEET_POSITIONS);
  }

  let shortLinksSheet = ss.getSheetByName(SHEET_SHORTLINKS);
  if (!shortLinksSheet) {
    shortLinksSheet = ss.insertSheet(SHEET_SHORTLINKS);
    shortLinksSheet.appendRow(['Short URL', 'URL Gốc', 'Meeting ID', 'Ngày Tạo']);
    shortLinksSheet.setFrozenRows(1);
    Logger.log('✅ Created sheet: ' + SHEET_SHORTLINKS);
  }

  let meetingConfigsSheet = ss.getSheetByName(SHEET_MEETING_CONFIGS);
  if (!meetingConfigsSheet) {
    meetingConfigsSheet = ss.insertSheet(SHEET_MEETING_CONFIGS);
    meetingConfigsSheet.appendRow(['Short Code', 'Meeting ID', 'Config JSON', 'Ngày Tạo']);
    meetingConfigsSheet.setFrozenRows(1);
    Logger.log('✅ Created sheet: ' + SHEET_MEETING_CONFIGS);
  }

  Logger.log('🎉 Setup complete!');
}

// ============ SỬA CÁC DÒNG BỊ THIẾU STT (giữ nguyên từ bản trước) ============
function fixMissingSTT() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const reserved = [SHEET_HISTORY, SHEET_POSITIONS, SHEET_DEPARTMENTS, SHEET_SHORTLINKS, SHEET_MEETING_CONFIGS, 'responses'];
  let totalFixed = 0;

  sheets.forEach(sheet => {
    const name = sheet.getName();
    if (reserved.indexOf(name) !== -1) return;

    const data = sheet.getDataRange().getValues();
    let fixedInSheet = 0;

    for (let i = 1; i < data.length; i++) {
      const hoTen = data[i][COL.HOTEN - 1];
      const stt = data[i][COL.STT - 1];
      if (hoTen && (stt === '' || stt === null || stt === undefined)) {
        const rowNumber = i + 1;
        sheet.getRange(rowNumber, COL.STT).setValue(i);
        fixedInSheet++;
        totalFixed++;
      }
    }

    if (fixedInSheet > 0) {
      Logger.log('✅ Sheet "' + name + '": đã điền lại STT cho ' + fixedInSheet + ' dòng');
    }
  });

  Logger.log('🎉 Hoàn tất. Tổng số dòng đã sửa STT: ' + totalFixed);
}

// ============ XÓA CACHE THỦ CÔNG (chạy tay nếu nghi ngờ gợi ý bị kẹt) ============
// Hàm tiện ích MỚI: nếu vì lý do gì đó vẫn nghi cache bị kẹt (hiếm khi xảy ra
// vì recordLearnedValue() giờ tự xóa cache), chạy hàm này 1 lần trong trình
// soạn thảo Apps Script (chọn "clearAllSuggestionCache" > Run) để xóa sạch.
function clearAllSuggestionCache() {
  CacheService.getScriptCache().remove(POSITION_CACHE_KEY);
  CacheService.getScriptCache().remove('position_suggestions_v3'); // xóa luôn cache bản cũ nếu còn sót
  Logger.log('🎉 Đã xóa cache gợi ý Chức Vụ.');
}

// ============ XỬ LÝ GET REQUEST (dùng cho JSONP) ============
// checkin.html dùng JSONP cho các lệnh CHỈ-ĐỌC chạy tự động lúc trang vừa mở:
// getPositionSuggestions, getDepartmentSuggestions, và MỚI: resolveMeetingCode
// (tra cứu cấu hình cuộc họp từ mã ngắn trong QR).
function doGet(e) {
  const params = e.parameter || {};
  const callback = params.callback;
  const action = params.action;

  let result;

  if (action === 'getPositionSuggestions') {
    result = getLearnedSuggestions(SHEET_POSITIONS, DEFAULT_POSITIONS, POSITION_CACHE_KEY);
  } else if (action === 'getDepartmentSuggestions') {
    result = handleGetDepartmentSuggestions(params);
  } else if (action === 'resolveMeetingCode') {
    result = handleResolveMeetingCode(params);
  } else if (action === 'getMeetingConfigByID') {
    result = handleGetMeetingConfigByID(params);
  } else if (action === 'getAttendanceList') {
    // Dùng cho trang Màn Hình Chiếu (display.html) — polling định kỳ, không
    // cần đăng nhập admin, chỉ cần biết meetingID (không phải thông tin mật).
    result = handleGetAttendanceList(params);
  } else if (action === 'getRollCallStatus') {
    // Dùng cho display.html (polling xem có đang Điểm danh đột xuất không)
    // và cho checkin-rollcall.html (trang xác nhận lần 2) để biết token còn
    // hiệu lực hay không trước khi cho bấm xác nhận.
    result = handleGetRollCallStatus(params);
  } else if (action === 'getRollCallList') {
    result = handleGetRollCallList(params);
  } else if (action === 'submitAttendance') {
    // MỚI: chuyển từ doPost sang doGet — xem ghi chú lớn phía trên doGet (tìm
    // "SỬA LỚN — TOÀN BỘ ACTION GHI DỮ LIỆU").
    result = handleSubmitAttendance(params);
  } else if (action === 'checkAttendance') {
    result = handleCheckAttendance(params);
  } else if (action === 'listMeetings') {
    result = handleListMeetings(params);
  } else if (action === 'saveMeetingConfig') {
    // QUAN TRỌNG: qua doGet, MỌI giá trị trong e.parameter đều là STRING thô —
    // field "config" đi qua URL dưới dạng chuỗi JSON.stringify() (xem
    // callGASJsonpOnce trong index.html, phần tự động stringify object trước
    // khi đưa vào query string). handleSaveMeetingConfig() lại mong đợi
    // payload.config là 1 OBJECT thật (nó tự JSON.stringify khi ghi xuống
    // Sheet) — nên phải JSON.parse() lại ở đây trước khi gọi, nếu không toàn
    // bộ cấu hình cuộc họp sẽ bị lưu sai thành chuỗi "[object Object]".
    let parsedConfig = {};
    try {
      parsedConfig = JSON.parse(params.config || '{}');
    } catch (e2) {
      Logger.log('doGet saveMeetingConfig: lỗi parse config JSON - ' + e2);
    }
    result = handleSaveMeetingConfig({ meetingID: params.meetingID, config: parsedConfig });
  } else if (action === 'startRollCall') {
    result = handleStartRollCall(params);
  } else if (action === 'stopRollCall') {
    result = handleStopRollCall(params);
  } else if (action === 'submitRollCall') {
    result = handleSubmitRollCall(params);
  } else if (action === 'shortenLink') {
    result = handleShortenLink(params);
  } else {
    result = sendResponse(false, 'Action không hợp lệ (doGet/JSONP): ' + action);
  }

  const jsonText = result.getContent();

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + jsonText + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return result;
}

// ============ HÀM TEST ============
function testWebApp() {
  const mockEvent = {
    postData: {
      contents: JSON.stringify({
        action: 'submitAttendance',
        meetingID: 'TEST-001',
        fullName: 'Nguyễn Văn A',
        position: 'Phó Sở Trưởng',
        department: 'Sở XYZ',
        deviceToken: 'test-device-token-123',
        timestamp: new Date().toISOString()
      })
    }
  };

  const result = doPost(mockEvent);
  Logger.log(result.getContent());
}
