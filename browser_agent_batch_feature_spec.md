# Browser Agent - Batch Workflow Feature Specification

## 1. Mục tiêu

Bổ sung tính năng **Batch Workflow** cho Browser Agent hiện tại.

Mục tiêu là cho phép người dùng record một quy trình thao tác trên một trang web, trong đó cùng một quy trình được lặp lại với từng dòng dữ liệu trong một file/dataset.

Use case chính:

1. Có một file Excel chứa nhiều dòng dữ liệu.
2. Người dùng click vào từng ô trên website và record:
   - `Add → Batch → Input`
   - `Add → Batch → Click`
   - `Add → Batch → Search`
   - `Add → Batch → Extract`
3. Mỗi `Batch Input` được map với một cột dữ liệu.
4. Khi chạy, Browser Agent lấy từng row, đưa dữ liệu vào các ô tương ứng.
5. Sau mỗi lần input, giá trị cũ trong ô phải được thay thế bằng giá trị mới.
6. Thực hiện các Click theo đúng thứ tự đã record.
7. Thực hiện Search.
8. Chờ kết quả.
9. Extract dữ liệu kết quả.
10. Lưu kết quả thành từng record.
11. Chuyển sang row tiếp theo và lặp lại cho đến hết dataset.

Đây là tính năng tổng quát của Browser Agent, không phụ thuộc vào một website hay business use case cụ thể.

---

# 2. Không thay đổi cấu trúc Add hiện tại

Giữ nguyên cơ chế Add hiện tại.

Menu:

```text
+ Add
├── Image
├── Text
├── Data Table
└── Batch
    ├── Input
    ├── Click
    ├── Search
    └── Extract
```

Không tạo các menu riêng như:

```text
Batch Input
Batch Click
Batch Search
Batch Extract
```

Tên UI phải giữ đúng cấu trúc:

```text
Add → Batch → Input
Add → Batch → Click
Add → Batch → Search
Add → Batch → Extract
```

---

# 3. Batch Workflow là gì?

Batch Workflow là một sequence các node được record trên browser.

Ví dụ:

```text
Batch
├── Input 1
├── Input 2
├── Click 1
├── Input 3
├── Click 2
├── Search
├── Extract 1
└── Extract 2
```

Không được hard-code workflow thành:

```text
Input → Search → Extract
```

Thứ tự node phải đúng theo thứ tự người dùng record.

Ví dụ hợp lệ:

```text
Input 1
Click 1
Input 2
Click 2
Input 3
Search
Extract
```

Hoặc:

```text
Click 1
Input 1
Click 2
Input 2
Search
Extract
```

Batch engine phải hỗ trợ cả hai.

---

# 4. Batch Input

## 4.1 Cách tạo

User:

1. Di chuột/chọn element input trên browser.
2. Click `Add`.
3. Chọn `Batch`.
4. Chọn `Input`.

UI:

```text
Add
→ Batch
→ Input
```

---

## 4.2 Input Type

Batch Input phải hỗ trợ nhiều loại input.

Tối thiểu:

```text
Text
File Upload
Select
Checkbox
Radio
Date / Time
```

Kiến trúc phải cho phép bổ sung Input Type mới trong tương lai.

Không được thiết kế Input chỉ dành cho Text.

---

# 5. Data Source

Batch Input cần lấy dữ liệu từ dataset.

MVP ưu tiên:

```text
Excel
```

Thiết kế architecture không được khóa vào Excel.

Có thể mở rộng sau:

```text
CSV
JSON
Database
API
Folder
Manual Dataset
```

---

# 6. Excel Dataset

Ví dụ:

| A | B | C | D |
|---|---|---|---|
| Code | Model | Line | File |
| A001 | X100 | S01 | C:\data\001.pdf |
| A002 | X200 | S02 | C:\data\002.pdf |
| A003 | X300 | S03 | C:\data\003.pdf |

Mỗi row là một iteration.

Ví dụ:

```text
Row 1:
A001 / X100 / S01 / 001.pdf

Row 2:
A002 / X200 / S02 / 002.pdf

Row 3:
A003 / X300 / S03 / 003.pdf
```

