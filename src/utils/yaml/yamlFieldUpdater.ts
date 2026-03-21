// ============================================================================
// YAML Field-Level Update Functions
// ============================================================================

import {
  type ItemPosition,
  type FieldMatch,
  ANY_FIELD_PATTERN,
  escapeRegex,
  parseLine,
  isPipeStyleValue,
  findInsertIndexAfterTopLevelField,
  findSection,
  findItemByRef,
  skipMultilineContent,
} from './yamlHelpers';
import { normalizeYamlWhitespace } from './yamlFormatter';

// ============================================================================
// YAML Formatting Helpers
// ============================================================================

/**
 * Helper to properly quote a YAML string value if needed
 * For multiline strings, uses pipe (|) style
 * @param value - String value to format
 * @param indent - Indentation to use for multiline blocks
 * @returns Formatted YAML value
 */
export function yamlQuote(value: string, indent: string = ''): string {
  // If value contains newlines, use pipe style for better readability
  if (value.includes('\n')) {
    const lines = value.split('\n');
    const blockIndent = indent + '  ';
    return '|\n' + lines.map(line => blockIndent + line).join('\n');
  }
  
  // Check if value needs quoting (contains special chars, starts with special chars, etc.)
  if (
    value.includes(':') ||
    value.includes('#') ||
    value.startsWith(' ') ||
    value.endsWith(' ') ||
    value.startsWith('"') ||
    value.startsWith("'") ||
    /^[{[\]&*!|>'"%@`]/.test(value) ||
    value === '' ||
    value === 'true' ||
    value === 'false' ||
    value === 'null' ||
    value === 'yes' ||
    value === 'no'
  ) {
    // Use double quotes and escape internal quotes
    return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return value;
}

/**
 * Format a field value for YAML output
 * @param value - Value to format (string, number, or array)
 * @param indent - Indentation string for multiline values
 * @returns Formatted value string
 */
export function formatValue(value: string | number | string[], indent: string = ''): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.join(', ')}]`;
  } else if (typeof value === 'number') {
    return Math.round(value).toString();
  } else {
    return yamlQuote(String(value), indent);
  }
}

/**
 * Format a field with its value for YAML output
 * @param fieldName - Name of the field
 * @param value - Field value
 * @param indent - Indentation string
 * @returns Complete field line
 */
export function formatFieldLine(fieldName: string, value: string | number | string[], indent: string): string {
  const formattedValue = formatValue(value, indent);
  return `${indent}${fieldName}: ${formattedValue}`;
}

// ============================================================================
// Field Update Helpers
// ============================================================================

/**
 * Find a field within an item and return match information
 */
function findFieldInItem(
  lines: string[], 
  itemPosition: ItemPosition, 
  fieldName: string
): FieldMatch | null {
  const fieldPattern = new RegExp(`^(\\s*)${escapeRegex(fieldName)}:\\s*(.*)$`);
  
  for (let i = itemPosition.startIndex; i <= itemPosition.endIndex && i < lines.length; i++) {
    const match = lines[i].match(fieldPattern);
    if (match) {
      const indent = match[1].length;
      const existingValue = match[2].trim();
      const isPipeStyle = isPipeStyleValue(existingValue);
      
      return {
        lineIndex: i,
        indent,
        existingValue,
        isPipeStyle
      };
    }
  }
  
  return null;
}

/**
 * Replace a field value in the result array
 */
function replaceFieldValue(
  result: string[],
  lines: string[],
  currentIndex: number,
  fieldMatch: FieldMatch,
  fieldName: string,
  newValue: string | number | string[]
): number {
  const indent = ' '.repeat(fieldMatch.indent);
  
  if (Array.isArray(newValue)) {
    if (newValue.length === 0) {
      // Skip the field entirely for empty arrays
      return skipMultilineContent(lines, currentIndex, fieldMatch.indent, fieldMatch.isPipeStyle);
    }
    // Always use inline format for arrays
    result.push(formatFieldLine(fieldName, newValue, indent));
  } else {
    // Scalar value
    result.push(formatFieldLine(fieldName, newValue, indent));
  }
  
  // Skip any existing multiline content
  return skipMultilineContent(lines, currentIndex, fieldMatch.indent, fieldMatch.isPipeStyle);
}

/**
 * Insert a missing field into an item
 */
function insertMissingField(
  result: string[],
  lastContentLineIndex: number,
  fieldName: string,
  value: string | number | string[],
  fieldIndent: number,
  itemIndent: number
): void {
  const indent = ' '.repeat(fieldIndent || itemIndent + 4);
  const fieldLine = formatFieldLine(fieldName, value, indent);
  
  const insertPos = lastContentLineIndex >= 0 ? lastContentLineIndex + 1 : result.length;
  result.splice(insertPos, 0, fieldLine);
}

// ============================================================================
// Main Field Update Functions
// ============================================================================

/**
 * Find and update a specific field value in YAML content for an item identified by ref.
 * Preserves comments and formatting. If the field doesn't exist, it will be added.
 * If newValue is undefined, the field will be removed.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param section - Section name (e.g., 'components', 'assets', 'threats')
 * @param ref - Reference identifier of the item to update
 * @param field - Field name to update
 * @param newValue - New value (undefined to remove field, empty array to remove field)
 * @returns Modified YAML string
 */
export function updateYamlField(
  yamlContent: string,
  section: string,
  ref: string,
  field: string,
  newValue: string | number | string[] | undefined
): string {
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  
  // Find the section
  const sectionPos = findSection(lines, section);
  if (!sectionPos) {
    // Section not found, return original content
    return yamlContent;
  }
  
  // Find the item within the section
  const itemPos = findItemByRef(lines, sectionPos.startIndex, sectionPos.indent, ref);
  if (!itemPos) {
    // Item not found, return original content
    return yamlContent;
  }
  
  // Track if we found and updated the field
  let fieldFound = false;
  let lastContentLineIndex = -1;
  
  // Process all lines
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // If we're within the target item and looking for the field
    if (i >= itemPos.startIndex && i <= itemPos.endIndex && !fieldFound) {
      const parsed = parseLine(line);
      
      // Update last content line tracking
      if (parsed.trimmed && !parsed.trimmed.startsWith('#')) {
        if (parsed.indent > itemPos.indent || parsed.trimmed.startsWith('-')) {
          lastContentLineIndex = result.length;
        }
      }
      
      // Update field indent detection
      if (itemPos.fieldIndent === 0) {
        const fieldMatch = line.match(ANY_FIELD_PATTERN);
        if (fieldMatch && !parsed.trimmed.startsWith('-')) {
          itemPos.fieldIndent = fieldMatch[1].length;
        }
      }
      
      // Try to find the field
      const fieldMatch = findFieldInItem([line], 
        { ...itemPos, startIndex: 0, endIndex: 0 }, 
        field
      );
      
      if (fieldMatch) {
        fieldFound = true;
        fieldMatch.lineIndex = i; // Update to actual line index
        
        if (newValue === undefined || (Array.isArray(newValue) && newValue.length === 0)) {
          // Remove the field - skip this line and any multiline content
          i = skipMultilineContent(lines, i, fieldMatch.indent, fieldMatch.isPipeStyle);
          continue;
        } else {
          // Replace the field value
          i = replaceFieldValue(result, lines, i, fieldMatch, field, newValue);
          lastContentLineIndex = result.length - 1;
          continue;
        }
      }
    }
    
    // If we just finished processing the target item and field wasn't found, insert it
    if (i === itemPos.endIndex && !fieldFound && newValue !== undefined && (!Array.isArray(newValue) || newValue.length > 0)) {
      result.push(line);
      insertMissingField(result, lastContentLineIndex !== -1 ? lastContentLineIndex : result.length - 1, 
        field, newValue, itemPos.fieldIndent, itemPos.indent);
      continue;
    }
    
    result.push(line);
  }
  
  return normalizeYamlWhitespace(result.join('\n'));
}

/**
 * Update a top-level field in the YAML (like name, description).
 * This modifies fields at the root level of the YAML document.
 * Handles existing multiline/pipe-style values by removing continuation lines.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param field - Field name to update
 * @param newValue - New value for the field
 * @returns Modified YAML string
 */
export function updateYamlTopLevelField(
  yamlContent: string,
  field: string,
  newValue: string
): string {
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  const fieldPattern = new RegExp(`^${escapeRegex(field)}:\\s*(.*)$`);
  let fieldLineIndex = -1;
  let skipContinuation = false;
  let fieldIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(fieldPattern);

    if (match && fieldLineIndex === -1) {
      // Found the field line at the top level (indent 0)
      const parsed = parseLine(line);
      if (parsed.indent !== 0) {
        // Not a top-level field, skip
        result.push(line);
        continue;
      }
      fieldLineIndex = i;
      fieldIndent = parsed.indent;
      const existingValue = match[1].trim();

      // Check if the existing value is pipe-style multiline
      if (isPipeStyleValue(existingValue)) {
        skipContinuation = true;
      }

      // Replace this line with the new value
      const formattedValue = yamlQuote(newValue);
      result.push(`${field}: ${formattedValue}`);
      continue;
    }

    // Skip continuation lines of a pipe-style block
    if (skipContinuation) {
      const parsed = parseLine(line);
      // Continuation lines are blank or indented more than the field
      if (parsed.trimmed === '' || parsed.indent > fieldIndent) {
        continue;
      }
      // We've exited the pipe block
      skipContinuation = false;
    }

    result.push(line);
  }

  return result.join('\n');
}

/**
 * Add, update, or remove an optional top-level field in YAML.
 * If the value is empty/blank, the field is removed.
 * If the field doesn't exist and value is non-empty, it's added after description.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param field - Field name to add/update/remove
 * @param newValue - New value (empty string removes the field)
 * @returns Modified YAML string
 */
export function updateYamlOptionalTopLevelField(
  yamlContent: string,
  field: string,
  newValue: string
): string {
  const trimmedValue = newValue.trim();
  const fieldPattern = new RegExp(`^${escapeRegex(field)}:.*$`, 'm');
  const fieldExists = fieldPattern.test(yamlContent);

  // If value is empty, remove the field if it exists
  if (!trimmedValue) {
    if (fieldExists) {
      // Remove the line (including newline)
      const removePattern = new RegExp(`^${escapeRegex(field)}:.*\n`, 'm');
      return yamlContent.replace(removePattern, '');
    }
    return yamlContent; // Field doesn't exist and value is empty, no change needed
  }

  // If field exists, update it
  if (fieldExists) {
    const pattern = new RegExp(`^(${escapeRegex(field)}:)\\s*(.*)$`, 'm');
    const formattedValue = yamlQuote(trimmedValue);
    return yamlContent.replace(pattern, `$1 ${formattedValue}`);
  }

  // Field doesn't exist, add it after description (or after name if no description)
  const lines = yamlContent.split('\n');
  let insertIndex = -1;

  // Find where to insert (after description or name, accounting for pipe-style multiline)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('description:')) {
      insertIndex = findInsertIndexAfterTopLevelField(lines, i);
      break;
    } else if (line.startsWith('name:') && insertIndex === -1) {
      insertIndex = findInsertIndexAfterTopLevelField(lines, i);
    }
  }

  if (insertIndex === -1) {
    // Fallback: insert after schema_version
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('schema_version:')) {
        insertIndex = i + 1;
        break;
      }
    }
  }

  if (insertIndex !== -1) {
    const formattedValue = yamlQuote(trimmedValue);
    lines.splice(insertIndex, 0, `${field}: ${formattedValue}`);
    return lines.join('\n');
  }

  return yamlContent; // Shouldn't reach here, but return unchanged if we can't find insert point
}

/**
 * Update a top-level string array field in the YAML (like participants).
 * Handles adding, updating, and removing the entire array.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param field - Field name to update (e.g., 'participants')
 * @param values - Array of string values (empty array removes the field)
 * @returns Modified YAML string
 */
export function updateYamlTopLevelStringArray(
  yamlContent: string,
  field: string,
  values: string[]
): string {
  const lines = yamlContent.split('\n');
  const fieldPattern = new RegExp(`^${escapeRegex(field)}:`);

  // Find the existing field and its extent
  let fieldStartIndex = -1;
  let fieldEndIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    if (fieldPattern.test(lines[i])) {
      fieldStartIndex = i;
      // Check if it's an inline empty array like "participants: []"
      if (/:\s*\[\s*\]/.test(lines[i])) {
        fieldEndIndex = i;
        break;
      }
      // Find the end of this array (items are indented lines starting with "- ")
      fieldEndIndex = i;
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        // Empty lines within the array are part of it
        if (line.trim() === '') {
          fieldEndIndex = j;
          continue;
        }
        // Indented lines (array items) are part of the field
        if (/^\s+-\s/.test(line)) {
          fieldEndIndex = j;
        } else {
          // Non-indented, non-empty line means the array has ended
          break;
        }
      }
      break;
    }
  }

  // If values are empty, remove the field entirely
  if (values.length === 0) {
    if (fieldStartIndex !== -1) {
      // Remove trailing empty lines after the field
      while (fieldEndIndex + 1 < lines.length && lines[fieldEndIndex + 1].trim() === '') {
        fieldEndIndex++;
      }
      lines.splice(fieldStartIndex, fieldEndIndex - fieldStartIndex + 1);
      return lines.join('\n');
    }
    return yamlContent; // Nothing to remove
  }

  // Build the new field lines
  const newFieldLines = [`${field}:`];
  for (const val of values) {
    newFieldLines.push(`  - ${yamlQuote(val)}`);
  }

  if (fieldStartIndex !== -1) {
    // Replace existing field
    lines.splice(fieldStartIndex, fieldEndIndex - fieldStartIndex + 1, ...newFieldLines);
  } else {
    // Insert after description (or after name if no description)
    // Account for pipe-style multiline content that extends beyond the header line
    let insertIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('description:')) {
        insertIndex = findInsertIndexAfterTopLevelField(lines, i);
        break;
      } else if (lines[i].startsWith('name:') && insertIndex === -1) {
        insertIndex = findInsertIndexAfterTopLevelField(lines, i);
      }
    }
    if (insertIndex === -1) {
      // Fallback: insert after schema_version
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('schema_version:')) {
          insertIndex = i + 1;
          break;
        }
      }
    }
    if (insertIndex !== -1) {
      lines.splice(insertIndex, 0, ...newFieldLines);
    }
  }

  return lines.join('\n');
}
