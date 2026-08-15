# Browser Agent Workflow Guide

## Workflow Structure Overview

A workflow is a JSON file that describes a series of automated browser actions to perform.

### Basic Workflow Format

```json
{
  "version": "1.0.0",
  "name": "My Workflow",
  "description": "What this workflow does",
  "params": [],
  "actions": [],
  "exportFormats": []
}
```

---

## 1. Version

```json
"version": "1.0.0"
```

- Semantic versioning (major.minor.patch)
- Used for compatibility checking
- Helps AI Agent validate workflow compatibility

---

## 2. Metadata

Optional metadata about the workflow:

```json
"metadata": {
  "creator": "browser-agent@1.0",
  "createdAt": "2024-01-15T10:00:00Z",
  "updatedAt": "2024-01-15T11:00:00Z",
  "tags": ["excel", "upload"],
  "minBrowserAgentVersion": "1.0.0",
  "maxBrowserAgentVersion": "2.0.0"
}
```

---

## 3. Parameters

Define input parameters that users provide when running the workflow:

```json
"params": [
  {
    "name": "excelFile",
    "type": "file",
    "required": true,
    "description": "Excel file to upload",
    "fileType": "xlsx"
  },
  {
    "name": "outputFormat",
    "type": "string",
    "required": false,
    "default": "xlsx",
    "options": ["xlsx", "csv", "json"]
  },
  {
    "name": "username",
    "type": "string",
    "required": true
  }
]
```

**Parameter Types:**
- `file` - File input (xlsx, csv, pdf, etc)
- `string` - Text input
- `number` - Numeric input
- `boolean` - True/False

**Usage in actions:**
- Reference with `${paramName}`
- Example: `"value": "${excelFile}"`

---

## 4. Global Settings

Configure default behavior across all actions:

```json
"globalSettings": {
  "autoDismissPopup": {
    "enabled": true,
    "mode": "smart",
    "selectors": [
      "button.close",
      "button.dismiss",
      "[aria-label='Close']"
    ],
    "timeout": 2000,
    "retryCount": 2
  },
  "handleBrowserAlerts": {
    "alert": "accept",
    "confirm": "accept",
    "prompt": "dismiss"
  },
  "defaultTimeout": 10000,
  "defaultWaitTime": 1000
}
```

**Popup Handling:**
- `mode: "smart"` - Auto-detect close button
- `mode: "manual"` - Use explicit selectors
- Popup will be dismissed before each action

**Browser Alerts:**
- Handle native JavaScript alerts/confirms
- Options: `accept` or `dismiss`

---

## 5. Actions

The core of the workflow - a sequence of browser actions.

### 5.1 Navigate

Navigate to a URL:

```json
{
  "id": "step-1",
  "type": "navigate",
  "url": "https://example.com/upload"
}
```

### 5.2 Click

Click on an element:

```json
{
  "id": "step-2",
  "type": "click",
  "selector": "button.login-btn",
  "waitAfter": 2000
}
```

### 5.3 Input

Type text into an input field:

```json
{
  "id": "step-3",
  "type": "input",
  "selector": "input#username",
  "value": "${username}",
  "waitAfter": 500
}
```

### 5.4 Select

Select an option from a dropdown:

```json
{
  "id": "step-4",
  "type": "select",
  "selector": "select#category",
  "value": "Option 1"
}
```

### 5.5 Upload File

Upload a file:

```json
{
  "id": "step-5",
  "type": "uploadFile",
  "selector": "input#file-input",
  "value": "${excelFile}",
  "waitAfter": 1000
}
```

The `selector` must point to an `<input type="file">` element.

### 5.6 Wait

Wait for a fixed duration (in milliseconds):

```json
{
  "id": "step-6",
  "type": "wait",
  "duration": 3000
}
```

### 5.7 Wait for Selector

Wait until an element appears on the page:

```json
{
  "id": "step-7",
  "type": "waitForSelector",
  "selector": "table.results",
  "timeout": 10000
}
```

### 5.8 Extract Table

Extract data from an HTML table:

```json
{
  "id": "step-8",
  "type": "extractTable",
  "selector": "table.results",
  "headers": ["ID", "Name", "Email", "Status"],
  "output": "results"
}
```

**Output:**
Stores extracted data as array of objects:
```javascript
{
  "results": [
    { "ID": "1", "Name": "John", "Email": "john@example.com", "Status": "Active" },
    { "ID": "2", "Name": "Jane", "Email": "jane@example.com", "Status": "Pending" }
  ]
}
```

### 5.9 Extract JSON

Extract JSON data from the page:

```json
{
  "id": "step-9",
  "type": "extractJson",
  "selector": "script[type='application/json']",
  "output": "jsonData"
}
```

### 5.10 Dismiss Popup

Explicitly dismiss a popup:

```json
{
  "id": "step-10",
  "type": "dismissPopup",
  "selectors": [
    "button.cookie-accept",
    ".modal-close"
  ],
  "timeout": 2000
}
```

### 5.11 Screenshot

Take a screenshot:

```json
{
  "id": "step-11",
  "type": "screenshot",
  "filename": "results.png"
}
```

### 5.12 Scroll

