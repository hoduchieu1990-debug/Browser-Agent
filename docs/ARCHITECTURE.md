# Browser Agent - Project Structure & Architecture

## High-Level Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Browser Agent                       │
├─────────────────────────────────────────────────────┤
│                                                       │
│  ┌──────────────────┐      ┌──────────────────┐    │
│  │    Extension     │      │   CLI Tool       │    │
│  │   (Recording)    │      │  (Execution)     │    │
│  │                  │      │                  │    │
│  │ React UI         │      │ Commander.js     │    │
│  │ Content Script   │      │ Chalk            │    │
│  │ File Handling    │      │ Argument parsing │    │
│  └────────┬─────────┘      └────────┬─────────┘    │
│           │                         │               │
│           └────────────┬────────────┘               │
│                        ↓                            │
│           ┌────────────────────────┐               │
│           │   Workflow Player      │               │
│           │   (Core Engine)        │               │
│           │                        │               │
│           │ - Action Executor      │               │
│           │ - Page Context         │               │
│           │ - Error Handler        │               │
│           │ - Export Manager       │               │
│           └────────────┬───────────┘               │
│                        │                           │
│           ┌────────────┴────────────┐              │
│           ↓                         ↓              │
│     ┌──────────────┐        ┌──────────────┐      │
│     │  Playwright  │        │  Libraries   │      │
│     │  (Automation)│        │              │      │
│     │              │        │ - exceljs    │      │
│     │              │        │ - papaparse  │      │
│     │              │        │ - cheerio    │      │
│     └──────────────┘        └──────────────┘      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## Directory Structure

