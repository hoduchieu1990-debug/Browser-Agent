# Skill: Nexacro Desktop App Element Recording

## Mục đích
Cung cấp strategies, helpers, và best practices để record, locate, và interact với elements trong Nexacro desktop apps wrap vào browser. Dùng kết hợp với Playwright skill của bạn.

## Trigger Conditions
- Recording elements trên Nexacro desktop application
- Nexacro components (TextBox, Button, ComboBox, Grid, CheckBox, etc.)
- Element không thể locate bằng standard DOM selectors
- Cần interact với Nexacro Object Model (`nexacro.getActiveFrame().lookup()`)
- Batch actions trên Nexacro form

---

## 1. Understanding Nexacro Architecture

### **Key Difference: Nexacro vs Standard Web**

```javascript
// Standard Web DOM
document.getElementById('myButton').click()
document.querySelector('input[name="username"]').value = 'admin'

// Nexacro Wrap (completely different)
const frm = nexacro.getActiveFrame();
frm.lookup('btnSubmit').click();
frm.lookup('edtUsername').set_value('admin');
```

**Nexacro Components** are NOT standard HTML elements:
- Custom rendering (không phải DOM)
- Component ID format: `btnSubmit`, `edtUsername`, `cboYear`, `chkActive`, etc.
- Access via Nexacro Object Model API
- Events: `onclick`, `onchange`, `onfocusout`, etc.

---

## 2. Nexacro Component Types

```javascript
// Common Nexacro component types
TextBox    → edtUsername, edtPassword
Button     → btnSearch, btnSubmit, btnCancel
ComboBox   → cboStatus, cboYear, cboMonth
CheckBox   → chkActive, chkApproved
Grid       → grdData, grdResult (table)
Label      → lblTitle, lblMessage
Edit       → edtNotes (text area)
Static     → stcVersion (read-only label)
Radio      → radGender, radOption (radio button group)
Popup      → popMenu, popFilter (popup window)
Tab        → tabData, tabConfig (tab control)
Date       → dtcFromDate, dtcToDate (date picker)
```

**Nexacro Component ID Convention:**
- Prefix (2-3 chars) + descriptive name
- Examples: `edt` = Edit, `btn` = Button, `cbo` = ComboBox, `chk` = CheckBox, `grd` = Grid

---

## 3. Locating Nexacro Elements

### **Method 1: Access Directly by Component ID** (Preferred)

```javascript
// Direct access - fastest
const frm = nexacro.getActiveFrame();
const component = frm.lookup('edtUsername');  // Get component
console.log(component.value);                  // Get value
```

### **Method 2: Detect Element Type**

```javascript
// Determine what element type it is
function inspectNexacroElement(componentId) {
  const frm = nexacro.getActiveFrame();
  const comp = frm.lookup(componentId);
  
  if (!comp) return { found: false };
  
  return {
    found: true,
    id: componentId,
    type: comp._type || comp.constructor.name,
    visible: comp.visible,
    enabled: comp.enabled,
    value: comp.value || comp.get_value?.() || '',
    readonly: comp.readonly || false,
    tagName: comp.tagName || 'nexacro-component'
  };
}
```

### **Method 3: Find by Text Content** (Complex)

```javascript
// Search for component containing specific text
function findComponentByText(frm, searchText) {
  const results = [];
  
  for (const compId in frm.components) {
    const comp = frm.components[compId];
    
    // Check if component contains text
    if (comp.value && comp.value.includes(searchText)) {
      results.push({ id: compId, value: comp.value });
    }
    if (comp.text && comp.text.includes(searchText)) {
      results.push({ id: compId, text: comp.text });
    }
  }
  
  return results;
}
```

---

## 4. Interacting with Nexacro Elements

### **A. Click Component**

```javascript
// Method 1: Direct click()
const frm = nexacro.getActiveFrame();
const btn = frm.lookup('btnSubmit');
btn.click();

// Method 2: Call onclick() handler
btn.onclick();

// Method 3: Trigger click event
const domElem = btn.getDOMElement?.();
if (domElem) {
  domElem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}
```

### **B. Fill Text (TextBox, Edit)**

```javascript
const frm = nexacro.getActiveFrame();
const edt = frm.lookup('edtUsername');

// Set value
edt.set_value('admin');

// Focus & trigger change
edt.setFocus?.();
edt.onchange?.();
```

### **C. Select Option (ComboBox)**