Scroll the page:

```json
{
  "id": "step-12",
  "type": "scroll",
  "position": "bottom"
}
```

---

## 6. Action Properties

All actions support these common properties:

```json
{
  "id": "unique-action-id",
  "type": "click",
  "selector": "button",
  "waitBefore": 500,      // Wait before action
  "waitAfter": 1000,      // Wait after action
  "retry": {              // Retry configuration
    "count": 3,
    "delayMs": 500
  },
  "onError": "fail"       // fail | skip | ignore
}
```

**Error Handling:**
- `fail` - Stop workflow if action fails (default)
- `skip` - Skip this action and continue
- `ignore` - Log warning but continue

---

## 7. Export Formats

Define how to export the extracted data:

```json
"exportFormats": [
  {
    "type": "excel",
    "output": "results.xlsx",
    "dataKey": "results"
  },
  {
    "type": "csv",
    "output": "results.csv",
    "dataKey": "results"
  },
  {
    "type": "json",
    "output": "results.json",
    "dataKey": "results"
  }
]
```

- `type` - Output format (excel, csv, json)
- `output` - Filename
- `dataKey` - Variable from actions (e.g., from `extractTable` output)

---

## 8. Selector Types

Selectors can be CSS or XPath:

**CSS Selectors:**
```json
"selector": "button.close"
"selector": "#submit-btn"
"selector": "input[type='file']"
"selector": "div.modal button:first-child"
```

**XPath:**
```json
"selector": "//button[contains(text(), 'Close')]"
"selector": "//div[@class='modal']//button"
```

---

## 9. Parameter Substitution

Use `${paramName}` to substitute parameters in actions:

```json
{
  "params": [
    { "name": "username", "type": "string" }
  ],
  "actions": [
    {
      "type": "input",
      "selector": "input#username",
      "value": "${username}"
    }
  ]
}
```

When running:
```bash
browser-agent run workflow.json --param username=john@example.com
```

---

## 10. Complete Workflow Example

```json
{
  "version": "1.0.0",
  "name": "Upload & Extract",
  
  "params": [
    {
      "name": "excelFile",
      "type": "file",
      "required": true
    }
  ],
  
  "globalSettings": {
    "autoDismissPopup": { "enabled": true }
  },
  
  "actions": [
    {
      "id": "navigate",
      "type": "navigate",
      "url": "https://example.com/upload"
    },
    {
      "id": "upload",
      "type": "uploadFile",
      "selector": "input#file",
      "value": "${excelFile}",
      "waitAfter": 1000
    },
    {
      "id": "click-process",
      "type": "click",
      "selector": "button#process"
    },
    {
      "id": "wait-results",
      "type": "waitForSelector",
      "selector": "table.results",
      "timeout": 10000
    },
    {
      "id": "extract",
      "type": "extractTable",
      "selector": "table.results",
      "output": "results"
    }
  ],
  
  "exportFormats": [
    {
      "type": "excel",
      "output": "results.xlsx",
      "dataKey": "results"
    }
  ]
}
```

---

## 11. Execution Flow

```
1. Validate workflow JSON
2. Parse parameters
3. For each action:
   a. Auto-dismiss popups (if enabled)
   b. Wait before action (if specified)
   c. Execute action
   d. Wait after action (if specified)
   e. Store output (if applicable)
   f. Handle errors
4. Export results
```

---

## 12. Tips & Best Practices

1. **Use meaningful IDs**: Make action IDs descriptive
2. **Add waits**: Use `waitAfter` for slow operations
3. **Error handling**: Set `onError` for optional actions
4. **Popup handling**: Enable `autoDismissPopup` globally
5. **Selectors**: Test selectors in browser console before adding
6. **Parameters**: Make workflows reusable with parameters
7. **Comments**: Use `description` field for clarity
8. **Version**: Always include version for compatibility

---

## 13. Running Workflows

### Via CLI

```bash
# Basic run
browser-agent run workflow.json --param excelFile=./data.xlsx

# With output directory
browser-agent run workflow.json \
  --param excelFile=./data.xlsx \
  --output ./results

# Headless mode (default)
browser-agent run workflow.json --headless

# Show browser UI
browser-agent run workflow.json --headed

# Dry run (validate only)
browser-agent run workflow.json --dry-run
```

### Via Node.js

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');

const player = new WorkflowPlayer();
const workflow = require('./workflow.json');

const result = await player.run(workflow, {
  excelFile: './data.xlsx'
});

console.log(result);
```

### Via Docker

```bash
docker run -v $(pwd):/app browser-agent:latest \
  browser-agent run /app/workflow.json \
  --param excelFile=./data.xlsx
```

---

## 14. Troubleshooting

**Workflow fails with "Selector not found"**
- Check if website has dynamic content
- Try XPath instead of CSS
- Wait before action with `waitBefore`

**File upload not working**
- Verify `input#file` is an `<input type="file">` element
- Check file exists at specified path
- Add `waitAfter` to allow time for processing

**Results not extracted**
- Verify table selector exists
- Check headers match actual table columns
- Use browser DevTools to inspect table structure

---

For more examples, see `example-workflows/` directory.
