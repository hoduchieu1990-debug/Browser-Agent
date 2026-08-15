# Browser Agent CLI Specification

## Overview

CLI tool cho phép user chạy workflows từ command line.

```bash
browser-agent [command] [options]
```

---

## 1. Main Commands

### 1.1 Run

Execute a workflow:

```bash
browser-agent run <workflow-file> [options]
```

**Examples:**

```bash
# Basic run
browser-agent run workflow.json --param excelFile=./data.xlsx

# With multiple parameters
browser-agent run workflow.json \
  --param excelFile=./input.xlsx \
  --param username=john \
  --param outputFormat=csv

# With output directory
browser-agent run workflow.json \
  --param excelFile=./data.xlsx \
  --output ./results

# Show browser (non-headless)
browser-agent run workflow.json --headed

# Dry run (validate only, don't execute)
browser-agent run workflow.json --dry-run

# Verbose logging
browser-agent run workflow.json --verbose

# Save logs to file
browser-agent run workflow.json --log-file execution.log
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--param <key=value>` | string | Workflow parameter (can repeat) |
| `-o, --output <dir>` | string | Output directory (default: `./`) |
| `--headless` | boolean | Run in headless mode (default: true) |
| `--headed` | boolean | Show browser UI |
| `--dry-run` | boolean | Validate workflow only |
| `-v, --verbose` | boolean | Verbose output |
| `--log-file <path>` | string | Save logs to file |
| `--timeout <ms>` | number | Global action timeout |
| `--browser <name>` | string | Browser to use (chromium, firefox, webkit) |

---

### 1.2 Validate

Validate a workflow file:

```bash
browser-agent validate <workflow-file> [options]
```

**Examples:**

```bash
# Basic validation
browser-agent validate workflow.json

# Check dependencies
browser-agent validate workflow.json --check-deps

# Check selectors (requires --url)
browser-agent validate workflow.json \
  --check-selectors \
  --url https://example.com

# Strict validation
browser-agent validate workflow.json --strict
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--check-deps` | boolean | Verify dependencies installed |
| `--check-selectors` | boolean | Verify selectors exist (needs --url) |
| `--url <url>` | string | Website URL to check selectors |
| `--strict` | boolean | Strict validation mode |

**Output:**

```
✓ JSON schema valid
✓ All required fields present
✓ Parameter types valid
✓ Actions valid
✓ Selectors valid (5/5 found)

Workflow is valid and ready to run.
```

---

### 1.3 Test

Test a workflow with sample data:

```bash
browser-agent test <workflow-file> [options]
```

**Examples:**

```bash
# Test with sample file
browser-agent test workflow.json --test-file sample.xlsx

# Compare with expected results
browser-agent test workflow.json \
  --test-file sample.xlsx \
  --expected expected-results.xlsx \
  --tolerance 0.95

# Generate test report
browser-agent test workflow.json \
  --test-file sample.xlsx \
  --report test-report.html
```

**Options:**

| Option | Type | Description |
|--------|------|-------------|
| `--test-file <path>` | string | Sample file for testing |
| `--expected <path>` | string | Expected results file |
| `--tolerance <0-1>` | number | Match tolerance (default: 0.9) |
| `--report <path>` | string | Generate HTML report |

---

### 1.4 List

List available workflows:

```bash
browser-agent list [options]
```

**Examples:**

```bash
# List all workflows
browser-agent list

# List with filters
browser-agent list --tag excel
browser-agent list --tag upload

# Show details
browser-agent list --details
```

---

### 1.5 Show

Show workflow details:

```bash
browser-agent show <workflow-file>
```

**Examples:**

```bash
# Show workflow info
browser-agent show workflow.json

# Export to other format
browser-agent show workflow.json --format yaml
```

**Output:**

```
Workflow: Upload Excel & Extract Results
Version: 1.0.0
Created: 2024-01-15T10:00:00Z

Parameters:
  - excelFile (file, required)
  - outputFormat (string, optional)

Actions:
  1. navigate → https://example.com/upload
  2. uploadFile → input#file
  3. wait → 3000ms
  4. extractTable → table.results

Export formats:
  - excel: results.xlsx
  - csv: results.csv
```

---

### 1.6 Create

Create new workflow from template:

```bash
browser-agent create [options]
```

**Examples:**

```bash
# Interactive creation
browser-agent create --interactive

# Create from template
browser-agent create \
  --template upload-excel \
  --name my-workflow.json

# Generate from URL
browser-agent create --url https://example.com --record
```

---

## 2. Global Options

Available for all commands:

```bash
browser-agent [command] [global-options]
```

| Option | Type | Description |
|--------|------|-------------|
| `-h, --help` | boolean | Show help |
| `-v, --version` | boolean | Show version |
| `--config <path>` | string | Config file |
| `--verbose` | boolean | Verbose output |
| `--no-color` | boolean | Disable colored output |

---

## 3. Configuration File

Optional config file for default settings:

`.browser-agent.json`:

```json
{
  "headless": true,
  "timeout": 10000,
  "browser": "chromium",
  "output": "./results",
  "logLevel": "info"
}
```

Load with:

```bash
browser-agent run workflow.json --config ./.browser-agent.json
```

---

## 4. Output Formats

