# 🌙 Browser Agent - Clean Dark Theme Design

## Overview

Giao diện **Dark Theme đơn giản, sạch sẽ, tinh tế**:
- Clean navy background
- Minimal accent colors
- Clear typography
- Professional appearance
- No unnecessary effects

---

## 🎨 Color Palette

### Background Colors
```css
--bg-primary: #1a1a2e     /* Main background */
--bg-secondary: #16213e   /* Slightly lighter */
--bg-tertiary: #0f3460    /* Hover/interactive */
```

### Accent Colors
```css
--accent-primary: #3498db    /* Blue - main accent */
--accent-secondary: #2ecc71  /* Green - success/start */
--accent-danger: #e74c3c     /* Red - danger/stop/delete */
```

### Text Colors
```css
--text-primary: #ecf0f1      /* Main text - light gray */
--text-secondary: #bdc3c7    /* Secondary - medium gray */
--text-tertiary: #95a5a6     /* Tertiary - light gray */
```

### Border
```css
--border-color: #2c3e50      /* Subtle border */
```

---

## 📐 Typography

### Font Family
```
'Segoe UI', Tahoma, Geneva, Verdana, sans-serif
(System fonts for best performance)
```

### Font Sizes
```
Header Title:    16px, 600 weight
Section Label:   12px, 600 weight
Body Text:       12px, 400 weight
Small Text:      11px, 400 weight
Meta Text:       10px, 400 weight
Monospace:       11px, 'Courier New' (for code/selectors)
```

---

## 🏗️ Component Design

### Header

```
┌───────────────────────────────────────┐
│ [BA] Browser Agent        [⚙️] [❓]   │
└───────────────────────────────────────┘
```

**Features:**
- Logo badge: 32×32px, blue background
- Title: Bold, light gray text
- Header buttons: 32×32px, hover to blue

**Colors:**
- Background: var(--bg-secondary)
- Logo: var(--accent-primary)
- Text: var(--text-primary)
- Hover: Blue background

**Styling:**
- Padding: 16px
- Border: 1px bottom
- No gradients, no effects

---

### Tab System

```
RECORD | PREVIEW | EXPORT | SETTINGS
   ↑
Active: Blue text + underline
Hover: Light blue background
```

**Tab States:**
- **Inactive**: Gray text, transparent
- **Active**: Blue text, blue underline (3px)
- **Hover**: Light blue background

**Styling:**
- Font: 12px, uppercase, 0.5px letter-spacing
- Padding: 12px
- Border-bottom: 3px (active only)
- Transition: 0.2s

---

### Recording Panel

#### Control Buttons
```
┌──────────────┬──────────────┐
│ ⭕ START     │ ⏹️ STOP      │
└──────────────┴──────────────┘
```

