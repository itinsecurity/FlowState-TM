// ============================================================================
// YAML Ref Renaming and Reference Cleanup
// ============================================================================

import {
  escapeRegex,
  parseLine,
} from './yamlHelpers';
import { normalizeYamlWhitespace } from './yamlFormatter';
import { yamlQuote } from './yamlFieldUpdater';

// ============================================================================
// Internal Helpers
// ============================================================================

/**
 * Make a ref unique by appending a number if it already exists.
 * @param yamlContent - Raw YAML string to check against
 * @param desiredRef - The desired ref value
 * @param excludeRef - A ref to exclude from uniqueness check (e.g., the old ref being renamed)
 * @returns A unique ref based on desiredRef
 */
function makeRefUnique(yamlContent: string, desiredRef: string, excludeRef?: string): string {
  const existingRefs = new Set<string>();
  const lines = yamlContent.split('\n');
  
  // Collect all existing refs
  for (const line of lines) {
    const refMatch = line.match(/^(\s*-?\s*)ref:\s*(.+)$/);
    if (refMatch) {
      const refValue = refMatch[2].trim().replace(/^["']|["']$/g, '');
      if (refValue !== excludeRef) {
        existingRefs.add(refValue);
      }
    }
  }
  
  // If desired ref is not in use, return it
  if (!existingRefs.has(desiredRef)) {
    return desiredRef;
  }
  
  // Find a unique variant by appending numbers
  let counter = 1;
  let uniqueRef = `${desiredRef}-${counter}`;
  while (existingRefs.has(uniqueRef)) {
    counter++;
    uniqueRef = `${desiredRef}-${counter}`;
  }
  
  return uniqueRef;
}

// ============================================================================
// Main Ref Renaming Functions
// ============================================================================

/**
 * Generic function to rename a ref and update all references to it throughout the YAML.
 * This ensures the new ref is unique and updates:
 * 1. The ref field of the item itself
 * 2. Any references to it in array fields throughout the document
 * 3. Any references in scalar fields (e.g., source/destination in data-flows)
 * 4. Data-flow refs when source or destination changes (if enabled)
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if needed)
 * @param options - Optional configuration
 * @returns Object containing the modified YAML string and the actual ref used (if made unique)
 * @throws Error if oldRef doesn't exist and requireRefExists is true
 */
export function renameRef(
  yamlContent: string,
  oldRef: string,
  newRef: string,
  options?: {
    /** Array field names that might contain this ref type (e.g., ['affected_data_flows']) */
    arrayFields?: string[];
    /** Scalar field names that might contain this ref (e.g., ['source', 'destination']) */
    scalarFields?: string[];
    /** Whether to regenerate data-flow refs when source/destination changes (default: false) */
    regenerateDataFlowRefs?: boolean;
    /** Whether to ensure uniqueness of the new ref (default: true) */
    ensureUnique?: boolean;
    /** Whether to require that the ref exists as an item (default: true) */
    requireRefExists?: boolean;
  }
): { yamlContent: string; actualRef: string } {
  const ensureUnique = options?.ensureUnique ?? true;
  const arrayFields = options?.arrayFields ?? [];
  const scalarFields = options?.scalarFields ?? [];
  const regenerateDataFlowRefs = options?.regenerateDataFlowRefs ?? false;
  const requireRefExists = options?.requireRefExists ?? true;
  
  if (oldRef === newRef) {
    return { yamlContent, actualRef: newRef };
  }
  
  // Check if oldRef exists
  const oldRefExists = yamlContent.split('\n').some(line => {
    const refMatch = line.match(/^(\s*-?\s*)ref:\s*(.+)$/);
    if (refMatch) {
      const refValue = refMatch[2].trim().replace(/^["']|["']$/g, '');
      return refValue === oldRef;
    }
    return false;
  });
  
  if (!oldRefExists && requireRefExists) {
    throw new Error(`Reference '${oldRef}' not found in document`);
  }
  
  // Make newRef unique if needed
  let actualRef = newRef;
  if (ensureUnique && newRef !== oldRef) {
    actualRef = makeRefUnique(yamlContent, newRef, oldRef);
  }
  
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  
  // Track data-flow items that need ref regeneration (index -> {source, dest, direction, refLineIdx})
  const dataFlowsToRegenerate = new Map<number, {
    source: string;
    destination: string;
    direction: string;
    refLineIdx: number;
  }>();
  
  // First pass: collect data-flow information
  if (regenerateDataFlowRefs) {
    let currentItemStartIdx = -1;
    let currentItemRefIdx = -1;
    let tempSource: string | null = null;
    let tempDestination: string | null = null;
    let tempDirection = 'unidirectional';
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const parsed = parseLine(line);
      
      // Detect start of a new item (starts with "  - ref:")
      if (line.match(/^\s*-\s*ref:\s*.+$/)) {
        // Save previous item if it had source and destination
        if (currentItemStartIdx >= 0 && tempSource && tempDestination) {
          dataFlowsToRegenerate.set(currentItemStartIdx, {
            source: tempSource,
            destination: tempDestination,
            direction: tempDirection,
            refLineIdx: currentItemRefIdx
          });
        }
        
        // Check if this might be a data-flow item
        const isDataFlow = i + 1 < lines.length && 
          (lines[i + 1].match(/^\s+source:/) || lines[i + 1].match(/^\s+destination:/));
        
        if (isDataFlow) {
          currentItemStartIdx = i;
          currentItemRefIdx = i;
          tempSource = null;
          tempDestination = null;
          tempDirection = 'unidirectional';
        } else {
          currentItemStartIdx = -1;
        }
      } else if (currentItemStartIdx >= 0) {
        // We're inside a potential data-flow item
        const sourceMatch = line.match(/^\s+source:\s*(.+)$/);
        if (sourceMatch) {
          tempSource = sourceMatch[1].trim().replace(/^["']|["']$/g, '');
        }
        
        const destMatch = line.match(/^\s+destination:\s*(.+)$/);
        if (destMatch) {
          tempDestination = destMatch[1].trim().replace(/^["']|["']$/g, '');
        }
        
        const dirMatch = line.match(/^\s+direction:\s*(.+)$/);
        if (dirMatch) {
          tempDirection = dirMatch[1].trim().replace(/^["']|["']$/g, '');
        }
        
        // Check if we're starting a new top-level item (end of current data-flow)
        if (parsed.indent <= 2 && line.match(/^\s*-\s+\w+:/)) {
          if (tempSource && tempDestination) {
            dataFlowsToRegenerate.set(currentItemStartIdx, {
              source: tempSource,
              destination: tempDestination,
              direction: tempDirection,
              refLineIdx: currentItemRefIdx
            });
          }
          currentItemStartIdx = -1;
        }
      }
    }
    
    // Handle last item if file ends while tracking
    if (currentItemStartIdx >= 0 && tempSource && tempDestination) {
      dataFlowsToRegenerate.set(currentItemStartIdx, {
        source: tempSource,
        destination: tempDestination,
        direction: tempDirection,
        refLineIdx: currentItemRefIdx
      });
    }
  }
  
  // Second pass: apply all transformations
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const parsed = parseLine(line);
    
    // Match the ref field: "  - ref: old-ref" or "    ref: old-ref"
    const refMatch = line.match(/^(\s*-?\s*)ref:\s*(.+)$/);
    if (refMatch) {
      const refValue = refMatch[2].trim().replace(/^["']|["']$/g, '');
      if (refValue === oldRef) {
        const prefix = refMatch[1];
        const formattedRef = yamlQuote(actualRef);
        line = `${prefix}ref: ${formattedRef}`;
      } else if (regenerateDataFlowRefs && dataFlowsToRegenerate.has(i)) {
        // This is a data-flow ref that needs regeneration
        const dfInfo = dataFlowsToRegenerate.get(i)!;
        // Update with new source/destination that may have been renamed
        let source = dfInfo.source === oldRef ? actualRef : dfInfo.source;
        let dest = dfInfo.destination === oldRef ? actualRef : dfInfo.destination;
        const arrow = dfInfo.direction === 'bidirectional' ? '<->' : '->';
        const newDataFlowRef = `${source}${arrow}${dest}`;
        const prefix = refMatch[1];
        line = `${prefix}ref: ${newDataFlowRef}`;
      }
    }
    
    // Match inline arrays for any specified field names
    for (const fieldName of arrayFields) {
      const inlineArrayRegex = new RegExp(`^(\\s*)${escapeRegex(fieldName)}:\\s*\\[(.+)\\]$`);
      const inlineArrayMatch = line.match(inlineArrayRegex);
      if (inlineArrayMatch) {
        const indent = inlineArrayMatch[1];
        const items = inlineArrayMatch[2].split(',').map(item => item.trim());
        const updatedItems = items.map(item => {
          const cleanItem = item.replace(/^["']|["']$/g, '');
          return cleanItem === oldRef ? actualRef : cleanItem;
        });
        line = `${indent}${fieldName}: [${updatedItems.join(', ')}]`;
        break; // Only match once per line
      }
    }
    
    // Handle scalar field updates (e.g., source, destination in data-flows)
    for (const fieldName of scalarFields) {
      const scalarFieldRegex = new RegExp(`^(\\s*)${escapeRegex(fieldName)}:\\s*(.+)$`);
      const scalarMatch = line.match(scalarFieldRegex);
      if (scalarMatch) {
        const indent = scalarMatch[1];
        const value = scalarMatch[2].trim().replace(/^["']|["']$/g, '');
        if (value === oldRef) {
          line = `${indent}${fieldName}: ${actualRef}`;
        }
        break;
      }
    }
    
    // Multi-line array item: "      - old-ref"
    // Only replace if we're in an array context (not a map item with colon)
    const arrayItemMatch = parsed.trimmed.match(/^-\s*(.+)$/);
    if (arrayItemMatch && !parsed.trimmed.includes(':')) {
      const itemValue = arrayItemMatch[1].trim().replace(/^["']|["']$/g, '');
      if (itemValue === oldRef) {
        const indent = ' '.repeat(parsed.indent);
        line = `${indent}- ${actualRef}`;
      }
    }
    
    result.push(line);
  }
  
  return { yamlContent: normalizeYamlWhitespace(result.join('\n')), actualRef };
}

/**
 * Rename a data flow ref and update all references to it throughout the YAML.
 * This updates:
 * 1. The ref field of the data_flow item itself
 * 2. Any references in affected_data_flows arrays in threats
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value
 * @returns Modified YAML string
 * @deprecated Use renameRef with arrayFields: ['affected_data_flows'] instead
 */
export function renameDataFlowRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): string {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: ['affected_data_flows'],
    ensureUnique: false, // Keep backward compatibility - don't auto-unique
    requireRefExists: false // Keep backward compatibility - allow renaming refs that don't exist as items
  }).yamlContent;
}

/**
 * Rename a component ref and update all references to it throughout the YAML.
 * Components can be referenced in:
 * - boundaries.components
 * - threats.affected_components
 * - controls.implemented_in
 * - data_flows.source and data_flows.destination
 * 
 * When a component is renamed, data-flow refs are automatically regenerated
 * based on the new source/destination values (e.g., api->db becomes api-gateway->db).
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if already exists)
 * @returns Object containing the modified YAML and actual ref used
 */
export function renameComponentRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): { yamlContent: string; actualRef: string } {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: ['components', 'affected_components', 'implemented_in'],
    scalarFields: ['source', 'destination'],
    regenerateDataFlowRefs: true
  });
}

/**
 * Rename an asset ref and update all references to it throughout the YAML.
 * Assets can be referenced in:
 * - components.assets
 * - threats.affected_assets
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if already exists)
 * @returns Object containing the modified YAML and actual ref used
 */
export function renameAssetRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): { yamlContent: string; actualRef: string } {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: ['assets', 'affected_assets']
  });
}

/**
 * Rename a boundary ref and update all references to it throughout the YAML.
 * Note: Boundaries are not currently referenced in arrays elsewhere,
 * but this provides consistency with other rename functions.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if already exists)
 * @returns Object containing the modified YAML and actual ref used
 */
export function renameBoundaryRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): { yamlContent: string; actualRef: string } {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: [] // Boundaries aren't referenced elsewhere
  });
}

/**
 * Rename a threat ref and update all references to it throughout the YAML.
 * Threats can be referenced in:
 * - controls.mitigates
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if already exists)
 * @returns Object containing the modified YAML and actual ref used
 */
export function renameThreatRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): { yamlContent: string; actualRef: string } {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: ['mitigates']
  });
}

/**
 * Rename a control ref and update all references to it throughout the YAML.
 * Note: Controls are not currently referenced in arrays elsewhere,
 * but this provides consistency with other rename functions.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param oldRef - Current reference value
 * @param newRef - New reference value (will be made unique if already exists)
 * @returns Object containing the modified YAML and actual ref used
 */
export function renameControlRef(
  yamlContent: string,
  oldRef: string,
  newRef: string
): { yamlContent: string; actualRef: string } {
  return renameRef(yamlContent, oldRef, newRef, {
    arrayFields: [] // Controls aren't referenced elsewhere
  });
}

/**
 * Remove a ref from all array fields that might contain it.
 *
 * This is used when deleting components or data flows to clean up references.
 * 
 * @param yamlContent - Raw YAML string to modify
 * @param refToRemove - Reference value to remove from arrays
 * @param fieldNames - Array of field names to check (e.g., ['affected_components', 'implemented_in'])
 * @returns Modified YAML string
 */
export function removeRefFromArrayFields(
  yamlContent: string,
  refToRemove: string,
  fieldNames: string[]
): string {
  const lines = yamlContent.split('\n');
  const result: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const parsed = parseLine(line);
    let shouldSkipLine = false;
    
    // Check each field name for inline arrays
    for (const fieldName of fieldNames) {
      const inlineArrayRegex = new RegExp(`^(\\s*)${escapeRegex(fieldName)}:\\s*\\[(.*)\\]$`);
      const inlineArrayMatch = line.match(inlineArrayRegex);
      
      if (inlineArrayMatch) {
        const indent = inlineArrayMatch[1];
        const arrayContent = inlineArrayMatch[2].trim();
        
        if (arrayContent === '') {
          // Empty array, keep as-is
          break;
        }
        
        const items = arrayContent.split(',').map(item => item.trim().replace(/^["']|["']$/g, ''));
        const filteredItems = items.filter(item => item !== refToRemove);
        
        if (filteredItems.length === 0) {
          // Remove the entire field if empty
          shouldSkipLine = true;
        } else if (filteredItems.length !== items.length) {
          // Only update if something was actually removed
          line = `${indent}${fieldName}: [${filteredItems.join(', ')}]`;
        }
        break;
      }
    }
    
    if (shouldSkipLine) {
      continue;
    }
    
    // Handle multi-line array items: "      - ref-to-remove"
    const arrayItemMatch = parsed.trimmed.match(/^-\s*(.+)$/);
    if (arrayItemMatch && !parsed.trimmed.includes(':')) {
      const itemValue = arrayItemMatch[1].trim().replace(/^["']|["']$/g, '');
      if (itemValue === refToRemove) {
        // Skip this item
        continue;
      }
    }
    
    result.push(line);
  }
  
  return normalizeYamlWhitespace(result.join('\n'));
}
