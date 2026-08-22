# Nexacro Browser Agent Skill
## Using Playwright + Nexacro Object Model for Automation

**Designed For:** Claude Browser Agent / RPA Automation Task  
**Compatible With:** Nexacro N V24, Platform 17+  
**Tool Stack:** Playwright + JavaScript Evaluation

---

## Quick Start: Agent Task Template

When given a Nexacro automation task, follow this structure:

### 1. **Reconnaissance Phase**
```javascript
// First, understand the page structure
const pageInfo = await page.evaluate(() => {
    const app = window.nexacro?.getApplication?.();
    const form = app?.mainForm;
    
    return {
        formName: form?.name,
        components: Object.keys(form || {}).filter(key => 
            !key.startsWith('_') && key[0] !== key[0].toUpperCase()
        ),
        datasets: Object.keys(form || {}).filter(key => key.startsWith('ds')),
        hasActiveTransaction: !!window._txInProgress
    };
});

console.log('Page Info:', pageInfo);
```

### 2. **Element Identification**
Use these patterns to find elements:

```javascript
// Pattern A: By Component ID (RECOMMENDED)
const button = '#Button_Search';
const input = '#edtOrderID';
const grid = '#grdResults';

// Pattern B: Confirm element exists
const exists = await page.locator(button).isVisible({ timeout: 5000 });

// Pattern C: Get parent form
const formName = await page.evaluate(() => {
    return window.nexacro.getApplication().mainForm.name;
});
```

### 3. **Action Execution**
```javascript
// Step 3a: Fill inputs
await page.fill('#edtOrderID', 'ORD001');

// Step 3b: Select dropdown
await page.click('#cboStatus');
await page.waitForSelector('[data-component="Combo"] li');
await page.click('text=Completed');

// Step 3c: Trigger action
await page.click('#Button_Search');

// Step 3d: Wait for completion (CRITICAL)
await page.waitForLoadState('networkidle', { timeout: 10000 });
// OR wait for dataset population
await page.waitForFunction(() => {
    const app = window.nexacro.getApplication();
    return app.mainForm.dsResults.getRowCount() > 0;
}, { timeout: 10000 });
```

### 4. **Data Extraction**
```javascript
const results = await page.evaluate(() => {
    const app = window.nexacro.getApplication();
    const ds = app.mainForm.dsResults;
    const rows = [];
    
    for (let i = 0; i < ds.getRowCount(); i++) {
        rows.push({
            col1: ds.getColumn(i, 'columnName1'),
            col2: ds.getColumn(i, 'columnName2'),
            col3: ds.getColumn(i, 'columnName3')
        });
    }
    return rows;
});

console.log('Extracted:', results);
```

### 5. **Error Handling**
```javascript
try {
    // Action
    await page.click('#Button_Submit');
    await page.waitForLoadState('networkidle');
} catch (error) {
    // Check for error message on page
    const errorMsg = await page.locator('[class*="error"]').innerText();
    if (errorMsg) {
        console.error('Form Error:', errorMsg);
        return { success: false, error: errorMsg };
    }
    throw error;
}
```

---

## Common Agent Tasks & Solutions

### Task: Search Form & Retrieve Results

**Objective:** Fill search criteria, submit, get grid results

```javascript
async function searchAndRetrieve(page, criteria) {
    // 1. Fill search fields
    for (const [fieldId, value] of Object.entries(criteria)) {
        await page.fill(`#${fieldId}`, value);
    }
    
    // 2. Click search
    await page.click('#Button_Search');
    
    // 3. Wait for results
    await page.waitForFunction(() => {
        const app = window.nexacro.getApplication();
        return app.mainForm.dsResults?.getRowCount?.() > 0;
    }, { timeout: 10000 });
    
    // 4. Extract grid data
    const data = await page.evaluate(() => {
        const app = window.nexacro.getApplication();
        const ds = app.mainForm.dsResults;
        const rows = [];
        
        for (let i = 0; i < ds.getRowCount(); i++) {
            rows.push(ds.getRowObject(i));
        }
        return rows;
    });
    
    return data;
}

