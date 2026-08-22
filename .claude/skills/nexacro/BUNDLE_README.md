# Nexacro Object Model & JavaScript API - Agent Guide Bundle

Đây là bộ tài liệu hoàn chỉnh để **Agent tự động hóa tương tác với Nexacro applications** sử dụng Playwright.

---

## 📦 Files in This Bundle

### 1. **nexacro_reference.html** ⭐ (Khuyến nghị chính)
- **Loại:** HTML standalone (mở trong browser)
- **Dung lượng:** ~100KB (khi render)
- **Sử dụng:** 
  - Mở file này trực tiếp trong trình duyệt để xem đầy đủ tài liệu
  - Có **search** tìm kiếm nhanh
  - Có **navigation** sidebar để dễ jump between sections
  - Không cần internet access
- **Ưu điểm:**
  - Giao diện đẹp, dễ đọc
  - Tìm kiếm nhanh
  - Smooth scrolling
  - Mobile-friendly
  - Tương thích tất cả trình duyệt

### 2. **nexacro_object_model_api_guide.md** (Comprehensive Reference)
- **Loại:** Markdown document
- **Dung lượng:** 32KB
- **Sử dụng:**
  - Đầy đủ nhất, chi tiết tất cả API
  - Dùng khi cần copy-paste code snippets
  - Version control friendly (git)
  - Có thể convert sang PDF nếu cần
- **Nội dung:**
  - Object Model Hierarchy
  - Global Nexacro API
  - Form Lifecycle Events
  - Component Types (Button, TextInput, Combo, Grid, CheckBox, Radio)
  - Event System
  - Data Binding & Datasets
  - Agent Automation Patterns
  - Element Selection & Interaction
  - Form Navigation
  - Common RPA Workflows
  - Debugging Tips
  - Performance Optimization

### 3. **nexacro_browser_agent_skill.md** (Agent-Focused)
- **Loại:** Markdown skill file
- **Dung lượng:** 19KB
- **Sử dụng:** 
  - **Cho Agent đọc trước khi tự động hóa task**
  - Template cho mỗi loại task
  - Practical code snippets sẵn sàng dùng
- **Nội dung:**
  - Quick Start Template (4 bước)
  - Common Tasks (Search, CRUD, Wizard, Batch)
  - Advanced Selectors
  - Custom Evaluations
  - Debugging Checklist
  - Performance Tips
  - Common Pitfalls & Solutions
  - Comprehensive reference table

---

## 🚀 Quick Start Guide

### Cho Hieu (Developer/Architect)

1. **Lần đầu tiên:**
   - Mở `nexacro_reference.html` trong browser
   - Scroll qua tất cả sections để hiểu overview
   - Bookmark cho reference nhanh

2. **Khi cần viết automation:**
   - Mở `nexacro_browser_agent_skill.md`
   - Copy template cho task type của bạn
   - Adapt theo UI của ứng dụng cụ thể

3. **Khi debug hoặc học sâu:**
   - Mở `nexacro_object_model_api_guide.md`
   - Tìm section liên quan (Ctrl+F)
   - Kiểm tra API detail

### Cho Agent (Automation)

Khi Agent nhận task "automate Nexacro application":

1. **Reconnaissance Phase** (từ skill file):
```javascript
// Agent tự động chạy code này để hiểu page structure
const pageInfo = await page.evaluate(() => {
    const app = window.nexacro?.getApplication?.();
    const form = app?.mainForm;
    
    return {
        formName: form?.name,
        components: Object.keys(form || {}),
        datasets: Object.keys(form || {}).filter(key => key.startsWith('ds'))
    };
});
```

2. **Task Execution** (theo pattern từ skill file):
   - Fill inputs
   - Click buttons
   - Wait for results
   - Extract data

3. **Error Handling:**
   - Check error messages on page
   - Log for debugging
   - Retry if needed

---

## 📋 Organization of Content

### By Task Type:

