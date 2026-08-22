# Nexacro Object Model & JavaScript API Guide
## For Browser Agent Automation (Playwright Integration)

**Version:** Nexacro N V24 / Platform 17  
**Last Updated:** 2026  
**Source:** TOBESOFT Official Documentation + Github Samples

---

## Table of Contents

1. [Core Object Model Hierarchy](#core-object-model-hierarchy)
2. [Global Nexacro API](#global-nexacro-api)
3. [Form Object & Lifecycle](#form-object--lifecycle)
4. [Component Types & Properties](#component-types--properties)
5. [Event System & Handlers](#event-system--handlers)
6. [Data Binding & Datasets](#data-binding--datasets)
7. [Agent Automation Patterns](#agent-automation-patterns)
8. [Element Selection & Interaction](#element-selection--interaction)
9. [Form Navigation & State](#form-navigation--state)
10. [Common Workflows for RPA](#common-workflows-for-rpa)

---

## Core Object Model Hierarchy

### Application → Form → Components → Properties/Events

```
nexacro.Application (Global App Instance)
├── Forms (Active/Loaded Forms)
│   ├── Components (Button, TextInput, Grid, etc.)
│   │   ├── Properties (value, text, visible, etc.)
│   │   └── Events (onclick, onchange, etc.)
│   ├── Datasets (Bound to Components)
│   └── Variables (AppVariables, Form Variables)
└── Transactions (Service Calls)
```

### Access Patterns

```javascript
// Application level
nexacro.getApplication()
nexacro.getApplication().mainForm  // Main form instance
nexacro.getApplication().aaa        // AppVariables (aaa = variable name)

// Form level (within form context: "this" = current Form)
this.componentName                  // Direct component reference
this.Button00                       // Button component
this.dsOrderList                    // Dataset

// Component level
this.Button00.text                  // Component property
this.Button00.visible               // Boolean property
this.Button00.onclick               // Event handler function
```

---

## Global Nexacro API

### Critical Global Objects & Functions

#### `nexacro.getApplication()`
```javascript
var app = nexacro.getApplication();
var mainForm = app.mainForm;
app.addVariable("varName", "varValue");
var value = app.varName;
```

#### `nexacro.toNumber(value, [nanVal], [pinfVal], [ninfVal])`
Converts value to number, handles NaN/Infinity safely.
```javascript
nexacro.toNumber("123")        // 123
nexacro.toNumber("text")       // NaN → converts to 0 if nanVal=0
nexacro.toNumber(null, 0)      // 0
```

#### `trace(message)`
Logs to Nexacro debugger console.
```javascript
trace("DEBUG: value=" + this.edtInput.value);
```

#### `eval(codeString)` / Dynamic Execution
Execute code dynamically (use with caution in automation).
```javascript
var componentName = "Button00";
eval("this." + componentName + ".click()");  // Dangerous if untrusted input
```

#### `alert(message)` / `confirm(message)` / `prompt(message)`
Modal dialogs - **May block automation**, handle with timeouts.

### Scope Rules

```javascript
// Inside Form context (form script)
this.componentName              // Components in this form
this.transaction()              // Form's transaction method (if available)

// Inside Application context (app script)
var form = nexacro.getApplication().formName;
form.componentName              // Access via form reference
```

---

## Form Object & Lifecycle

### Form Events (Execution Order)

```javascript
// 1. Form being loaded
this.form_onload = function(obj:nexacro.Form, e:nexacro.LoadEventInfo) {
    // Initialize: load datasets, set default values
    // obj = Form instance
    // e.fromobject = caller/previous form
};

// 2. Form showing (before visible)
this.form_onshow = function(obj:nexacro.Form, e:nexacro.ShowEventInfo) {
    // Refresh UI, set focus, animations
};

// 3. Form size/activation
this.form_onactivate = function(obj:nexacro.Form, e:nexacro.ActivateEventInfo) {
    // Called when form gets focus
};

// 4. Form deactivation
this.form_ondeactivate = function(obj:nexacro.Form, e:nexacro.DeActivateEventInfo) {
    // Called when form loses focus
};

// 5. Form closing (before destroy)
this.form_onclose = function(obj:nexacro.Form, e:nexacro.CloseEventInfo) {
    // Cleanup: save state, close resources
    // e.closequery = true → can prevent close by returning false
};
```

### Common Form Methods

```javascript
// Navigation
this.open(strFormName, [strOpenStyle], [vOpenArgs], [nOpenWidth], [nOpenHeight]);
this.close([nReturnValue]);

// Visibility & State
this.show();
this.hide();
this.maximize();
this.minimize();
this.setFocus();

// Dimensions & Position
this.setSize(nWidth, nHeight);
this.move(nX, nY);
this.getOffsetWidth();     // Pixel width
this.getOffsetHeight();    // Pixel height

// Dataset operations
this.dsOrderList.clearData();
this.dsOrderList.addRow();
this.dsOrderList.getRowCount();
```

---

## Component Types & Properties

### Universal Component Properties

**Every component inherits these:**

```javascript
component.id                  // String: Component ID (same as this.componentName)
component.name                // String: Component name
component.visible             // Boolean: Visibility state
component.enabled             // Boolean: Clickable/interactive
component.text                // String: Display text (for labels, buttons)
component.value               // String/Number: Current value
component.parent              // Object: Parent form
component.getOffsetWidth()    // Int: Pixel width
component.getOffsetHeight()   // Int: Pixel height
component.setFocus()          // Method: Set keyboard focus
component.click()             // Method: Simulate click
component.show()              // Method: Show component
component.hide()              // Method: Hide component

// Styling
component.background          // String: Color or image
component.foreground          // String: Text color
component.font                // String: Font specification
component.opacity             // 0-1: Transparency
```

### Button Component

```javascript
this.Button00 = nexacro.Button (
    id, name, x, y, width, height, 
    text="Click Me", value="btn_value"
);

// Key Properties
this.Button00.text             // Display text
this.Button00.value            // Internal value
this.Button00.enabled          // Clickable?
this.Button00.visible          // Visible?
this.Button00.onclick = function(obj:Button, e:ClickEventInfo) {
    // e.buttontype: "left", "right", "middle"
    // e.ctrlKey, e.shiftKey, e.altKey: Modifier keys
};

// Methods
this.Button00.click();         // Programmatic click
this.Button00.setFocus();      // Focus button
```

### TextInput / Edit Component

```javascript
this.edtOrderID = nexacro.Edit (
    id, name, x, y, width, height, 
    value="default"
);

// Key Properties
this.edtOrderID.value          // Current text value
this.edtOrderID.text           // Same as value
this.edtOrderID.readonly       // Read-only?
this.edtOrderID.maxlength      // Max characters
this.edtOrderID.placeholder    // Placeholder text
this.edtOrderID.inputtype      // "text", "password", "number", etc.

// Key Events
this.edtOrderID.onchange = function(obj:Edit, e:ChangeEventInfo) {
    // Triggered when value changes
    trace("New value: " + obj.value);
};

this.edtOrderID.onkeydown = function(obj:Edit, e:KeyEventInfo) {
    // e.keycode: Key code (13=Enter, 27=Escape)
    if (e.keycode == 13) {  // Enter
        this.search();
    }
};

this.edtOrderID.onfocus = function(obj:Edit, e:FocusEventInfo) {
    obj.selectAll();  // Auto-select all text on focus
};

// Methods
this.edtOrderID.setValue("new value");
this.edtOrderID.selectAll();
this.edtOrderID.setFocus();
```

### Combo / Dropdown Component

```javascript
this.cboStatus = nexacro.Combo (
    id, name, x, y, width, height
);

// Key Properties
this.cboStatus.value           // Currently selected value
this.cboStatus.text            // Currently selected text
this.cboStatus.readonly        // Read-only dropdown?
this.cboStatus.index           // Selected item index
this.cboStatus.itemcount       // Total items in list

// Key Methods
this.cboStatus.addItem(strDisplay, strValue);
this.cboStatus.removeItem(nIndex);
this.cboStatus.clearAll();
this.cboStatus.findItem(strValue);  // Returns index
this.cboStatus.setIndex(nIndex);    // Select by index

// Key Events
this.cboStatus.onitemchanged = function(obj:Combo, e:ItemChangeEventInfo) {
    // e.postvalue: Previous value
    // e.value: New value
    trace("Changed from " + e.postvalue + " to " + e.value);
};
```

### Grid Component

```javascript
this.grdOrderList = nexacro.Grid (
    id, name, x, y, width, height, 
    datasource=this.dsOrderList
);

// Key Properties
this.grdOrderList.selecttype    // "row", "cell", "multirow", "multicell"
this.grdOrderList.readonly      // Editable in grid?
this.grdOrderList.focusedColumn // Currently focused cell column
this.grdOrderList.focusedRow    // Currently focused cell row index

// Key Methods
this.grdOrderList.selectAll();
this.grdOrderList.unselectAll();
this.grdOrderList.setFocus();
this.grdOrderList.setFocusedCell(nRow, strColName);
this.grdOrderList.scrollToRow(nRow);

// Key Events
this.grdOrderList.oncelldblclick = function(obj:Grid, e:CellClickEventInfo) {
    // e.row: Row index
    // e.col: Column index
    // e.colid: Column ID
    // e.celltext: Cell text value
    trace("Clicked row=" + e.row + ", col=" + e.col);
};

// Get cell value
var cellValue = this.grdOrderList.getCellValue(nRow, strColName);
this.grdOrderList.setCellValue(nRow, strColName, newValue);
```

### Static / Label Component

```javascript
this.stcLabel = nexacro.Static (
    id, name, x, y, width, height, 
    text="Label Text"
);

this.stcLabel.text = "Updated Label";
this.stcLabel.textAlign = "left";   // "left", "center", "right"
```

### CheckBox Component

```javascript
this.chkActive = nexacro.CheckBox (
    id, name, x, y, width, height,
    text="Active", value=false
);

this.chkActive.value            // true/false
this.chkActive.checked          // Same as value
this.chkActive.onchanged = function(obj:CheckBox, e:ChangeEventInfo) {
    trace("Checkbox now: " + obj.value);
};
```

### RadioButton Component

```javascript
this.radMale = nexacro.Radio (
    id, name, x, y, width, height,
    text="Male", value="M"
);

this.radMale.value              // Current value if selected
this.radMale.selected           // true/false
this.radMale.onchanged = function(obj:Radio, e:ChangeEventInfo) {
    if (obj.value == "M") {
        trace("Male selected");
    }
};
```

---

## Event System & Handlers

### Event Handler Signature Pattern

```javascript
// All event handlers follow this pattern:
componentName_eventName = function(obj:ComponentType, e:EventInfoType) {
    // obj = Component instance (same as this.componentName)
    // e = Event info object with details
};

// Examples:
this.Button00_onclick = function(obj:Button, e:ClickEventInfo) { };
this.edtOrderID_onchange = function(obj:Edit, e:ChangeEventInfo) { };
this.grdOrderList_oncelldblclick = function(obj:Grid, e:CellClickEventInfo) { };
```

### Common Event Info Properties

```javascript
e.object                        // Same as obj (component reference)
e.eventid                       // Event ID string

// Keyboard events
e.keycode                       // 13=Enter, 27=Escape, 32=Space, etc.
e.ctrlKey, e.shiftKey, e.altKey // Modifier states (true/false)

// Mouse events
e.clientX, e.clientY            // Mouse pixel position
e.screenX, e.screenY            // Screen coordinates
e.button                        // Mouse button code
e.buttontype                    // "left", "right", "middle"

// Change events
e.postvalue                     // Previous value
e.value                         // New value
e.oldvalue                      // Before change
```

### Event Bubbling & Capture

```javascript
// Return false to prevent default action
this.Button00_onclick = function(obj:Button, e:ClickEventInfo) {
    if (!isValidInput()) {
        return false;  // Prevents normal click behavior
    }
};

// Stop event propagation (in contained components)
e.cancelBubble = true;         // Prevent bubbling to parent
```

---

## Data Binding & Datasets

### Dataset Basics

```javascript
// Define dataset (in form XML or script)
var dsOrderList = new nexacro.Dataset("dsOrderList", this);

// Or access existing bound dataset
this.dsOrderList

// Dataset Properties
this.dsOrderList.name           // "dsOrderList"
this.dsOrderList.getRowCount()  // Row count
this.dsOrderList.getColumnCount()  // Column count

// Add columns
this.dsOrderList.addColumn("orderID", "string");
this.dsOrderList.addColumn("orderDate", "date");
this.dsOrderList.addColumn("amount", "number");
```

### Data Operations

```javascript
// Add rows
var nRow = this.dsOrderList.addRow();  // Returns row index

// Set cell values
this.dsOrderList.setColumn(nRow, "orderID", "ORD001");
this.dsOrderList.setColumn(nRow, "amount", 1000);

// Get cell values
var value = this.dsOrderList.getColumn(nRow, "orderID");

// Get full row as object
var rowObj = this.dsOrderList.getRowObject(nRow);
// rowObj = {orderID: "ORD001", orderDate: ..., amount: 1000}

// Update entire row
var updateObj = {orderID: "ORD002", amount: 2000};
this.dsOrderList.setRowObject(nRow, updateObj);

// Clear all data
this.dsOrderList.clearData();

// Delete row
this.dsOrderList.deleteRow(nRow);
```

### Data Filtering & Search

```javascript
// Find row by column value
var nRow = this.dsOrderList.findRowExpr("orderID == 'ORD001'");

// Filter dataset
this.dsOrderList.filter("amount > 1000");
this.dsOrderList.clearFilter();

// Sort dataset
this.dsOrderList.sort("orderDate desc");  // Descending
this.dsOrderList.sort("amount asc");      // Ascending
```

### Binding Grid to Dataset

```javascript
// In Form XML (XFDL):
// <Grid id="grdOrderList" datasource="this.dsOrderList" ... />

// Programmatically:
this.grdOrderList.setBindDataset(this.dsOrderList);

// Unbind:
this.grdOrderList.setBindDataset(null);
```

### Data Transaction (Service Call)

```javascript
// Define dataset for transaction
var dsRequest = new nexacro.Dataset("dsRequest", this);
var dsResponse = new nexacro.Dataset("dsResponse", this);

// Call transaction
this.transaction(
    strServiceID,           // Service ID from environment.xml
    strURL,                 // Target URL
    dsRequest,              // Input dataset
    dsResponse,             // Output dataset (receives response)
    callback,               // Callback function
    "POST",                 // HTTP method
    strParamList            // Optional: "key1=col1 key2=col2"
);

// Callback
function callback(strSvcId, nErrorCode, strErrorMsg) {
    if (nErrorCode == 0) {
        // Success: dsResponse now contains data
        trace("Response rows: " + this.dsResponse.getRowCount());
    } else {
        trace("Error: " + strErrorMsg);
    }
}
```

---

## Agent Automation Patterns

### Pattern 1: Button Click & Wait

```javascript
// Playwright approach (in your browser agent)
async function clickButtonAndWait(page, buttonSelector) {
    // Click within Nexacro context
    await page.click(buttonSelector);
    
    // Wait for network to settle (transactions complete)
    await page.waitForLoadState('networkidle');
    
    // Alternative: Wait for specific dataset change
    // Requires evaluating JS in page
    await page.waitForFunction(
        () => window.datasetRowCount > 0,
        { timeout: 5000 }
    );
}
```

### Pattern 2: Element Selection in Nexacro

Nexacro renders components as HTML elements with IDs and data attributes:

```html
<!-- Inside Nexacro, a Button renders as -->
<button id="Button00" class="button" data-component="Button">Click Me</button>

<!-- A TextInput renders as -->
<input id="edtOrderID" type="text" class="edit" data-component="Edit" />

<!-- A Grid cell -->
<div id="grdOrderList_cell_0_1" class="gridcell">Value</div>
```

### Pattern 3: Fill Form & Submit

```javascript
// Agent automation task
async function fillAndSubmit(page) {
    // Fill TextInput
    await page.fill('#edtOrderID', 'ORD001');
    
    // Select from Combo
    await page.click('#cboStatus');  // Open dropdown
    await page.click('text=Completed');  // Click option
    
    // Check CheckBox
    await page.click('#chkActive');
    
    // Click Button
    await page.click('#Button00');
    
    // Wait for response/navigation
    await page.waitForLoadState('networkidle');
}
```

### Pattern 4: Extract Grid Data

```javascript
// After grid loads, extract all rows
async function extractGridData(page) {
    const data = await page.evaluate(() => {
        const rows = [];
        const cells = document.querySelectorAll('.gridrow');
        
        cells.forEach((row, idx) => {
            const cells = row.querySelectorAll('.gridcell');
            rows.push({
                orderID: cells[0]?.innerText,
                amount: cells[1]?.innerText,
                status: cells[2]?.innerText
            });
        });
        
        return rows;
    });
    
    return data;
}
```

### Pattern 5: Wait for Async Operation

Nexacro transactions are async; Agent needs to wait:

```javascript
// Method A: Network idle (transaction completed)
await page.waitForLoadState('networkidle');

// Method B: Wait for loading indicator to disappear
await page.waitForSelector('.loading', { state: 'hidden' });

// Method C: Poll for dataset change (evaluate JS)
await page.waitForFunction(
    () => {
        // Evaluate in page context
        var app = window.nexacro?.getApplication?.();
        return app?.mainForm?.dsOrderList?.getRowCount?.() > 0;
    },
    { timeout: 10000, polling: 500 }
);

// Method D: Listen for custom event
await page.evaluate(() => {
    return new Promise(resolve => {
        window.dataChangeEvent = resolve;
    });
});
// Nexacro fires: window.dataChangeEvent() when ready
```

---

## Element Selection & Interaction

### Selector Strategies for Nexacro Elements

#### 1. By Component ID (Most Reliable)

```javascript
// CSS Selector
#Button00
#edtOrderID
#grdOrderList

// XPath
//button[@id='Button00']
//input[@id='edtOrderID']

// Playwright
page.click('#Button00');
page.fill('#edtOrderID', 'value');
```

#### 2. By Component Type & Attributes

```javascript
// All buttons
[data-component='Button']

// All edits/text inputs
[data-component='Edit']

// Grid cells in specific column
[data-component='Grid'] [data-col='2']
```

#### 3. By Text Content (Risky, but useful for labels)

```javascript
// Find button by text
button:has-text("Search")

// Find by label
text="Order ID"  // Playwright text selector

// XPath by text
//button[contains(text(), 'Search')]
```

#### 4. Nexacro-Specific Attributes

In rendered HTML, Nexacro adds attributes:

```html
<div id="componentID" 
     data-component="ComponentType"
     data-row="0"
     data-col="1"
     class="button|edit|grid">
```

### Interaction Patterns

#### Click & Focus

```javascript
// Simple click
await page.click('#Button00');

// Click with retry
await page.click('#Button00', { force: true });

// Click at specific coordinates (within component bounds)
await page.click('#Button00', { position: { x: 50, y: 25 } });

// Focus without clicking
await page.focus('#edtOrderID');
```

#### Text Input

```javascript
// Clear & fill
await page.fill('#edtOrderID', '');
await page.fill('#edtOrderID', 'ORD001');

// Type character by character (useful for input masks)
await page.click('#edtOrderID');
await page.keyboard.type('12345', { delay: 100 });

// Type with modifiers
await page.keyboard.press('Control+A');  // Select all
await page.keyboard.press('Delete');
```

#### Dropdown / Combo Selection

```javascript
// Playwright select (if native select)
// But Nexacro uses custom rendering, so:

await page.click('#cboStatus');  // Open dropdown
await page.waitForSelector('[data-component="Combo"] [role="option"]');
await page.click('text=Active');  // Click desired option

// Or programmatic (via JavaScript)
await page.evaluate(() => {
    var app = window.nexacro.getApplication();
    var form = app.mainForm;
    form.cboStatus.setIndex(2);  // Set by index
});
```

#### Keyboard Navigation

```javascript
// Arrow keys (navigate grid)
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowUp');
await page.keyboard.press('ArrowLeft');
await page.keyboard.press('ArrowRight');

// Tab (focus next/previous)
await page.keyboard.press('Tab');
await page.keyboard.press('Shift+Tab');

// Enter (confirm/submit)
await page.keyboard.press('Enter');

// Escape (cancel/close)
await page.keyboard.press('Escape');
```

---

## Form Navigation & State

### Opening Forms

```javascript
// JavaScript in Nexacro
this.open("DetailForm", "modeless", {param1: "value1"});
// or
this.open(
    "DetailForm",      // Form name
    "modal",           // "modal", "modeless", "modeless_wait", "float", etc.
    {                  // Arguments passed to form
        orderID: "ORD001",
        mode: "edit"
    },
    800,               // Optional width
    600                // Optional height
);

// Receive return value in callback
function openCallback(strFormName, nReturnValue) {
    trace("Form closed with return: " + nReturnValue);
}
```

### Form Arguments (in opened form)

```javascript
this.form_onload = function(obj:Form, e:LoadEventInfo) {
    // Access arguments passed via open()
    var args = obj.getOpenEventInfo().eventargument;
    
    if (args.orderID) {
        this.edtOrderID.value = args.orderID;
    }
};
```

### Closing Forms

```javascript
// Return value to caller
this.close(nReturnValue);
// or
this.close(0);  // Success
this.close(-1); // Error/Cancel

// In caller:
function openCallback(strFormName, nReturnValue) {
    if (nReturnValue == 0) {
        trace("Success");
    } else {
        trace("Cancelled");
    }
}
```

### Agent: Navigate Between Forms

```javascript
// Method 1: Click button that opens form
await page.click('#Button_OpenDetail');
await page.waitForSelector('[data-form="DetailForm"]', { timeout: 5000 });

// Method 2: Programmatic form switching
await page.evaluate(() => {
    var app = window.nexacro.getApplication();
    app.mainForm.open("DetailForm", "modal", {});
});

// Wait for modal overlay
await page.waitForSelector('.modal', { timeout: 5000 });

// Method 3: Close modal & return to main form
await page.click('#Button_Close');
await page.waitForSelector('[data-form="MainForm"]');
```

---

## Common Workflows for RPA

### Workflow 1: Search & Display Results

```javascript
// Step 1: Input search criteria
await page.fill('#edtOrderID', 'ORD001');
await page.fill('#edtCustomer', 'ACME Corp');

// Step 2: Click Search button
await page.click('#Button_Search');

// Step 3: Wait for grid to populate
await page.waitForFunction(
    () => {
        var app = window.nexacro.getApplication();
        var form = app.mainForm;
        return form.dsOrderList.getRowCount() > 0;
    },
    { timeout: 10000 }
);

// Step 4: Extract results
const results = await page.evaluate(() => {
    var app = window.nexacro.getApplication();
    var ds = app.mainForm.dsOrderList;
    const rows = [];
    
    for (let i = 0; i < ds.getRowCount(); i++) {
        rows.push({
            orderID: ds.getColumn(i, 'orderID'),
            customer: ds.getColumn(i, 'customer'),
            amount: ds.getColumn(i, 'amount')
        });
    }
    return rows;
});

console.log(results);
```

### Workflow 2: CRUD Operations (Create/Read/Update/Delete)

#### Create (Insert)

```javascript
// 1. Click New button
await page.click('#Button_New');
await page.waitForLoadState('networkidle');

// 2. Fill form fields
await page.fill('#edtOrderID', 'ORD999');
await page.fill('#edtCustomer', 'New Corp');
await page.fill('#edtAmount', '5000');

// 3. Select combo
await page.click('#cboStatus');
await page.click('text=Pending');

// 4. Click Save
await page.click('#Button_Save');

// 5. Wait for confirmation
await page.waitForLoadState('networkidle');
const message = await page.textContent('[data-component="Static"][class*="message"]');
console.log("Save response:", message);
```

#### Read (Already covered in "Search & Display")

#### Update (Edit)

```javascript
// 1. Select row in grid
await page.click('#grdOrderList_cell_0_0');  // Click first cell

// 2. Double-click to edit (or click Edit button)
await page.dblclick('#grdOrderList_cell_0_0');
// Or:
await page.click('#Button_Edit');

// 3. Form opens in edit mode; modify fields
await page.fill('#edtAmount', '6000');

// 4. Save
await page.click('#Button_Save');
await page.waitForLoadState('networkidle');
```

#### Delete

```javascript
// 1. Select row
await page.click('#grdOrderList_cell_0_0');

// 2. Click Delete button
await page.click('#Button_Delete');

// 3. Confirm deletion (if modal appears)
await page.click('button:has-text("Confirm")');

// 4. Wait for grid refresh
await page.waitForLoadState('networkidle');
```

### Workflow 3: Multi-Step Form Wizard

```javascript
async function completeWizard(page) {
    // Step 1
    await page.fill('#edtStep1_Field1', 'Value1');
    await page.click('#Button_Next');
    await page.waitForSelector('[data-step="2"]');
    
    // Step 2
    await page.fill('#edtStep2_Field1', 'Value2');
    await page.click('#Button_Next');
    await page.waitForSelector('[data-step="3"]');
    
    // Step 3 (Final)
    await page.fill('#edtStep3_Field1', 'Value3');
    await page.click('#Button_Finish');
    
    // Wait for completion
    await page.waitForLoadState('networkidle');
}
```

### Workflow 4: Batch Processing (Loop Through Grid)

```javascript
async function processBatch(page) {
    const rowCount = await page.evaluate(() => {
        var app = window.nexacro.getApplication();
        return app.mainForm.dsOrderList.getRowCount();
    });
    
    for (let i = 0; i < rowCount; i++) {
        // Select row
        await page.click(`#grdOrderList_row_${i}`);
        
        // Perform action
        await page.click('#Button_Process');
        await page.waitForLoadState('networkidle');
        
        // Check result
        const status = await page.evaluate((row) => {
            var app = window.nexacro.getApplication();
            return app.mainForm.dsOrderList.getColumn(row, 'status');
        }, i);
        
        console.log(`Row ${i} status: ${status}`);
    }
}
```

### Workflow 5: Wait for Async Completion

```javascript
async function waitForAsyncTask(page, timeoutMs = 30000) {
    // Set up listener before triggering task
    await page.evaluate(() => {
        window.asyncTaskComplete = false;
        
        // Hook into transaction callback
        var originalTransaction = window.nexacro.Application.prototype.transaction;
        window.nexacro.Application.prototype.transaction = function(...args) {
            const callback = args[3];
            args[3] = function(svcId, errCode, errMsg) {
                // Call original callback
                if (callback) callback.apply(this, arguments);
                // Signal completion
                window.asyncTaskComplete = true;
            };
            return originalTransaction.apply(this, args);
        };
    });
    
    // Trigger action
    await page.click('#Button_LongOperation');
    
    // Wait for flag
    const completed = await page.waitForFunction(
        () => window.asyncTaskComplete === true,
        { timeout: timeoutMs }
    );
    
    console.log("Async task completed");
}
```

---

## Debugging & Inspection

### Accessing Nexacro Objects in Browser Console

```javascript
// Get application
var app = window.nexacro.getApplication();

// Get main form
var form = app.mainForm;

// List all components
console.log(Object.keys(form));

// Inspect component
console.log(form.Button00);
console.log(form.Button00.text);
console.log(form.Button00.visible);

// List dataset rows
var ds = form.dsOrderList;
for (let i = 0; i < ds.getRowCount(); i++) {
    console.log(ds.getRowObject(i));
}

// Call method directly
form.search();
form.Button00.click();
```

### Tracing in Nexacro (Server-Side Logging)

In Nexacro JavaScript:
```javascript
trace("Debug message: " + varName);
trace("Component value: " + this.edtOrderID.value);
```

Access via:
- Nexacro Studio debugger (if running locally)
- Browser console (if Nexacro exposes trace)
- Network tab (check transaction responses)

### Playwright Debugging

```javascript
// Enable debug logging
const browser = await chromium.launch({ headless: false });

// Inspect elements
await page.pause();  // Pauses execution, open DevTools

// Screenshots
await page.screenshot({ path: 'screenshot.png' });

// HTML snapshot
const html = await page.content();
console.log(html);
```

---

## Tips & Best Practices for Agent Automation

### 1. Waits & Timeouts

```javascript
// Network wait (for transactions)
await page.waitForLoadState('networkidle', { timeout: 10000 });

// Element appears
await page.waitForSelector('#grdOrderList', { timeout: 5000 });

// Element disappears
await page.waitForSelector('.loading', { state: 'hidden', timeout: 5000 });

// Function evaluates to true
await page.waitForFunction(() => /* condition */, { timeout: 10000 });
```

### 2. Retry Strategies

```javascript
async function retryClick(page, selector, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            await page.click(selector, { timeout: 5000 });
            return;
        } catch (e) {
            console.log(`Retry ${i+1}: ${e.message}`);
            if (i === maxRetries - 1) throw e;
            await page.waitForTimeout(1000);
        }
    }
}
```

### 3. Error Handling

```javascript
try {
    await page.click('#Button_Save');
    await page.waitForLoadState('networkidle');
} catch (error) {
    if (error.message.includes('Timeout')) {
        console.error("Action timed out - server may be slow");
    } else if (error.message.includes('notFound')) {
        console.error("Element not found - UI may have changed");
    } else {
        console.error("Unexpected error:", error);
    }
}
```

### 4. Avoiding Modal Dialog Blocks

```javascript
// If alert/confirm dialogs appear, handle them
page.on('dialog', async dialog => {
    console.log(`Dialog: ${dialog.type()} - ${dialog.message()}`);
    if (dialog.type() === 'confirm') {
        await dialog.accept();  // Click OK
    } else {
        await dialog.dismiss();  // Click Cancel
    }
});

// Now run action that triggers dialog
await page.click('#Button_Delete');
```

### 5. Data Validation

```javascript
// Before submitting, validate
const value = await page.inputValue('#edtOrderID');
if (!value || value.trim() === '') {
    console.error("Order ID is empty");
    return;
}

// After transaction, verify response
const rowCount = await page.evaluate(() => {
    return window.nexacro.getApplication().mainForm.dsOrderList.getRowCount();
});

if (rowCount === 0) {
    console.error("No data returned from search");
}
```

---

## Quick Reference: Component Selector Map

| Component | Selector | Key Property | Key Event |
|-----------|----------|--------------|-----------|
| Button | `#buttonID` | `.text` | `.onclick` |
| TextEdit | `#editID` | `.value` | `.onchange` |
| Combo | `#comboID` | `.value` | `.onitemchanged` |
| Grid | `#gridID` | `.focusedRow` | `.oncelldblclick` |
| CheckBox | `#checkID` | `.value` | `.onchanged` |
| Radio | `#radioID` | `.value` | `.onchanged` |
| Static | `#staticID` | `.text` | (none) |
| Dataset | N/A | `.getRowCount()` | N/A |

---

## References & Sources

- **Official TOBESOFT Documentation:** https://docs.tobesoft.com/
- **Github Samples:** 
  - https://github.com/TOBESOFT-DOCS/sample_Nexacro_N_V24
  - https://github.com/TOBESOFT-DOCS/sample_nexacroplatform_17
  - https://github.com/nexacro-spring/
- **Playwright Documentation:** https://playwright.dev/

---

**End of Guide**

*This guide is designed for browser automation agents that interact with Nexacro Platform applications. Adapt patterns based on specific application UI and architecture.*
