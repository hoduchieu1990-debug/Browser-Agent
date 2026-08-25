# Browser Agent Recorder - Implementation Checklist

**Quick Reference for Building**  
**Updated**: August 26, 2026

---

## Phase 1: MVP (Weeks 1-4) - Core Detection + Recording

### Week 1: Foundation

- [ ] **Project Setup**
  - [ ] Create TypeScript project structure
  - [ ] Setup DOM detection layer
  - [ ] Define UIObject interface
  - [ ] Create test harness

- [ ] **DOM Layer (Layer 1)**
  - [ ] Map standard HTML elements (see BROWSER_AGENT_UI_OBJECT_SPEC Part 1, Section 4.2)
  - [ ] Test with: `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>`
  - [ ] Handle edge cases: `<form>`, nested inputs, hidden elements
  - [ ] **Test**: 10 basic HTML controls

- [ ] **ARIA Layer (Layer 2)**
  - [ ] Extract ARIA role attributes
  - [ ] Map role → UIObject type (see spec Part 4, Section 4.3)
  - [ ] Handle aria-label, aria-checked, aria-expanded
  - [ ] Fallback for non-standard components
  - [ ] **Test**: MUI Button with role="button", custom combobox

### Week 2: Core Detector + Relationship

- [ ] **Relationship Layer (Layer 3)**
  - [ ] Label association: `<label>` → `<input>`
  - [ ] Container detection: parent context for nested elements
  - [ ] Infer type from structure (e.g., dropdown menu)
  - [ ] **Test**: Form fields with labels, dropdown menus

- [ ] **Unified Detector**
  - [ ] Implement 3-layer detection (DOM → ARIA → Relationship)
  - [ ] Priority system (if DOM match, skip ARIA)
  - [ ] Caching mechanism
  - [ ] Extract all UIObject properties (see spec Part 2)
  - [ ] **Test**: 50+ element types

- [ ] **Action Mapping**
  - [ ] Define ActionType enum
  - [ ] Implement action matrix (see spec Part 3)
  - [ ] Click, Fill, Select, Check, Toggle
  - [ ] Hover, RightClick (optional for MVP)
  - [ ] **Test**: ActionRecord format

### Week 3: Event Recording

- [ ] **Event Recorder**
  - [ ] Hook DOM events: click, input, change, submit
  - [ ] Capture event context: target element, mouse position, timestamp
  - [ ] Build ActionRecord for each event
  - [ ] **Test**: Click button → ActionRecord
  - [ ] **Test**: Fill textbox → ActionRecord with value

- [ ] **Locator Generation**
  - [ ] HTML id attribute
  - [ ] CSS selectors (stable ones only)
  - [ ] XPath generation
  - [ ] DOM path traversal
  - [ ] aria-label fallback
  - [ ] **Test**: Can re-locate element after DOM changes

- [ ] **Recording File Format**
  - [ ] JSON export (Action[])
  - [ ] Include: action, target, parameters, timestamp
  - [ ] Pretty-print for readability
  - [ ] **Test**: Export valid JSON

### Week 4: Basic Testing + Polish

- [ ] **Unit Tests**
  - [ ] 20+ unit tests for detector
  - [ ] 10+ tests for action recorder
  - [ ] Test coverage: >80%

- [ ] **Integration Tests**
  - [ ] Record 3-step workflow (login form)
  - [ ] Record table row click
  - [ ] Record dropdown selection
  - [ ] Verify exported JSON structure

- [ ] **Demo Setup**
  - [ ] Create demo HTML page with 20+ UI elements
  - [ ] VSCode integration hook
  - [ ] Console API: `window.__BROWSER_AGENT__.recordSession()`

**End of Phase 1**: ✅ MVP works for standard HTML + React/Vue (basic)

---

## Phase 2: Framework Adapters + Nexacro (Weeks 5-7)

### Week 5: React + Vue Adapters

- [ ] **React Adapter**
  - [ ] Detect React fiber
  - [ ] Map React component names to UIObject types
  - [ ] Handle MUI Button, TextField, Select, Table
  - [ ] Extract props for value/label
  - [ ] **Test**: MUI form
  - [ ] **Test**: React hook form

- [ ] **Vue Adapter**
  - [ ] Detect Vue instance (`__vue__`)
  - [ ] Map Vue component names
  - [ ] Handle Ant Design Vue, Element Plus
  - [ ] **Test**: Vue 3 composition API form
  - [ ] **Test**: Ant Design Vue Table

