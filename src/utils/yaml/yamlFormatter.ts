// ============================================================================
// YAML Whitespace Normalization and Serialization
// ============================================================================

import yaml from 'js-yaml';
import type { ThreatModel } from '../../types/threatModel';
import { parseLine } from './yamlHelpers';
import { normalizeYamlLegacyValues } from './yamlParser';

/**
 * Normalize YAML whitespace according to formatting rules:
 * 1. No whitespace between fields within the same item
 * 2. Exactly one blank line between items within the same section
 * 3. Exactly one blank line between sections (or before comments that start a section)
 * 
 * This handles piped content specially to preserve internal blank lines.
 * 
 * @param yamlContent - Raw YAML string to normalize
 * @returns Normalized YAML string
 */
export function normalizeYamlWhitespace(yamlContent: string): string {
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  let previousLineType: 'empty' | 'section' | 'item' | 'field' | 'comment' | 'pipe-indicator' | 'pipe-content' | 'top-level-field' = 'empty';
  let inPipeBlock = false;
  let pipeBlockIndent = 0;
  let currentItemIndent = -1;
  let pipeBlockLines: string[] = []; // Accumulate pipe block lines to trim trailing whitespace
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parsed = parseLine(line);
    
    // Skip empty lines for now - we'll add them back based on rules
    if (parsed.trimmed === '') {
      // In pipe blocks, accumulate empty lines
      if (inPipeBlock) {
        pipeBlockLines.push(line);
        previousLineType = 'pipe-content';
      } else {
        previousLineType = 'empty';
      }
      continue;
    }
    
    // Check if we're in or entering a pipe block
    if (!inPipeBlock && (parsed.trimmed.endsWith('|') || parsed.trimmed.endsWith('|-') || parsed.trimmed.endsWith('|+'))) {
      inPipeBlock = true;
      pipeBlockIndent = parsed.indent;
      pipeBlockLines = []; // Start accumulating pipe block content
      
      result.push(line);
      previousLineType = 'pipe-indicator';
      continue;
    }
    
    // Check if we're still in a pipe block (indented content or empty lines)
    if (inPipeBlock) {
      if (parsed.indent > pipeBlockIndent || parsed.trimmed === '') {
        // Still in pipe block - accumulate the line
        pipeBlockLines.push(line);
        previousLineType = 'pipe-content';
        continue;
      } else {
        // Exited pipe block - trim trailing blank lines and add to result
        // Remove trailing empty lines from pipe block
        while (pipeBlockLines.length > 0 && pipeBlockLines[pipeBlockLines.length - 1].trim() === '') {
          pipeBlockLines.pop();
        }
        result.push(...pipeBlockLines);
        pipeBlockLines = [];
        inPipeBlock = false;
      }
    }
    
    // Detect line type
    type LineType = 'empty' | 'section' | 'item' | 'field' | 'comment' | 'pipe-indicator' | 'pipe-content' | 'top-level-field';
    let currentLineType: LineType = 'field';
    const previousItemIndent = currentItemIndent; // Save before updating
    
    if (parsed.trimmed.startsWith('#')) {
      currentLineType = 'comment';
      // Section-level comments reset the current section context
      if (parsed.indent === 0) {
        currentItemIndent = -1;
      }
    } else if (parsed.trimmed.match(/^\w+:/) && parsed.indent === 0) {
      // Top-level field or section
      // Check if the value is empty or an array indicator (section)
      if (parsed.trimmed.endsWith(':') || parsed.trimmed.endsWith(': []')) {
        currentLineType = 'section';
        currentItemIndent = -1;
      } else {
        currentLineType = 'top-level-field';
      }
    } else if (parsed.trimmed.startsWith('- ')) {
      // Array item
      currentLineType = 'item';
      currentItemIndent = parsed.indent;
    } else {
      // Regular field
      currentLineType = 'field';
    }
    
    // Determine if we need a blank line before this line
    let needsBlankLine = false;
    
    if (result.length === 0) {
      // First line, no blank line
      needsBlankLine = false;
    } else if (currentLineType === 'section') {
      // Blank line before sections
      // Unless the previous line is already blank OR it was a comment (comments introduce sections)
      // OR it was a top-level field (no blank line between top-level fields and sections)
      const lastResultLine = result[result.length - 1];
      const lastLineIsBlank = lastResultLine === '';
      needsBlankLine = !lastLineIsBlank && previousLineType !== 'comment' && previousLineType !== 'top-level-field';
    } else if (currentLineType === 'comment' && parsed.indent === 0) {
      // Blank line before top-level comments (they often introduce new sections)
      // UNLESS the previous line was already a blank or was a section header, top-level field, or another comment
      const lastResultLine = result[result.length - 1];
      const lastLineIsBlank = lastResultLine === '';
      needsBlankLine = !lastLineIsBlank && previousLineType !== 'section' && previousLineType !== 'top-level-field' && previousLineType !== 'comment';
    } else if (currentLineType === 'item') {
      // Blank line between items in the same section
      // But NOT before the first item in a section
      if ((previousLineType === 'item' || previousLineType === 'field' || previousLineType === 'pipe-content' || previousLineType === 'pipe-indicator' || previousLineType === 'empty') && 
          parsed.indent === previousItemIndent && previousItemIndent !== -1) {
        needsBlankLine = true;
      } else if (previousLineType === 'section' || (previousItemIndent === -1 && previousLineType !== 'empty')) {
        // First item in a section - no blank line
        needsBlankLine = false;
      }
    } else if (currentLineType === 'top-level-field') {
      // No blank line between top-level fields
      needsBlankLine = false;
    }
    
    // Add blank line if needed
    if (needsBlankLine && result.length > 0) {
      result.push('');
    }
    
    result.push(line);
    previousLineType = currentLineType;
  }
  
  // Handle case where file ends while still in a pipe block
  if (inPipeBlock && pipeBlockLines.length > 0) {
    // Trim trailing blank lines from pipe block
    while (pipeBlockLines.length > 0 && pipeBlockLines[pipeBlockLines.length - 1].trim() === '') {
      pipeBlockLines.pop();
    }
    result.push(...pipeBlockLines);
  }
  
  // Normalize legacy values in the final output
  return normalizeYamlLegacyValues(result.join('\n'));
}

