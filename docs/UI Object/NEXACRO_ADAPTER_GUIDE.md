# Nexacro Adapter Implementation Guide

**For**: Browser Agent Recorder  
**Focus**: Samsung Nexacro XML-based framework integration  
**Date**: August 2026

---

## Table of Contents

1. [Nexacro Fundamentals](#nexacro-fundamentals)
2. [Component Type Mapping](#component-type-mapping)
3. [Grid Detection (Critical)](#grid-detection-critical)
4. [Event Capturing](#event-capturing)
5. [Locator Generation](#locator-generation)
6. [Code Examples](#code-examples)

---

## Nexacro Fundamentals

### Architecture

```
┌─────────────────────────────────────┐
│  Nexacro Application (JS Runtime)   │
├─────────────────────────────────────┤
│  Frame (Window-like container)      │
│  └─ Form (XML-based UI definition)  │
│     ├─ Component 1 (Edit)           │
│     ├─ Component 2 (Combo)          │
│     ├─ Component 3 (Grid)           │
│     └─ Component N (...)            │
├─────────────────────────────────────┤
│  Rendered as: <div> containers      │
│  (Nexacro generates native DOM)     │
└─────────────────────────────────────┘
```

### Accessing Nexacro Runtime

```javascript
// Global nexacro object
window.nexacro

// Current application
nexacro.application

// Active frame (main window)
nexacro.application.getActiveFrame()

// Get form from frame
const frame = nexacro.application.getActiveFrame();
const form = frame.form;

// Get component by ID
const component = form.getComponent('edtEmployeeID');

// List all components
const components = form.components;
```

### Component Hierarchy

```javascript
// Parent-child relationship
const component = form.getComponent('cboDepartment');
const parentForm = component.parent;  // Points to form

// Get all children (for container types)
const container = form.getComponent('divMain');
const children = container.components;  // If it's a container
```

---

## Component Type Mapping

### Complete Nexacro → UIObject Mapping

```javascript
const NEXACRO_MAPPING = {
  // Input Components
  'Edit': {
    uiType: 'TextBox',
    valueProperty: 'value',
    properties: ['value', 'enable', 'visible', 'readonly'],
    events: ['onchanged', 'onclick', 'onfocus', 'onblur']
  },
  
  'MaskEdit': {
    uiType: 'MaskedInput',
    valueProperty: 'value',
    properties: ['value', 'mask', 'enable', 'visible'],
    note: 'Format pattern stored in mask property'
  },
  
  'Textarea': {
    uiType: 'TextArea',
    valueProperty: 'value',
    properties: ['value', 'enable', 'visible', 'readonly'],
    events: ['onchanged']
  },
  
  'Spin': {
    uiType: 'NumberBox',
    valueProperty: 'value',
    properties: ['value', 'min', 'max', 'enable', 'visible']
  },
  
  // Selection Components
  'CheckBox': {
    uiType: 'Checkbox',
    valueProperty: 'value',
    stateProperty: 'value',  // 0 = unchecked, 1 = checked
    properties: ['value', 'enable', 'visible'],
    events: ['onchanged', 'onclick']
  },
  
  'Radio': {
    uiType: 'RadioButton',
    valueProperty: 'value',
    properties: ['value', 'enable', 'visible'],
    grouping: 'name attribute'
  },
  
  'Combo': {
    uiType: 'ComboBox',
    valueProperty: 'value',
    listProperty: 'innerdataset',  // Reference to dataset
    properties: ['value', 'enable', 'visible', 'readonly'],
    events: ['onchanged', 'onitemclick'],
    note: 'Must fetch dataset for options'
  },
  
  'ListBox': {
    uiType: 'ListBox',
    valueProperty: 'value',
    multiSelect: true,
    properties: ['value', 'enable', 'visible'],
    events: ['onitemclick', 'onchanged']
  },
  
  // Date/Time
  'DatePicker': {
    uiType: 'DatePicker',
    valueProperty: 'value',
    formatProperty: 'dateformat',
    properties: ['value', 'dateformat', 'enable', 'visible'],
    events: ['onchanged']
  },
  
  'Calendar': {
    uiType: 'Calendar',
    valueProperty: 'value',
    properties: ['value', 'enable', 'visible']
  },
  
  // Button
  'Button': {
    uiType: 'Button',
    labelProperty: 'value',
    properties: ['value', 'enable', 'visible'],
    events: ['onclick']
  },
  
  'ImageButton': {
    uiType: 'ImageButton',
    properties: ['enable', 'visible'],
    events: ['onclick']
  },
  
  // Navigation
  'Tab': {
    uiType: 'Tab',
    selectedProperty: 'selectedindex',
    properties: ['selectedindex', 'enable', 'visible'],
    events: ['onchanged']
  },
  
  'TabPage': {
    uiType: 'TabPanel',
    properties: []
  },
  
  // Grid Components (CRITICAL)
  'Grid': {
    uiType: 'DataGrid',
    dataProperty: 'innerdataset',
    properties: [
      'rowcount',
      'colcount',
      'currentrow',
      'currentcol',
      'selecttype',  // 'row', 'cell', 'multi'
      'enable',
      'visible'
    ],
    events: [
      'onitemclick',
      'ondblclick',
      'onmousedown',
      'onmouseup',
      'onchanged',
      'oncelldblclick',
      'oncellclick'
    ],
    note: 'Most complex component - see Grid Detection section'
  },
  
  'Tree': {
    uiType: 'TreeSelect',
    dataProperty: 'innerdataset',
    properties: ['currentnode', 'enable', 'visible'],
    events: ['onitemclick', 'onnodeclick']
  },
  
  // Layout
  'Div': {
    uiType: 'Container',
    properties: ['enable', 'visible'],
    isContainer: true,
    note: 'Can have child components'
  },
  
  'GroupBox': {
    uiType: 'Group',
    properties: ['enable', 'visible'],
    isContainer: true,
    label: 'text property'
  },
  
  // Display
  'Static': {
    uiType: 'Text',
    valueProperty: 'text',
    properties: ['text', 'enable', 'visible']
  },
  
  'ImageViewer': {
    uiType: 'Image',
    imageProperty: 'src',
    properties: ['src', 'enable', 'visible']
  },
  
  // Popup
  'PopupDiv': {
    uiType: 'Popup',
    properties: ['enable', 'visible'],
    isContainer: true,
    note: 'Child of a form, displayed on demand'
  }
};
```

---

## Grid Detection (Critical)

Nexacro Grid is the most complex component. Must handle:
- Multiple rows/columns
- Cell editing
- Row selection
- Column headers
- Nested context

### 3.1 Grid Structure

```javascript
const grid = form.getComponent('grdEmployee');

// Properties
grid.rowcount              // Number of rows
grid.colcount              // Number of columns
grid.currentrow            // Selected row index (-1 if none)
grid.currentcol            // Selected column index (-1 if none)
grid.selecttype            // 'row', 'cell', 'multi'
grid.innerdataset          // NeXacro Dataset with data

// Dataset access
const dataset = grid.innerdataset;
const rowData = dataset.getRowData(rowIndex);     // Object of row values
const cellValue = grid.getCellValue(rowIndex, colIndex);

// Column headers (from dataset)
const colid = grid.getBindCellProperty(0, 0, 'text');  // Column text
const columnInfo = grid.getColumnInfo(colIndex);       // Column config
```

### 3.2 Grid Cell Detection

```typescript
class NexacroGridDetector {
  
  /**
   * Detect grid cell from HTML element
   * Grid renders as nested divs/spans
   */
  detectGridCell(element: HTMLElement, grid: NexacroGrid): UIObject | null {
    // 1. Find cell position in grid
    const cellInfo = this.findCellCoordinates(element, grid);
    if (!cellInfo) return null;
    
    const { rowIndex, colIndex } = cellInfo;
    
    // 2. Get cell value from Nexacro
    const cellValue = grid.getCellValue(rowIndex, colIndex);
    
    // 3. Get row data (for context)
    const dataset = grid.innerdataset;
    const rowData = dataset.getRowData(rowIndex);
    
    // 4. Get column info
    const colName = this.getColumnName(grid, colIndex);
    
    // 5. Build UIObject
    return {
      type: 'GridCell',
      
      // Identity
      id: `${grid.id}-cell-${rowIndex}-${colIndex}`,
      text: cellValue?.toString() || '',
      
      // State
      value: cellValue,
      selected: (grid.currentrow === rowIndex && 
                 grid.currentcol === colIndex),
      
      // Geometry
      boundingBox: this.getCellBBox(element),
      
      // Context
      context: {
        gridId: grid.id,
        rowIndex,
        colIndex,
        colName,
        rowData,
        rowSelectedInGrid: grid.currentrow === rowIndex
      },
      
      // Locators
      locators: {
        nexacroId: grid.id,
        nexacroCell: `${rowIndex},${colIndex}`,
        customLocator: {
          componentClass: 'Grid',
          rowIndex: rowIndex.toString(),
          colIndex: colIndex.toString(),
          colName
        }
      },
      
      framework: 'Nexacro'
    };
  }
  
  /**
   * Find which cell was clicked in grid
   * Grid DOM structure:
   *   <div class="nxgridcol">    (column wrapper)
   *     <div class="nxgridcell"> (individual cell)
   *       <span>Cell Content</span>
   *     </div>
   *   </div>
   */
  private findCellCoordinates(
    element: HTMLElement, 
    grid: NexacroGrid
  ): { rowIndex: number; colIndex: number } | null {
    let current = element;
    
    // Traverse up to find cell container
    while (current) {
      if (current.classList?.contains('nxgridcell')) {
        // Found cell, get its position from parent structure
        const cellDiv = current;
        const colDiv = cellDiv.parentElement;
        
        // Get row index from parent's attribute
        const rowIndex = parseInt(
          colDiv?.getAttribute('rowindex') || '-1'
        );
        
        // Get col index from column position
        const colIndex = parseInt(
          colDiv?.getAttribute('colindex') || '-1'
        );
        
        if (rowIndex >= 0 && colIndex >= 0) {
          return { rowIndex, colIndex };
        }
      }
      
      current = current.parentElement;
    }
    
    return null;
  }
  
  private getColumnName(grid: NexacroGrid, colIndex: number): string {
    // Grid has column configuration
    const colInfo = grid.getColumnInfo(colIndex);
    return colInfo?.id || `col_${colIndex}`;
  }
  
  private getCellBBox(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    };
  }
}
```

### 3.3 Grid Row Selection

```javascript
// Recording grid row selection

const grid = form.getComponent('grdEmployee');
const selectedRowIndex = grid.currentrow;

const gridRowObject = {
  type: 'GridRow',
  id: `${grid.id}-row-${selectedRowIndex}`,
  
  // Row data (all columns)
  rowData: grid.innerdataset.getRowData(selectedRowIndex),
  
  // Context
  context: {
    gridId: grid.id,
    rowIndex: selectedRowIndex,
    rowCount: grid.rowcount
  },
  
  // Locators
  locators: {
    nexacroId: grid.id,
    nexacroRow: selectedRowIndex.toString(),
    customLocator: {
      componentClass: 'Grid',
      rowIndex: selectedRowIndex.toString()
    }
  }
};
```

### 3.4 Grid Cell Editing

```javascript
// Recording grid cell edit (e.g., double-click to edit)

const action = {
  action: 'Fill',
  target: {
    type: 'GridCell',
    context: {
      gridId: 'grdEmployee',
      rowIndex: 5,
      colName: 'EmployeeName',
      rowData: {
        'EmployeeID': 'EMP001',
        'EmployeeName': 'John Doe',
        'Department': 'IT'
      }
    },
    locators: {
      nexacroCell: '5,2'  // row 5, col 2
    }
  },
  parameters: {
    value: 'Jane Doe'  // New value
  }
};
```

---

## Event Capturing

### Nexacro Event Model

Nexacro has its own event system. Must hook into both:
1. **Nexacro Events** (`onchanged`, `onclick`, etc.)
2. **DOM Events** (mouse, keyboard)

### Hooking Nexacro Events

```javascript
class NexacroEventHook {
  
  /**
   * Intercept Nexacro component events
   */
  hookComponentEvents(component: NexacroComponent): void {
    // Save original event handlers
    const originalHandlers = {};
    
    const eventNames = [
      'onclick', 'ondblclick', 'onchanged', 
      'onfocus', 'onblur', 'onmousedown', 'onmouseup',
      'onitemclick', 'oncelldblclick', 'oncellclick'
    ];
    
    eventNames.forEach(eventName => {
      originalHandlers[eventName] = component[eventName];
      
      // Replace with wrapper
      component[eventName] = (obj) => {
        // Capture event info
        const eventData = this.captureEventData(
          component, 
          eventName, 
          obj
        );
        
        // Notify recorder
        this.recorder.recordNexacroEvent(eventData);
        
        // Call original handler
        if (originalHandlers[eventName]) {
          originalHandlers[eventName].call(component, obj);
        }
      };
    });
  }
  
  /**
   * Capture Nexacro event details
   */
  private captureEventData(
    component: NexacroComponent,
    eventName: string,
    eventObj: any
  ): NexacroEventData {
    const uiObject = this.detector.detectNexacroComponent(component);
    
    return {
      timestamp: Date.now(),
      framework: 'Nexacro',
      
      // Event info
      eventName,
      
      // Component info
      component: {
        id: component.id,
        className: component.className,
        value: component.value,
        text: component.text
      },
      
      // UIObject representation
      uiObject,
      
      // Event-specific data
      eventData: eventObj,
      
      // For Grid events, add cell coordinates
      cellInfo: this.extractGridCellInfo(component, eventObj)
    };
  }
  
  private extractGridCellInfo(
    component: NexacroComponent,
    eventObj: any
  ): GridCellInfo | null {
    if (component.className !== 'Grid') return null;
    
    return {
      rowIndex: eventObj.row || -1,
      colIndex: eventObj.col || -1,
      cellValue: component.getCellValue(
        eventObj.row, 
        eventObj.col
      )
    };
  }
}
```

### DOM Event Interception (Fallback)

```javascript
// If Nexacro event hooks unavailable, hook DOM events

class DOMEventInterceptor {
  
  intercept(element: HTMLElement, form: NexacroForm): void {
    // Find associated Nexacro component
    const componentId = this.findNexacroComponentId(element);
    if (!componentId) return;
    
    const component = form.getComponent(componentId);
    
    // Hook click
    element.addEventListener('click', (e) => {
      const uiObject = this.detector.detectNexacroComponent(component);
      this.recorder.recordAction({
        action: 'Click',
        target: uiObject,
        timestamp: Date.now()
      });
    }, { capture: true });
    
    // Hook change (for inputs)
    if (component.className === 'Edit' || 
        component.className === 'Combo' ||
        component.className === 'CheckBox') {
      element.addEventListener('change', (e) => {
        this.recorder.recordAction({
          action: 'Fill',
          target: this.detector.detectNexacroComponent(component),
          parameters: {
            value: component.value
          }
        });
      }, { capture: true });
    }
  }
  
  private findNexacroComponentId(element: HTMLElement): string | null {
    // Nexacro sets data attributes with component IDs
    let current = element;
    while (current) {
      const nexacroId = current.getAttribute('nexacroactuallayout');
      if (nexacroId) return nexacroId;
      
      // Try finding from class patterns
      if (current.id?.startsWith('nxcl_')) {
        // Nexacro control ID pattern
        return current.id.replace('nxcl_', '');
      }
      
      current = current.parentElement;
    }
    
    return null;
  }
}
```

---

## Locator Generation

### Nexacro Locator Strategy

For Nexacro, primary locator is **component ID**, fallback is **DOM path**:

```typescript
class NexacroLocatorGenerator {
  
  generate(
    component: NexacroComponent,
    element: HTMLElement
  ): UILocators {
    return {
      // Primary: Nexacro component ID (most reliable)
      nexacroId: component.id,
      
      // Secondary: Form context + component ID
      customLocator: {
        componentClass: component.className,
        formId: component.parent?.id,
        componentId: component.id
      },
      
      // Tertiary: DOM path (for display DOM elements)
      domPath: this.generateDomPath(element),
      
      // Quaternary: CSS selector (if element has stable class)
      cssSelector: this.generateCssSelector(element),
      
      // For debugging
      alternates: [
        // Try by name attribute if exists
        ...(component.name ? [{
          type: 'byName',
          value: component.name
        }] : []),
        
        // Try by text content (for static/button)
        ...(component.value || component.text ? [{
          type: 'byText',
          value: component.value || component.text
        }] : [])
      ]
    };
  }
  
  /**
   * For Grid cell, locator includes row/col
   */
  generateGridCellLocator(
    grid: NexacroGrid,
    rowIndex: number,
    colIndex: number
  ): UILocators {
    const colName = this.getColumnName(grid, colIndex);
    
    return {
      nexacroId: grid.id,
      
      customLocator: {
        componentClass: 'Grid',
        gridId: grid.id,
        rowIndex: rowIndex.toString(),
        colIndex: colIndex.toString(),
        colName
      },
      
      // Can also reference by row data
      byRowData: {
        gridId: grid.id,
        rowData: grid.innerdataset.getRowData(rowIndex),
        colName
      }
    };
  }
}
```

### Replay with Nexacro Locators

```javascript
// When replaying recorded actions

function replayNexacroAction(actionRecord: ActionRecord): void {
  const form = nexacro.application.getActiveFrame().form;
  
  // Extract locator
  const locators = actionRecord.target.locators;
  
  // Try primary locator
  let component = form.getComponent(locators.nexacroId);
  
  if (!component && locators.customLocator?.componentId) {
    component = form.getComponent(
      locators.customLocator.componentId
    );
  }
  
  if (!component) {
    console.error('Component not found:', locators);
    return;
  }
  
  // Execute action
  switch (actionRecord.action) {
    case 'Click':
      component.onclick?.(null);
      break;
      
    case 'Fill':
      component.value = actionRecord.parameters.value;
      component.onchanged?.({ col: -1, row: -1, text: '' });
      break;
      
    case 'Select':
      if (component.className === 'Combo' || 
          component.className === 'ListBox') {
        component.value = actionRecord.parameters.value;
        component.onchanged?.({});
      }
      break;
      
    case 'Check':
      if (component.className === 'CheckBox') {
        component.value = 1;
        component.onchanged?.({});
      }
      break;
      
    case 'Fill' (Grid cell):
      const { rowIndex, colIndex } = actionRecord.target.context;
      component.setCellValue(
        rowIndex,
        colIndex,
        actionRecord.parameters.value
      );
      component.oncellclick?.({ 
        row: rowIndex, 
        col: colIndex 
      });
      break;
  }
}
```

---

## Code Examples

### Example 1: Detect Nexacro Edit Component

```javascript
// Samsung Employee form example

const form = nexacro.application.getActiveFrame().form;
const editComponent = form.getComponent('edtEmployeeID');

const uiObject = nexacroAdapter.mapNexacroComponent(editComponent);

// Result:
{
  type: 'TextBox',
  id: 'edtEmployeeID',
  name: 'edtEmployeeID',
  text: '',
  value: 'EMP001',
  
  enabled: true,
  visible: true,
  
  label: 'Employee ID',  // From associated label
  
  framework: 'Nexacro',
  
  locators: {
    nexacroId: 'edtEmployeeID',
    customLocator: {
      componentClass: 'Edit',
      formId: 'frmEmployee'
    }
  },
  
  boundingBox: { x: 100, y: 50, width: 150, height: 25 }
}
```

### Example 2: Record Grid Cell Edit

```javascript
// User double-clicks Grid cell to edit

const grid = form.getComponent('grdEmployee');
const rowIndex = 5;
const colIndex = 1;

// Grid fires oncellclick event
grid.oncellclick = (eventObj) => {
  // Detect cell
  const cellUiObject = gridDetector.detectGridCell(rowIndex, colIndex, grid);
  
  // Record action
  const actionRecord = {
    timestamp: Date.now(),
    action: 'Fill',
    target: {
      type: 'GridCell',
      locators: {
        nexacroId: 'grdEmployee',
        customLocator: {
          componentClass: 'Grid',
          rowIndex: '5',
          colIndex: '1',
          colName: 'EmployeeName'
        }
      },
      context: {
        gridId: 'grdEmployee',
        rowIndex: 5,
        colName: 'EmployeeName',
        rowData: {
          'EmployeeID': 'EMP001',
          'EmployeeName': 'John Doe',
          'Department': 'IT'
        }
      }
    },
    parameters: {
      value: 'Jane Doe'  // User's input
    }
  };
  
  recorder.recordAction(actionRecord);
  
  // User types and presses Enter
  const newValue = 'Jane Doe';
  grid.setCellValue(rowIndex, colIndex, newValue);
};
```

### Example 3: Record Combo Selection

```javascript
// User selects from Nexacro Combo

const combo = form.getComponent('cboDepartment');

// Original change handler
combo.onchanged = (eventObj) => {
  // Get selected value
  const selectedValue = combo.value;  // e.g., 'IT'
  const selectedText = combo.text;    // e.g., 'Information Technology'
  
  // Detect component
  const uiObject = nexacroAdapter.mapNexacroComponent(combo);
  
  // Record action
  const actionRecord = {
    timestamp: Date.now(),
    action: 'Select',
    target: {
      type: 'ComboBox',
      id: 'cboDepartment',
      locators: {
        nexacroId: 'cboDepartment',
        customLocator: {
          componentClass: 'Combo',
          formId: 'frmEmployee'
        }
      },
      display: {
        label: 'Department'
      }
    },
    parameters: {
      value: selectedValue,
      text: selectedText
    }
  };
  
  recorder.recordAction(actionRecord);
};
```

### Example 4: Nexacro Form Initialization

```javascript
// Complete form setup for recording

class NexacroRecorderSetup {
  
  setupFormRecording(formId: string): void {
    const form = this.getForm(formId);
    
    // 1. Hook all components
    form.components.forEach(component => {
      this.hookComponent(form, component);
    });
    
    // 2. Setup Grid-specific handlers
    form.components.forEach(component => {
      if (component.className === 'Grid') {
        this.setupGridRecording(form, component);
      }
    });
    
    // 3. Setup combo datasets
    form.components.forEach(component => {
      if (component.className === 'Combo') {
        this.setupComboRecording(form, component);
      }
    });
  }
  
  private hookComponent(
    form: NexacroForm,
    component: NexacroComponent
  ): void {
    const detector = new NexacroAdapterDetector();
    const recorder = this.recorder;
    
    // Hook click
    const origClick = component.onclick;
    component.onclick = (obj) => {
      const uiObject = detector.mapNexacroComponent(component);
      recorder.recordAction({
        action: 'Click',
        target: uiObject,
        timestamp: Date.now()
      });
      return origClick?.call(component, obj);
    };
    
    // Hook change
    if (['Edit', 'MaskEdit', 'Combo', 'CheckBox', 'Radio'].includes(
      component.className
    )) {
      const origChange = component.onchanged;
      component.onchanged = (obj) => {
        const uiObject = detector.mapNexacroComponent(component);
        recorder.recordAction({
          action: 'Fill',
          target: uiObject,
          parameters: { value: component.value },
          timestamp: Date.now()
        });
        return origChange?.call(component, obj);
      };
    }
  }
  
  private setupGridRecording(
    form: NexacroForm,
    grid: NexacroGrid
  ): void {
    // Grid is special - monitor cell interactions
    const gridDetector = new NexacroGridDetector();
    
    const origCellClick = grid.oncellclick;
    grid.oncellclick = (obj) => {
      const cellUiObject = gridDetector.detectGridCell(obj.row, obj.col, grid);
      this.recorder.recordAction({
        action: 'Click',
        target: cellUiObject,
        timestamp: Date.now()
      });
      return origCellClick?.call(grid, obj);
    };
  }
  
  private setupComboRecording(
    form: NexacroForm,
    combo: NexacroCombo
  ): void {
    // Preload dataset info for locator generation
    const dataset = combo.innerdataset;
    this.datasetCache[combo.id] = dataset;
  }
}
```

---

## Testing Nexacro Adapter

### Test Cases

```javascript
const nexacroTests = [
  {
    name: 'Detect Edit component',
    setup: () => {
      const component = form.getComponent('edtEmployeeID');
      component.value = 'EMP001';
    },
    test: () => {
      const uiObject = detector.detectNexacroComponent(component);
      assert.equals(uiObject.type, 'TextBox');
      assert.equals(uiObject.value, 'EMP001');
    }
  },
  
  {
    name: 'Detect Grid cell',
    setup: () => {
      const grid = form.getComponent('grdEmployee');
      // Simulate click on row 3, col 1
      grid.currentrow = 3;
      grid.currentcol = 1;
    },
    test: () => {
      const cellUiObject = gridDetector.detectGridCell(3, 1, grid);
      assert.equals(cellUiObject.type, 'GridCell');
      assert.equals(cellUiObject.rowIndex, 3);
    }
  },
  
  {
    name: 'Record Combo change',
    setup: () => {
      const combo = form.getComponent('cboDepartment');
      // Simulate selection
      combo.value = 'IT';
      combo.onchanged?.({});
    },
    test: () => {
      const actions = recorder.getRecordedActions();
      const lastAction = actions[actions.length - 1];
      assert.equals(lastAction.action, 'Select');
      assert.equals(lastAction.parameters.value, 'IT');
    }
  }
];
```

---

## Performance Considerations

### Grid Performance

For large grids (1000+ rows), avoid:
- ❌ Iterating all rows on every cell click
- ❌ Fetching full dataset unnecessarily
- ❌ Creating UIObject for off-screen cells

Do:
- ✅ Use only `currentrow` and `currentcol`
- ✅ Lazy-load cell data when needed
- ✅ Cache column info
- ✅ Use DOM event delegation

### Code Example

```javascript
// Efficient grid cell detection

class EfficientGridDetector {
  private columnCache = new Map();
  
  detectGridCell(rowIndex: number, colIndex: number, grid: NexacroGrid) {
    // 1. Only get data for clicked cell, not entire row
    const dataset = grid.innerdataset;
    const rowData = dataset.getRowData(rowIndex);
    const cellValue = grid.getCellValue(rowIndex, colIndex);
    
    // 2. Cache column info
    let colName = this.columnCache.get(grid.id)?.[colIndex];
    if (!colName) {
      colName = this.getColumnName(grid, colIndex);
      if (!this.columnCache.has(grid.id)) {
        this.columnCache.set(grid.id, {});
      }
      this.columnCache.get(grid.id)[colIndex] = colName;
    }
    
    // 3. Build minimal UIObject
    return {
      type: 'GridCell',
      context: {
        gridId: grid.id,
        rowIndex,
        colIndex,
        colName,
        rowData
      },
      // ... rest of properties
    };
  }
}
```

---

**Last Updated**: August 26, 2026  
**Status**: Ready for Phase 2 implementation