- [ ] **Angular Adapter** (Basic)
  - [ ] Detect Angular component host
  - [ ] Basic component mapping
  - [ ] Test with Material components
  - [ ] **Test**: Material form

### Week 6: Nexacro Adapter (PRIORITY)

**CRITICAL FOR SAMSUNG INTERNAL USE**

- [ ] **Nexacro Fundamentals**
  - [ ] Access `window.nexacro` API
  - [ ] Get active frame and form
  - [ ] Fetch components by ID
  - [ ] **Test**: Can access Nexacro runtime

- [ ] **Basic Component Mapping** (see NEXACRO_ADAPTER_GUIDE Part 2)
  - [ ] Edit → TextBox
  - [ ] MaskEdit → MaskedInput
  - [ ] Combo → ComboBox
  - [ ] CheckBox → Checkbox
  - [ ] Button → Button
  - [ ] Tab → Tab
  - [ ] **Test**: Detect 8+ Nexacro component types

- [ ] **Nexacro Event Hooking**
  - [ ] Hook `onclick`, `onchanged`, `onitemclick`
  - [ ] Capture component value before/after
  - [ ] **Test**: Button click recorded
  - [ ] **Test**: Combo selection recorded

- [ ] **Nexacro Locator Generation**
  - [ ] Primary: nexacroId (component ID)
  - [ ] Custom locator with componentClass + formId
  - [ ] DOM path fallback
  - [ ] **Test**: Can replay with nexacroId

### Week 7: Nexacro Grid (CRITICAL)

**Most complex Nexacro component**

- [ ] **Grid Cell Detection** (see NEXACRO_ADAPTER_GUIDE Part 3)
  - [ ] Map DOM grid structure to rowIndex/colIndex
  - [ ] Extract cell value from grid.getCellValue()
  - [ ] Get column names from grid
  - [ ] Build GridCell UIObject
  - [ ] **Test**: Click grid cell → detect row/col/value

- [ ] **Grid Row Context**
  - [ ] Capture full row data (innerdataset.getRowData)
  - [ ] Include in ActionRecord context
  - [ ] **Test**: Record edit action with row context

- [ ] **Grid Event Recording**
  - [ ] Hook oncellclick, oncelldblclick
  - [ ] Handle cell editing (double-click)
  - [ ] Record as `Fill(GridCell, value)` with context
  - [ ] **Test**: Grid cell edit workflow

- [ ] **Nexacro Grid Test Coverage**
  - [ ] [ ] Simple grid with 10 rows
  - [ ] [ ] Combo inside grid
  - [ ] [ ] Cell editing
  - [ ] [ ] Row context capture

**End of Phase 2**: ✅ React/Vue/Angular + Nexacro support

---

## Phase 3: Edge Cases + Optimization (Weeks 8-9)

### Week 8: Edge Cases

- [ ] **Virtual Lists**
  - [ ] Detect scroll position
  - [ ] Map visible item to DOM element
  - [ ] Record scroll + click combination
  - [ ] **Test**: Scroll 1000-item list, click item

- [ ] **Shadow DOM (Web Components)**
  - [ ] Detect shadow DOM boundary
  - [ ] Traverse into shadow tree
  - [ ] Extract locators for shadow elements
  - [ ] **Test**: Custom web component form

- [ ] **Masked/Formatted Inputs**
  - [ ] Phone, credit card, date masks
  - [ ] Extract actual value (not display)
  - [ ] Record typed value + formatted result
  - [ ] **Test**: Phone mask (555-1234)

- [ ] **Interactive SVG/Canvas**
  - [ ] Detect clickable SVG elements
  - [ ] Map click coordinates to chart area
  - [ ] Record with pixel coordinates (backup)
  - [ ] **Test**: D3 chart click

- [ ] **Nested iFrames**
  - [ ] Detect element in iframe
  - [ ] Generate iframe-aware locator
  - [ ] Record within iframe scope
  - [ ] **Test**: Nested iframe form

### Week 9: Performance + Deployment

- [ ] **Performance Optimization**
  - [ ] Implement caching for detected objects
  - [ ] Batch detection on scroll
  - [ ] Limit DOM traversal depth
  - [ ] **Benchmark**: <100ms per element