---

# 7. Batch Input Mapping

Khi user tạo:

```text
Add → Batch → Input
```

hiển thị cấu hình:

```text
Batch Input

Element:
[ selected browser element ]

Input Type:
[ Text ▼ ]

Data Source:
[ Excel ▼ ]

File:
[ data.xlsx ]

Column:
[ A - Code ▼ ]

Input Name:
Input 1

Before Input:
[ Replace ▼ ]

[ Save ]
```

Mỗi Batch Input phải có ID/sequence riêng:

```text
Input 1
Input 2
Input 3
...
```

---

# 8. Input Behavior - BẮT BUỘC

Đây là requirement quan trọng.

Mỗi lần chuyển sang row mới, Batch Input phải tự động thay thế giá trị cũ.

Không yêu cầu user record thao tác Clear riêng.

Ví dụ:

```text
Row 1:
Input = A001

Row 2:
Input = A002
```

Khi chạy row 2:

```text
Focus input
→ Clear old value A001
→ Input A002
```

Không được xảy ra:

```text
A001A002
```

---

# 9. Input Replace Modes

Batch Input nên có option:

```text
Before Input

Replace
Append
Keep Existing
```

Mặc định:

```text
Replace
```

### Replace

```text
Old: A001
New: A002

Result:
A002
```

### Append

```text
Old: ABC
New: 001

Result:
ABC001
```

### Keep Existing

Không thay đổi giá trị hiện tại.

MVP có thể chỉ implement `Replace`, nhưng data model phải hỗ trợ mode để mở rộng.

---

# 10. Text Input

Với Text:

```text
Locate element
→ Focus
→ Clear existing value
→ Fill new value
→ Verify
```

Nếu phương pháp clear/fill chính thất bại, có thể fallback:

```text
Focus
→ Ctrl+A
→ Backspace/Delete
→ Type value
→ Verify
```

Không được dựa vào tọa độ màn hình.

Ưu tiên:

```text
DOM
Accessibility
CSS
XPath
Keyboard fallback
```

---

# 11. File Upload

File Upload là một Input Type khác.

Ví dụ:

```text
Add → Batch → Input

Input Type:
File Upload

Data Source:
Excel

Column:
D - File
```

Mỗi row:

```text
Row 1 → upload 001.pdf
Row 2 → upload 002.pdf
Row 3 → upload 003.pdf
```

Không dùng text clear logic cho File Upload.

Phải:

```text
Locate file input
→ Replace current file
→ Upload new file
→ Verify upload if possible
```

---

# 12. Batch Click

## 12.1 Cách tạo

User:

1. Chọn button/element cần click.
2. `Add → Batch → Click`.

Node được tạo:

```text
Click 1
```

Click tiếp:

```text
Click 2
```

...

---

## 12.2 Click phải giữ đúng thứ tự

Ví dụ user record:

```text
Input 1
Click 1
Input 2
Click 2
Search
```

Engine phải chạy đúng:

```text
Input 1
→ Click 1
→ Input 2
→ Click 2
→ Search
```

Không được tự sắp xếp tất cả Input lên trước.

---

# 13. Batch Search

## 13.1 Cách tạo

User chọn Search button:

```text
Add → Batch → Search
```

Node:

```text
Search 1
```

MVP có thể chỉ cần một Search trong một Batch Workflow, nhưng data model nên cho phép nhiều Search nếu sau này cần.

---

# 14. Search phải có Wait Result

Search không được chỉ click rồi lập tức Extract.

Sau Search phải có cơ chế chờ kết quả.

Các điều kiện Wait có thể hỗ trợ:

```text
Element appears
Element disappears
Text appears
Text changes
Loading disappears
URL changes
Network idle
Custom condition
```

MVP có thể ưu tiên:

```text
Element appears
```

và:

```text
Timeout
```

Ví dụ:

```text
Search
→ Wait until result element appears
→ Max 30 seconds
→ Extract
```

Không nên hard-code:

```text
sleep(5000)
```

làm cơ chế chờ chính.

---

# 15. Batch Extract

