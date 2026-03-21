import { useState, useRef, forwardRef, useImperativeHandle } from 'react';
import EditableCell from './EditableCell';
import EditableTextarea from './EditableTextarea';
import ParticipantsInput from './ParticipantsInput';
import type { ParticipantsInputRef } from './ParticipantsInput';
import ComponentsTable from './ComponentsTable';
import type { ComponentsTableRef } from './ComponentsTable';
import AssetsTable from './AssetsTable';
import type { AssetsTableRef } from './AssetsTable';
import ThreatsTable from './ThreatsTable';
import type { ThreatsTableRef } from './ThreatsTable';
import ControlsTable from './ControlsTable';
import type { ControlsTableRef } from './ControlsTable';
import ArchitectureSection from './ArchitectureSection';
import type { ArchitectureSectionRef } from './ArchitectureSection';
import SummarySection from './SummarySection';
import { useTableNavigation } from '../../hooks/useTableNavigation';
import type { ThreatModel, ComponentType, Direction } from '../../types/threatModel';
import type { GitHubMetadata } from '../../integrations/github/types';

export interface TablesPanelHandle {
  /** Toggle all sections collapsed/expanded (for keyboard shortcut) */
  toggleAllSections: () => void;
  /** Get current collapse states (for keyboard shortcut hook) */
  getSectionCollapseStates: () => SectionCollapseStates;
  /** Set collapse states directly (for keyboard shortcut hook) */
  setSectionCollapseStates: (states: SectionCollapseStates) => void;
}

export interface SectionCollapseStates {
  isWorkingSectionCollapsed: boolean;
  isThreatsSectionCollapsed: boolean;
  isControlsSectionCollapsed: boolean;
  isSummarySectionCollapsed: boolean;
}

export interface TableCallbacks {
  // Header
  onThreatModelNameChange: (name: string) => void;
  onThreatModelDescriptionChange: (description: string) => void;
  onParticipantsChange: (participants: string[]) => void;

  // Components
  onComponentNameChange: (ref: string, name: string) => void;
  onComponentTypeChange: (ref: string, type: ComponentType) => void;
  onComponentDescriptionChange: (ref: string, description: string) => void;
  onComponentAssetsChange: (ref: string, assets: string[]) => void;
  onCreateAsset: (name: string) => string;
  onRemoveComponent: (ref: string) => void;
  onAddComponent: (componentType: ComponentType) => void;
  onReorderComponents: (newOrder: string[]) => void;

  // Assets
  onAssetNameChange: (ref: string, name: string) => void;
  onAssetDescriptionChange: (ref: string, description: string) => void;
  onRemoveAsset: (ref: string) => void;
  onAddAsset: () => void;
  onReorderAssets: (newOrder: string[]) => void;

  // Architecture
  onBoundaryNameChange: (ref: string, name: string) => void;
  onBoundaryDescriptionChange: (ref: string, description: string) => void;
  onDataFlowDirectionChange: (ref: string, direction: Direction) => void;
  onDataFlowLabelChange: (ref: string, label: string) => void;
  onRemoveBoundary: (ref: string) => void;
  onRemoveDataFlow: (ref: string) => void;

  // Threats
  onThreatNameChange: (ref: string, name: string) => void;
  onThreatDescriptionChange: (ref: string, description: string) => void;
  onThreatAffectedComponentsChange: (ref: string, components: string[]) => void;
  onThreatAffectedDataFlowsChange: (ref: string, dataFlows: string[]) => void;
  onThreatAffectedAssetsChange: (ref: string, assets: string[]) => void;
  onThreatStatusChange: (ref: string, status: string | undefined) => void;
  onThreatStatusLinkChange: (ref: string, link: string | undefined) => void;
  onThreatStatusNoteChange: (ref: string, note: string | undefined) => void;
  onControlMitigatesChange: (ref: string, mitigates: string[]) => void;
  onCreateControl: (name: string) => string;
  onRemoveThreat: (ref: string) => void;
  onAddThreat: () => void;
  onReorderThreats: (newOrder: string[]) => void;