| Task | File | Section |
|------|------|---------|
| Search & retrieve data | skill.md | "Task: Search Form & Retrieve Results" |
| Create new record | skill.md | "Task: Fill Multi-Step Form" |
| Update existing | skill.md | "Task: Edit Grid Row & Save" |
| Delete records | skill.md | "Task: Batch Delete Rows" |
| Handle dropdowns | skill.md | "Task: Handle Dropdown/Combo Selection" |
| Multi-form navigation | skill.md | "Task: Navigate Between Forms" |
| Long-running task | skill.md | "Task: Wait for Long-Running Task" |

### By Component Type:

| Component | Reference.html | API Guide |
|-----------|---|---|
| Button | Components → Button | Component Types: Button |
| TextInput | Components → TextInput | Component Types: TextInput |
| Combo | Components → Combo | Component Types: Combo |
| Grid | Components → Grid | Component Types: Grid |
| CheckBox | Components → CheckBox | Component Types: CheckBox |
| Radio | Components → Radio | Component Types: Radio |

### By Concept:

| Concept | Files |
|---------|-------|
| Object hierarchy | reference.html, api_guide.md |
| Event handlers | reference.html, api_guide.md, skill.md |
| Dataset operations | api_guide.md, skill.md |
| Element selection | skill.md, api_guide.md |
| Wait strategies | skill.md, api_guide.md |
| Error handling | skill.md |
| Debugging | reference.html, api_guide.md, skill.md |

---

## 🔧 Practical Examples by Use Case

### Use Case 1: Order Search System

**Files to read:**
- `skill.md` → "Task: Search Form & Retrieve Results"
- `reference.html` → Navigate to Components section (TextInput, Button, Grid)

**Pattern:**
1. Fill search criteria → `await page.fill()`
2. Click Search → `await page.click()`
3. Wait for results → `await page.waitForFunction()`
4. Extract grid → `await page.evaluate()`

### Use Case 2: Data Entry Form (Multi-step)

**Files to read:**
- `skill.md` → "Task: Fill Multi-Step Form"
- `reference.html` → Events section

**Pattern:**
1. Fill step 1 fields
2. Click Next
3. Wait for step 2 → `waitForSelector()`
4. Fill step 2 fields
5. Submit → `click()` + `waitForLoadState()`

### Use Case 3: Dropdown Selection (Problematic)

**Files to read:**
- `skill.md` → "Task: Handle Dropdown/Combo Selection"
- `api_guide.md` → Combo Component section

**Pattern:**
```javascript
// Method 1: Click (may fail with custom dropdowns)
await page.click('#cboStatus');
await page.click('text=Completed');

// Method 2: API (reliable)
await page.evaluate(({ comboId, value }) => {
    const app = window.nexacro.getApplication();
    const combo = app.mainForm[comboId];
    // Find index of value and setIndex()
}, { comboId: 'cboStatus', value: 'COMPLETED' });
```

### Use Case 4: Grid Row Edit & Save

**Files to read:**
- `skill.md` → "Task: Edit Grid Row & Save"
- `api_guide.md` → Grid Component section

**Pattern:**
1. Select row → `page.click('#grdData_row_0')`
2. Open edit form → `dblclick()` or click Edit button
3. Fill fields → `page.fill()`
4. Save → `page.click()` + wait

---

## 💡 Tips for Using These Guides

### 1. Keep reference.html as a Bookmark
```
Browser Bookmark: file:///path/to/nexacro_reference.html
```

### 2. Search Function (reference.html)
Press `Ctrl+F` in the HTML to search across all content

### 3. Copy-Paste Code Snippets
- From `reference.html`: Sections have ready-to-use code
- From `api_guide.md`: Markdown format easier to copy from editor
- From `skill.md`: Task-specific templates

### 4. Keep Terminal Open with Both Files
```bash
# Terminal 1: Editor with API guide
code nexacro_object_model_api_guide.md

# Terminal 2: Browser with HTML reference
open nexacro_reference.html
# or
chrome nexacro_reference.html
```

### 5. Before Automation Task
- Read `skill.md` → Section matching your task type
- Check `reference.html` → Components section for specific elements
- Test selectors in browser console first:
  ```javascript
  var app = window.nexacro.getApplication();
  console.log(app.mainForm.Button00);  // Verify component exists
  ```