## 15.1 Cách tạo

Sau khi Search trả kết quả:

1. User di chuột/chọn vùng dữ liệu cần lấy.
2. `Add → Batch → Extract`.

Ví dụ:

```text
Add
→ Batch
→ Extract
```

---

# 16. Extract có thể có nhiều field

Ví dụ:

```text
Extract 1 → Status
Extract 2 → Quantity
Extract 3 → Result
Extract 4 → Date
```

Mỗi Extract phải có:

```text
Extract Name
Element
Extraction Type
```

Extraction Type MVP:

```text
Text
Attribute
Value
```

Có thể mở rộng sau:

```text
Table
JSON
Image
Link
HTML
```

---

# 17. Kết quả phải được lưu theo từng row

Ví dụ Input:

| Code | Model | Line |
|---|---|---|
| A001 | X100 | S01 |
| A002 | X200 | S02 |
| A003 | X300 | S03 |

Extract:

```text
Status
Quantity
Result
```

Output:

| Code | Model | Line | Status | Quantity | Result |
|---|---|---|---|---:|---|
| A001 | X100 | S01 | PASS | 120 | OK |
| A002 | X200 | S02 | PASS | 85 | OK |
| A003 | X300 | S03 | FAIL | 0 | Error |

Input columns phải được giữ lại trong result.

Extract columns được append vào result.

---

# 18. Data Loop Engine

Đây là logic core.

Không cần UI node `Loop`.

User chỉ record:

```text
Input 1
Input 2
Click 1
Input 3
Click 2
Search
Extract 1
Extract 2
```

Engine tự hiểu:

```text
FOR EACH ROW IN DATASET

    Execute Input 1 using row[column]
    Execute Input 2 using row[column]
    Execute Click 1
    Execute Input 3 using row[column]
    Execute Click 2
    Execute Search

    WAIT FOR RESULT

    Execute Extract 1
    Execute Extract 2

    SAVE RESULT

NEXT ROW
```

---

# 19. Không được tạo Loop node trong UI

Không thêm:

```text
Add → Batch → Loop
```

ở MVP.

Loop là behavior nội bộ của Batch Engine.

Mục tiêu UX:

> User chỉ cần record thao tác một lần trên một dòng dữ liệu mẫu. Browser Agent tự lặp workflow với toàn bộ dataset.

---

# 20. Record Flow

Ví dụ user thực hiện:

### Bước 1

Click ô Code:

```text
Add → Batch → Input
Column A
```

### Bước 2

Click ô Model:

```text
Add → Batch → Input
Column B
```

### Bước 3

Click dropdown:

```text
Add → Batch → Input
Input Type = Select
Column C
```

### Bước 4

Click button:

```text
Add → Batch → Click
```

### Bước 5

Click file upload:

```text
Add → Batch → Input
Input Type = File Upload
Column D
```

### Bước 6

Click Search:

```text
Add → Batch → Search
```

### Bước 7

Click vùng Status:

```text
Add → Batch → Extract
```

Workflow:

```text
Batch
├── Input 1 → Column A
├── Input 2 → Column B
├── Input 3 → Column C
├── Click 1
├── Input 4 → Column D
├── Search 1
└── Extract 1
```

---

# 21. Batch Workflow Data Model

Không hard-code theo UI.

Nên có model tổng quát tương tự:

```text
BatchWorkflow
├── id
├── name
├── dataSource
├── dataSourceConfig
├── nodes[]
└── resultConfig
```

Node:

```text
BatchNode
├── id
├── type
├── order
├── element
├── config
└── enabled
```

Type:

```text
INPUT
CLICK
SEARCH
EXTRACT
```

Input config:

```text
{
  inputType,
  dataSource,
  column,
  replaceMode
}
```

Click config:

```text
{
  element,
  clickType
}
```

Search config:

```text
{
  element,
  waitCondition,
  timeout
}
```

Extract config:

```text
{
  element,
  extractType,
  outputName
}
```

Không gắn logic vào tên `Input1`, `Input2`.

`Input 1` chỉ là display label dựa trên thứ tự.

---

# 22. Element Identification