```javascript
const frm = nexacro.getActiveFrame();
const cbo = frm.lookup('cboYear');

// Set selection
cbo.set_value('2024');
cbo.onchange?.();
```

### **D. Check/Uncheck (CheckBox)**

```javascript
const frm = nexacro.getActiveFrame();
const chk = frm.lookup('chkActive');

// Check (value = '1')
chk.set_value('1');
chk.onchange?.();

// Uncheck (value = '0')
chk.set_value('0');
chk.onchange?.();
```

### **E. Work with Grid**

```javascript
const frm = nexacro.getActiveFrame();
const grd = frm.lookup('grdData');
const ds = frm.lookup('dsData');  // Associated dataset

// Get row count
console.log(ds.getRowCount());

// Set cell value
ds.setColumn(0, 'column_name', 'value');

// Get cell value
const value = ds.getColumn(0, 'column_name');

// Add new row
ds.addRow();

// Delete row
ds.deleteRow(0);
```

---

## 5. Batch Action Execution

### **Define Steps**

```python
steps = [
    {
        'action': 'fill',
        'identifier': 'edtSearchKeyword',
        'value': 'inventory'
    },
    {
        'action': 'select',
        'identifier': 'cboStatus',
        'value': 'active'
    },
    {
        'action': 'click',
        'identifier': 'btnSearch'
    },
    {
        'action': 'wait',
        'ms': 2000
    },
    {
        'action': 'check',
        'identifier': 'chkExportExcel',
        'checked': True
    },
    {
        'action': 'click',
        'identifier': 'btnExport'
    }
]
```

### **Execute via JavaScript**

```python
from playwright.sync_api import sync_playwright

def execute_nexacro_steps(page, steps):
    """Execute batch steps on Nexacro app"""
    results = []
    
    for step in steps:
        action = step.get('action')
        identifier = step.get('identifier')
        
        try:
            if action == 'fill':
                value = step.get('value', '')
                page.evaluate(f"""
                    () => {{
                        const comp = nexacro.getActiveFrame().lookup('{identifier}');
                        comp.set_value('{value}');
                        comp.setFocus?.();
                        comp.onchange?.();
                    }}
                """)
                results.append({'step': identifier, 'action': action, 'status': 'success'})
            
            elif action == 'click':
                page.evaluate(f"""
                    () => {{
                        const comp = nexacro.getActiveFrame().lookup('{identifier}');
                        comp.click?.();
                        comp.onclick?.();
                    }}
                """)
                results.append({'step': identifier, 'action': action, 'status': 'success'})
            
            elif action == 'select':
                value = step.get('value', '')
                page.evaluate(f"""
                    () => {{
                        const comp = nexacro.getActiveFrame().lookup('{identifier}');
                        comp.set_value('{value}');
                        comp.onchange?.();
                    }}
                """)
                results.append({'step': identifier, 'action': action, 'status': 'success'})
            
            elif action == 'check':
                checked = step.get('checked', True)
                val = '1' if checked else '0'
                page.evaluate(f"""
                    () => {{
                        const comp = nexacro.getActiveFrame().lookup('{identifier}');
                        comp.set_value('{val}');
                        comp.onchange?.();
                    }}
                """)
                results.append({'step': identifier, 'action': action, 'status': 'success'})
            
            elif action == 'wait':
                ms = step.get('ms', 500)
                page.wait_for_timeout(ms)
                results.append({'step': 'wait', 'action': action, 'ms': ms, 'status': 'success'})
            
            elif action == 'get_value':
                value = page.evaluate(f"""
                    () => {{
                        const comp = nexacro.getActiveFrame().lookup('{identifier}');
                        return comp.value || comp.get_value?.() || '';
                    }}
                """)
                results.append({'step': identifier, 'action': action, 'value': value, 'status': 'success'})
            
            else:
                results.append({'step': identifier, 'action': action, 'status': 'unknown_action'})
        
        except Exception as e:
            results.append({'step': identifier, 'action': action, 'status': 'error', 'error': str(e)})
    
    return results
```

---

## 6. Recording Nexacro Actions

### **Start Recording**

