// ============================================================================
// YAML Item CRUD and Section Reorder Operations
// ============================================================================

import {
  parseLine,
  extractRefValue,
  isLeavingSection,
  isSectionHeader,
} from './yamlHelpers';
import { normalizeYamlWhitespace } from './yamlFormatter';
import { yamlQuote } from './yamlFieldUpdater';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Format an object as YAML array item lines.
 * Creates properly indented YAML lines for an item with the first field
 * starting with '- ' (array item syntax).
 * 
 * @param item - Object to format as YAML
 * @param baseIndent - Base indentation level for the item
 * @returns Array of formatted YAML lines
 */
function formatYamlItem(item: Record<string, unknown>, baseIndent: number): string[] {
  const indent = ' '.repeat(baseIndent);
  const lines: string[] = [];
  let first = true;
  
  for (const [key, value] of Object.entries(item)) {
    if (value === undefined || value === null) continue;
    
    const prefix = first ? `${indent}- ` : `${indent}  `;
    first = false;
    
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      lines.push(`${prefix}${key}: [${value.join(', ')}]`);
    } else if (typeof value === 'object') {
      // Nested object - simplified handling
      lines.push(`${prefix}${key}: {}`);
    } else if (typeof value === 'number') {
      lines.push(`${prefix}${key}: ${value.toString()}`);
    } else {
      const stringValue = String(value);
      if (stringValue.includes('\n')) {
        // Multiline value - use pipe style
        const blockIndent = indent + '    ';
        lines.push(`${prefix}${key}: |`);
        const multilineValue = stringValue.split('\n')
          .map(line => blockIndent + line)
          .join('\n');
        lines.push(multilineValue);
      } else {
        const formattedValue = yamlQuote(stringValue, indent + '  ');
        lines.push(`${prefix}${key}: ${formattedValue}`);
      }
    }
  }
  
  return lines;
}

// ============================================================================
// Main Item Operations
// ============================================================================

/**
 * Append a new item to a YAML array section (like data_flows, components, etc.).
 * This preserves all existing content and comments. Handles empty sections and
 * empty array notation (section: []).
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param section - Section name to append to (e.g., 'threats', 'assets')
 * @param item - Object representing the item to append
 * @returns Modified YAML string
 */
