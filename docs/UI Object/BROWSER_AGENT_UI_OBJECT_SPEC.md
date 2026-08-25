# Browser Agent Recorder - UI Object Detection Specification

**Version**: 1.0  
**Date**: August 2026  
**Purpose**: Complete UI Object model + detection strategy for recording user interactions

---

## Executive Summary

| Metric | Value |
|--------|-------|
| **Total UI Objects** | 115 (109 standard + 6 edge cases) |
| **Detection Strategies** | 6 (DOM, ARIA, Relationship, Framework, Visual, OCR) |
| **Framework Adapters** | 4 tiers (Standard, Popular, Special, Legacy) |
| **Priority Objects** | 80 (Phase 1 MVP) |

---

## Part 1: UI Object Registry (115 Objects)

### 1. Page & Layout — 15 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 1 | Page | Root document | Context for all actions |
| 2 | Window | Browser window | Navigation, resize |
| 3 | Header | Page header section | Layout grouping |
| 4 | Footer | Page footer section | Layout grouping |
| 5 | Navbar | Navigation bar | Navigation context |
| 6 | Sidebar | Side panel navigation | Layout grouping |
| 7 | Main | Main content area | Action scope |
| 8 | Section | Content section | Logical grouping |
| 9 | Container | Generic wrapper | Context container |
| 10 | Panel | Collapsible/expandable panel | State tracking |
| 11 | Card | Card component | Visual grouping |
| 12 | Group | Element group | Semantic grouping |
| 13 | Row | Layout row | Table/grid context |
| 14 | Column | Layout column | Table/grid context |
| 15 | IFrame | Embedded document | Scope boundary |

---

### 2. Text & Content — 10 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 16 | Text | Plain text node | Content verification |
| 17 | Heading | H1-H6 heading | Page structure |
| 18 | Label | Form label | Field identification |
| 19 | Paragraph | Text paragraph | Content block |
| 20 | Link | Hyperlink | Navigation action |
| 21 | List | Unordered/ordered list | Structure |
| 22 | ListItem | List item | Element in list |
| 23 | Badge | Status badge | Status indicator |
| 24 | Tag | Tag/chip component | Status/filter |
| 25 | Icon | Icon element | Visual indicator |

---

### 3. Input — 12 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 26 | TextBox | Single-line text input | `Fill(TextBox, value)` |
| 27 | PasswordBox | Password input | `Fill(PasswordBox, value)` |
| 28 | TextArea | Multi-line text input | `Fill(TextArea, value)` |
| 29 | NumberBox | Numeric input | `Fill(NumberBox, value)` |
| 30 | SearchBox | Search input | `Fill(SearchBox, query)` |
| 31 | EmailBox | Email input | `Fill(EmailBox, email)` |
| 32 | PhoneBox | Phone input | `Fill(PhoneBox, phone)` |
| 33 | URLBox | URL input | `Fill(URLBox, url)` |
| 34 | FileUpload | File picker | `Upload(FileUpload, path)` |
| 35 | ColorPicker | Color input | `Pick(ColorPicker, color)` |
| 36 | HiddenInput | Hidden form field | Metadata only |
| 37 | MaskedInput | Formatted input (phone, card, date) | `Fill(MaskedInput, value)` ⚠️ |

---

### 4. Selection — 9 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 38 | Checkbox | Checkbox input | `Check(Checkbox)`, `Uncheck(Checkbox)` |
| 39 | RadioButton | Radio button group | `Select(RadioButton, value)` |
| 40 | Select | Dropdown select | `Select(Select, value)` |
| 41 | ComboBox | Searchable dropdown | `Select(ComboBox, value)`, `Fill(ComboBox, query)` |
| 42 | ListBox | Multi-select list | `Select(ListBox, [values])` |
| 43 | MultiSelect | Multi-select dropdown | `Select(MultiSelect, [values])` |
| 44 | AutoComplete | Auto-complete input | `Fill(AutoComplete, query)`, `Select(AutoComplete, item)` |
| 45 | TreeSelect | Hierarchical select | `Expand(TreeSelect, node)`, `Select(TreeSelect, value)` |
| 46 | Switch | Toggle switch | `Toggle(Switch)` |

---

### 5. Date / Time — 5 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 47 | DatePicker | Date selection | `Pick(DatePicker, date)` |
| 48 | TimePicker | Time selection | `Pick(TimePicker, time)` |
| 49 | DateTimePicker | Date + time selection | `Pick(DateTimePicker, datetime)` |
| 50 | Calendar | Full calendar widget | `Select(Calendar, date)` |
| 51 | MonthPicker | Month selection | `Pick(MonthPicker, month)` |

---

### 6. Button / Action — 7 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 52 | Button | Standard button | `Click(Button)` |
| 53 | SubmitButton | Form submit button | `Click(SubmitButton)` → form submit |
| 54 | ResetButton | Form reset button | `Click(ResetButton)` → form reset |
| 55 | IconButton | Icon-only button | `Click(IconButton)` |
| 56 | ToggleButton | Button with toggle state | `Toggle(ToggleButton)` |
| 57 | SplitButton | Button + dropdown | `Click(SplitButton)`, `Open(SplitButton.dropdown)` |
| 58 | CloseButton | Close/dismiss button | `Click(CloseButton)` → close parent |