// Usage
const results = await searchAndRetrieve(page, {
    'edtOrderID': 'ORD001',
    'edtCustomer': 'ACME'
});
```

### Task: Fill Multi-Step Form

**Objective:** Navigate through wizard, fill each step, submit

```javascript
async function completeWizard(page, formData) {
    const steps = formData.steps || [];
    
    for (let stepIdx = 0; stepIdx < steps.length; stepIdx++) {
        const stepData = steps[stepIdx];
        const currentStep = await page.evaluate(() => {
            const app = window.nexacro.getApplication();
            return app.mainForm.currentStep || 1;
        });
        
        console.log(`Processing step ${currentStep}`);
        
        // Fill all fields in this step
        for (const [fieldId, value] of Object.entries(stepData)) {
            const selector = `#${fieldId}`;
            if (await page.locator(selector).isVisible()) {
                await page.fill(selector, value);
            }
        }
        
        // Move to next step (if not last)
        if (stepIdx < steps.length - 1) {
            await page.click('#Button_Next');
            await page.waitForLoadState('networkidle');
        }
    }
    
    // Final submit
    await page.click('#Button_Submit');
    await page.waitForLoadState('networkidle');
    
    // Check success message
    const message = await page.locator('[class*="success"], [class*="message"]').innerText();
    return { success: true, message };
}

// Usage
const result = await completeWizard(page, {
    steps: [
        { edtName: 'John Doe', edtEmail: 'john@example.com' },
        { edtPhone: '0123456789', cboCountry: 'Vietnam' },
        { chkAgree: true, edtReason: 'Testing' }
    ]
});
```

### Task: Edit Grid Row & Save

**Objective:** Select row, modify, save changes

```javascript
async function editGridRow(page, rowIndex, updates) {
    // 1. Click row to select
    const cellSelector = `#grdData_cell_${rowIndex}_0`;
    await page.click(cellSelector);
    
    // 2. Open edit form (double-click or click Edit button)
    await page.dblclick(cellSelector);
    // OR
    // await page.click('#Button_Edit');
    
    // Wait for form
    await page.waitForSelector('[data-form="EditForm"]', { timeout: 5000 });
    
    // 3. Fill update fields
    for (const [fieldId, value] of Object.entries(updates)) {
        await page.fill(`#${fieldId}`, value);
    }
    
    // 4. Save
    await page.click('#Button_Save');
    await page.waitForLoadState('networkidle');
    
    // 5. Verify update
    const savedValue = await page.evaluate((row, col) => {
        const app = window.nexacro.getApplication();
        return app.mainForm.dsData.getColumn(row, col);
    }, rowIndex, Object.keys(updates)[0]);
    
    console.log(`Updated row ${rowIndex}, new value:`, savedValue);
    return { success: true };
}

// Usage
await editGridRow(page, 2, { edtAmount: '5000', cboStatus: 'Completed' });
```

### Task: Batch Delete Rows

**Objective:** Multi-select rows and bulk delete

```javascript
async function batchDelete(page, rowIndices) {
    // 1. Select rows (Ctrl+Click)
    for (let idx of rowIndices) {
        const selector = `#grdData_row_${idx}`;
        await page.click(selector, { modifiers: ['Control'] });
    }
    
    // 2. Click Delete
    await page.click('#Button_Delete');
    
    // 3. Confirm dialog
    // Wait for confirmation modal
    const dialogExists = await page.locator('button:has-text("Confirm")').isVisible({ timeout: 3000 }).catch(() => false);
    if (dialogExists) {
        await page.click('button:has-text("Confirm")');
    }
    
    // 4. Wait for completion
    await page.waitForLoadState('networkidle');
    
    // 5. Verify deletion
    const rowCount = await page.evaluate(() => {
        return window.nexacro.getApplication().mainForm.dsData.getRowCount();
    });
    
    console.log(`Deleted ${rowIndices.length} rows. Remaining: ${rowCount}`);
    return { success: true, remainingRows: rowCount };
}

// Usage
await batchDelete(page, [0, 2, 5]);  // Delete rows 0, 2, 5
```

### Task: Handle Dropdown/Combo Selection

**Objective:** Reliably select from dynamic dropdowns

```javascript
async function selectCombo(page, comboId, displayText) {
    // 1. Click to open dropdown
    const comboSelector = `#${comboId}`;
    await page.click(comboSelector);
    
    // 2. Wait for options to appear
    // Nexacro renders dropdown as overlay
    await page.waitForSelector(
        `[class*="combo-list"], [data-component="Combo"] li, [role="option"]`,
        { timeout: 3000 }
    );
    
    // 3. Find and click matching option
    // Try multiple selectors (Nexacro versions vary)
    const optionSelectors = [
        `text="${displayText}"`,
        `[class*="combo-item"]:has-text("${displayText}")`,
        `li:has-text("${displayText}")`,
        `[role="option"]:has-text("${displayText}")`
    ];
    
    for (const selector of optionSelectors) {
        try {
            await page.click(selector, { timeout: 1000 });
            console.log(`Selected "${displayText}" from combo`);
            return { success: true };
        } catch (e) {
            // Try next selector
        }
    }
    
    throw new Error(`Could not find option "${displayText}" in combo`);
}