  // Controls
  onControlNameChange: (ref: string, name: string) => void;
  onControlDescriptionChange: (ref: string, description: string) => void;
  onControlStatusChange: (ref: string, status: string | undefined) => void;
  onControlStatusLinkChange: (ref: string, link: string | undefined) => void;
  onControlStatusNoteChange: (ref: string, note: string | undefined) => void;
  onControlImplementedInChange: (ref: string, implementedIn: string[]) => void;
  onRemoveControl: (ref: string) => void;
  onAddControl: () => void;
  onReorderControls: (newOrder: string[]) => void;
}

export interface TablesPanelProps {
  threatModel: ThreatModel | null;
  githubMetadata?: GitHubMetadata;
  /** Whether this is the first tables tab (owns refs for keyboard navigation) */
  isFirstTables: boolean;
  callbacks: TableCallbacks;
}

export const TablesPanel = forwardRef<TablesPanelHandle, TablesPanelProps>(function TablesPanel(
  { threatModel, githubMetadata, isFirstTables, callbacks: cb },
  ref,
) {
  // Section collapse state (owned by TablesPanel)
  const [isWorkingSectionCollapsed, setIsWorkingSectionCollapsed] = useState(false);
  const [isThreatsSectionCollapsed, setIsThreatsSectionCollapsed] = useState(false);
  const [isControlsSectionCollapsed, setIsControlsSectionCollapsed] = useState(false);
  const [isSummarySectionCollapsed, setIsSummarySectionCollapsed] = useState(false);

  // Table and header refs
  const titleInputRef = useRef<HTMLTextAreaElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const participantsInputRef = useRef<ParticipantsInputRef>(null);
  const componentsTableRef = useRef<ComponentsTableRef>(null);
  const assetsTableRef = useRef<AssetsTableRef>(null);
  const threatsTableRef = useRef<ThreatsTableRef>(null);
  const controlsTableRef = useRef<ControlsTableRef>(null);
  const architectureSectionRef = useRef<ArchitectureSectionRef>(null);

  // Table navigation callbacks (tab / arrow key between header fields and tables)
  const {
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
  } = useTableNavigation({
    titleInputRef,
    descriptionInputRef,
    participantsInputRef,
    componentsTableRef,
    assetsTableRef,
    threatsTableRef,
    controlsTableRef,
    architectureSectionRef,
    threatModel,
  });

  // Expose imperative methods for parent (keyboard shortcuts, etc.)
  useImperativeHandle(ref, () => ({
    toggleAllSections: () => {
      const allCollapsed =
        isWorkingSectionCollapsed &&
        isThreatsSectionCollapsed &&
        isControlsSectionCollapsed &&
        isSummarySectionCollapsed;
      const allExpanded =
        !isWorkingSectionCollapsed &&
        !isThreatsSectionCollapsed &&
        !isControlsSectionCollapsed &&
        !isSummarySectionCollapsed;
      const shouldExpand = allCollapsed || !allExpanded;
      setIsWorkingSectionCollapsed(!shouldExpand);
      setIsThreatsSectionCollapsed(!shouldExpand);
      setIsControlsSectionCollapsed(!shouldExpand);
      setIsSummarySectionCollapsed(!shouldExpand);
    },
    getSectionCollapseStates: () => ({
      isWorkingSectionCollapsed,
      isThreatsSectionCollapsed,
      isControlsSectionCollapsed,
      isSummarySectionCollapsed,
    }),
    setSectionCollapseStates: (states: SectionCollapseStates) => {
      setIsWorkingSectionCollapsed(states.isWorkingSectionCollapsed);
      setIsThreatsSectionCollapsed(states.isThreatsSectionCollapsed);
      setIsControlsSectionCollapsed(states.isControlsSectionCollapsed);
      setIsSummarySectionCollapsed(states.isSummarySectionCollapsed);
    },
  }), [isWorkingSectionCollapsed, isThreatsSectionCollapsed, isControlsSectionCollapsed, isSummarySectionCollapsed]);

  return (
    <div className="tab-panel-tables">
      <div className="header-section">
        <div className="title-section">
          <div className="threat-model-title">
            <EditableCell
              ref={isFirstTables ? titleInputRef : undefined}
              value={threatModel?.name || ''}
              placeholder={threatModel?.name === 'TM Title' ? 'TM Title' : undefined}
              onSave={cb.onThreatModelNameChange}
              onNavigate={handleTitleNavigate}
              onTabPress={handleTitleTabPress}
              allowEmpty={false}
            />
          </div>
          <div className="threat-model-description">
            <EditableTextarea
              ref={isFirstTables ? descriptionInputRef : undefined}
              value={threatModel?.description || ''}
              placeholder={!threatModel?.description || threatModel?.description === 'Description of scope...' ? 'Description of scope...' : undefined}
              onSave={cb.onThreatModelDescriptionChange}
              onNavigate={handleDescriptionNavigate}
              onTabPress={handleDescriptionTabPress}
            />
          </div>
          <div className="threat-model-participants">
            <ParticipantsInput
              ref={isFirstTables ? participantsInputRef : undefined}
              value={threatModel?.participants || []}
              onSave={cb.onParticipantsChange}
              onNavigate={handleParticipantsNavigate}
              onTabPress={handleParticipantsTabPress}
            />
          </div>
        </div>
      </div>

      <div className='tables-container-content'>
        <h2 className="collapsible-section-header" onClick={() => setIsWorkingSectionCollapsed(!isWorkingSectionCollapsed)}>
          <span>What are we working on?</span>
          <span className="collapse-arrow">{isWorkingSectionCollapsed ? '▶' : '▼'}</span>
        </h2>
        {!isWorkingSectionCollapsed && (
          <>
            <ComponentsTable
              ref={isFirstTables ? componentsTableRef : undefined}
              threatModel={threatModel}
              onComponentNameChange={cb.onComponentNameChange}
              onComponentTypeChange={cb.onComponentTypeChange}
              onComponentDescriptionChange={cb.onComponentDescriptionChange}
              onComponentAssetsChange={cb.onComponentAssetsChange}
              onCreateAsset={cb.onCreateAsset}
              onRemoveComponent={cb.onRemoveComponent}
              onAddComponent={cb.onAddComponent}
              onReorderComponents={cb.onReorderComponents}
              onNavigateToNextTable={handleComponentsNavigateToNextTable}
              onNavigateToPreviousTable={handleComponentsNavigateToPreviousTable}
            />

            <AssetsTable
              ref={isFirstTables ? assetsTableRef : undefined}
              threatModel={threatModel}
              onAssetNameChange={cb.onAssetNameChange}
              onAssetDescriptionChange={cb.onAssetDescriptionChange}
              onRemoveAsset={cb.onRemoveAsset}
              onAddAsset={cb.onAddAsset}
              onReorderAssets={cb.onReorderAssets}
              onNavigateToNextTable={handleAssetsNavigateToNextTable}
              onNavigateToPreviousTable={handleAssetsNavigateToPreviousTable}
            />
            <ArchitectureSection
              ref={isFirstTables ? architectureSectionRef : undefined}
              threatModel={threatModel}
              handleBoundaryNameChange={cb.onBoundaryNameChange}
              handleBoundaryDescriptionChange={cb.onBoundaryDescriptionChange}
              handleDataFlowDirectionChange={cb.onDataFlowDirectionChange}
              handleDataFlowLabelChange={cb.onDataFlowLabelChange}
              handleRemoveBoundary={cb.onRemoveBoundary}
              handleRemoveDataFlow={cb.onRemoveDataFlow}
              onNavigateToPreviousTable={handleArchitectureNavigateToPreviousTable}
              onNavigateToNextTable={handleArchitectureNavigateToNextTable}
            />
          </>
        )}

        <div className="tables-divider"></div>
        <h2 className="collapsible-section-header" onClick={() => setIsThreatsSectionCollapsed(!isThreatsSectionCollapsed)}>
          <span>What can go wrong?</span>
          <span className="collapse-arrow">{isThreatsSectionCollapsed ? '▶' : '▼'}</span>
        </h2>
        {!isThreatsSectionCollapsed && (
          <ThreatsTable
            ref={isFirstTables ? threatsTableRef : undefined}
            threatModel={threatModel}
            githubMetadata={githubMetadata}
            onThreatNameChange={cb.onThreatNameChange}
            onThreatDescriptionChange={cb.onThreatDescriptionChange}
            onThreatAffectedComponentsChange={cb.onThreatAffectedComponentsChange}
            onThreatAffectedDataFlowsChange={cb.onThreatAffectedDataFlowsChange}
            onThreatAffectedAssetsChange={cb.onThreatAffectedAssetsChange}
            onThreatStatusChange={cb.onThreatStatusChange}
            onThreatStatusLinkChange={cb.onThreatStatusLinkChange}
            onThreatStatusNoteChange={cb.onThreatStatusNoteChange}
            onControlMitigatesChange={cb.onControlMitigatesChange}
            onCreateControl={cb.onCreateControl}
            onRemoveThreat={cb.onRemoveThreat}
            onAddThreat={cb.onAddThreat}
            onReorderThreats={cb.onReorderThreats}
            onNavigateToNextTable={handleThreatsNavigateToNextTable}
            onNavigateToPreviousTable={handleThreatsNavigateToPreviousTable}
          />
        )}
        <div className="tables-divider"></div>
        <h2 className="collapsible-section-header" onClick={() => setIsControlsSectionCollapsed(!isControlsSectionCollapsed)}>
          <span>What are we going to do about it?</span>
          <span className="collapse-arrow">{isControlsSectionCollapsed ? '▶' : '▼'}</span>
        </h2>
        {!isControlsSectionCollapsed && (
          <ControlsTable
            ref={isFirstTables ? controlsTableRef : undefined}
            threatModel={threatModel}
            githubMetadata={githubMetadata}
            onControlNameChange={cb.onControlNameChange}
            onControlDescriptionChange={cb.onControlDescriptionChange}
            onControlStatusChange={cb.onControlStatusChange}
            onControlStatusLinkChange={cb.onControlStatusLinkChange}
            onControlStatusNoteChange={cb.onControlStatusNoteChange}
            onControlMitigatesChange={cb.onControlMitigatesChange}
            onControlImplementedInChange={cb.onControlImplementedInChange}
            onRemoveControl={cb.onRemoveControl}
            onAddControl={cb.onAddControl}
            onReorderControls={cb.onReorderControls}
            onNavigateToPreviousTable={handleControlsNavigateToPreviousTable}
          />
        )}
        <div className="tables-divider"></div>
        <h2 className="collapsible-section-header" onClick={() => setIsSummarySectionCollapsed(!isSummarySectionCollapsed)}>
          <span>Did we do a good job?</span>
          <span className="collapse-arrow">{isSummarySectionCollapsed ? '▶' : '▼'}</span>
        </h2>
        {!isSummarySectionCollapsed && (
          <SummarySection 
            threatModel={threatModel} 
            threatsTableRef={threatsTableRef}
            controlsTableRef={controlsTableRef}
            onExpandThreatsSection={() => setIsThreatsSectionCollapsed(false)}
            onExpandControlsSection={() => setIsControlsSectionCollapsed(false)}
          />
        )}
      </div>
    </div>
  );
});