---

### 7. Navigation — 8 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 59 | Menu | Menu container | Navigation context |
| 60 | MenuItem | Menu item | `Click(MenuItem)` |
| 61 | SubMenu | Nested menu | `Expand(SubMenu)` |
| 62 | Tab | Tab navigation | `Select(Tab, tabName)` |
| 63 | TabPanel | Tab content panel | Context for actions |
| 64 | Breadcrumb | Breadcrumb navigation | `Click(Breadcrumb.item)` |
| 65 | Pagination | Page navigation | `Click(Pagination, pageNum)` |
| 66 | NavigationLink | Navigation hyperlink | `Click(NavigationLink)` |

---

### 8. Table / Grid — 13 Objects (Extended)

**CRITICAL GROUP FOR RECORDER** — Most complex interactions

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 67 | Table | Table container | Context for all row/cell actions |
| 68 | TableHeader | Table header section | Column identification |
| 69 | TableColumn | Table column | Sorting, filtering context |
| 70 | TableRow | Table row | `Click(TableRow)`, selection context |
| 71 | TableCell | Table cell | `Click(TableCell)`, edit context |
| 72 | DataGrid | Complex data grid | Advanced table |
| 73 | GridRow | Grid row | `Click(GridRow)` |
| 74 | GridCell | Grid cell | `Click(GridCell)`, edit |
| 75 | TreeGrid | Hierarchical grid | `Expand(TreeNode)`, `Select(TreeRow)` |
| 76 | TreeNode | Tree node in grid | `Expand(TreeNode)`, `Collapse(TreeNode)` |
| 77 | TableRowAction | Action button in row | `Click(TableRowAction)` with context |
| 78 | ColumnResizer | Column resize handle | `Drag(ColumnResizer)` ⚠️ |
| 79 | VirtualList | Lazy-loaded list | Scroll + render detection ⚠️ |

---

### 9. Popup / Overlay — 9 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 80 | Dialog | Modal dialog | Scope boundary |
| 81 | Modal | Modal overlay | `Close(Modal)` action |
| 82 | Popup | Popup window | `Close(Popup)` action |
| 83 | Dropdown | Dropdown menu | `Open(Dropdown)`, `Click(MenuItem)` |
| 84 | ContextMenu | Right-click menu | `RightClick(target)` → menu action |
| 85 | Tooltip | Hover tooltip | `Hover(element)` → tooltip |
| 86 | Popover | Popover container | `Click(trigger)` → popover |
| 87 | Drawer | Side drawer | `Open(Drawer)`, `Close(Drawer)` |
| 88 | DropZone | Drag-drop zone | `Drop(element, zone)` |

---

### 10. Feedback / Status — 7 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 89 | Alert | Alert message | Status verification |
| 90 | Notification | Notification message | Event confirmation |
| 91 | Toast | Toast notification | Transient feedback |
| 92 | ProgressBar | Progress indicator | State tracking |
| 93 | Spinner | Loading spinner | Async wait state |
| 94 | Loading | Loading indicator | Async operation |
| 95 | ValidationMessage | Form validation error | Error state tracking |

---

### 11. Media / Visual — 9 Objects

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 96 | Image | Static image | Context/verification |
| 97 | ImageButton | Clickable image | `Click(ImageButton)` |
| 98 | ImageLink | Image hyperlink | `Click(ImageLink)` |
| 99 | SVG | SVG graphic | Visual indicator |
| 100 | SVGClickable | Interactive SVG element | `Click(SVGClickable)` with coords ⚠️ |
| 101 | Canvas | HTML canvas | Bounding box detection ⚠️ |
| 102 | Video | Video player | Playback control |
| 103 | Audio | Audio player | Playback control |
| 104 | Chart | Data visualization chart | Click area detection ⚠️ |

---

### 12. Interactive Special — 11 Objects (Extended)

| # | Object | Purpose | Recorder Use |
|---|--------|---------|--------------|
| 105 | Slider | Single value slider | `Drag(Slider, value)` |
| 106 | RangeSlider | Min-max slider | `Drag(RangeSlider, [min, max])` |
| 107 | Rating | Rating input | `Click(Rating, rating)` |
| 108 | DragDropArea | Drag-drop container | `Drag(element, zone)` |
| 109 | ScrollContainer | Scrollable container | `Scroll(ScrollContainer, direction)` |
| 110 | RichTextEditor | WYSIWYG editor | `Edit(RichTextEditor, content)` |
| 111 | CodeEditor | Code input | `Edit(CodeEditor, code)` |
| 112 | FileDropZone | File drop area | `Drop(files, zone)` |
| 113 | ResizablePanel | Resizable panel | `Resize(ResizablePanel, size)` |
| 114 | WebComponent | Shadow DOM element | DOM traversal required ⚠️ |
| 115 | IFrameDocument | Nested document | Recursive detection ⚠️ |