```
browser-agent/
│
├── extension/                          # Chrome Extension
│   ├── public/
│   │   ├── manifest.json              # Manifest V3
│   │   ├── popup.html                 # Popup UI
│   │   └── icons/
│   │       ├── icon-16.png
│   │       ├── icon-48.png
│   │       └── icon-128.png
│   │
│   ├── src/
│   │   ├── content-script.ts          # Content script (DOM access)
│   │   ├── background.ts              # Background service worker
│   │   ├── popup/
│   │   │   ├── App.tsx                # Main popup component
│   │   │   ├── RecordingPanel.tsx     # Recording UI
│   │   │   ├── PreviewPanel.tsx       # Preview recorded actions
│   │   │   ├── ExportDialog.tsx       # Export workflow dialog
│   │   │   └── styles.css
│   │   │
│   │   ├── utils/
│   │   │   ├── action-recorder.ts     # Record user actions
│   │   │   ├── selector-utils.ts      # Generate selectors (XPath, CSS)
│   │   │   ├── workflow-builder.ts    # Build workflow JSON
│   │   │   ├── storage-manager.ts     # IndexedDB handling
│   │   │   └── popup-detector.ts      # Detect popup elements
│   │   │
│   │   └── types.ts                   # TypeScript interfaces
│   │
│   ├── test/
│   │   └── extension.test.ts
│   │
│   ├── dist/                          # Build output (generated)
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── package.json
│   └── README.md
│
├── player/                            # Workflow Player (Core Engine)
│   ├── src/
│   │   ├── index.ts                  # Main exports
│   │   ├── workflow-player.ts        # WorkflowPlayer class
│   │   │
│   │   ├── core/
│   │   │   ├── action-executor.ts    # Execute individual actions
│   │   │   ├── page-context.ts       # Manage browser/page instances
│   │   │   ├── parameter-resolver.ts # Resolve ${param} references
│   │   │   └── error-handler.ts      # Error handling & recovery
│   │   │
│   │   ├── actions/
│   │   │   ├── navigate.ts           # Navigate action
│   │   │   ├── click.ts              # Click action
│   │   │   ├── input.ts              # Input action
│   │   │   ├── select.ts             # Select action
│   │   │   ├── upload-file.ts        # Upload file action
│   │   │   ├── wait.ts               # Wait actions
│   │   │   ├── extract-table.ts      # Extract table action
│   │   │   ├── extract-json.ts       # Extract JSON action
│   │   │   ├── dismiss-popup.ts      # Dismiss popup action
│   │   │   ├── screenshot.ts         # Screenshot action
│   │   │   └── scroll.ts             # Scroll action
│   │   │
│   │   ├── extractors/
│   │   │   ├── table-extractor.ts    # Parse HTML table
│   │   │   ├── json-extractor.ts     # Extract JSON data
│   │   │   └── text-extractor.ts     # Extract text
│   │   │
│   │   ├── exporters/
│   │   │   ├── excel-exporter.ts     # Export to Excel
│   │   │   ├── csv-exporter.ts       # Export to CSV
│   │   │   └── json-exporter.ts      # Export to JSON
│   │   │
│   │   ├── utils/
│   │   │   ├── selector-engine.ts    # Smart selector handling
│   │   │   ├── wait-strategies.ts    # Various wait strategies
│   │   │   ├── retry-logic.ts        # Retry mechanism
│   │   │   ├── validators.ts         # Input validation
│   │   │   └── logger.ts             # Logging utility
│   │   │
│   │   └── types.ts                  # TypeScript interfaces
│   │
│   ├── test/
│   │   ├── unit/
│   │   │   ├── action-executor.test.ts
│   │   │   ├── table-extractor.test.ts
│   │   │   └── ...
│   │   │
│   │   ├── integration/
│   │   │   ├── workflow-player.test.ts
│   │   │   └── end-to-end.test.ts
│   │   │
│   │   └── fixtures/
│   │       ├── workflows/
│   │       ├── test-data/
│   │       └── html-samples/
│   │
│   ├── dist/                         # Build output (generated)
│   ├── tsconfig.json
│   ├── jest.config.js
│   ├── package.json
│   └── README.md
│
├── cli/                               # Command-line Tool
│   ├── src/
│   │   ├── index.ts                  # Entry point
│   │   ├── cli.ts                    # CLI setup (Commander)
│   │   │
│   │   ├── commands/
│   │   │   ├── run.ts                # run command
│   │   │   ├── validate.ts           # validate command
│   │   │   ├── test.ts               # test command
│   │   │   ├── show.ts               # show command
│   │   │   ├── list.ts               # list command
│   │   │   └── create.ts             # create command
│   │   │
│   │   ├── formatters/
│   │   │   ├── console-formatter.ts  # Console output format
│   │   │   ├── json-formatter.ts     # JSON output
│   │   │   ├── html-formatter.ts     # HTML report
│   │   │   └── table-formatter.ts    # Table display
│   │   │
│   │   ├── utils/
│   │   │   ├── config-loader.ts      # Load config files
│   │   │   ├── file-handler.ts       # File operations
│   │   │   ├── validation.ts         # Workflow validation
│   │   │   └── logger.ts             # CLI logging
│   │   │
│   │   └── types.ts
│   │
│   ├── bin/
│   │   └── browser-agent.js          # CLI executable
│   │
│   ├── test/
│   │   └── commands.test.ts
│   │
│   ├── dist/
│   ├── tsconfig.json
│   ├── package.json
│   └── README.md
│
├── shared/                            # Shared Utilities
│   ├── types.ts                      # Shared interfaces
│   ├── schema.json                   # JSON schema
│   ├── constants.ts                  # Constants
│   └── utils.ts                      # Shared utilities
│
├── docs/                              # Documentation
│   ├── WORKFLOW_GUIDE.md             # Workflow creation guide
│   ├── CLI_SPECIFICATION.md          # CLI reference
│   ├── API_SPECIFICATION.md          # API/SDK reference
│   ├── ARCHITECTURE.md               # System architecture
│   ├── CONTRIBUTING.md               # Development guide
│   └── examples/
│       ├── basic-upload.json
│       ├── login-upload.json
│       ├── with-popups.json
│       └── ...
│
├── examples/                          # Example Workflows
│   ├── upload-excel-basic.json
│   ├── login-upload-extract.json
│   ├── upload-with-popups.json
│   ├── batch-processing.json
│   └── ...
│
├── .github/
│   ├── workflows/
│   │   ├── build.yml                 # CI/CD workflow
│   │   ├── test.yml                  # Test workflow
│   │   └── release.yml               # Release workflow
│   │
│   ├── ISSUE_TEMPLATE/
│   │   └── bug_report.md
│   │
│   └── pull_request_template.md
│
├── docker/
│   ├── Dockerfile                   # Production image
│   ├── Dockerfile.dev               # Development image
│   └── docker-compose.yml
│
├── scripts/
│   ├── build.sh                     # Build script
│   ├── test.sh                      # Test script
│   ├── publish.sh                   # Publish to npm
│   └── release.sh                   # Release script
│
├── .env.example                      # Environment variables template
├── .eslintrc.json                   # ESLint config
├── .prettierrc                      # Prettier config
├── tsconfig.json                    # TypeScript base config
├── jest.config.js                   # Jest config
├── package.json                     # Root package.json
├── package-lock.json
├── lerna.json                       # Monorepo config
├── README.md                        # Project README
├── CHANGELOG.md                     # Version history
└── LICENSE                          # MIT License
```

