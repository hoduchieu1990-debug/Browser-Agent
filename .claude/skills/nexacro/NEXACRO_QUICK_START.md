# 🚀 Nexacro Skill - Quick Start Guide

**For Recording & Automating Nexacro Desktop Apps (Wrap Browser)**

---

## 📦 Files You Have

1. **`nexacro_element_recording_skill.md`** ⭐ Main skill documentation
   - Complete reference for Nexacro operations
   - Best practices, troubleshooting
   - Integration examples

2. **`nexacro_helper_minimal.py`** ⭐ Production-ready helper module
   - Copy this file into your project
   - Use with Playwright page object

---

## ⚡ 30-Second Setup

```python
# 1. Import (copy nexacro_helper_minimal.py to your project)
from nexacro_helper_minimal import NexacroHelper

# 2. Initialize with your Playwright page
helper = NexacroHelper(page)

# 3. Use it!
helper.click("btnSubmit")
helper.fill("edtUsername", "admin")
helper.select("cboYear", "2024")
```

---

## 🎯 Most Common Tasks

### **Click Button**
```python
helper.click("btnSearch")
```

### **Fill Textbox**
```python
helper.fill("edtUsername", "admin")
helper.fill("edtPassword", "password123")
```

### **Select ComboBox Option**
```python
helper.select("cboStatus", "active")
helper.select("cboYear", "2024")
```

### **Check/Uncheck Checkbox**
```python
helper.check("chkActive", checked=True)
helper.check("chkApproved", checked=False)
```

### **Get Value**
```python
username = helper.get_value("edtUsername")
print(f"Username: {username}")
```

### **Batch Actions**
```python
steps = [
    {'action': 'fill', 'id': 'edtUsername', 'value': 'admin'},
    {'action': 'fill', 'id': 'edtPassword', 'value': 'pass123'},
    {'action': 'click', 'id': 'btnLogin'},
    {'action': 'wait', 'ms': 2000},
]

results = helper.execute_steps(steps)
```

---

## 🔍 Find Component IDs

In your Nexacro app's browser DevTools console:

```javascript
// List all components
const frm = nexacro.getActiveFrame();
for (const id in frm.components) {
    const comp = frm.components[id];
    if (comp.visible) {
        console.log(`ID: ${id}, Type: ${comp._type}`);
    }
}

// Or inspect specific component
nexacro.getActiveFrame().lookup('edtUsername')  // Returns component
```

---

## 📋 Action Types

| Action | Code | Example |
|--------|------|---------|
| Click | `{'action': 'click', 'id': '...'}` | `{'action': 'click', 'id': 'btnSubmit'}` |
| Fill | `{'action': 'fill', 'id': '...', 'value': '...'}` | `{'action': 'fill', 'id': 'edtName', 'value': 'John'}` |
| Select | `{'action': 'select', 'id': '...', 'value': '...'}` | `{'action': 'select', 'id': 'cboYear', 'value': '2024'}` |
| Check | `{'action': 'check', 'id': '...', 'checked': True/False}` | `{'action': 'check', 'id': 'chkActive', 'checked': True}` |
| Get Value | `{'action': 'get_value', 'id': '...'}` | `{'action': 'get_value', 'id': 'edtResult'}` |
| Wait | `{'action': 'wait', 'ms': ...}` | `{'action': 'wait', 'ms': 1000}` |

---

## 💻 Real Example

```python
from playwright.sync_api import sync_playwright
from nexacro_helper_minimal import NexacroHelper

# Launch Nexacro app
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto("http://your-nexacro-app")
    
    helper = NexacroHelper(page)
    
    # Login
    helper.fill("edtUsername", "admin")
    helper.fill("edtPassword", "pass123")
    helper.click("btnLogin")
    helper.wait(2000)
    
    # Search
    helper.fill("edtSearchKeyword", "inventory")
    helper.select("cboStatus", "active")
    helper.click("btnSearch")
    helper.wait(2000)
    
    # Export
    helper.check("chkIncludeDetails", checked=True)
    helper.click("btnExport")
    
    browser.close()
```

---

## 🐛 Debugging

### **Check if Component Exists**
```python
elem = helper.locate("edtUsername")
print(f"Found: {elem.found}, Type: {elem.component_type}")
```

### **Inspect Component**
```python
info = helper.inspect("edtUsername")
print(info)
# Output: {'id': 'edtUsername', 'type': 'TextBox', 'value': '', 'visible': True, ...}
```

### **List All Components**
```python
all_comps = helper.list_all_components()
for comp in all_comps:
    print(f"{comp['id']:20} {comp['type']:15} visible={comp['visible']}")
```

---

## 🎬 Record & Playback

### **Record User Actions**
```python
helper.start_recording()

# User does stuff...
helper.click("btnSubmit")
helper.fill("edtName", "John")

# Export recorded actions
events = helper.get_recorded_events()
steps = helper.export_recording_to_steps(events)

print("Recorded steps:")
for step in steps:
    print(step)
```

### **Output:**
```
Recorded steps:
{'action': 'click', 'id': 'btnSubmit'}
{'action': 'fill', 'id': 'edtName', 'value': 'John'}
```

---

## 🔗 Component ID Convention

**Standard Nexacro prefixes:**
- `edt` = TextBox / Edit (text input)
- `btn` = Button (clickable)
- `cbo` = ComboBox (dropdown)
- `chk` = CheckBox
- `rad` = Radio button
- `grd` = Grid (table)
- `dsc` = DataSet (data)
- `lbl` = Label (read-only text)
- `stc` = Static (constant)
- `dtc` = Date picker

**Examples:**
- `edtUsername` → TextBox for username
- `btnSubmit` → Submit button
- `cboYear` → Year selection dropdown
- `chkActive` → Active status checkbox
- `grdData` → Data grid table

---

## ✨ Integration with Your Playwright Skill

Since you already have Playwright skill, just add Nexacro:

```python
# In your browser_agent.py
from nexacro_helper_minimal import NexacroHelper

class BrowserAgent:
    def __init__(self, page):
        self.page = page
        self.nexacro = NexacroHelper(page)  # ← Add this line
    
    def interact_nexacro(self, steps):
        """Handle Nexacro components"""
        return self.nexacro.execute_steps(steps)
    
    def interact_dom(self, selector, action):
        """Handle standard DOM (use your Playwright skill)"""
        # ... your existing Playwright code ...
```

---

## 🚨 Common Issues

### **"Component not found"**
- Check component ID is correct (case-sensitive)
- Use DevTools console to verify: `nexacro.getActiveFrame().lookup('id')`

### **"Value not setting"**
- Ensure component is `enabled: true`
- Try triggering `onchange()` after `set_value()`

### **"Click not working"**
- Try multiple methods: `click()`, `onclick()`, dispatch event
- Check if component is visible

→ See **nexacro_element_recording_skill.md** Section 8 for full troubleshooting

---

## 📚 Full Documentation

Read **`nexacro_element_recording_skill.md`** for:
- Nexacro architecture deep dive
- All component types
- Advanced recording
- Grid/Dataset operations
- Complete troubleshooting

---

## 🎓 Next Steps

1. **Copy `nexacro_helper_minimal.py`** into your project
2. **Import in your browser agent**: `from nexacro_helper_minimal import NexacroHelper`
3. **Initialize**: `helper = NexacroHelper(page)`
4. **Use**: `helper.click("btnSubmit")`

---

## ✅ You're Ready!

This skill lets you:
- ✓ Record Nexacro element interactions
- ✓ Automate forms & workflows
- ✓ Extract data from grids
- ✓ Batch operations
- ✓ Debug component issues

**Happy Nexacro automation!** 🚀