---

## Part 2: UIObject Data Model

Every detected object must have these properties:

```typescript
interface UIObject {
  // Identity
  type: ObjectType              // e.g., "Button", "TextBox"
  id?: string                   // HTML id attribute
  name?: string                 // name attribute or accessible name
  text?: string                 // Displayed text content
  
  // Semantics
  role?: string                 // ARIA role
  label?: string                // Associated label (for form inputs)
  placeholder?: string          // Input placeholder
  value?: string                // Current value
  
  // State
  visible: boolean
  enabled: boolean
  disabled?: boolean
  readOnly?: boolean
  selected?: boolean
  checked?: boolean
  expanded?: boolean
  
  // Geometry
  boundingBox: {
    x: number
    y: number
    width: number
    height: number
    screenX?: number            // For screenshot overlay
    screenY?: number
  }
  
  // Structure
  parent?: UIObject
  children?: UIObject[]
  
  // Locators (for replay)
  locators: {
    id?: string
    name?: string
    cssSelector?: string
    xpath?: string
    domPath?: string            // Traversal path
    ariaLabel?: string
    ariaRole?: string
    testId?: string             // data-testid
    customLocator?: Record<string, string>
  }
  
  // Metadata
  framework?: FrameworkType     // React, Vue, Angular, Nexacro, etc.
  shadowDOM?: boolean           // Web Component indicator
  nested?: boolean              // Nested in special context
  timestamp?: number            // Detection timestamp
}
```

---

## Part 3: Action Matrix

Define which actions each object type supports:

### 3.1 Action Types

```typescript
type ActionType = 
  | 'Click'           // Mouse click
  | 'Fill'            // Text input
  | 'Select'          // Dropdown/choice selection
  | 'Check'           // Checkbox check
  | 'Uncheck'         // Checkbox uncheck
  | 'Toggle'          // Switch/toggle
  | 'Hover'           // Mouse hover
  | 'RightClick'      // Context menu
  | 'DoubleClick'     // Double click
  | 'Drag'            // Drag & drop
  | 'Scroll'          // Scroll
  | 'Pick'            // Date/color picker
  | 'Upload'          // File upload
  | 'Edit'            // Rich text edit
  | 'Expand'          // Expand/collapse
  | 'Close'           // Close modal/drawer
  | 'Open'            // Open dropdown/drawer
  | 'Resize'          // Resize element
  | 'Wait'            // Wait for visibility
  | 'FrameNavigation' // Navigate iframe
```

### 3.2 Object Type × Action Matrix

| Object | Click | Fill | Select | Check/Toggle | Hover | RightClick | Drag | Scroll | Edit |
|--------|:-----:|:----:|:------:|:------------:|:-----:|:----------:|:----:|:------:|:----:|
| **Button** | ✓ | - | - | - | ✓ | - | - | - | - |
| **TextBox** | ✓ | ✓ | - | - | - | - | - | - | - |
| **TextArea** | ✓ | ✓ | - | - | - | - | - | - | ✓ |
| **Select** | ✓ | - | ✓ | - | - | - | - | - | - |
| **ComboBox** | ✓ | ✓ | ✓ | - | - | - | - | - | - |
| **Checkbox** | ✓ | - | - | ✓ | - | - | - | - | - |
| **RadioButton** | ✓ | - | ✓ | - | - | - | - | - | - |
| **Switch** | ✓ | - | - | ✓ | - | - | - | - | - |
| **Slider** | - | - | - | - | - | - | ✓ | - | - |
| **DatePicker** | ✓ | - | ✓ | - | - | - | - | - | - |
| **TableCell** | ✓ | ✓ | - | - | - | - | - | - | ✓ |
| **TableRow** | ✓ | - | - | ✓ | - | ✓ | ✓ | - | - |
| **Tooltip** | - | - | - | - | ✓ | - | - | - | - |
| **Dropdown** | - | - | - | - | - | - | - | - | - |
| **Menu** | ✓ | - | - | - | - | - | - | - | - |
| **Tab** | ✓ | - | ✓ | - | - | - | - | - | - |
| **Modal** | - | - | - | - | - | - | - | - | - |
| **Drawer** | ✓ | - | - | - | - | - | - | - | - |
| **Pagination** | ✓ | - | - | - | - | - | - | - | - |
| **ScrollContainer** | - | - | - | - | - | - | - | ✓ | - |
| **VirtualList** | - | - | - | - | - | - | - | ✓ | - |
| **RichTextEditor** | ✓ | ✓ | - | - | - | - | - | - | ✓ |
| **FileUpload** | ✓ | - | - | - | - | - | ✓ | - | - |
| **ImageButton** | ✓ | - | - | - | ✓ | - | - | - | - |
| **Canvas** | ✓ | - | - | - | - | - | - | - | - |

---

## Part 4: Detection Strategy

### 4.1 Detection Priority (6-Layer Pyramid)

