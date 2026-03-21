// ============================================================================
// Shared YAML Helper Types, Constants, and Internal Utility Functions
// ============================================================================

/**
 * Represents a parsed YAML line with its indentation and content
 */
export interface YamlLine {
  raw: string;
  trimmed: string;
  indent: number;
}

/**
 * Position and metadata for a YAML section
 */
export interface SectionPosition {
  startIndex: number;
  indent: number;
  inSection: boolean;
}

/**
 * Position and metadata for a YAML item within a section
 */
export interface ItemPosition {
  startIndex: number;
  endIndex: number;
  indent: number;
  fieldIndent: number;
}

/**
 * Result of a field match operation
 */
export interface FieldMatch {
  lineIndex: number;
  indent: number;
  existingValue: string;
  isPipeStyle: boolean;
}

// ============================================================================
// Constants and Regex Patterns
// ============================================================================

/** Regex pattern for matching item ref lines */
export const REF_PATTERN = /^-?\s*ref:\s*(.+)$/;

/** Regex pattern for matching any field in a YAML item */
export const ANY_FIELD_PATTERN = /^(\s+)(\w+):/;

/** Regex pattern for pipe-style multiline indicators */
export const PIPE_STYLE_PATTERN = /\|[-+]?$/;

// ============================================================================
// Core Utility Functions
// ============================================================================

/**
 * Helper to escape special regex characters in a string
 */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse a raw YAML line into structured format
 */
export function parseLine(line: string): YamlLine {
  const trimmed = line.trimStart();
  const indent = line.length - trimmed.length;
  return { raw: line, trimmed, indent };
}

/**
 * Check if a value indicates a pipe-style multiline block
 */
export function isPipeStyleValue(value: string): boolean {
  return PIPE_STYLE_PATTERN.test(value);
}

/**
 * Find the insert index after a top-level field, accounting for pipe-style
 * multiline content that extends beyond the field's header line.
 * 
 * For `description: |` followed by indented continuation lines, this returns
 * the index AFTER all continuation lines rather than right after the header.
 * 
 * @param lines - Array of YAML lines
 * @param fieldLineIndex - Index of the field's header line
 * @returns Index where new content can safely be inserted
 */
export function findInsertIndexAfterTopLevelField(lines: string[], fieldLineIndex: number): number {
  const fieldLine = lines[fieldLineIndex];
  const fieldMatch = fieldLine.match(/^\w+:\s*(.*)$/);
  if (!fieldMatch) return fieldLineIndex + 1;
  
  const fieldValue = fieldMatch[1].trim();
  
  // If not pipe-style, insert right after this line
  if (!isPipeStyleValue(fieldValue)) {
    return fieldLineIndex + 1;
  }
  
  // For pipe-style, skip continuation lines (blank or indented more than the field)
  const fieldIndent = parseLine(fieldLine).indent;
  let i = fieldLineIndex + 1;
  while (i < lines.length) {
    const p = parseLine(lines[i]);
    if (p.trimmed === '' || p.indent > fieldIndent) {
      i++;
    } else {
      break;
    }
  }
  return i;
}

/**
 * Extract ref value from a ref line, removing quotes
 */