```python
def start_nexacro_recording(page):
    """Inject recording hooks into Nexacro"""
    page.evaluate("""
        () => {
            window._nexacroEvents = [];
            
            if (!window.nexacro) {
                console.warn('Nexacro not detected');
                return;
            }
            
            const frm = nexacro.getActiveFrame();
            
            // Hook into all components
            for (const compId in frm.components) {
                const comp = frm.components[compId];
                
                // Record click
                const origClick = comp.click;
                if (origClick) {
                    comp.click = function() {
                        window._nexacroEvents.push({
                            type: 'click',
                            componentId: compId,
                            timestamp: new Date().toISOString()
                        });
                        return origClick.call(this);
                    };
                }
                
                // Record value change
                const origSetValue = comp.set_value;
                if (origSetValue) {
                    comp.set_value = function(val) {
                        window._nexacroEvents.push({
                            type: 'set_value',
                            componentId: compId,
                            value: val,
                            timestamp: new Date().toISOString()
                        });
                        return origSetValue.call(this, val);
                    };
                }
            }
        }
    """)
```

### **Get Recorded Events**

```python
def get_recorded_events(page):
    """Retrieve recorded events"""
    events = page.evaluate("() => window._nexacroEvents || []")
    return events

def export_recording_to_python(events):
    """Convert recorded events to Python code"""
    code_lines = []
    
    for event in events:
        if event['type'] == 'click':
            code_lines.append(f"helper.click('{event['componentId']}')")
        elif event['type'] == 'set_value':
            value = event['value'].replace("'", "\\'")
            code_lines.append(f"helper.fill('{event['componentId']}', '{value}')")
    
    # Generate Python script
    script = """
from nexacro_helper import NexacroHelper

def recorded_workflow(helper):
    \"\"\"Auto-generated from recording\"\"\"
"""
    for line in code_lines:
        script += f"    {line}\n"
    
    return script
```

---

## 7. Inspecting Nexacro Apps

### **Debug: List All Components**

```javascript
// In browser console or via page.evaluate()
const frm = nexacro.getActiveFrame();
console.table(
  Object.entries(frm.components).map(([id, comp]) => ({
    'Component ID': id,
    'Type': comp._type || comp.constructor.name,
    'Visible': comp.visible,
    'Enabled': comp.enabled,
    'Value': comp.value
  }))
);
```

### **Debug: Component Properties**

```javascript
// Inspect single component
const comp = nexacro.getActiveFrame().lookup('edtUsername');
console.log({
  id: 'edtUsername',
  type: comp._type,
  value: comp.value,
  visible: comp.visible,
  enabled: comp.enabled,
  readonly: comp.readonly,
  methods: Object.getOwnPropertyNames(comp)
    .filter(m => typeof comp[m] === 'function')
    .slice(0, 10)
});
```

---

## 8. Common Nexacro Issues & Solutions

### **Issue 1: Component Not Found**
```javascript
// ✗ Wrong
frm.lookup('btnSubmit')  // Returns null → error

// ✓ Solution
// Check exact ID in DevTools console
nexacro.getActiveFrame().components  // List all

// Use correct ID
frm.lookup('Button_1')  // Maybe it's named differently
```

### **Issue 2: Click Not Triggering**
```javascript
// Try different methods in order:
const comp = frm.lookup('btnSubmit');

// Method 1: Direct click
comp.click();

// Method 2: Call handler
comp.onclick?.();

// Method 3: Dispatch event
comp.getDOMElement?.().dispatchEvent(
  new MouseEvent('click', { bubbles: true })
);

// Method 4: Fire custom event
comp._triggerEvent?.('onclick');
```

### **Issue 3: Value Not Setting**
```javascript
const comp = frm.lookup('edtUsername');

// Method 1: set_value()
comp.set_value('admin');

// Method 2: Direct assignment
comp.value = 'admin';

// Method 3: With focus & change
comp.setFocus?.();
comp.set_value('admin');
comp.onchange?.();
```

### **Issue 4: Grid/Dataset Operations**
```javascript
const frm = nexacro.getActiveFrame();
const ds = frm.lookup('dsData');  // Get dataset

// Check if dataset exists
if (!ds || !ds.getRowCount) {
  console.error('Dataset not found or invalid');
  return;
}

// Get data
const rowCount = ds.getRowCount();
const colValue = ds.getColumn(0, 'column_name');

// Set data
ds.setColumn(0, 'column_name', 'new_value');
```

---

## 9. Integration with Playwright

### **Use in Your Playwright Skill**