```
┌─────────────────────────────────┐
│  1. DOM (Standard HTML)         │  Highest confidence
├─────────────────────────────────┤
│  2. ARIA Attributes             │  Accessibility layer
├─────────────────────────────────┤
│  3. Relationship/Label          │  Context detection
├─────────────────────────────────┤
│  4. Framework Adapter           │  React/Vue/Nexacro specific
├─────────────────────────────────┤
│  5. Visual/Style Detection      │  CSS-based inference
├─────────────────────────────────┤
│  6. OCR (Fallback)              │  Last resort
└─────────────────────────────────┘
```

### 4.2 Layer 1: DOM Standard Elements

```javascript
// Mapping standard HTML → UIObject

<input type="text">           → TextBox
<input type="password">       → PasswordBox
<input type="checkbox">       → Checkbox
<input type="radio">          → RadioButton
<input type="file">           → FileUpload
<input type="date">           → DatePicker
<textarea>                    → TextArea
<select>                      → Select
<button>                      → Button
<a href="#">                  → Link
<table>                       → Table
<tr>                          → TableRow
<td>/<th>                     → TableCell
<img>                         → Image
<svg>                         → SVG
<canvas>                      → Canvas
<video>                       → Video
<audio>                       → Audio
<dialog>                      → Dialog
<form>                        → Form (implied context)
```

### 4.3 Layer 2: ARIA Attributes

```javascript
// ARIA role mapping

role="button"               → Button (if not <button>)
role="textbox"              → TextBox
role="combobox"             → ComboBox
role="listbox"              → ListBox
role="option"               → SelectOption / ListItem
role="checkbox"             → Checkbox
role="radio"                → RadioButton
role="tab"                  → Tab
role="tabpanel"             → TabPanel
role="dialog"               → Dialog
role="alertdialog"          → Alert + Dialog
role="grid"                 → DataGrid / Table
role="row"                  → GridRow / TableRow
role="gridcell"             → GridCell / TableCell
role="navigation"           → Navigation context
role="menu"                 → Menu
role="menuitem"             → MenuItem
role="link"                 → Link (if not <a>)
role="image"                → Image
role="img"                  → Image
aria-label                  → Name / Label
aria-expanded               → Expanded state
aria-checked                → Checked state
aria-selected               → Selected state
aria-hidden                 → Visibility
aria-disabled               → Disabled state
```

### 4.4 Layer 3: Relationship Detection

```javascript
// Infer type from structure

<label>Name</label>
<input type="text">
→ TextBox with label="Name"

<label>
  <input type="checkbox">
  Subscribe
</label>
→ Checkbox with text="Subscribe"

<table>
  <thead>
    <tr><th>ID</th><th>Name</th></tr>
  </thead>
  <tbody>
    <tr><td>001</td><td>John</td></tr>
  </tbody>
</table>
→ Table, TableColumn, TableRow, TableCell (inferred)

<div class="dropdown">
  <button>Actions</button>
  <div class="dropdown-menu">
    <a>Edit</a>
    <a>Delete</a>
  </div>
</div>
→ Dropdown + MenuItem (inferred)
```

### 4.5 Layer 4: Framework Adapter

See **Part 5** for framework-specific detection

### 4.6 Layer 5: Visual/Style Detection

```javascript
// CSS-based inference (fallback)

.btn, .button              → Button
.input, .textbox           → TextBox
.select, .dropdown         → Select / ComboBox
.checkbox                  → Checkbox
.radio                     → RadioButton
.modal, .dialog            → Modal / Dialog
.table, .grid              → Table / DataGrid
.menu, .nav                → Menu / Navigation
[contenteditable="true"]   → RichTextEditor
overflow: scroll/auto      → ScrollContainer
pointer-events: none       → Disabled/Hidden
display: none/hidden       → Hidden/Invisible
```

### 4.7 Layer 6: OCR Detection

```javascript
// Extract text from visual elements (Image, Canvas, Screenshot)

Canvas text detection   → Detect actionable text
SVG text detection      → Extract SVG text labels
Screenshot OCR          → Last resort for custom UI
```

---

## Part 5: Framework Adapter Strategy

### 5.1 Framework Tier Classification

```
TIER 1: Standard Web (No adapter needed)
├─ Standard HTML/DOM
├─ Standard ARIA
└─ Vanilla JavaScript

TIER 2: Popular Frameworks (High priority)
├─ React (16.x, 17.x, 18.x)
├─ Vue (2.x, 3.x)
├─ Angular (12+)
└─ Component Libraries: MUI, Ant Design, Element Plus

TIER 3: Special Platforms (Samsung focus)
├─ Nexacro (XML-based)
├─ Custom enterprise frameworks
└─ Legacy frameworks

TIER 4: Web Standards (Medium priority)
├─ Web Components (Shadow DOM)
├─ Custom Elements
└─ Emerging frameworks
```

### 5.2 React Adapter

