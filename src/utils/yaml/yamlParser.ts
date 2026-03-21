// ============================================================================
// YAML Parsing, Validation, and Legacy Normalization
// ============================================================================

import yaml from 'js-yaml';
import Ajv from 'ajv';
import type { ThreatModel } from '../../types/threatModel';
import threatModelSchema from '../../../threat_model.schema.json';

// ============================================================================
// Schema Validation Setup
// ============================================================================

// Configure Ajv for JSON schema validation
// Note: Ajv requires runtime code generation which needs 'wasm-unsafe-eval' in CSP
const ajv = new Ajv({ 
  allErrors: true, 
  strict: false
});
const validateThreatModel = ajv.compile(threatModelSchema);

// ============================================================================
// YAML Parsing Configuration
// ============================================================================

/**
 * Custom YAML schema that treats all unquoted scalars as strings.
 * This prevents numeric values like "2024" or "123" from being converted to numbers,
 * which would break schema validation that expects string types.
 * 
 * We use FAILSAFE_SCHEMA as the base because it treats all scalars as strings by default,
 * while still parsing arrays and objects correctly.
 */
const STRING_PRESERVING_SCHEMA = yaml.FAILSAFE_SCHEMA;

/**
 * Safe YAML parsing options to prevent attacks and preserve string types
 */
const SAFE_YAML_OPTIONS = {
  // Prevent YAML bombs and billion laughs attacks
  maxAliasCount: 100,
  // Use FAILSAFE_SCHEMA to prevent numeric string conversion
  schema: STRING_PRESERVING_SCHEMA,
  // Set JSON compatibility mode
  json: true,
};

/**
 * Mapping of legacy YAML field values to their current equivalents.
 * Used for both object-level and string-level normalization.
 */
const LEGACY_VALUE_REPLACEMENTS: Record<string, { field: string; pattern: RegExp; replacement: string }> = {
  external_dependency: {
    field: 'component_type',
    pattern: /^(\s+component_type:\s*)external_dependency(\s*)$/gm,
    replacement: '$1external$2',
  },
};

/**
 * Normalize legacy values in a raw YAML string.
 * Replaces deprecated field values (e.g. component_type: external_dependency → external)
 * so the YAML editor shows the canonical values.
 *
 * @param yamlContent - Raw YAML string
 * @returns YAML string with legacy values replaced
 */
export function normalizeYamlLegacyValues(yamlContent: string): string {
  let result = yamlContent;
  for (const { pattern, replacement } of Object.values(LEGACY_VALUE_REPLACEMENTS)) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Normalize legacy component_type values in a parsed object.
 * This ensures backwards compatibility when loading older threat model files.
 *
 * Legacy mappings:
 * - 'external_dependency' → 'external'
 */
function normalizeLegacyValues(data: any): any {
  if (!data || typeof data !== 'object') return data;

  if (Array.isArray(data)) {
    return data.map(item => normalizeLegacyValues(item));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'component_type' && value === 'external_dependency') {
      result[key] = 'external';
    } else if (value && typeof value === 'object') {
      result[key] = normalizeLegacyValues(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Converts string values to numbers for specific numeric fields in the parsed YAML.
 * FAILSAFE_SCHEMA treats all scalars as strings, but we need actual numbers for
 * coordinate and dimension fields to pass schema validation.
 */
function convertNumericFields(data: any): any {
  if (!data || typeof data !== 'object') return data;

  // List of fields that should be numbers
  const numericFields = ['x', 'y', 'width', 'height'];

  if (Array.isArray(data)) {
    return data.map(item => convertNumericFields(item));
  }

  const result: any = {};
  for (const [key, value] of Object.entries(data)) {
    if (numericFields.includes(key) && typeof value === 'string') {
      // Convert string to number if it's a valid number
      const num = Number(value);
      result[key] = isNaN(num) ? value : num;
    } else if (value && typeof value === 'object') {
      // Recursively process nested objects and arrays
      result[key] = convertNumericFields(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ============================================================================
// Core Parsing Functions
// ============================================================================

/**
 * Fetch raw YAML content from a file
 * @param yamlPath - Path to the YAML file
 * @returns Raw YAML string
 */
export async function fetchYamlContent(yamlPath: string): Promise<string> {
  const response = await fetch(yamlPath);
  if (!response.ok) {
    throw new Error(`Failed to fetch YAML file: ${response.statusText}`);
  }
  return response.text();
}

/**
 * Parse YAML string into ThreatModel with validation
 * @param yamlContent - Raw YAML string
 * @returns Parsed and validated threat model data
 * @throws Error if YAML is invalid or doesn't conform to schema
 */
export function parseYaml(yamlContent: string): ThreatModel {
  try {
    // Parse YAML with safety limits (all scalars will be strings with FAILSAFE_SCHEMA)
    const parsed = yaml.load(yamlContent, SAFE_YAML_OPTIONS);
    
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Invalid YAML: Expected an object');
    }
    
    // Convert numeric fields (x, y, width, height) from strings to numbers
    const converted = convertNumericFields(parsed);
    
    // Normalize legacy values (e.g. external_dependency → external)
    const normalized = normalizeLegacyValues(converted);
    
    // Validate against JSON schema
    const isValid = validateThreatModel(normalized);
    
    if (!isValid) {
      const errors = validateThreatModel.errors || [];
      const errorMessages = errors.map(err => {
        const path = err.instancePath || 'root';
        return `${path}: ${err.message}`;
      }).join('; ');
      
      throw new Error(`Schema validation failed: ${errorMessages}`);
    }
    
    return normalized as unknown as ThreatModel;
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      throw new Error(`YAML parsing error: ${error.message}`);
    }
    throw error;
  }
}
