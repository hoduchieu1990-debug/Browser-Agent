import Ajv from 'ajv';
import schemaJson from './schema.json';
import type { Workflow, ValidationResult, ValidationError, ValidationWarning } from './types';

const ajv = new Ajv({ allErrors: true, strict: false, logger: false });
const validateSchema = ajv.compile(schemaJson);

export function validateWorkflow(workflow: Workflow): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!validateSchema(workflow)) {
    for (const err of validateSchema.errors ?? []) {
      errors.push({
        field: err.instancePath || err.schemaPath,
        message: err.message ?? 'Invalid value',
        severity: 'error',
      });
    }
  }

  const ids = new Set<string>();
  for (const action of workflow.actions ?? []) {
    if (ids.has(action.id)) {
      errors.push({
        field: `actions.${action.id}`,
        message: `Duplicate action id: ${action.id}`,
        severity: 'error',
      });
    }
    ids.add(action.id);
  }

  for (const format of workflow.exportFormats ?? []) {
    const producesOutput = (workflow.actions ?? []).some(
      (a) => 'output' in a && (a as any).output === format.dataKey,
    );
    if (!producesOutput) {
      warnings.push({
        field: `exportFormats.${format.dataKey}`,
        message: `No action outputs "${format.dataKey}"`,
        severity: 'warning',
      });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function resolveParams(value: string, params: Record<string, any>): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key) => {
    if (!(key in params)) {
      throw new Error(`Missing parameter: ${key}`);
    }
    return String(params[key]);
  });
}