**Start Button:**
- Color: Green (#2ecc71)
- Hover: Slight opacity reduction
- Width: 50% of container

**Stop Button:**
- Color: Red (#e74c3c)
- Disabled by default
- Hover: Slight opacity reduction

#### Recording Status
```
[🔴 pulsing] Ready to record
```

**Style:**
- Background: var(--bg-secondary)
- Border: 1px
- Padding: 12px
- Font: 12px
- Pulsing dot animation

---

### Action Items

```
┌─────────────────────────────────────┐
│ NAVIGATE                         [✕] │
│ https://example.com/upload          │
│ 10:45:23                            │
├─────────────────────────────────────┤
│ CLICK                            [✕] │
│ button#upload-btn                   │
│ 10:45:25                            │
└─────────────────────────────────────┘
```

**Components:**
- **Action Type**: Blue uppercase badge (10px)
- **Selector**: Gray monospace (11px)
- **Value**: Green text (11px)
- **Timestamp**: Light gray (10px)
- **Delete**: Red button, 24px

**Styling:**
- Background: var(--bg-secondary)
- Border: 1px
- Padding: 10px
- Border-radius: 6px
- Hover: Blue border tint

---

### Export Form

```
┌─────────────────────────────────────┐
│ Workflow Name                       │
│ [my-workflow               ]        │
│                                    │
│ Description                         │
│ [Upload Excel...                    │
│                                    │
│ Export Formats                      │
│ ☑ JSON  ☑ YAML                     │
│                                    │
│ [📥 EXPORT]                         │
└─────────────────────────────────────┘
```

**Input Fields:**
- Background: var(--bg-secondary)
- Border: 1px
- Padding: 10px
- Focus: Blue border
- Placeholder: Gray text

**Export Button:**
- Color: Blue (#3498db)
- Hover: Opacity 0.9
- Padding: 12px
- Uppercase text

---

### Settings

```
┌─────────────────────────────────────┐
│ Auto-dismiss Popups        [🟢 ON]  │
├─────────────────────────────────────┤
│ Capture Screenshots        [⚪ OFF] │
├─────────────────────────────────────┤
│ Highlight Elements         [🟢 ON]  │
├─────────────────────────────────────┤
│ Verbose Logging            [⚪ OFF] │
└─────────────────────────────────────┘
```

**Toggle Switch:**
- OFF: Gray background, circle left
- ON: Green background, circle right
- Smooth 0.2s transition
- Size: 44×24px

**Setting Item:**
- Background: var(--bg-secondary)
- Border: 1px
- Padding: 12px
- Hover: Blue border

---

## ✨ Animations

### Pulse (Recording Indicator)
```css
@keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
}
Duration: 1.5s, infinite
```

### Fade In (Tab Content)
```css
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
Duration: 0.3s
```

### Hover Effects
```css
transition: all 0.2s;
```

**Button Hover:**
- Opacity: 0.9

**Card Hover:**
- Border: Blue

**Input Focus:**
- Border: Blue
- Background: Light blue tint

---

## 📏 Spacing

### Grid (8px baseline)
```
4px:  xs spacing
8px:  small spacing
12px: medium spacing
16px: large spacing
```

### Component Sizing
```
Header height:       52px (16px padding × 2 + text height)
Tab height:          44px (12px padding × 2 + text height)
Input height:        38px (10px padding × 2 + text height)
Button height:       40px (12px padding × 2 + text height)
Toggle size:         44×24px
Icon size:           32px, 14px (for emoji)
```

### Gaps
```
Between sections:    16px
Between items:       8-10px
Between elements:    6-8px
```

---

## 🎯 Responsive Behavior

**Fixed Width:** 420px (Chrome extension constraint)

**Scrollbar:**
```css
width: 6px
background: var(--accent-primary)
border-radius: 3px
```

**Overflow:**
- Vertical scroll in content area
- No horizontal scroll

---

## 🎬 User Interactions

### Button States
```
Default:  Normal color
Hover:    0.9 opacity
Active:   0.85 opacity
Disabled: 0.4 opacity
```

### Input States
```
Default:  Gray border
Focus:    Blue border + light blue background
Hover:    No change until focus
```

### Tab States
```
Inactive:  Gray text, transparent
Active:    Blue text, blue underline
Hover:     Light blue background
```

### Toggle States
```
OFF:  Gray background
ON:   Green background
Transition: 0.2s smooth
```

---

## 🌑 Dark Mode Details

This design IS dark mode. For reference only:

**Why Dark:**
- Reduced eye strain
- Better for low-light environments
- Professional appearance
- Better focus on content

**Color Contrast:**
- Text: 4.5:1 (WCAG AA)
- Borders: Subtle but visible
- Accents: Stand out clearly

---

## 🎨 Design Principles

### 1. Simplicity
- Minimal colors
- Clean layout
- No unnecessary effects
- Focus on functionality

### 2. Clarity
- Clear typography hierarchy
- Good contrast
- Easy to scan
- Obvious interactive elements

### 3. Consistency
- Same spacing throughout
- Unified color usage
- Standard component design
- Predictable interactions

### 4. Professionalism
- Enterprise look
- Clean aesthetics
- Refined details
- Polished finish

---

## 📋 Implementation Checklist

- [x] Dark background colors
- [x] Blue primary accent
- [x] Green success state
- [x] Red danger state
- [x] Clear typography
- [x] Consistent spacing
- [x] Smooth transitions
- [x] Responsive scrollbar
- [x] Focus states
- [x] Hover effects
- [x] Toggle switches
- [x] Form inputs
- [x] Button states
- [x] Tab system
- [x] Recording panel
- [x] Action list
- [x] Settings panel
- [x] Export form

---

## 🖼️ Design Assets

### Color Codes
```
Primary:      #3498db
Secondary:    #2ecc71
Danger:       #e74c3c
Bg Primary:   #1a1a2e
Bg Secondary: #16213e
Bg Tertiary:  #0f3460
Text Primary: #ecf0f1
Border:       #2c3e50
```

### Font Sizes
```
16px: Headers
12px: Labels, body
11px: Small text
10px: Meta text
```

### Spacing
```
4px / 8px / 12px / 16px
(8px baseline grid)
```

### Border Radius
```
4px: Small elements
6px: Inputs, items
8px: Cards
12px: Popup (TBD)
```

---

## 🚀 File Structure (React)

```
extension/
├── src/
│   ├── popup/
│   │   ├── App.tsx
│   │   ├── Header.tsx
│   │   ├── TabSystem.tsx
│   │   ├── RecordingPanel.tsx
│   │   ├── PreviewPanel.tsx
│   │   ├── ExportPanel.tsx
│   │   ├── SettingsPanel.tsx
│   │   ├── Footer.tsx
│   │   └── styles/
│   │       ├── variables.css
│   │       ├── popup.css
│   │       └── components.css
│   └── ...
└── ...
```

### CSS Variables File
```css
:root {
  /* Dark Colors */
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --bg-tertiary: #0f3460;
  
  /* Accents */
  --accent-primary: #3498db;
  --accent-secondary: #2ecc71;
  --accent-danger: #e74c3c;
  
  /* Text */
  --text-primary: #ecf0f1;
  --text-secondary: #bdc3c7;
  --text-tertiary: #95a5a6;
  
  /* Borders */
  --border-color: #2c3e50;
  
  /* Spacing (8px grid) */
  --spacing-xs: 4px;
  --spacing-sm: 8px;
  --spacing-md: 12px;
  --spacing-lg: 16px;
  
  /* Transitions */
  --transition-fast: 0.2s;
  --transition-normal: 0.3s;
  --transition-slow: 0.5s;
}
```

---

## ✅ Browser Support

- Chrome 90+
- Edge 90+
- Firefox 88+
- Safari 14+

---

## 📊 Performance

- No gradients (except text)
- Minimal animations (pulse only)
- Smooth CSS transitions
- Optimized for extension environment
- Lightweight CSS

---

## 🎯 Quality Metrics

| Metric | Value |
|--------|-------|
| Color Contrast | 4.5:1+ (WCAG AA) |
| Load Time | < 100ms |
| Animation FPS | 60fps |
| Accessibility | WCAG 2.1 AA |
| Responsiveness | 420px fixed |

---

**Design Version:** 1.0 (Clean Dark)  
**Status:** Production Ready  
**Theme:** Dark with Blue Accents  
**Complexity:** Minimal  
**Philosophy:** Simple, Clean, Professional