Không sử dụng coordinate làm locator chính.

Mỗi recorded element nên lưu càng nhiều thông tin càng tốt:

```text
Element
├── tag
├── id
├── name
├── role
├── aria-label
├── text
├── CSS selector
├── XPath
├── attributes
└── screenshot/visual metadata nếu cần
```

Khi chạy, locator nên có fallback/self-healing.

---

# 23. Execution State

Batch Runner phải có trạng thái:

```text
Idle
Running
Waiting
Success
Failed
Paused
Stopped
Completed
```

Theo từng row:

```text
Pending
Running
Success
Failed
Skipped
```

---

# 24. Error Handling

Nếu một row lỗi:

```text
Row 10 → Failed
```

không được mặc định dừng toàn bộ Batch.

MVP nên:

```text
Row 10
→ Error
→ Save error
→ Continue Row 11
```

Có thể hỗ trợ Retry:

```text
Retry count = 3
```

Sau khi retry hết:

```text
Failed
→ Continue next row
```

---

# 25. Resume

Batch phải có khả năng xác định row hiện tại.

Ví dụ:

```text
Total: 1000
Completed: 500
Current: 501
```

Nếu browser/process bị dừng:

```text
Resume
→ Row 501
```

Không chạy lại toàn bộ từ đầu.

Có thể để Resume là Phase 2 nếu MVP cần đơn giản.

---

# 26. Test Run

Trước khi chạy toàn bộ dataset phải có:

```text
Test Current Row
```

Ví dụ:

```text
[ Test Row 1 ]
```

Chạy:

```text
Row 1
→ Input
→ Click
→ Search
→ Wait
→ Extract
```

Nếu thành công:

```text
Test Passed
```

sau đó mới:

```text
Run All
```

---

# 27. Preview Workflow

UI nên hiển thị:

```text
BATCH WORKFLOW

Data:
data.xlsx

Input 1 → Column A
Input 2 → Column B
Input 3 → Column C

Click 1

Input 4 → Column D

Search

Extract 1 → Status
Extract 2 → Result

Rows:
100
```

Buttons:

```text
[Test Row]
[Run All]
[Pause]
[Stop]
```

---

# 28. Result Monitor

Trong khi chạy:

```text
Batch: Product Search

Progress:
████████████░░░░ 75%

Current Row:
76 / 100

Status:
Running

Results:
┌──────┬────────┬──────────┐
│ Row  │ Status │ Result   │
├──────┼────────┼──────────┤
│ 1    │ ✓      │ PASS     │
│ 2    │ ✓      │ PASS     │
│ 3    │ ✗      │ Error    │
│ ...  │ ...    │ ...      │
│ 76   │ ●      │ Running  │
└──────┴────────┴──────────┘
```

---

# 29. Important UX Principle

Không yêu cầu user hiểu:

```text
Variable
Loop
For Each
Programming
```

User chỉ cần:

```text
Click element
→ Add
→ Batch
→ Input
→ Chọn cột
```

hoặc:

```text
Click button
→ Add
→ Batch
→ Click
```

hoặc:

```text
Click Search
→ Add
→ Batch
→ Search
```

hoặc:

```text
Click result
→ Add
→ Batch
→ Extract
```

Browser Agent tự xây execution loop.

---

# 30. Scope của implementation

## Phase 1 - MVP

Implement:

```text
Add → Batch → Input
Add → Batch → Click
Add → Batch → Search
Add → Batch → Extract
```

Dataset:

```text
Excel
```

Input Types:

```text
Text
File Upload
Select
```

Behavior:

```text
Replace existing value
Sequential execution
Wait for result
Extract text
Save result
```

## Phase 2

Thêm:

```text
Checkbox
Radio
Date/Time
CSV
JSON
Retry
Pause
Resume
```

## Phase 3

Thêm:

```text
Conditional logic
Multiple Search
Advanced Wait
Self-healing locator
Parallel execution
Database/API datasource
```

---

# 31. Acceptance Criteria

Feature được xem là hoàn thành khi:

### AC-01
User có thể mở:

```text
Add → Batch → Input
```

