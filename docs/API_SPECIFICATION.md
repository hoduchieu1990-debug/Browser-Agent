# Browser Agent API/SDK Specification

## Overview

API cho phép developers nhúng Browser Agent vào applications của họ.

---

## 1. Node.js/JavaScript API

### 1.1 Basic Usage

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');
const fs = require('fs');

// Load workflow
const workflow = JSON.parse(fs.readFileSync('./workflow.json'));

// Create player instance
const player = new WorkflowPlayer();

// Run workflow
async function main() {
  try {
    const result = await player.run(workflow, {
      excelFile: './input.xlsx',
      username: 'john@example.com'
    });
    
    console.log('Success:', result.data);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

main();
```

---

### 1.2 WorkflowPlayer Class

```typescript
class WorkflowPlayer {
  /**
   * Create player instance
   */
  constructor(options?: PlayerOptions);
  
  /**
   * Load workflow from file
   */
  loadFromFile(filePath: string): Workflow;
  
  /**
   * Load workflow from object
   */
  loadFromObject(workflow: Workflow): Workflow;
  
  /**
   * Run workflow with parameters
   */
  async run(
    workflow: Workflow,
    params: Record<string, any>,
    options?: ExecutionOptions
  ): Promise<WorkflowResult>;
  
  /**
   * Validate workflow
   */
  async validate(
    workflow: Workflow,
    options?: ValidationOptions
  ): Promise<ValidationResult>;
  
  /**
   * Close browser and cleanup
   */
  async close(): Promise<void>;
}
```

### 1.3 Interfaces

```typescript
interface PlayerOptions {
  headless?: boolean;
  browser?: 'chromium' | 'firefox' | 'webkit';
  timeout?: number;
  debug?: boolean;
}

interface ExecutionOptions {
  headless?: boolean;
  outputDir?: string;
  screenshot?: boolean;
  verbose?: boolean;
}

interface WorkflowResult {
  success: boolean;
  data: Record<string, any>;
  files: Record<string, string>;
  logs: string[];
  duration: number;
  timestamp: string;
  error?: {
    actionId: string;
    message: string;
  };
}
```

---

## 2. Examples: JavaScript

### Example 1: Simple Upload & Extract

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');

async function processFile(filePath) {
  const player = new WorkflowPlayer({ headless: true });
  
  const workflow = {
    version: '1.0.0',
    name: 'Simple Upload',
    actions: [
      {
        id: 'navigate',
        type: 'navigate',
        url: 'https://example.com/upload'
      },
      {
        id: 'upload',
        type: 'uploadFile',
        selector: 'input#file',
        value: filePath
      },
      {
        id: 'wait',
        type: 'wait',
        duration: 3000
      },
      {
        id: 'extract',
        type: 'extractTable',
        selector: 'table.results',
        output: 'results'
      }
    ]
  };
  
  try {
    const result = await player.run(workflow, {});
    return result.data.results;
  } finally {
    await player.close();
  }
}

// Usage
processFile('./data.xlsx').then(results => {
  console.log(results);
});
```

### Example 2: With Error Handling

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');

async function runWorkflow() {
  const player = new WorkflowPlayer();
  
  try {
    // Validate first
    const validation = await player.validate(workflow);
    if (!validation.valid) {
      console.error('Validation errors:', validation.errors);
      return;
    }
    
    // Run workflow
    const result = await player.run(workflow, params, {
      headless: false,
      screenshot: true,
      verbose: true
    });
    
    if (result.success) {
      console.log('✅ Workflow completed');
      console.log('Data:', result.data);
      console.log('Files:', result.files);
      console.log('Duration:', result.duration, 'ms');
    } else {
      console.error('❌ Workflow failed');
      console.error('Error:', result.error);
    }
    
  } catch (error) {
    console.error('Exception:', error.message);
  } finally {
    await player.close();
  }
}

runWorkflow();
```

### Example 3: Batch Processing

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');
const fs = require('fs');
const path = require('path');

async function processBatch(inputDir, workflow) {
  const files = fs.readdirSync(inputDir)
    .filter(f => f.endsWith('.xlsx'));
  
  const player = new WorkflowPlayer({ headless: true });
  const results = [];
  
  try {
    for (const file of files) {
      const filePath = path.join(inputDir, file);
      console.log(`Processing ${file}...`);
      
      const result = await player.run(workflow, {
        excelFile: filePath
      });
      
      results.push({
        file,
        success: result.success,
        rowCount: result.data.results?.length || 0
      });
    }
  } finally {
    await player.close();
  }
  
  return results;
}

// Usage
processBatch('./input', workflow).then(results => {
  console.log('Summary:', results);
});
```

### Example 4: Express.js Integration

```javascript
const express = require('express');
const { WorkflowPlayer } = require('@browser-agent/player');
const multer = require('multer');

const app = express();
const upload = multer({ dest: 'uploads/' });
const player = new WorkflowPlayer();
const workflow = require('./workflow.json');

app.post('/process', upload.single('file'), async (req, res) => {
  try {
    const result = await player.run(workflow, {
      excelFile: req.file.path
    });
    
    res.json({
      success: result.success,
      data: result.data,
      duration: result.duration
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.listen(3000);
```

---

## 3. Python API

### 3.1 Installation

```bash
pip install browser-agent-player
```

### 3.2 Basic Usage

```python
from browser_agent import WorkflowPlayer
import json

# Load workflow
with open('workflow.json') as f:
    workflow = json.load(f)

# Create player
player = WorkflowPlayer()

# Run workflow
result = player.run(
    workflow,
    excel_file='./input.xlsx',
    username='john@example.com'
)

print(f"Success: {result['success']}")
print(f"Data: {result['data']}")
print(f"Duration: {result['duration']}ms")
```

### 3.3 Examples

**Example 1: Simple Upload**

```python
from browser_agent import WorkflowPlayer

def process_excel(file_path):
    player = WorkflowPlayer(headless=True)
    
    workflow = {
        "version": "1.0.0",
        "name": "Upload Excel",
        "actions": [
            {"id": "nav", "type": "navigate", "url": "https://example.com/upload"},
            {"id": "upload", "type": "uploadFile", "selector": "input#file", "value": file_path},
            {"id": "wait", "type": "wait", "duration": 3000},
            {"id": "extract", "type": "extractTable", "selector": "table.results", "output": "results"}
        ]
    }
    
    result = player.run(workflow)
    player.close()
    
    return result['data']['results']

# Usage
data = process_excel('./data.xlsx')
print(data)
```

**Example 2: Django Integration**

```python
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from browser_agent import WorkflowPlayer
import json

workflow = None

def load_workflow():
    global workflow
    if workflow is None:
        with open('workflows/upload.json') as f:
            workflow = json.load(f)
    return workflow

@require_POST
def process_file(request):
    try:
        file = request.FILES['file']
        
        # Save uploaded file temporarily
        file_path = f'/tmp/{file.name}'
        with open(file_path, 'wb+') as f:
            for chunk in file.chunks():
                f.write(chunk)
        
        # Run workflow
        player = WorkflowPlayer()
        result = player.run(load_workflow(), excel_file=file_path)
        player.close()
        
        return JsonResponse({
            'success': result['success'],
            'data': result['data']
        })
    except Exception as e:
        return JsonResponse({'success': False, 'error': str(e)}, status=500)
```

---

## 4. Advanced Features

### 4.1 Custom Action Handlers

```javascript
const { WorkflowPlayer, registerActionHandler } = require('@browser-agent/player');

// Register custom action type
registerActionHandler('customAction', async (page, action, context) => {
  console.log(`Executing custom action: ${action.id}`);
  // Custom logic here
  return { success: true };
});

// Use in workflow
const workflow = {
  actions: [
    {
      id: 'my-custom',
      type: 'customAction',
      customParam: 'value'
    }
  ]
};
```

### 4.2 Event Listeners

```javascript
const player = new WorkflowPlayer();

// Listen to events
player.on('actionStart', (action) => {
  console.log(`Starting: ${action.id}`);
});

player.on('actionEnd', (action, result) => {
  console.log(`Ended: ${action.id}`, result);
});

player.on('error', (error) => {
  console.error(`Error: ${error.message}`);
});

player.on('complete', (result) => {
  console.log(`Workflow complete: ${result.duration}ms`);
});

// Run with listeners active
await player.run(workflow, params);
```

### 4.3 Progress Tracking

```javascript
const player = new WorkflowPlayer();

player.on('progress', (current, total) => {
  const percentage = Math.round((current / total) * 100);
  console.log(`Progress: ${percentage}% (${current}/${total})`);
  // Update UI progress bar
});

await player.run(workflow, params);
```

### 4.4 Browser Instance Reuse

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');

// Reuse same browser for multiple workflows
const player = new WorkflowPlayer();

try {
  const result1 = await player.run(workflow1, params1);
  const result2 = await player.run(workflow2, params2);
  const result3 = await player.run(workflow3, params3);
} finally {
  await player.close();
}
```

---

## 5. Error Handling

### 5.1 Try-Catch

```javascript
try {
  const result = await player.run(workflow, params);
  console.log(result.data);
} catch (error) {
  console.error(`Action failed: ${error.message}`);
  console.error(`Action ID: ${error.actionId}`);
  console.error(`Step: ${error.step}`);
}
```

### 5.2 Result Status

```javascript
const result = await player.run(workflow, params);

if (!result.success) {
  console.error('Workflow failed');
  console.error('Error:', result.error);
  console.error('Logs:', result.logs);
} else {
  console.log('Success');
  console.log('Data:', result.data);
}
```

---

## 6. Configuration

### 6.1 Player Configuration

```javascript
const player = new WorkflowPlayer({
  headless: true,
  browser: 'chromium',
  timeout: 30000,
  debug: false,
  slowMo: 0,
  args: ['--disable-web-resources']
});
```

### 6.2 Global Defaults

```javascript
const { setGlobalDefaults } = require('@browser-agent/player');

setGlobalDefaults({
  timeout: 15000,
  headless: true,
  browser: 'chromium'
});

// All subsequent players use these defaults
```

---

## 7. Testing

### 7.1 Unit Test

```javascript
const { WorkflowPlayer } = require('@browser-agent/player');
const assert = require('assert');

describe('Workflow Tests', () => {
  let player;
  
  beforeEach(() => {
    player = new WorkflowPlayer({ headless: true });
  });
  
  afterEach(async () => {
    await player.close();
  });
  
  it('should upload and extract', async () => {
    const result = await player.run(workflow, {
      excelFile: './test-data.xlsx'
    });
    
    assert(result.success);
    assert(result.data.results.length > 0);
  });
});
```

---

## 8. Performance Tips

1. **Reuse browser instance**
   ```javascript
   const player = new WorkflowPlayer();
   // Run multiple workflows with same player
   ```

2. **Use headless mode**
   ```javascript
   const player = new WorkflowPlayer({ headless: true });
   ```

3. **Increase timeout for slow operations**
   ```javascript
   const result = await player.run(workflow, params, {
     timeout: 30000
   });
   ```

4. **Parallel execution** (with multiple players)
   ```javascript
   const players = [
     new WorkflowPlayer(),
     new WorkflowPlayer(),
     new WorkflowPlayer()
   ];
   
   const promises = files.map((file, i) => 
     players[i % 3].run(workflow, { excelFile: file })
   );
   
   const results = await Promise.all(promises);
   ```

---

## 9. Logging & Debugging

```javascript
const player = new WorkflowPlayer({ debug: true });

player.on('log', (level, message) => {
  console.log(`[${level}] ${message}`);
});

player.on('actionStart', (action) => {
  console.log(`🚀 ${action.id}: ${action.type}`);
});

player.on('actionEnd', (action, duration) => {
  console.log(`✅ ${action.id} (${duration}ms)`);
});

await player.run(workflow, params);
```

---

## 10. Documentation

- **GitHub**: https://github.com/browser-agent/player
- **NPM**: https://www.npmjs.com/package/@browser-agent/player
- **PyPI**: https://pypi.org/project/browser-agent-player/
- **Docs**: https://docs.browser-agent.dev

---

This API specification allows developers to integrate Browser Agent into their applications seamlessly.