---

## Module Dependencies

```
┌─────────────────────┐
│   CLI Tool          │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│ Player Library      │
└──────────┬──────────┘
           │
        ┌──┴──┐
        ↓     ↓
    Playwright, 
    exceljs, 
    papaparse,
    cheerio
```

---

## Tech Stack by Module

### Extension
- **Frontend**: React, TypeScript
- **Bundler**: Webpack
- **Storage**: IndexedDB
- **Build**: npm scripts

### Player
- **Runtime**: Node.js
- **Browser Automation**: Playwright
- **Excel**: exceljs
- **CSV**: papaparse
- **HTML Parsing**: cheerio
- **Testing**: Jest, Playwright Test

### CLI
- **CLI Framework**: Commander.js
- **Colors**: Chalk
- **Tables**: Table.js
- **Testing**: Jest

### Shared
- **Language**: TypeScript
- **Validation**: Ajv (JSON schema)

---

## Build & Distribution

### NPM Packages

```
@browser-agent/player        # Core player library
@browser-agent/cli           # CLI tool
@browser-agent/types         # TypeScript types
@browser-agent/extension     # Chrome extension
```

### Distribution Channels

- **NPM**: For Node.js packages
- **Chrome Web Store**: For extension
- **GitHub Releases**: For binaries
- **Docker Hub**: For Docker image

---

## Development Workflow

```
1. Clone repository
2. Install dependencies: npm install
3. Build all packages: npm run build
4. Run tests: npm test
5. Run examples: npm run examples
6. Publish: npm run publish
```

---

## File Relationships

```
workflow.json
    ↓
Extension (record)
    ↓ exports
Player (load & execute)
    ├─ CLI (run)
    ├─ API (import)
    └─ Docker (containerize)
```

---

## Key Classes & Interfaces

### WorkflowPlayer (Player)
```
├── load(file): Workflow
├── validate(workflow): ValidationResult
├── run(workflow, params): Promise<WorkflowResult>
└── close(): Promise<void>
```

### ActionExecutor (Player)
```
├── execute(action): Promise<void>
├── handleClick(selector)
├── handleInput(selector, value)
├── handleUpload(selector, filePath)
└── handleExtractTable(selector)
```

### Workflow (Shared)
```
├── version: string
├── name: string
├── params: WorkflowParam[]
├── actions: WorkflowAction[]
└── exportFormats: ExportFormat[]
```

---

## Monorepo Structure

Uses **Lerna** for monorepo management:

```json
{
  "packages": [
    "extension",
    "player",
    "cli",
    "shared"
  ]
}
```

Each package:
- Has own `package.json`
- Maintains own dependencies
- Can be published separately
- Shares types from `shared`

---

## Testing Strategy

```
Extension
├── Unit: Component tests
└── Integration: Recording tests

Player
├── Unit: Action handler tests
├── Integration: Workflow execution
└── E2E: Full workflow tests

CLI
├── Unit: Command tests
└── Integration: CLI execution
```

---

## CI/CD Pipeline

```
GitHub Push
    ↓
Run Tests
    ↓
Build All Packages
    ↓
Run E2E Tests
    ↓
Generate Docs
    ↓
Publish to NPM (if version bumped)
```

---

This structure provides:
- **Separation of concerns**: Each module has clear responsibility
- **Scalability**: Easy to add new actions, exporters, etc.
- **Testability**: Clear module boundaries for testing
- **Reusability**: Shared types and utilities across packages
- **Distribution**: Multiple distribution channels

---

AI Agent có thể dùng structure này làm reference để implement từng module một.