export function appendYamlItem(
  yamlContent: string,
  section: string,
  item: Record<string, unknown>
): string {
  const lines = yamlContent.split('\n');
  let inSection = false;
  let sectionIndent = 0;
  let itemIndent = 2; // Default item indent (will be detected from existing items)
  let lastItemEndIndex = -1; // Track where the last actual item content ends
  let emptyArrayLineIndex = -1; // Track if there's an empty array on the same line as section header
  
  // First pass: find the section and track where items are
  let inMultilineBlock = false;
  let multilineBlockIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const indent = line.length - trimmed.length;
    
    // Check if we're entering the target section
    // Only match actual section headers, not nested fields with inline values
    // e.g., match 'assets:' or 'assets: []' but not 'assets: [A01]'
    if (isSectionHeader(trimmed, section)) {
      inSection = true;
      sectionIndent = indent;
      
      // Check if this line has an empty array (e.g., "assets: []")
      if (trimmed === `${section}: []`) {
        emptyArrayLineIndex = i;
      }
      continue;
    }
    
    // If we're in the section
    if (inSection) {
      // Check if we're in a multiline block (pipe style |)
      if (inMultilineBlock) {
        // Still in multiline if indented more than the field that started it
        if (trimmed.length === 0 || indent > multilineBlockIndent) {
          lastItemEndIndex = i;
        } else {
          inMultilineBlock = false;
        }
      }
      
      // Check if this line starts a multiline block
      if (trimmed.endsWith('|') || trimmed.endsWith('|-') || trimmed.endsWith('|+')) {
        inMultilineBlock = true;
        multilineBlockIndent = indent;
        lastItemEndIndex = i;
      }
      
      // Detect item indent and track last item position
      // Only count '-' at the item indent level, not within nested content
      if (trimmed.startsWith('-') && !inMultilineBlock && (indent === sectionIndent || indent === sectionIndent + 2)) {
        itemIndent = indent;
        lastItemEndIndex = i;
      } else if (trimmed && !trimmed.startsWith('#') && !inMultilineBlock && indent > sectionIndent && !trimmed.endsWith('|') && !trimmed.endsWith('|-') && !trimmed.endsWith('|+')) {
        // This is a field within an item (not a comment, has content, indented more than section)
        lastItemEndIndex = i;
      }
      
      // Check if we're leaving the section (new top-level key at same or lower indent)
      if (trimmed.length > 0 && !trimmed.startsWith('#') && indent <= sectionIndent && !trimmed.startsWith('-')) {
        inSection = false;
        break;
      }
    }
  }
  
  // If we found an empty array on the section header line, we need to replace it
  if (emptyArrayLineIndex >= 0) {
    const result: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i === emptyArrayLineIndex) {
        // Replace the empty array line with just the section header
        result.push(`${' '.repeat(sectionIndent)}${section}:`);
        const newItemLines = formatYamlItem(item, sectionIndent + 2);
        result.push(...newItemLines);
        // Check if next line exists and isn't blank before adding spacing
        // Only add blank line if next content is a section or section-level comment
        if (i + 1 < lines.length) {
          const nextLine = lines[i + 1];
          const nextParsed = parseLine(nextLine);
          if (nextParsed.trimmed && (nextParsed.indent <= sectionIndent || nextParsed.trimmed.startsWith('#'))) {
            result.push('');
          }
        }
      } else {
        result.push(lines[i]);
      }
    }
    return normalizeYamlWhitespace(result.join('\n'));
  }
  
  // If we found items, insert after the last one
  // If section exists but no items, insert right after section header
  // If section doesn't exist, append at end
  
  let insertAfterIndex: number = lines.length - 1;
  if (lastItemEndIndex >= 0) {
    insertAfterIndex = lastItemEndIndex;
  } else {
    // Find section header line
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseLine(lines[i]);
      if (isSectionHeader(parsed.trimmed, section)) {
        insertAfterIndex = i;
        break;
      }
    }
  }
  
  // Build result
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    result.push(lines[i]);
    
    if (i === insertAfterIndex) {
      // If there's already at least one item in the section, add whitespace before new item
      if (lastItemEndIndex >= 0) {
        result.push('');
      }
      
      const newItemLines = formatYamlItem(item, itemIndent);
      result.push(...newItemLines);
      
      // Add blank line after new item only if next line is a section or section-level comment
      const nextLineIndex = i + 1;
      if (nextLineIndex < lines.length) {
        const nextLine = lines[nextLineIndex];
        const nextParsed = parseLine(nextLine);
        if (nextParsed.trimmed && (nextParsed.indent <= sectionIndent || 
            (nextParsed.trimmed.startsWith('#') && nextParsed.indent <= sectionIndent))) {
          result.push('');
        }
      }
    }
  }
  
  // If section wasn't found at all, append new section at end
  if (lastItemEndIndex === -1 && !lines.some(l => {
    const p = parseLine(l);
    return isSectionHeader(p.trimmed, section);
  })) {
    result.push('');
    result.push(`${section}:`);
    const newItemLines = formatYamlItem(item, 2);
    result.push(...newItemLines);
    result.push(''); // Add blank line after the item when creating new section
  }
  
  return normalizeYamlWhitespace(result.join('\n'));
}

/**
 * Reorder items within a YAML array section by a new ref order.
 * Surgically extracts each item block (preserving its formatting, comments,
 * pipe blocks, etc.) and reassembles them in the specified order.
 *
 * @param yamlContent - Raw YAML string to modify
 * @param section - Section name (e.g., 'assets', 'components', 'threats', 'controls')
 * @param newOrder - Array of ref values in the desired order
 * @returns Modified YAML string with items reordered
 */