```python
# playwright_skill.py
from playwright.sync_api import sync_playwright

class NexacroPlaywrightAgent:
    def __init__(self, page):
        self.page = page
    
    def locate_nexacro(self, component_id: str) -> dict:
        """Locate Nexacro component"""
        result = self.page.evaluate(f"""
            () => {{
                const frm = nexacro.getActiveFrame();
                const comp = frm?.lookup('{component_id}');
                
                if (comp) {{
                    return {{
                        found: true,
                        type: comp._type || comp.constructor.name,
                        visible: comp.visible,
                        enabled: comp.enabled,
                        value: comp.value || comp.get_value?.() || ''
                    }};
                }}
                return {{ found: false }};
            }}
        """)
        return result
    
    def click_nexacro(self, component_id: str):
        """Click Nexacro component"""
        self.page.evaluate(f"""
            () => {{
                const comp = nexacro.getActiveFrame().lookup('{component_id}');
                comp.click?.();
                comp.onclick?.();
            }}
        """)
    
    def fill_nexacro(self, component_id: str, value: str):
        """Fill Nexacro textbox"""
        escaped = value.replace('"', '\\"')
        self.page.evaluate(f"""
            () => {{
                const comp = nexacro.getActiveFrame().lookup('{component_id}');
                comp.set_value("{escaped}");
                comp.setFocus?.();
                comp.onchange?.();
            }}
        """)
```

---

## 10. Best Practices

### ✅ DO
- Use exact component IDs (case-sensitive)
- Always check `comp.visible` and `comp.enabled` before interact
- Call `onchange()` after setting values
- Handle optional methods with `?.()` (optional chaining)
- Wrap in try-catch for error handling
- Wait between actions (Nexacro needs time to update)

### ❌ DON'T
- Assume component exists without checking
- Use standard DOM selectors (won't work)
- Direct assignment without `set_value()`
- Interact with hidden components
- Rapid fire clicks without delays
- Ignore Nexacro Object Model structure

---

## 11. GitHub References

For advanced features (image-based fallback):

| Repository | Stars | Purpose | When to Use |
|------------|-------|---------|------------|
| **PaddleOCR** | 76k ⭐ | OCR if component text unclear | Text extraction fallback |
| **OpenCV** | 79k ⭐ | Image matching if element lost | Visual element locating |
| **PyAutoGUI** | 5.7k ⭐ | Pixel-based fallback | Remote/virtual desktop |

---

## 12. Example: Complete Workflow

```python
from playwright.sync_api import sync_playwright

def nexacro_workflow():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto("http://your-nexacro-app")
        
        # Define steps
        steps = [
            {'action': 'fill', 'identifier': 'edtUsername', 'value': 'admin'},
            {'action': 'fill', 'identifier': 'edtPassword', 'value': 'pass123'},
            {'action': 'click', 'identifier': 'btnLogin'},
            {'action': 'wait', 'ms': 2000},
            {'action': 'fill', 'identifier': 'edtSearchKeyword', 'value': 'inventory'},
            {'action': 'click', 'identifier': 'btnSearch'},
            {'action': 'wait', 'ms': 1000},
            {'action': 'click', 'identifier': 'btnExport'},
        ]
        
        # Execute
        for step in steps:
            action = step['action']
            comp_id = step.get('identifier', '')
            
            print(f"  → {action}: {comp_id}")
            
            if action == 'fill':
                page.evaluate(f"""
                    () => {{
                        nexacro.getActiveFrame().lookup('{comp_id}').set_value('{step['value']}');
                    }}
                """)
            elif action == 'click':
                page.evaluate(f"""
                    () => {{
                        nexacro.getActiveFrame().lookup('{comp_id}').click?.();
                    }}
                """)
            elif action == 'wait':
                page.wait_for_timeout(step['ms'])
        
        print("✓ Workflow completed")
        browser.close()

# Run it
nexacro_workflow()
```

---

## Summary

**Nexacro Recording Skill Overview:**

| Task | Method |
|------|--------|
| Locate element | `frm.lookup('componentId')` |
| Click button | `comp.click()` or `comp.onclick()` |
| Fill textbox | `comp.set_value('value')` |
| Select option | `comp.set_value('optionValue')` |
| Check box | `comp.set_value('1')` |
| Get value | `comp.value` or `comp.get_value()` |
| Record | Inject hooks + `_nexacroEvents` array |
| Debug | `frm.components`, `console.log(comp)` |

**Key Takeaway**: Always use Nexacro Object Model (`frm.lookup()`) - Never use standard DOM selectors on Nexacro components.