// Programmatic alternative (direct API)
async function selectComboByApi(page, comboId, value) {
    // Set value directly via Nexacro API
    const result = await page.evaluate(({ comboId, value }) => {
        const app = window.nexacro.getApplication();
        const form = app.mainForm;
        const combo = form[comboId];
        
        if (!combo) throw new Error(`Combo ${comboId} not found`);
        
        // Find index of value
        for (let i = 0; i < combo.itemcount; i++) {
            // Nexacro API varies; common methods:
            if (combo.getItemValue?.(i) === value || combo.getItem?.(i)?.value === value) {
                combo.setIndex(i);
                return { success: true, selectedIndex: i };
            }
        }
        
        throw new Error(`Value "${value}" not found in combo items`);
    }, { comboId, value });
    
    return result;
}

// Usage
await selectCombo(page, 'cboStatus', 'Completed');
// Or
await selectComboByApi(page, 'cboStatus', 'COMPLETED');
```

### Task: Wait for Long-Running Task

**Objective:** Submit task, poll for completion, get result

```javascript
async function submitAndWaitForCompletion(page, taskId, maxWaitMs = 60000) {
    // 1. Click submit
    await page.click('#Button_Submit');
    
    // 2. Capture async start
    await page.evaluate(() => {
        window._taskStartTime = Date.now();
        window._taskComplete = false;
    });
    
    // 3. Hook transaction callback
    await page.evaluate(() => {
        const originalTx = window.nexacro.Application.prototype.transaction;
        window.nexacro.Application.prototype.transaction = function(...args) {
            const callback = args[3];
            args[3] = function(svcId, errCode, errMsg) {
                // Call original
                if (callback) callback.apply(this, arguments);
                // Signal completion
                window._taskComplete = true;
                window._taskError = errCode !== 0 ? errMsg : null;
                window._taskEndTime = Date.now();
            };
            return originalTx.apply(this, args);
        };
    });
    
    // 4. Wait for completion flag
    const completed = await page.waitForFunction(
        () => window._taskComplete === true,
        { timeout: maxWaitMs, polling: 1000 }
    );
    
    // 5. Check result
    const result = await page.evaluate(() => {
        return {
            taskId: window._taskId,
            success: !window._taskError,
            error: window._taskError,
            duration: window._taskEndTime - window._taskStartTime,
            // Get response data
            resultDataset: window.nexacro.getApplication().mainForm.dsResult
                ? Object.values(window.nexacro.getApplication().mainForm.dsResult)
                : null
        };
    });
    
    console.log(`Task completed in ${result.duration}ms. Success: ${result.success}`);
    return result;
}

// Usage
const result = await submitAndWaitForCompletion(page, 'TASK_001', 120000);
if (result.success) {
    console.log('Task succeeded');
} else {
    console.error('Task failed:', result.error);
}
```

### Task: Navigate Between Forms

**Objective:** Open detail form, edit, close and return to main

```javascript
async function navigateToDetailForm(page, recordId) {
    // 1. Find and click detail button for record
    // (Usually grid row double-click or dedicated button)
    const rowButton = `#grdMain_row_${recordId} [data-action="edit"]`;
    await page.click(rowButton);
    
    // 2. Wait for detail form to open
    const detailFormSelector = '[data-form="DetailForm"]';
    await page.waitForSelector(detailFormSelector, { timeout: 5000 });
    
    // 3. Verify form loaded
    const formName = await page.evaluate(() => {
        return window.nexacro.getApplication().mainForm.name;
    });
    
    console.log(`Opened form: ${formName}`);
    
    return { success: true, formName };
}

async function closeDetailFormAndReturn(page) {
    // 1. Close detail form (close button or keyboard Escape)
    await page.click('#Button_Close');
    // OR
    // await page.keyboard.press('Escape');
    
    // 2. Wait for return to main form
    await page.waitForFunction(() => {
        const form = window.nexacro.getApplication().mainForm;
        return form.name === 'MainForm' || form.name === 'ListForm';
    }, { timeout: 5000 });
    
    console.log('Returned to main form');
    return { success: true };
}

// Usage
await navigateToDetailForm(page, 0);  // Open detail for row 0
// ... do edits ...
await closeDetailFormAndReturn(page);  // Close and return
```

---

## Advanced: Custom Selectors for Nexacro

### DataAttribute-Based Selection

```javascript
// Components have data attributes in rendered HTML
// Use them for more reliable selection

// All buttons
await page.click('[data-component="Button"]');

// Grid cell by row/col
const cellSelector = '[data-component="Grid"][data-row="2"][data-col="3"]';
await page.click(cellSelector);