```typescript
// React-specific detection

class ReactAdapterDetector {
  detect(element: HTMLElement): UIObject | null {
    // 1. Check for React props/fiber
    const fiberKey = Object.keys(element).find(key => 
      key.startsWith('__react')
    );
    
    if (fiberKey) {
      const fiber = element[fiberKey];
      const component = fiber.elementType?.name;
      
      // 2. Map React component to UIObject
      return this.mapReactComponent(component, element);
    }
    
    // 3. Fallback to standard detection
    return null;
  }
  
  mapReactComponent(component: string, element: HTMLElement): UIObject {
    // e.g., Button → Button, TextField → TextBox, Select → Select
    const mapping = {
      'Button': 'Button',
      'TextField': 'TextBox',
      'TextFieldMultiline': 'TextArea',
      'Select': 'Select',
      'MenuItem': 'SelectOption',
      'Checkbox': 'Checkbox',
      'Radio': 'RadioButton',
      'Switch': 'Switch',
      'Dialog': 'Dialog',
      'Modal': 'Modal',
      'Drawer': 'Drawer',
      'Table': 'Table',
      'TableRow': 'TableRow',
      'TableCell': 'TableCell',
      'Tab': 'Tab',
      'Tabs': 'TabPanel',
      'Menu': 'Menu',
      'MenuItem': 'MenuItem',
      'DatePicker': 'DatePicker',
      'TimePicker': 'TimePicker',
      'Slider': 'Slider',
      'Rating': 'Rating',
      // ... etc
    };
    
    return {
      type: mapping[component] || 'Unknown',
      framework: 'React',
      ...this.extractProps(element)
    };
  }
}
```

### 5.3 Vue Adapter

```typescript
// Vue-specific detection

class VueAdapterDetector {
  detect(element: HTMLElement): UIObject | null {
    // 1. Check for Vue instance
    const vueInstance = element.__vue__;
    
    if (vueInstance) {
      const componentName = vueInstance.$options.name;
      const props = vueInstance.$props;
      
      return this.mapVueComponent(componentName, element, props);
    }
    
    return null;
  }
}
```

### 5.4 Angular Adapter

```typescript
// Angular-specific detection

class AngularAdapterDetector {
  detect(element: HTMLElement): UIObject | null {
    // 1. Check for Angular component
    const ngComponent = (element as any).getAttribute('ng-component');
    const ngHost = (element as any).__ngHost__;
    
    if (ngHost) {
      const componentInstance = ngHost._componentRef?.instance;
      return this.mapAngularComponent(componentInstance, element);
    }
    
    return null;
  }
}
```

### 5.5 Nexacro Adapter (PRIORITY)

**⚠️ SAMSUNG INTERNAL FRAMEWORK**

Nexacro is XML-based, **NOT HTML-based**. Requires special handling:

```typescript
class NexacroAdapterDetector {
  detect(element: HTMLElement): UIObject | null {
    // 1. Check for Nexacro framework marker
    if (!window.nexacro) return null;
    
    // 2. Get Nexacro component ID
    const nexacroId = element.id;
    if (!nexacroId) return null;
    
    // 3. Fetch component from Nexacro runtime
    const form = nexacro.application.getActiveFrame().form;
    const component = form.getComponent(nexacroId);
    
    if (!component) return null;
    
    // 4. Map Nexacro component type to UIObject
    return this.mapNexacroComponent(component, element);
  }
  
  mapNexacroComponent(
    component: NexacroComponent, 
    element: HTMLElement
  ): UIObject {
    const typeMapping = {
      'Edit': 'TextBox',
      'Textarea': 'TextArea',
      'MaskEdit': 'MaskedInput',
      'CheckBox': 'Checkbox',
      'Radio': 'RadioButton',
      'Combo': 'ComboBox',
      'ListBox': 'ListBox',
      'Button': 'Button',
      'DatePicker': 'DatePicker',
      'TimePicker': 'TimePicker',
      'Slider': 'Slider',
      'Spin': 'NumberBox',
      'Calendar': 'Calendar',
      'Grid': 'DataGrid',
      'Tab': 'Tab',
      'Tree': 'TreeSelect',
      'TreeView': 'TreeSelect',
      'Div': 'Container',
      'Static': 'Text',
      'TextArea': 'TextArea',
      'Label': 'Label',
      'Image': 'Image',
      'ImageButton': 'ImageButton',
      'PopupDiv': 'Popup',
    };
    
    const objectType = typeMapping[component.className] || 'Unknown';
    
    // 5. Extract Nexacro-specific properties
    return {
      type: objectType,
      framework: 'Nexacro',
      id: component.id,
      name: component.id,
      text: component.value || component.text || '',
      value: component.value,
      enabled: component.enable,
      visible: component.visible,
      
      // Nexacro-specific
      locators: {
        id: component.id,
        customLocator: {
          'nexacroId': component.id,
          'componentClass': component.className,
          'formId': component.parent?.id
        }
      },
      
      boundingBox: this.getNexacroBBox(element),
      timestamp: Date.now()
    };
  }
  
  getNexacroBBox(element: HTMLElement) {
    // Nexacro generates DOM elements, get their bounding box
    const rect = element.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
      screenX: rect.left + window.scrollX,
      screenY: rect.top + window.scrollY
    };
  }
}
```

### 5.6 Nexacro-Specific UI Mapping