- [ ] **Memory Management**
  - [ ] Cache eviction policy
  - [ ] Cleanup on page navigation
  - [ ] Limit recorded actions in memory
  - [ ] **Test**: 10k actions, memory <50MB

- [ ] **Error Handling**
  - [ ] Graceful fallback if detection fails
  - [ ] Invalid locator recovery
  - [ ] Missing Nexacro runtime
  - [ ] **Test**: Recording continues on error

- [ ] **Replay Engine**
  - [ ] Load ActionRecord from file
  - [ ] Locate element using locators
  - [ ] Execute action (click, fill, etc.)
  - [ ] Verify result
  - [ ] **Test**: Replay recorded workflow

- [ ] **VSCode Integration**
  - [ ] Show action list in sidebar
  - [ ] Inline visualization of detected objects
  - [ ] Export/save actions
  - [ ] **Test**: Show 10 recorded actions in sidebar

**End of Phase 3**: ✅ Production-ready recorder

---

## Implementation Priority by Framework

### Tier 1 (Week 2): Standard HTML
```
Impact: 80% of test cases
Effort: 2-3 days
Tests needed: 20+

Components:
- TextBox, TextArea
- Select, Checkbox, RadioButton
- Button
- Table (basic)
- Dialog, Popup
```

### Tier 2 (Week 3-4): React + Vue
```
Impact: 15% of test cases
Effort: 3-4 days
Tests needed: 15+

Components:
- MUI Button, TextField, Select, Table
- Ant Design Form, Table
- Vue 3 form components
```

### Tier 3 (Week 5-7): Nexacro
```
Impact: 5% of test cases (but CRITICAL for Samsung)
Effort: 4-5 days
Tests needed: 20+

Components:
- Nexacro Edit, Combo, CheckBox
- Nexacro Grid (CRITICAL - 50% of Nexacro effort)
- Nexacro Tab, Button
```

---

## Code Structure Template

```typescript
// src/detector/unified-detector.ts
export class UnifiedUIDetector {
  private cache = new UIObjectCache();
  private adapters: Map<string, FrameworkAdapter>;
  
  detect(element: HTMLElement): UIObject | null {
    // 1. Try cache
    // 2. Try Layer 1: DOM
    // 3. Try Layer 2: ARIA
    // 4. Try Layer 3: Relationship
    // 5. Try Layer 4: Framework Adapters
    // 6. Fallback: Visual/OCR
  }
}

// src/adapters/nexacro-adapter.ts
export class NexacroAdapter implements FrameworkAdapter {
  mapComponent(component: NexacroComponent): UIObject {
    // Map Nexacro component type to UIObject
  }
}

// src/recorder/event-recorder.ts
export class EventRecorder {
  private actions: ActionRecord[] = [];
  
  recordEvent(event: Event): void {
    // 1. Detect UI object
    // 2. Determine action type
    // 3. Build ActionRecord
    // 4. Store
  }
  
  export(): ActionRecord[] {
    return this.actions;
  }
}

// src/locators/locator-generator.ts
export class LocatorGenerator {
  generate(element: HTMLElement, uiObject: UIObject): UILocators {
    // Generate CSS, XPath, DOM path, aria-label, etc.
  }
}
```

---

## Testing Checklist

### Unit Tests (>80% coverage)

```typescript
describe('UnifiedUIDetector', () => {
  it('should detect button', () => { });
  it('should detect textbox with label', () => { });
  it('should detect select dropdown', () => { });
  it('should detect table cells', () => { });
  it('should fallback to ARIA role', () => { });
  it('should cache results', () => { });
  it('should detect React components', () => { });
  it('should detect Vue components', () => { });
  it('should detect Nexacro components', () => { });
});

describe('EventRecorder', () => {
  it('should record button click', () => { });
  it('should record textbox fill', () => { });
  it('should record select change', () => { });
  it('should include locators', () => { });
  it('should export JSON', () => { });
});

describe('NexacroAdapter', () => {
  it('should detect Nexacro Edit', () => { });
  it('should detect Nexacro Combo', () => { });
  it('should detect Grid cell', () => { });
  it('should extract row data', () => { });
});
```

### Integration Tests

