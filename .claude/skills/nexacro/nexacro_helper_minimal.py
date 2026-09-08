"""
Nexacro Element Recording & Interaction Helper
For use with Playwright's browser automation

Usage:
    from nexacro_helper_minimal import NexacroHelper
    
    helper = NexacroHelper(page)
    helper.click("btnSubmit")
    helper.fill("edtUsername", "admin")
"""

from typing import Dict, Optional, List
from dataclasses import dataclass


@dataclass
class NexacroElement:
    """Information about a located Nexacro component"""
    found: bool
    component_id: str
    component_type: Optional[str] = None
    visible: bool = True
    enabled: bool = True
    value: str = ""


class NexacroHelper:
    """Minimal Nexacro helper for element recording & interaction"""
    
    def __init__(self, page):
        """Initialize with Playwright page object"""
        self.page = page
        self._inject_js_helpers()
    
    def _inject_js_helpers(self):
        """Inject JavaScript helper functions into page"""
        self.page.evaluate("""
            window.getNexacroFrame = function() {
                return window.nexacro?.getActiveFrame?.();
            };
            
            window.getNexacroComponent = function(id) {
                const frm = window.getNexacroFrame();
                return frm?.lookup?.(id);
            };
        """)
    
    # ============ LOCATE ============
    
    def locate(self, component_id: str) -> NexacroElement:
        """Locate Nexacro component by ID"""
        result = self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                if (!comp) {{
                    return {{ found: false, component_id: '{component_id}' }};
                }}
                
                return {{
                    found: true,
                    component_id: '{component_id}',
                    component_type: comp._type || comp.constructor.name,
                    visible: comp.visible,
                    enabled: comp.enabled,
                    value: comp.value || comp.get_value?.() || ''
                }};
            }}
        """)
        
        return NexacroElement(**result)
    
    def inspect(self, component_id: str) -> Dict:
        """Debug: Get detailed component information"""
        return self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                if (!comp) return {{ error: 'Component not found' }};
                
                return {{
                    id: '{component_id}',
                    type: comp._type || comp.constructor.name,
                    value: comp.value,
                    visible: comp.visible,
                    enabled: comp.enabled,
                    readonly: comp.readonly
                }};
            }}
        """)
    
    # ============ ACTIONS ============
    
    def click(self, component_id: str, wait_ms: int = 300):
        """Click Nexacro button"""
        elem = self.locate(component_id)
        if not elem.found:
            raise ValueError(f"Component not found: {component_id}")
        
        self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                comp.click?.();
                comp.onclick?.();
            }}
        """)
        
        if wait_ms > 0:
            self.page.wait_for_timeout(wait_ms)
    
    def fill(self, component_id: str, value: str, wait_ms: int = 300):
        """Fill textbox with value"""
        elem = self.locate(component_id)
        if not elem.found:
            raise ValueError(f"Component not found: {component_id}")
        
        escaped_value = value.replace('"', '\\"')
        
        self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                comp.set_value?.("{escaped_value}");
                comp.setFocus?.();
                comp.onchange?.();
            }}
        """)
        
        if wait_ms > 0:
            self.page.wait_for_timeout(wait_ms)
    
    def select(self, component_id: str, value: str, wait_ms: int = 300):
        """Select option in ComboBox"""
        elem = self.locate(component_id)
        if not elem.found:
            raise ValueError(f"Component not found: {component_id}")
        
        escaped_value = value.replace('"', '\\"')
        
        self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                comp.set_value?.("{escaped_value}");
                comp.onchange?.();
            }}
        """)
        
        if wait_ms > 0:
            self.page.wait_for_timeout(wait_ms)
    
    def check(self, component_id: str, checked: bool = True, wait_ms: int = 300):
        """Check/uncheck checkbox"""
        elem = self.locate(component_id)
        if not elem.found:
            raise ValueError(f"Component not found: {component_id}")
        
        value = "1" if checked else "0"
        
        self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                comp.set_value?.("{value}");
                comp.onchange?.();
            }}
        """)
        
        if wait_ms > 0:
            self.page.wait_for_timeout(wait_ms)
    
    def get_value(self, component_id: str) -> str:
        """Get component value"""
        value = self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                return comp?.value || comp?.get_value?.() || '';
            }}
        """)
        return value
    
    def set_focus(self, component_id: str):
        """Focus component"""
        self.page.evaluate(f"""
            () => {{
                const comp = window.getNexacroComponent('{component_id}');
                comp.setFocus?.();
            }}
        """)
    
    # ============ BATCH ACTIONS ============
    
    def execute_steps(self, steps: List[Dict], verbose: bool = True) -> List[Dict]:
        """Execute batch of Nexacro actions"""
        results = []
        
        for i, step in enumerate(steps):
            action = step.get('action')
            comp_id = step.get('id')
            
            try:
                if action == 'click':
                    self.click(comp_id, wait_ms=step.get('wait_ms', 300))
                    result = {'status': 'success', 'action': action, 'id': comp_id}
                
                elif action == 'fill':
                    value = step.get('value', '')
                    self.fill(comp_id, value, wait_ms=step.get('wait_ms', 300))
                    result = {'status': 'success', 'action': action, 'id': comp_id, 'value': value}
                
                elif action == 'select':
                    value = step.get('value', '')
                    self.select(comp_id, value, wait_ms=step.get('wait_ms', 300))
                    result = {'status': 'success', 'action': action, 'id': comp_id, 'value': value}
                
                elif action == 'check':
                    checked = step.get('checked', True)
                    self.check(comp_id, checked, wait_ms=step.get('wait_ms', 300))
                    result = {'status': 'success', 'action': action, 'id': comp_id, 'checked': checked}
                
                elif action == 'get_value':
                    value = self.get_value(comp_id)
                    result = {'status': 'success', 'action': action, 'id': comp_id, 'value': value}
                
                elif action == 'wait':
                    ms = step.get('ms', 500)
                    self.page.wait_for_timeout(ms)
                    result = {'status': 'success', 'action': action, 'ms': ms}
                
                else:
                    result = {'status': 'error', 'action': action, 'error': 'Unknown action'}
                
                if verbose:
                    print(f"✓ Step {i+1}: {action} - {comp_id}")
            
            except Exception as e:
                result = {'status': 'error', 'action': action, 'id': comp_id, 'error': str(e)}
                if verbose:
                    print(f"✗ Step {i+1}: {action} - {comp_id}: {e}")
            
            result['step'] = i + 1
            results.append(result)
        
        return results
    
    # ============ RECORDING ============
    
    def start_recording(self):
        """Start recording Nexacro events"""
        self.page.evaluate("""
            () => {
                window._nexacroRecordedEvents = [];
                
                if (!window.nexacro) return;
                
                const frm = window.getNexacroFrame();
                if (!frm) return;
                
                for (const compId in frm.components) {
                    const comp = frm.components[compId];
                    
                    const origClick = comp.click;
                    if (origClick) {
                        comp.click = function() {
                            window._nexacroRecordedEvents.push({
                                type: 'click',
                                componentId: compId
                            });
                            return origClick.call(this);
                        };
                    }
                    
                    const origSetValue = comp.set_value;
                    if (origSetValue) {
                        comp.set_value = function(val) {
                            window._nexacroRecordedEvents.push({
                                type: 'set_value',
                                componentId: compId,
                                value: val
                            });
                            return origSetValue.call(this, val);
                        };
                    }
                }
            }
        """)
    
    def get_recorded_events(self) -> List[Dict]:
        """Get all recorded events"""
        return self.page.evaluate("() => window._nexacroRecordedEvents || []")
    
    def export_recording_to_steps(self, events: List[Dict]) -> List[Dict]:
        """Convert recorded events to action steps"""
        steps = []
        
        for event in events:
            if event['type'] == 'click':
                steps.append({'action': 'click', 'id': event['componentId']})
            elif event['type'] == 'set_value':
                steps.append({
                    'action': 'fill',
                    'id': event['componentId'],
                    'value': event.get('value', '')
                })
        
        return steps
    
    # ============ LIST COMPONENTS ============
    
    def list_all_components(self) -> List[Dict]:
        """List all Nexacro components in frame"""
        return self.page.evaluate("""
            () => {
                const frm = window.getNexacroFrame();
                if (!frm) return [];
                
                const components = [];
                for (const id in frm.components) {
                    const comp = frm.components[id];
                    components.push({
                        id: id,
                        type: comp._type || comp.constructor.name,
                        visible: comp.visible,
                        enabled: comp.enabled,
                        value: comp.value
                    });
                }
                
                return components;
            }
        """)
