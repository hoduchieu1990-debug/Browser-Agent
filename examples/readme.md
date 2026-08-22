# Example Workflows

## upload-excel-basic.json
Upload 1 file Excel lên form, chờ xử lý rồi extract bảng kết quả.

- **Params**: `excelFile` (bắt buộc), `outputFormat` (tùy chọn: xlsx/csv/json)
- **Flow**: navigate → uploadFile → wait 3s → extractTable (`ID, Name, Email, Status`)
- **Export**: `results.xlsx`

## login-upload-extract.json
Đăng nhập, sau đó upload Excel và extract kết quả đã xử lý.

- **Params**: `username`, `password`, `excelFile` (đều bắt buộc)
- **Flow**: navigate login → input username/password → click login → waitForSelector dashboard → navigate upload → uploadFile → click process → waitForSelector results → extractTable (`ID, Input, Output, Status`)
- **Export**: `results.xlsx`, `results.csv`

## upload-with-popups.json
Upload Excel trên trang có cookie banner / popup che form.

- **Params**: `excelFile` (bắt buộc)
- **Đặc điểm**: `globalSettings.autoDismissPopup` bật với danh sách selector cụ thể (cookie-accept, modal-close, aria-label Close...); có thêm bước `dismissPopup` tường minh trước khi upload để đảm bảo popup không chặn action
- **Flow**: navigate → dismissPopup → uploadFile → click process → waitForSelector (success hoặc bảng kết quả) → extractTable (`Status, Count, Message`)
- **Export**: `results.xlsx`