// Components with specific state
const disabledButton = '[data-component="Button"][disabled]';
const visibleEdit = '[data-component="Edit"]:visible';
```

### Custom Evaluation for Complex Selection

```javascript
// When CSS/XPath isn't enough, use evaluate
const componentByProperty = await page.evaluate((propName, propValue) => {
    const app = window.nexacro.getApplication();
    const form = app.mainForm;
    
    // Find component matching property
    for (const [key, comp] of Object.entries(form)) {
        if (comp && comp[propName] === propValue) {
            return { componentId: key, found: true };
        }
    }
    return { found: false };
}, 'text', 'Search');
```

---

## Debugging Tips for Agent

### Check What Components Are Available

```javascript
await page.evaluate(() => {
    const app = window.nexacro.getApplication();
    const form = app.mainForm;
    
    console.log('=== COMPONENTS ===');
    Object.keys(form).forEach(key => {
        if (!key.startsWith('_') && form[key]) {
            const comp = form[key];
            console.log(`${key}: ${comp.constructor?.name || 'Unknown'}`);
        }
    });
    
    console.log('=== DATASETS ===');
    Object.keys(form).forEach(key => {
        if (key.startsWith('ds')) {
            const ds = form[key];
            console.log(`${key}: ${ds.getRowCount()} rows`);
        }
    });
});
```

### Inspect Element HTML

```javascript
// Get rendered HTML of component
const html = await page.locator('#Button_Search').evaluate(el => el.outerHTML);
console.log(html);

// Example output:
// <button id="Button_Search" class="button" data-component="Button">Search</button>
```

### Check Network Transactions

```javascript
// Listen to all network requests
page.on('request', request => {
    if (request.url().includes('nexacro') || request.url().includes('service')) {
        console.log('Request:', request.url(), request.method());
    }
});

page.on('response', response => {
    if (response.status() >= 400) {
        console.log('Error Response:', response.url(), response.status());
    }
});
```

---

## Performance Optimization for Agent

### Batch Queries

```javascript
// AVOID: Multiple evaluate calls
for (let i = 0; i < 100; i++) {
    const value = await page.evaluate((idx) => {
        return window.nexacro.getApplication().mainForm.dsData.getColumn(idx, 'name');
    }, i);
    console.log(value);
}

// BETTER: Single evaluate for all data
const allValues = await page.evaluate(() => {
    const app = window.nexacro.getApplication();
    const ds = app.mainForm.dsData;
    const values = [];
    for (let i = 0; i < ds.getRowCount(); i++) {
        values.push(ds.getColumn(i, 'name'));
    }
    return values;
});
console.log(allValues);
```

### Cache Selectors

```javascript
// Avoid re-querying same elements
const buttonSearch = page.locator('#Button_Search');
await buttonSearch.click();
const isVisible = await buttonSearch.isVisible();
const text = await buttonSearch.innerText();

// Instead of:
// await page.click('#Button_Search');
// await page.locator('#Button_Search').isVisible();
// await page.locator('#Button_Search').innerText();
```

---

## Checklist: Before Running Agent Task

- [ ] Confirm Nexacro version (N V24 or Platform 17+)
- [ ] Identify all form component IDs (prefix: no underscore)
- [ ] List all dataset names (prefix: `ds`)
- [ ] Map UI buttons to action handlers
- [ ] Identify grid column names and types
- [ ] Document dropdown options (if fixed)
- [ ] Test page load & authentication
- [ ] Check for modal dialogs or popups
- [ ] Verify network endpoints are accessible
- [ ] Plan wait strategies (networkidle vs function)

---

## Common Pitfalls & Solutions

| Problem | Symptom | Solution |
|---------|---------|----------|
| Element not found | `locator.click()` timeout | Verify component exists in page; check ID typo; wait for form load first |
| Wrong value after click | Combo selected wrong option | Use API method `setIndex()` instead of clicking |
| Transaction response never comes | Page.waitForFunction hangs | Check network tab; add error callback logging |
| Grid data empty after search | `getRowCount()` returns 0 | Search returned no results; add validation |
| Modal blocks click | Click succeeds but no result | Handle dialog: `page.on('dialog', ...)` |
| Dropdown options not visible | Click opens dropdown but options missing | Wait longer; try keyboard navigation (arrow keys) |

---

## References

- [Nexacro Platform API Reference](https://docs.tobesoft.com/developer_guide_nexacro_n_v24_ko)
- [Playwright Documentation](https://playwright.dev)
- [Github TOBESOFT Samples](https://github.com/TOBESOFT-DOCS)