export function reorderYamlSection(
  yamlContent: string,
  section: string,
  newOrder: string[]
): string {
  const lines = yamlContent.split('\n');

  // 1. Find where the section starts
  let sectionStart = -1;
  let sectionIndent = 0;
  for (let i = 0; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);
    // Only match actual section headers, not nested fields with inline values
    if (isSectionHeader(parsed.trimmed, section)) {
      sectionStart = i;
      sectionIndent = parsed.indent;
      break;
    }
  }

  if (sectionStart === -1) return yamlContent;

  // 2. Find the end of the section by looking for either:
  //    - A non-blank, non-comment line at sectionIndent or lower (a new section key)
  //    - A top-level comment that precedes a new section (blank line + comment pattern)
  // We include blank lines / comments that are between items, but NOT trailing
  // comments that introduce the next section.
  let sectionEnd = lines.length;
  let lastItemContentEnd = sectionStart; // tracks last line that belongs to an item

  for (let i = sectionStart + 1; i < lines.length; i++) {
    const parsed = parseLine(lines[i]);

    // A non-blank, non-comment, non-item line at section indent = new section key
    if (parsed.trimmed.length > 0 &&
        !parsed.trimmed.startsWith('#') &&
        parsed.indent <= sectionIndent &&
        !parsed.trimmed.startsWith('-')) {
      sectionEnd = i;
      break;
    }

    // A top-level comment at sectionIndent (e.g. "# Components") after a blank line
    // might be introducing the next section — verify by looking ahead for a
    // non-comment line at sectionIndent or lower (i.e. an actual section key)
    if (parsed.trimmed.startsWith('#') && parsed.indent <= sectionIndent) {
      if (i > 0 && lines[i - 1].trim() === '') {
        // Look ahead past any further comments/blanks to find the next real line
        let isNextSection = false;
        for (let j = i + 1; j < lines.length; j++) {
          const ahead = parseLine(lines[j]);
          if (ahead.trimmed.length === 0 || ahead.trimmed.startsWith('#')) continue;
          // Found a non-comment, non-blank line — check its indent
          if (ahead.indent <= sectionIndent && !ahead.trimmed.startsWith('-')) {
            isNextSection = true;
          }
          break;
        }
        if (isNextSection) {
          sectionEnd = i;
          break;
        }
      }
    }

    // Track the last line that looks like item content (non-blank)
    if (parsed.trimmed.length > 0) {
      lastItemContentEnd = i;
    }
  }

  // Trim sectionEnd to exclude trailing blank lines between last item and sectionEnd
  // (they belong to inter-section spacing, not items)
  if (sectionEnd > lastItemContentEnd + 1) {
    sectionEnd = lastItemContentEnd + 1;
  }

  // 3. Extract individual item blocks (lines between one `- ref:` and the next)
  const itemBlocks = new Map<string, string[]>();
  let currentRef: string | null = null;
  let currentBlock: string[] = [];
  let inPipeBlock = false;
  let pipeBlockFieldIndent = 0;

  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    const parsed = parseLine(lines[i]);

    // Detect item start
    if (parsed.trimmed.startsWith('- ref:')) {
      // Save the previous item block
      if (currentRef !== null) {
        // Trim trailing blank lines from the block
        while (currentBlock.length > 0 && currentBlock[currentBlock.length - 1].trim() === '') {
          currentBlock.pop();
        }
        itemBlocks.set(currentRef, currentBlock);
      }
      currentRef = extractRefValue(parsed.trimmed);
      currentBlock = [lines[i]];
      inPipeBlock = false;
      continue;
    }

    if (currentRef !== null) {
      // Track pipe blocks to avoid misinterpreting their content
      if (!inPipeBlock && parsed.trimmed &&
        (parsed.trimmed.endsWith('|') || parsed.trimmed.endsWith('|-') || parsed.trimmed.endsWith('|+'))) {
        inPipeBlock = true;
        pipeBlockFieldIndent = parsed.indent;
        currentBlock.push(lines[i]);
        continue;
      }

      if (inPipeBlock) {
        if (parsed.trimmed === '' || parsed.indent > pipeBlockFieldIndent) {
          currentBlock.push(lines[i]);
          continue;
        } else {
          inPipeBlock = false;
          // Fall through to normal handling
        }
      }

      currentBlock.push(lines[i]);
    }
  }

  // Save the last block
  if (currentRef !== null) {
    while (currentBlock.length > 0 && currentBlock[currentBlock.length - 1].trim() === '') {
      currentBlock.pop();
    }
    itemBlocks.set(currentRef, currentBlock);
  }

  // If no items found, nothing to reorder
  if (itemBlocks.size === 0) return yamlContent;

  // 4. Reassemble: lines before section items + reordered items + lines after section
  const result: string[] = [];

  // Lines up to and including the section header
  for (let i = 0; i <= sectionStart; i++) {
    result.push(lines[i]);
  }

  // Reordered item blocks, separated by blank lines
  let first = true;
  for (const ref of newOrder) {
    const block = itemBlocks.get(ref);
    if (!block) continue;
    if (!first) {
      result.push('');
    }
    result.push(...block);
    first = false;
  }

  // Lines after the section
  for (let i = sectionEnd; i < lines.length; i++) {
    result.push(lines[i]);
  }

  return normalizeYamlWhitespace(result.join('\n'));
}

/**
 * Remove an item from a YAML array section by ref.
 * This removes the entire item including all its fields and preserves
 * the rest of the YAML structure.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param section - Section name containing the item (e.g., 'components', 'threats')
 * @param ref - Reference value of the item to remove
 * @returns Modified YAML string
 */