### 4.1 Console Output

```
🤖 Browser Agent

Workflow: Upload Excel & Extract Results
Parameters: {"excelFile":"./data.xlsx"}

🚀 Starting execution...

▶️  Step 1: Navigate to https://example.com/upload
✅ step-1-navigate (1200ms)

▶️  Step 2: Upload file to input#file
✅ step-2-upload (2100ms)

⏳ Step 3: Wait 3000ms
✅ step-3-wait (3000ms)

📊 Step 4: Extract table from table.results
   Found 50 rows, 4 columns
✅ step-4-extract (500ms)

💾 Exporting results...
✓ Exported to results.xlsx
✓ Exported to results.csv

✅ Workflow completed successfully!
Duration: 6.8s
```

### 4.2 JSON Output

With `--output-json`:

```bash
browser-agent run workflow.json --output-json result.json
```

Output file structure:

```json
{
  "success": true,
  "duration": 6800,
  "timestamp": "2024-01-15T10:15:00Z",
  "workflow": "Upload Excel & Extract Results",
  "data": {
    "results": [
      { "ID": "1", "Name": "John", "Email": "john@example.com" }
    ]
  },
  "files": {
    "results": "./results/results.xlsx"
  },
  "logs": [
    "Navigate to https://example.com/upload",
    "Upload file: data.xlsx"
  ]
}
```

### 4.3 CSV Output

Extract table automatically exported as CSV if configured.

### 4.4 HTML Report

With `--report`:

```bash
browser-agent run workflow.json --report results.html
```

Generates HTML report with:
- Workflow info
- Execution timeline
- Screenshots
- Results table
- Logs

---

## 5. Error Handling

### Exit Codes

```
0  - Success
1  - General error
2  - Validation error
3  - Execution error
4  - File not found
5  - Configuration error
```

### Error Messages

```bash
$ browser-agent run missing.json
❌ Error: Workflow file not found: missing.json
Exit code: 4
```

---

## 6. Environment Variables

```bash
# File path
export BROWSER_AGENT_FILE=./data.xlsx
browser-agent run workflow.json --param excelFile=$BROWSER_AGENT_FILE

# Output directory
export BROWSER_AGENT_OUTPUT=./results
browser-agent run workflow.json --output $BROWSER_AGENT_OUTPUT

# Browser
export BROWSER_AGENT_BROWSER=firefox
browser-agent run workflow.json

# Timeout
export BROWSER_AGENT_TIMEOUT=30000
browser-agent run workflow.json
```

---

## 7. Batch Operations

### Run Multiple Workflows

Create a manifest file (`manifest.json`):

```json
{
  "workflows": [
    {
      "file": "workflow1.json",
      "params": { "excelFile": "./data1.xlsx" }
    },
    {
      "file": "workflow2.json",
      "params": { "excelFile": "./data2.xlsx" }
    }
  ]
}
```

Run with:

```bash
browser-agent run-batch manifest.json
```

---

## 8. Scheduling (via CLI)

### Schedule with Cron

```bash
# Run workflow daily at 9 AM
0 9 * * * browser-agent run /path/to/workflow.json --param excelFile=/data/daily.xlsx

# Run every hour
0 * * * * browser-agent run /path/to/workflow.json
```

---

## 9. Docker Usage

### Interactive Run

```bash
docker run -it \
  -v $(pwd):/app \
  -v $(pwd)/results:/output \
  browser-agent:latest \
  browser-agent run /app/workflow.json \
  --param excelFile=/app/data.xlsx \
  --output /output
```

### With Config File

```bash
docker run \
  -v $(pwd):/app \
  browser-agent:latest \
  browser-agent run /app/workflow.json \
  --config /app/.browser-agent.json
```

---

## 10. Examples

### Example 1: Simple Upload

```bash
browser-agent run upload.json \
  --param excelFile=./input.xlsx \
  --output ./results
```

### Example 2: Login & Upload

```bash
browser-agent run login-upload.json \
  --param username=john@example.com \
  --param password=secret123 \
  --param excelFile=./data.xlsx \
  --output ./results \
  --headed
```

### Example 3: Validate Before Run

```bash
# First validate
browser-agent validate workflow.json --check-deps

# Then run
browser-agent run workflow.json --param excelFile=./data.xlsx
```

### Example 4: Test Workflow

```bash
# Test with sample data
browser-agent test workflow.json \
  --test-file test-sample.xlsx \
  --report test-results.html

# If tests pass, run for real
browser-agent run workflow.json --param excelFile=./real-data.xlsx
```

### Example 5: Dry Run

```bash
# Check if workflow would execute without errors
browser-agent run workflow.json --dry-run
```

---

## 11. Help System

```bash
# General help
browser-agent --help

# Command-specific help
browser-agent run --help
browser-agent validate --help

# Search help
browser-agent help [keyword]
```

---

## 12. Installation

### Global Install

```bash
npm install -g @browser-agent/cli
browser-agent --version
```

### Local Install

```bash
npm install @browser-agent/cli
npx browser-agent run workflow.json
```

---

## 13. Uninstall

```bash
npm uninstall -g @browser-agent/cli
```

---

This CLI specification provides a complete interface for users to run, validate, test, and manage workflows from the command line.