| Nexacro Component | UIObject Type | Special Handling |
|------------------|---------------|-----------------|
| Edit | TextBox | `component.value` for content |
| MaskEdit | MaskedInput | Format pattern stored in component |
| Textarea | TextArea | Multi-line support |
| CheckBox | Checkbox | `component.value` = checked state |
| Radio | RadioButton | Group handling via form |
| Combo | ComboBox | Need to fetch dataset |
| ListBox | ListBox | Multi-select support |
| Button | Button | Standard click |
| DatePicker (xpicker) | DatePicker | Format from component config |
| Grid | DataGrid | Complex: rows/cols/cells |
| Tab | Tab | Dynamic tab switching |
| Tree / TreeView | TreeSelect | Hierarchical data |
| Div | Container | Layout grouping |
| Static / Label | Label/Text | Display-only |
| PopupDiv | Popup | Modal-like behavior |
| Image | Image | Image source in URL property |

**Nexacro Grid Detection (Critical):**
```javascript
// For Grid component, must detect:
// - Grid container
// - HeaderRow (column names)
// - DataRows (row items)
// - GridCell (individual cell)

const grid = form.getComponent(gridId);
const headerInfo = grid.getCellProperty(0, 'text'); // Column header
const rowCount = grid.getRowCount();
const cellValue = grid.getCellValue(rowIndex, colIndex);
```

---

## Part 6: Recording Format

### 6.1 Action Record

```typescript
interface ActionRecord {
  // Action metadata
  timestamp: number
  duration?: number          // ms from start to complete
  
  // Action specification
  action: ActionType
  
  // Target object
  target: {
    type: ObjectType
    
    // Primary locators (in priority order)
    locators: {
      id?: string
      cssSelector?: string
      xpath?: string
      domPath?: string
      nexacroId?: string    // Nexacro-specific
      testId?: string
    }
    
    // Display properties (for human readability)
    display?: {
      text?: string
      name?: string
      label?: string
      ariaLabel?: string
    }
    
    // Context (for nested elements)
    context?: {
      parentType?: ObjectType
      parentLocator?: string
      tableRow?: { id?: string; values?: Record<string, string> }
      tableColumn?: string
      tab?: string
      modal?: string
    }
  }
  
  // Action parameters
  parameters?: {
    value?: string | number | boolean | string[]
    option?: string
    date?: string
    time?: string
    color?: string
    coordinates?: { x: number; y: number }
    dragTarget?: UIObject
    files?: string[]
    keys?: string[]
  }
  
  // Result/outcome
  result?: {
    success: boolean
    error?: string
    newValue?: string
    navigationTarget?: string
  }
  
  // Verification (for testing)
  verification?: {
    expectedValue?: string
    expectedState?: string
    waitTime?: number
  }
}
```

### 6.2 Example Records

```javascript
// Example 1: Fill TextBox
{
  timestamp: 1693123456789,
  action: 'Fill',
  target: {
    type: 'TextBox',
    locators: {
      id: 'employeeId',
      cssSelector: 'input[name="emp_id"]'
    },
    display: {
      label: 'Employee ID',
      name: 'emp_id'
    }
  },
  parameters: {
    value: 'EMP001'
  }
}

// Example 2: Click Button in TableRow
{
  timestamp: 1693123457890,
  action: 'Click',
  target: {
    type: 'Button',
    locators: {
      id: 'edit-btn-emp001',
      cssSelector: 'button[data-action="edit"]'
    },
    display: {
      text: 'Edit'
    },
    context: {
      parentType: 'TableRow',
      tableRow: {
        id: 'emp001',
        values: {
          'employeeId': 'EMP001',
          'name': 'John Doe'
        }
      },
      table: 'employeeTable'
    }
  }
}

// Example 3: Select from Nexacro Combo
{
  timestamp: 1693123458901,
  action: 'Select',
  target: {
    type: 'ComboBox',
    locators: {
      nexacroId: 'cboDepartment',
      customLocator: {
        'componentClass': 'Combo',
        'formId': 'frmEmployee'
      }
    },
    display: {
      label: 'Department'
    },
    framework: 'Nexacro'
  },
  parameters: {
    value: 'IT'
  }
}

// Example 4: Scroll in VirtualList
{
  timestamp: 1693123459912,
  action: 'Scroll',
  target: {
    type: 'VirtualList',
    locators: {
      id: 'userList',
      cssSelector: '.virtual-list'
    }
  },
  parameters: {
    direction: 'down',
    distance: 500
  }
}
```

---

## Part 7: Implementation Phases

### Phase 1 (MVP): Weeks 1-4

**Objective**: Record basic interactions without coordinate dependency

**In Scope**:
- Detector: Layers 1-3 (DOM, ARIA, Relationship)
- Objects: 80 core objects (exclude edge cases)
- Adapters: Tier 1 (Standard HTML)
- Actions: Click, Fill, Select, Check, Toggle, Hover
- Recording: TextBox, Button, Select, Checkbox, Table basics