export function extractRefValue(line: string): string | null {
  const match = line.match(REF_PATTERN);
  if (!match) return null;
  return match[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Check if we're leaving a section based on indentation
 */
export function isLeavingSection(line: YamlLine, sectionIndent: number): boolean {
  return line.trimmed.length > 0 && 
         !line.trimmed.startsWith('#') && 
         line.indent <= sectionIndent && 
         !line.trimmed.startsWith('-');
}

/**
 * Check if a line is a section header for a given section name.
 * A section header is 'sectionName:' (followed by items on next lines),
 * 'sectionName: []' (empty section), or 'sectionName: # comment'.
 * This excludes inline array values like 'assets: [A01]' which are field values.
 */
export function isSectionHeader(trimmedLine: string, sectionName: string): boolean {
  if (trimmedLine === `${sectionName}:`) return true;
  if (!trimmedLine.startsWith(`${sectionName}: `)) return false;
  const valueAfter = trimmedLine.slice(sectionName.length + 2).trim();
  return valueAfter === '[]' || valueAfter.startsWith('#');
}

/**
 * Find a section in YAML lines and return its position
 * @param lines - Array of YAML lines
 * @param sectionName - Name of the section to find (e.g., 'components', 'threats')
 * @returns Section position information or null if not found
 */
export function findSection(lines: string[], sectionName: string): SectionPosition | null {
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    // Only match actual section headers, not nested fields with inline values
    // e.g., match 'assets:' or 'assets: []' but not 'assets: [A01]'
    if (isSectionHeader(parsed.trimmed, sectionName)) {
      return {
        startIndex: i,
        indent: parsed.indent,
        inSection: true
      };
    }
  }
  return null;
}

/**
 * Find an item by ref within a section
 * @param lines - Array of YAML lines
 * @param sectionStart - Starting index of the section
 * @param sectionIndent - Indentation level of the section
 * @param targetRef - Ref value to search for
 * @returns Item position information or null if not found
 */
export function findItemByRef(
  lines: string[], 
  sectionStart: number, 
  sectionIndent: number, 
  targetRef: string
): ItemPosition | null {
  let itemStartIndex = -1;
  let itemIndent = 0;
  let fieldIndent = 0;
  
  for (let i = sectionStart + 1; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    
    // Check if we've left the section
    if (isLeavingSection(parsed, sectionIndent)) {
      // If we're tracking an item, end it here
      if (itemStartIndex !== -1) {
        return {
          startIndex: itemStartIndex,
          endIndex: i - 1,
          indent: itemIndent,
          fieldIndent
        };
      }
      break;
    }
    
    // Check for item start with ref
    if (parsed.trimmed.startsWith('- ref:')) {
      const refValue = extractRefValue(parsed.trimmed);
      if (refValue === targetRef) {
        itemStartIndex = i;
        itemIndent = parsed.indent;
        fieldIndent = 0; // Will be detected from fields
        continue;
      } else if (itemStartIndex !== -1) {
        // Found next item, return previous item's position
        return {
          startIndex: itemStartIndex,
          endIndex: i - 1,
          indent: itemIndent,
          fieldIndent
        };
      }
    }
    
    // Detect field indent from any field in target item
    if (itemStartIndex !== -1 && fieldIndent === 0) {
      const fieldMatch = parsed.raw.match(ANY_FIELD_PATTERN);
      if (fieldMatch && !parsed.trimmed.startsWith('-')) {
        fieldIndent = fieldMatch[1].length;
      }
    }
  }
  
  // If we found the item but reached end of file or section, 
  // find the actual last line of content for this item
  if (itemStartIndex !== -1) {
    let lastContentLine = itemStartIndex;
    
    // Scan forward from item start to find last line that belongs to this item
    for (let i = itemStartIndex + 1; i < lines.length; i++) {
      const parsed = parseLine(lines[i]);
      
      // Skip empty lines and comments when determining boundaries
      if (!parsed.trimmed || parsed.trimmed.startsWith('#')) {
        continue;
      }
      
      // Check if we've left the section
      if (isLeavingSection(parsed, sectionIndent)) {
        break;
      }
      
      // If this line is indented at or less than the item indent and is not part of the item
      // (e.g., it's a new section or item at the same level), stop here
      if (parsed.indent <= itemIndent && !parsed.trimmed.startsWith('-')) {
        break;
      }
      
      // This line belongs to the item
      lastContentLine = i;
    }
    
    return {
      startIndex: itemStartIndex,
      endIndex: lastContentLine,
      indent: itemIndent,
      fieldIndent
    };
  }
  
  return null;
}

/**
 * Skip multiline content following a field
 * @param lines - Array of YAML lines
 * @param startIndex - Starting index (field line)
 * @param fieldIndent - Indentation of the field
 * @param isPipeStyle - Whether this is a pipe-style block
 * @returns Index of the last line to skip
 */
export function skipMultilineContent(
  lines: string[], 
  startIndex: number, 
  fieldIndent: number, 
  isPipeStyle: boolean
): number {
  let currentIndex = startIndex;
  
  while (currentIndex + 1 < lines.length) {
    const parsed = parseLine(lines[currentIndex + 1]);
    
    // For pipe-style blocks, blank lines are part of the content
    // For regular fields, blank lines mark the end of the field
    if (parsed.raw === '' && !isPipeStyle) {
      break;
    }
    
    // Content belonging to this field is indented more than the field
    if (parsed.raw === '' || (parsed.indent > fieldIndent && (parsed.trimmed.startsWith('-') || isPipeStyle || parsed.trimmed !== ''))) {
      // Stop if we hit another field at the same level (not for pipe style)
      if (!isPipeStyle && parsed.trimmed && !parsed.trimmed.startsWith('-') && parsed.indent === fieldIndent) {
        break;
      }
      // For pipe blocks, continue until we hit content at same or lower indent (excluding blank lines)
      if (isPipeStyle && parsed.trimmed && parsed.indent <= fieldIndent) {
        break;
      }
      currentIndex++;
    } else {
      break;
    }
  }
  
  return currentIndex;
}
