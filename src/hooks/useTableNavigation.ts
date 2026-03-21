import { type RefObject } from 'react';
import type { ThreatModel } from '../types/threatModel';
import { mapAssetsToThreatsColumn, mapThreatsToAssetsColumn, mapThreatsToControlsColumn, mapControlsToThreatsColumn } from '../utils/navigationHelpers';

// Minimal ref interfaces — use string parameters to be contravariant-compatible
// with the concrete table ref types that use narrower string unions.
interface FocusCellByColumn {
  focusCellByColumn: (column: any, rowIndex: number) => void;
}

interface FocusCellByColumnIndex {
  focusCellByColumnIndex: (columnIndex: number, rowIndex: number) => void;
}

interface ArchitectureRef {
  focusCell: (table: any, cellType: string, rowIndex: number) => void;
}

interface Focusable {
  focus: () => void;
}

interface UseTableNavigationOptions {
  titleInputRef: RefObject<HTMLTextAreaElement | null>;
  descriptionInputRef: RefObject<HTMLTextAreaElement | null>;
  participantsInputRef: RefObject<Focusable | null>;
  componentsTableRef: RefObject<FocusCellByColumn | null>;
  assetsTableRef: RefObject<FocusCellByColumn | null>;
  threatsTableRef: RefObject<FocusCellByColumn | null>;
  controlsTableRef: RefObject<FocusCellByColumnIndex | null>;
  architectureSectionRef: RefObject<ArchitectureRef | null>;
  threatModel: ThreatModel | null;
}

export function useTableNavigation({
  titleInputRef,
  descriptionInputRef,
  participantsInputRef,
  componentsTableRef,
  assetsTableRef,
  threatsTableRef,
  controlsTableRef,
  architectureSectionRef,
  threatModel,
}: UseTableNavigationOptions) {
  // Title and Description navigation callbacks
  const handleTitleNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (direction === 'down') {
      descriptionInputRef.current?.focus();
    }
  };

  const handleTitleTabPress = (shiftKey: boolean) => {
    if (!shiftKey) {
      descriptionInputRef.current?.focus();
    }
  };

  const handleDescriptionNavigate = (direction: 'up' | 'down' | 'left' | 'right') => {
    if (direction === 'up') {
      titleInputRef.current?.focus();
    } else if (direction === 'down') {
      participantsInputRef.current?.focus();
    }
  };

  const handleDescriptionTabPress = (shiftKey: boolean) => {
    if (shiftKey) {
      titleInputRef.current?.focus();
    } else {
      participantsInputRef.current?.focus();
    }
  };

  // Participants navigation callbacks
  const handleParticipantsNavigate = (direction: 'up' | 'down') => {
    if (direction === 'up') {
      descriptionInputRef.current?.focus();
    } else if (direction === 'down') {
      componentsTableRef.current?.focusCellByColumn('name', 0);
    }
  };

  const handleParticipantsTabPress = (shiftKey: boolean) => {
    if (shiftKey) {
      descriptionInputRef.current?.focus();
    } else {
      componentsTableRef.current?.focusCellByColumn('name', 0);
    }
  };

  // Components navigation callbacks
  const handleComponentsNavigateToNextTable = (column: 'name' | 'type' | 'description' | 'assets') => {
    const targetColumn = column === 'type' ? 'name' : (column === 'assets' ? 'description' : column);
    assetsTableRef.current?.focusCellByColumn(targetColumn as 'name' | 'description', 0);
  };

  const handleComponentsNavigateToPreviousTable = (_column: 'name' | 'type' | 'description' | 'assets') => {
    // Navigate back to participants field
    participantsInputRef.current?.focus();
  };

  // Assets navigation callbacks
  const handleAssetsNavigateToNextTable = (column: 'name' | 'description') => {
    const targetColumn = mapAssetsToThreatsColumn(column);
    threatsTableRef.current?.focusCellByColumn(targetColumn, 0);
  };

  const handleAssetsNavigateToPreviousTable = (column: 'name' | 'description') => {
    // Navigate back to components table, mapping to the appropriate column
    const components = threatModel?.components || [];
    if (components.length > 0) {
      // Map assets column to components column: name -> name, description -> description
      const targetColumn = column === 'description' ? 'description' : 'name';
      componentsTableRef.current?.focusCellByColumn(targetColumn, components.length - 1);
    } else {
      descriptionInputRef.current?.focus();
    }
  };

  // Threats navigation callbacks
  const handleThreatsNavigateToNextTable = (column: 'name' | 'description' | 'items' | 'status') => {
    const targetColumnIndex = mapThreatsToControlsColumn(column);
    controlsTableRef.current?.focusCellByColumnIndex(targetColumnIndex, 0);
  };

  const handleThreatsNavigateToPreviousTable = (column: 'name' | 'description' | 'items' | 'status') => {
    const targetColumn = mapThreatsToAssetsColumn(column);
    assetsTableRef.current?.focusCellByColumn(targetColumn, (threatModel?.assets?.length || 1) - 1);
  };

  const handleControlsNavigateToPreviousTable = (columnIndex: number) => {
    const targetColumn = mapControlsToThreatsColumn(columnIndex);
    threatsTableRef.current?.focusCellByColumn(targetColumn, (threatModel?.threats?.length || 1) - 1);
  };

  // Architecture navigation callbacks
  const handleArchitectureNavigateToPreviousTable = (table: 'boundary' | 'dataflow', column: string) => {
    // When navigating up from architecture section
    const assets = threatModel?.assets || [];
    const boundaries = threatModel?.boundaries || [];
    
    // Map architecture columns back to assets/threats columns
    // name -> name, description/label -> description
    let targetColumn: 'name' | 'description' = 'name';
    if (column === 'description' || column === 'label') {
      targetColumn = 'description';
    }
    
    if (table === 'boundary') {
      // Navigating from boundary, go to last asset
      if (assets.length > 0) {
        assetsTableRef.current?.focusCellByColumn(targetColumn, assets.length - 1);
      }
    } else if (table === 'dataflow') {
      // Navigating from data flow - check if there are boundaries above
      if (boundaries.length > 0) {
        // Navigate to last boundary
        const cellType = column === 'label' ? 'description' : 'name';
        architectureSectionRef.current?.focusCell('boundary', cellType, boundaries.length - 1);
      } else if (assets.length > 0) {
        // No boundaries, go to assets
        assetsTableRef.current?.focusCellByColumn(targetColumn, assets.length - 1);
      }
    }
  };

  const handleArchitectureNavigateToNextTable = (table: 'boundary' | 'dataflow', column: string) => {
    // When navigating down from architecture section (only from data flows), go to threats
    if (table === 'dataflow') {
      // Map data flow columns to threats columns
      // direction -> name, label -> description
      const targetColumn: 'name' | 'description' | 'items' = column === 'label' ? 'description' : 'name';
      threatsTableRef.current?.focusCellByColumn(targetColumn, 0);
    }
  };

  return {
    handleTitleNavigate,
    handleTitleTabPress,
    handleDescriptionNavigate,
    handleDescriptionTabPress,
    handleParticipantsNavigate,
    handleParticipantsTabPress,
    handleComponentsNavigateToNextTable,
    handleComponentsNavigateToPreviousTable,
    handleAssetsNavigateToNextTable,
    handleAssetsNavigateToPreviousTable,
    handleThreatsNavigateToNextTable,
    handleThreatsNavigateToPreviousTable,
    handleControlsNavigateToPreviousTable,
    handleArchitectureNavigateToPreviousTable,
    handleArchitectureNavigateToNextTable,
  };
}