---

## 🐛 Debugging with These Guides

### Common Problem: "Element not found"

**Steps:**
1. Read `skill.md` → "Debugging Tips for Agent" section
2. Run code from "Check What Components Are Available"
3. Verify component ID exists
4. Check selector syntax using browser console

### Common Problem: "Wrong value selected"

**Steps:**
1. Read `skill.md` → "Task: Handle Dropdown/Combo Selection"
2. Try API method instead of clicking
3. Debug: `console.log(combo.itemcount)` to check if items exist

### Common Problem: "Timeout waiting for data"

**Steps:**
1. Read `skill.md` → "Debugging Tips" section
2. Check "Wait Strategies" table
3. Add error callback logging
4. Check network tab for failed requests

---

## 📚 Learning Path

### If you're new to Nexacro automation:

1. **Start:** Read `reference.html` completely (30 mins)
2. **Learn:** Read `skill.md` sections matching your tasks (30 mins)
3. **Practice:** Implement simple task (search, create) (1 hour)
4. **Reference:** Use `api_guide.md` for deep dives

### If you know Nexacro basics:

1. **Quick:** Skim `reference.html` (10 mins)
2. **Apply:** Use `skill.md` task templates directly (5 mins)
3. **Debug:** Check `api_guide.md` when stuck (as needed)

### If you're integrating with Agent:

1. **Provide skill.md to Agent** ← Most important
2. **Agent reads:**
   - Reconnaissance pattern
   - Task-specific templates
   - Common pitfalls
3. **You read:**
   - `reference.html` for manual debugging
   - `api_guide.md` for component details

---

## 🔗 External Resources

These guides reference and compile from:

- **TOBESOFT Official Docs:** https://docs.tobesoft.com/
- **Github Samples:**
  - Nexacro N V24: https://github.com/TOBESOFT-DOCS/sample_Nexacro_N_V24
  - Platform 17: https://github.com/TOBESOFT-DOCS/sample_nexacroplatform_17
  - Spring Integration: https://github.com/nexacro-spring/
- **Playwright Docs:** https://playwright.dev/

---

## 📝 File Sizes & Format

| File | Format | Size | Best For |
|------|--------|------|----------|
| nexacro_reference.html | HTML | ~100KB | Browser viewing, fast reference |
| nexacro_object_model_api_guide.md | Markdown | 32KB | Detailed reading, searching |
| nexacro_browser_agent_skill.md | Markdown | 19KB | Agent automation, task templates |
| README.md | Markdown | This file | Navigation & guidance |

**Total:** ~150KB (all markdown combined), ~200KB when rendered as HTML

---

## 🎯 Next Steps

1. **Open `nexacro_reference.html` in browser now** ← Start here
2. **Bookmark it** for quick reference
3. **When automating a specific task:**
   - Find matching pattern in `skill.md`
   - Copy template
   - Adapt to your UI
   - Test selectors in browser console

---

## ❓ FAQ

**Q: Can I convert these files to PDF?**
A: Yes. Use:
- `pandoc nexacro_object_model_api_guide.md -o guide.pdf`
- Or browser's Print → Save as PDF function for HTML

**Q: Are these guides version-specific?**
A: They cover Nexacro N V24 and Platform 17. Older versions may have API differences.

**Q: Can Agent directly read these files?**
A: Yes. Provide `nexacro_browser_agent_skill.md` in Agent's context for automation tasks.

**Q: Which file should I prioritize?**
A: 
- First-time: `nexacro_reference.html` (overview)
- For automation: `nexacro_browser_agent_skill.md` (task templates)
- For deep reference: `nexacro_object_model_api_guide.md` (complete API)

---

## 📞 Source Documentation

Nếu cần thông tin cập nhật hơn:
- Nexacro Official: https://docs.tobesoft.com/
- TOBESOFT Support: https://www.tobesoft.com/ (Vietnamese support available)

---

**Last Updated:** August 2026  
**Compiled from:** TOBESOFT Official Documentation + Github Community Samples  
**Compatible with:** Nexacro N V24, Platform 17+

Happy automating! 🚀