**Deliverable**:
- UnifiedUIDetector class
- Layer 1-3 detection implementation
- EventRecorder → ActionRecord conversion
- File format: `.json` action sequence

**Test Coverage**:
- Standard HTML forms
- Simple tables
- Basic navigation

---

### Phase 2 (Tier 2 + Nexacro): Weeks 5-7

**Objective**: Support React/Vue/Angular/Nexacro

**In Scope**:
- Adapters: Tier 2 (React, Vue, Angular) + Tier 3 (Nexacro)
- Objects: Add Virtual List, MaskedInput, WebComponent
- Actions: Add Drag, Edit, Upload
- Recording: Complex tables, nested modals

**Deliverable**:
- React/Vue/Angular framework adapters
- **Nexacro adapter (PRIORITY)**
- Nexacro Grid detection
- Framework-aware locator generation

**Test Coverage**:
- Samsung Nexacro forms
- MUI/Ant Design components
- React hook forms
- Vue 3 composition API

---

### Phase 3 (Edge Cases + Optimization): Weeks 8-9

**Objective**: Handle complex scenarios, performance tuning

**In Scope**:
- Visual detection (Canvas, Chart, SVG clickable)
- OCR fallback
- Virtual list performance
- Shadow DOM (Web Components)
- Action replay + verification

**Deliverable**:
- Visual detector
- OCR integration
- Performance optimizations
- Replay engine

---

## Part 8: Detection Performance

### 8.1 Optimization Strategy

```javascript
// Caching layer
class UIObjectCache {
  private cache = new Map<Element, UIObject>();
  
  detect(element: Element, forceRefresh = false): UIObject {
    if (!forceRefresh && this.cache.has(element)) {
      return this.cache.get(element)!;
    }
    
    // Detect
    const obj = this.unifiedDetector.detect(element);
    this.cache.set(element, obj);
    return obj;
  }
  
  invalidate(element: Element) {
    this.cache.delete(element);
    // Invalidate parent chain
    let parent = element.parentElement;
    while (parent) {
      this.cache.delete(parent);
      parent = parent.parentElement;
    }
  }
}
```

### 8.2 Batching

```javascript
// Batch multiple detections (e.g., on scroll)
class BatchDetector {
  private queue: Element[] = [];
  private debounceTimer: number | null = null;
  
  detectBatch(elements: Element[], delay = 100) {
    this.queue.push(...elements);
    
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    
    this.debounceTimer = window.setTimeout(() => {
      const results = this.queue.map(el => 
        this.detector.detect(el)
      );
      this.queue = [];
      return results;
    }, delay);
  }
}
```

---

## Part 9: Quality Assurance

### 9.1 Accuracy Metrics

| Metric | Target | Notes |
|--------|--------|-------|
| **Detection Accuracy** | >95% | False positive rate <2% |
| **Locator Robustness** | >90% | Replay works after DOM changes |
| **Framework Coverage** | 100% | React, Vue, Angular, Nexacro |
| **Performance** | <100ms | Single element detection |
| **Memory Usage** | <50MB | Full page detection |

### 9.2 Test Matrix

```
Framework × Object Type × Action
├─ React + Button + Click
├─ React + TextBox + Fill
├─ React + ComboBox + Select
├─ Vue + Select + Select
├─ Angular + DataGrid + RowClick
├─ Nexacro + Combo + Select
├─ Nexacro + Grid + CellEdit
└─ Standard HTML (all combinations)
```

### 9.3 Regression Test Suite

```javascript
const testCases = [
  {
    name: 'MUI Button',
    html: '<Button variant="contained">Click me</Button>',
    expected: { type: 'Button', text: 'Click me' }
  },
  {
    name: 'Ant Design Table Cell',
    html: '<td>Cell Content</td>',
    expected: { type: 'TableCell', text: 'Cell Content' }
  },
  {
    name: 'Nexacro Grid Cell',
    framework: 'Nexacro',
    componentId: 'grdData',
    row: 0,
    col: 'name',
    expected: { type: 'GridCell', framework: 'Nexacro' }
  },
  // ... 50+ more cases
];
```

---

## Part 10: API Reference

### 10.1 Unified Detector Interface

```typescript
interface UnifiedUIDetector {
  // Main detection method
  detect(element: HTMLElement): UIObject | null;
  
  // Batch detection
  detectBatch(elements: HTMLElement[]): UIObject[];
  
  // Find objects by criteria
  findByType(type: ObjectType, root?: HTMLElement): UIObject[];
  findByText(text: string, root?: HTMLElement): UIObject[];
  findByLabel(label: string, root?: HTMLElement): UIObject[];
  
  // Framework management
  registerFrameworkAdapter(
    framework: FrameworkType,
    adapter: FrameworkAdapter
  ): void;
  
  // Cache management
  clearCache(element?: HTMLElement): void;
  
  // Debug
  debugElement(element: HTMLElement): DebugInfo;
}
```

### 10.2 Event Recorder Interface