export function removeYamlItem(
  yamlContent: string,
  section: string,
  ref: string
): string {
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  let inSection = false;
  let inTargetItem = false;
  let sectionIndent = 0;
  let sectionLineIndex = -1;
  let itemIndent = 0;
  let inPipeBlock = false;
  let pipeBlockFieldIndent = 0;
  let itemFound = false;
  let hasOtherItems = false;
  let skipNextBlankLine = false; // Track if we should skip one trailing blank line
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseLine(line);
    
    // Check if we're entering the target section
    // Only match actual section headers, not nested fields with inline values
    if (isSectionHeader(parsed.trimmed, section)) {
      inSection = true;
      sectionIndent = parsed.indent;
      sectionLineIndex = result.length;
      result.push(line);
      continue;
    }
    
    // Check if we're leaving the section
    if (inSection && isLeavingSection(parsed, sectionIndent)) {
      inSection = false;
      inTargetItem = false;
      inPipeBlock = false;
      skipNextBlankLine = false;
    }
    
    // Look for items with matching ref in this section
    if (inSection && parsed.trimmed.startsWith('- ref:')) {
      const refValue = extractRefValue(parsed.trimmed);
      if (refValue === ref) {
        inTargetItem = true;
        itemFound = true;
        itemIndent = parsed.indent;
        inPipeBlock = false;
        skipNextBlankLine = false;
        continue; // Skip this line (start of item to remove)
      } else {
        inTargetItem = false;
        inPipeBlock = false;
        skipNextBlankLine = false;
        hasOtherItems = true; // Found another item in this section
      }
    }
    
    // Skip lines that belong to the target item
    if (inTargetItem) {
      // Check if we're starting a pipe-style block
      if (!inPipeBlock && parsed.trimmed && (parsed.trimmed.endsWith('|') || parsed.trimmed.endsWith('|-') || parsed.trimmed.endsWith('|+'))) {
        inPipeBlock = true;
        pipeBlockFieldIndent = parsed.indent;
        continue;
      }
      
      // Check if we're still in a pipe block
      if (inPipeBlock) {
        // In pipe block, blank lines and indented content are part of the block
        if (parsed.trimmed === '' || parsed.indent > pipeBlockFieldIndent) {
          continue;
        } else {
          // Exited pipe block (content at same or lower indent)
          inPipeBlock = false;
          // Don't continue here - process this line with normal logic below
        }
      }
      
      // Check for new item at same level
      if (parsed.trimmed.startsWith('-') && parsed.indent <= itemIndent) {
        // New item, stop skipping
        inTargetItem = false;
        inPipeBlock = false;
        skipNextBlankLine = false;
        hasOtherItems = true; // Found another item after the removed one
      } else if (parsed.trimmed === '') {
        // Hit a blank line (not in pipe block)
        // Skip only the first blank line after the item (the trailing whitespace)
        if (skipNextBlankLine) {
          skipNextBlankLine = false; // We've consumed the one blank line to skip
          continue; // Skip this blank line
        }
        // For subsequent blank lines, exit the item (they separate sections)
        inTargetItem = false;
        inPipeBlock = false;
        skipNextBlankLine = false;
      } else if (parsed.indent <= itemIndent && parsed.trimmed) {
        // Content at same or lower indent than item (and not blank) - we've left the item
        inTargetItem = false;
        inPipeBlock = false;
        skipNextBlankLine = false;
      } else if (parsed.indent > itemIndent || parsed.trimmed.startsWith('#')) {
        // Still in target item (indented content or inline comments), skip
        // Mark that we should skip the next blank line (trailing whitespace)
        skipNextBlankLine = true;
        continue;
      }
    }
    
    result.push(line);
  }
  
  // If we removed an item and there are no other items left in the section,
  // convert the section to empty array notation
  if (itemFound && !hasOtherItems && sectionLineIndex !== -1) {
    const sectionLine = result[sectionLineIndex];
    const indent = sectionLine.match(/^(\s*)/)?.[1] || '';
    result[sectionLineIndex] = `${indent}${section}: []`;
    
    // Remove lines immediately after the section line that belong to the now-empty section
    // BUT stop at:
    // 1. A blank line (content after blank line belongs to next section)
    // 2. Content at same or lower indent that isn't a comment (new section)
    // 3. Comments at the section indent level (they belong to the next section)
    let i = sectionLineIndex + 1;
    let hasSeenBlankLine = false;
    
    while (i < result.length) {
      const parsed = parseLine(result[i]);
      
      // If we hit a blank line, mark it and continue to see what comes after
      if (!parsed.trimmed) {
        hasSeenBlankLine = true;
        i++;
        continue;
      }
      
      // If we previously saw a blank line, content after it belongs to the next section
      // So stop removing - we're done cleaning up
      if (hasSeenBlankLine) {
        break;
      }
      
      // Keep lines that start a new section (at same or lower indent, not a comment)
      if (parsed.trimmed && !parsed.trimmed.startsWith('#') && parsed.indent <= sectionIndent) {
        break;
      }
      
      // Keep comments at the section indent level - they belong to the next section
      if (parsed.trimmed.startsWith('#') && parsed.indent <= sectionIndent) {
        break;
      }
      
      // Remove indented content or comments that are part of the now-empty section
      // (before any blank line)
      if (parsed.trimmed.startsWith('#') || parsed.indent > sectionIndent) {
        result.splice(i, 1);
        // Don't increment i since we removed an item
      } else {
        break;
      }
    }
  }
  
  // Only normalize if we actually modified the content
  if (itemFound) {
    return normalizeYamlWhitespace(result.join('\n'));
  } else {
    return yamlContent;
  }
}