/**
 * Simple YAML serialization for when we need to generate YAML from model
 * (e.g., after structural changes like adding/removing components).
 * Rounds all position values to integers for cleaner output.
 * 
 * @param threatModel - Threat model object to serialize
 * @returns YAML string representation
 */
export function modelToYaml(threatModel: ThreatModel): string {
  // Create a deep copy and round all position values to integers
  const cleanedModel = JSON.parse(JSON.stringify(threatModel));
  
  // Round component positions
  if (cleanedModel.components) {
    cleanedModel.components.forEach((component: { x?: number; y?: number }) => {
      if (typeof component.x === 'number') component.x = Math.round(component.x);
      if (typeof component.y === 'number') component.y = Math.round(component.y);
    });
  }
  
  // Round boundary positions and dimensions
  if (cleanedModel.boundaries) {
    cleanedModel.boundaries.forEach((boundary: { x?: number; y?: number; width?: number; height?: number }) => {
      if (typeof boundary.x === 'number') boundary.x = Math.round(boundary.x);
      if (typeof boundary.y === 'number') boundary.y = Math.round(boundary.y);
      if (typeof boundary.width === 'number') boundary.width = Math.round(boundary.width);
      if (typeof boundary.height === 'number') boundary.height = Math.round(boundary.height);
    });
  }
  
  const yamlOutput = yaml.dump(cleanedModel, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
    // Use flow style (inline brackets) for arrays that are short
    flowLevel: 3, // This makes arrays at depth 3+ use flow style
    condenseFlow: true, // Condense flow collections
  });

  // Fix 'y' quoting issue that js-yaml creates
  const fixedOutput = yamlOutput.replace(/'y':/g, 'y:');
  
  // Normalize whitespace according to formatting rules
  return normalizeYamlWhitespace(fixedOutput);
}