và tạo Input node.

### AC-02
User có thể map Input với Excel column.

### AC-03
Có thể tạo nhiều Input:

```text
Input 1
Input 2
Input 3
...
```

### AC-04
Input Text mặc định phải replace giá trị cũ trước khi nhập giá trị mới.

Ví dụ:

```text
Row 1: ABC
Row 2: XYZ
```

Không được tạo:

```text
ABCXYZ
```

### AC-05
Có thể upload file theo từng row từ đường dẫn/file column.

### AC-06
User có thể tạo nhiều Click node theo thứ tự record.

### AC-07
User có thể tạo Search node.

### AC-08
Search phải chờ kết quả trước khi Extract.

### AC-09
User có thể tạo nhiều Extract node.

### AC-10
Mỗi row tạo ra một result record.

### AC-11
Batch tiếp tục sang row tiếp theo sau khi row trước thành công.

### AC-12
Một row lỗi không làm mất toàn bộ kết quả đã chạy.

### AC-13
Có Test Row trước khi Run All.

### AC-14
Workflow giữ nguyên thứ tự node user đã record.

### AC-15
Không dùng screen coordinates làm locator chính.

---

# 32. Ví dụ hoàn chỉnh

Excel:

| A | B | C | D |
|---|---|---|---|
| Code | Model | Line | File |
| A001 | X100 | S01 | 001.pdf |
| A002 | X200 | S02 | 002.pdf |
| A003 | X300 | S03 | 003.pdf |

Recorded workflow:

```text
1. Batch Input
   Column A
   Type: Text

2. Batch Input
   Column B
   Type: Text

3. Batch Input
   Column C
   Type: Select

4. Batch Click
   Element: Add/Select button

5. Batch Input
   Column D
   Type: File Upload

6. Batch Search
   Element: Search

7. Batch Extract
   Element: Status

8. Batch Extract
   Element: Result
```

Runtime:

```text
ROW 1
A001 / X100 / S01 / 001.pdf
↓
Replace Input 1
Replace Input 2
Select Input 3
Click
Upload 001.pdf
Search
Wait
Extract Status
Extract Result
Save

ROW 2
A002 / X200 / S02 / 002.pdf
↓
Replace Input 1
Replace Input 2
Select Input 3
Click
Upload 002.pdf
Search
Wait
Extract Status
Extract Result
Save

ROW 3
...
```

Final result:

| Code | Model | Line | File | Status | Result |
|---|---|---|---|---|---|
| A001 | X100 | S01 | 001.pdf | PASS | OK |
| A002 | X200 | S02 | 002.pdf | PASS | OK |
| A003 | X300 | S03 | 003.pdf | FAIL | Error |

---

# 33. Implementation Principle

Không rewrite toàn bộ Browser Agent chỉ để thêm Batch.

Hãy tích hợp Batch vào architecture hiện tại:

```text
Existing Recorder
       │
       ├── Image
       ├── Text
       ├── Data Table
       │
       └── Batch
            ├── Input
            ├── Click
            ├── Search
            └── Extract
```

Batch nên là một module độc lập:

```text
Batch Module
├── BatchRecorder
├── BatchNode
├── BatchDataset
├── BatchMapper
├── BatchExecutor
├── BatchExtractor
├── BatchResult
└── BatchRunner
```

Không làm Batch phụ thuộc trực tiếp vào UI.

UI chỉ tạo cấu hình.

Engine chịu trách nhiệm execute.

---

# 34. Core Concept cần giữ nguyên

Browser Agent phải hiểu Batch theo mô hình:

```text
DATASET
   ↓
CURRENT ROW
   ↓
EXECUTE RECORDED BATCH NODES
   ↓
WAIT
   ↓
EXTRACT
   ↓
SAVE RESULT
   ↓
NEXT ROW
```

Trong đó:

```text
Input  = lấy dữ liệu từ Dataset → Website
Click  = thao tác Website
Search = trigger + wait result
Extract = Website → Result Dataset
```

Đây là nền tảng để sau này mở rộng Browser Agent mà không phải thay đổi concept hiện tại.