```typescript
describe('End-to-end workflows', () => {
  it('should record & export login workflow', () => {
    // 1. Record: Fill email
    // 2. Record: Fill password
    // 3. Record: Click submit
    // 4. Verify: 3 actions in JSON
  });
  
  it('should record table row edit', () => {
    // 1. Record: Click table row
    // 2. Record: Click edit button
    // 3. Record: Fill textbox in grid
    // 4. Verify: Grid context included
  });
  
  it('should handle Nexacro form', () => {
    // 1. Setup Nexacro form
    // 2. Record: Fill Edit component
    // 3. Record: Select from Combo
    // 4. Verify: nexacroId locators
  });
});
```

---

## Key APIs to Expose

### For VSCode Agent

```typescript
// window.__BROWSER_AGENT__

interface BrowserAgentAPI {
  // Detection
  detectElement(selector: string): UIObject
  detectAll(selector: string): UIObject[]
  
  // Recording
  startRecording(): void
  stopRecording(): ActionRecord[]
  pauseRecording(): void
  resumeRecording(): void
  
  // Filtering
  setFilter(predicate: (action: ActionRecord) => boolean): void
  
  // Export
  exportJSON(): string
  exportXML(): string
  exportCSV(): string
  
  // Debugging
  highlightElement(selector: string): void
  debugElement(selector: string): DebugInfo
  
  // Configuration
  setConfig(config: RecorderConfig): void
  getConfig(): RecorderConfig
  
  // Replay
  loadActions(json: string): void
  replayAction(action: ActionRecord): Promise<void>
  replayAll(): Promise<void>
}
```

---

## Verification Checklist Before Deployment

### Phase 1 Verification
- [ ] Detect 50+ HTML elements correctly
- [ ] Record click, fill, select actions
- [ ] Generate valid locators
- [ ] Export JSON file
- [ ] No console errors on demo page

### Phase 2 Verification
- [ ] React component detection works
- [ ] Vue component detection works
- [ ] Nexacro runtime detection works
- [ ] Nexacro Grid cell detection works
- [ ] Framework-specific locators generated

### Phase 3 Verification
- [ ] Virtual list scroll handling
- [ ] Web Component shadow DOM traversal
- [ ] Masked input value extraction
- [ ] SVG clickable area detection
- [ ] Performance <100ms per element
- [ ] Memory usage <50MB for 10k actions

---

## Documentation Deliverables

- [x] BROWSER_AGENT_UI_OBJECT_SPEC.md (115 objects, 6-layer detection)
- [x] NEXACRO_ADAPTER_GUIDE.md (Nexacro-specific implementation)
- [x] IMPLEMENTATION_CHECKLIST.md (This file - weekly tasks)
- [ ] API_REFERENCE.md (TypeScript interfaces, method signatures)
- [ ] TESTING_GUIDE.md (Test cases for each component type)
- [ ] DEPLOYMENT_GUIDE.md (Integration into VSCode, browser extension)

---

## Success Criteria

| Criterion | Target | Status |
|-----------|--------|--------|
| Detection accuracy | >95% | TBD |
| Supported object types | 115 | TBD |
| Framework support | React, Vue, Angular, Nexacro | TBD |
| Action locator robustness | >90% replay success | TBD |
| Performance | <100ms per element | TBD |
| Memory usage | <50MB for 10k actions | TBD |
| Test coverage | >85% | TBD |
| Documentation | Complete with examples | TBD |

---

## Risk Mitigation

### Risk: Nexacro Runtime Not Available
- **Mitigation**: Graceful fallback to DOM detection
- **Fallback Code**: 
  ```javascript
  if (!window.nexacro) {
    return standardDOMDetector.detect(element);
  }
  ```

### Risk: Framework Detection Conflicts
- **Mitigation**: Priority order (Nexacro > React > Vue > Standard)
- **Code**: `frameworkPriority` config array

### Risk: Performance Degradation on Large Pages
- **Mitigation**: Caching + batch detection
- **Benchmark**: Test on 500-element page

### Risk: Locators Break After DOM Updates
- **Mitigation**: Multiple fallback locators (ID → CSS → XPath → aria-label)
- **Test**: Re-locate after DOM mutation

---

## Contact & Support

For technical details on specific sections:
- **Nexacro questions**: See NEXACRO_ADAPTER_GUIDE.md
- **Object types**: See BROWSER_AGENT_UI_OBJECT_SPEC.md Part 1
- **Detection strategy**: See BROWSER_AGENT_UI_OBJECT_SPEC.md Part 4

---

**Document Status**: Ready for development  
**Last Updated**: August 26, 2026  
**Next Update**: After Phase 1 completion