```typescript
interface EventRecorder {
  // Recording control
  start(): void;
  stop(): ActionRecord[];
  pause(): void;
  resume(): void;
  
  // Event binding
  recordEvent(event: MouseEvent | KeyboardEvent): void;
  
  // Filtering
  setActionFilter(
    predicate: (action: ActionRecord) => boolean
  ): void;
  
  // Export
  exportJSON(): string;
  exportXML(): string;
  exportCSV(): string;
  
  // Playback preparation
  generateReplayScript(): string;
}
```

---

## Part 11: Configuration

### 11.1 Detector Configuration

```typescript
interface DetectorConfig {
  // Detection layers to enable
  enableDOM: boolean = true;
  enableAria: boolean = true;
  enableRelationship: boolean = true;
  enableFrameworkAdapters: boolean = true;
  enableVisual: boolean = false;
  enableOCR: boolean = false;
  
  // Framework priorities
  frameworkPriority: FrameworkType[] = [
    'Nexacro',    // Samsung-first
    'React',
    'Vue',
    'Angular',
    'Standard'
  ];
  
  // Performance tuning
  cachingEnabled: boolean = true;
  cacheSize: number = 1000;
  batchDetectionDelay: number = 100;
  
  // Logging
  debugMode: boolean = false;
  logLevel: 'error' | 'warn' | 'info' | 'debug' = 'info';
}
```

### 11.2 Recorder Configuration

```typescript
interface RecorderConfig {
  // What to record
  recordClicks: boolean = true;
  recordInput: boolean = true;
  recordScroll: boolean = true;
  recordNavigation: boolean = true;
  recordHover: boolean = false;
  
  // Filtering
  ignoredSelectors: string[] = [
    '.tooltip',
    '[aria-hidden="true"]',
    '.modal-overlay'
  ];
  
  // Context capture
  captureParentContext: boolean = true;
  captureTableContext: boolean = true;
  captureFormContext: boolean = true;
  maxContextDepth: number = 5;
  
  // Output format
  outputFormat: 'json' | 'xml' | 'csv' = 'json';
  prettify: boolean = true;
  includeTimestamps: boolean = true;
  includeScreenshots: boolean = false;
}
```

---

## Appendix A: Common Integration Points

### A.1 In VSCode DevTools

```javascript
// When building Browser Agent, use these hooks

window.__BROWSER_AGENT__ = {
  detector: unifiedDetector,
  recorder: eventRecorder,
  config: detectorConfig,
  
  // DevTools commands
  detectElement: (selector) => detector.detect(document.querySelector(selector)),
  recordSession: (duration) => { /* ... */ },
  stopRecording: () => recorder.stop(),
  exportActions: () => recorder.exportJSON(),
  highlightObject: (element) => { /* ... */ }
};
```

### A.2 VSCode Extension Integration

```typescript
// In VSCode extension for Browser Agent

vscode.commands.registerCommand('browserAgent.detectUI', async () => {
  const result = await executeInBrowser(
    `window.__BROWSER_AGENT__.detectElement('selected')`
  );
  vscode.window.showInformationMessage(
    `Detected: ${result.type} - ${result.name || result.text}`
  );
});
```

---

## Appendix B: Nexacro Specific Examples

### B.1 Nexacro Form Detection

```javascript
// Samsung Nexacro example: Employee form

const form = nexacro.application.getActiveFrame().form;

// Detect all components
const components = form.components;
components.forEach(comp => {
  const uiObject = nexacroAdapter.mapComponent(comp);
  console.log(uiObject);
  // Output:
  // {
  //   type: 'TextBox',
  //   id: 'edtEmployeeID',
  //   label: 'Employee ID',
  //   framework: 'Nexacro',
  //   locators: { nexacroId: 'edtEmployeeID', ... }
  // }
});
```

### B.2 Nexacro Grid Interaction

```javascript
// Recording Grid cell edit

const grid = form.getComponent('grdEmployee');
const rowIndex = 5;
const colIndex = 'employeeName';

// Detect Grid + Row + Cell context
const gridObject = detector.detect(grid.element);
const rowObject = {
  type: 'GridRow',
  index: rowIndex,
  data: grid.getRowData(rowIndex)
};
const cellObject = {
  type: 'GridCell',
  row: rowIndex,
  col: colIndex,
  value: grid.getCellValue(rowIndex, colIndex)
};

// Record action
const actionRecord = {
  action: 'Fill',
  target: {
    type: 'GridCell',
    context: {
      gridObject,
      rowObject,
      cellObject
    }
  },
  parameters: {
    value: 'New Name'
  }
};
```

---

## Appendix C: Resources & References

- **ARIA Specifications**: https://www.w3.org/WAI/ARIA/
- **React Testing Library**: https://testing-library.com/
- **Nexacro Documentation**: [Internal Samsung Wiki]
- **Playwright Inspector**: https://playwright.dev/docs/inspector
- **Puppeteer DevTools Protocol**: https://chromedevtools.github.io/devtools-protocol/

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Aug 2026 | Initial specification - 115 objects, 6-layer detection, Nexacro adapter |

---

**Last Updated**: August 26, 2026  
**Next Review**: October 2026 (Post-Phase 1)
