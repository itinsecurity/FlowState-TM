import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { Shapes } from 'lucide-react';

import '@xyflow/react/dist/style.css';
import '../App.css';
import { TablesPanel } from './tables/TablesPanel';
import type { TablesPanelHandle, TableCallbacks } from './tables/TablesPanel';
import type { YamlEditorRef } from './YamlEditor';
import { ModalLayer } from './modals/ModalLayer';
import type { ModalLayerHandle } from './modals/ModalLayer';
import { ResizeDivider } from './layout/ResizeDivider';
import { TabPanelHeader, TabPanelHeaderContent } from './layout/TabPanelHeader';
import TutorialPanel from './tutorials/TutorialPanel';
import './layout/TabPanel.css';
import { useTabLayout } from '../hooks/useTabLayout';
import { DndContext, DragOverlay, closestCenter } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import {
  getOrCreateSessionDraftKey,
  isFileSystemAccessSupported,
} from '../utils/browserStorage';
import type { SerializedSaveSource } from '../utils/browserStorage';
import { useGitHubIntegration, SyncResult } from '../integrations/github/hooks/useGitHubIntegration';
import type { GitHubMetadata } from '../integrations/github/types';

import { useToast } from '../contexts/ToastContext';
import { useSaveState } from '../contexts/SaveStateContext';
// Lazy load YamlEditor and its heavy dependencies (syntax-highlighter)
const YamlEditor = lazy(() => import('./YamlEditor'));
import { CanvasPanel } from './canvas/CanvasPanel';
import type { CanvasPanelHandle } from './canvas/CanvasPanel';
import { Navbar } from './navbar/Navbar';
import { transformThreatModel } from '../utils/flowTransformer';
import { addCallbacksToNodesAndEdges } from '../utils/nodeEdgeCallbackBuilder';
import { useExportActions } from '../hooks/useExportActions';
import { useThreatModelState } from '../hooks/useThreatModelState';
import { useAutoSave } from '../hooks/useAutoSave';
import { useFileChangeDetection } from '../hooks/useFileChangeDetection';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useSaveHandlers } from '../hooks/useSaveHandlers';
import { useGitHubOperations } from '../integrations/github/hooks/useGitHubOperations';
import { useModelLoader } from '../hooks/useModelLoader';
import { useEntityOperations } from '../hooks/useEntityOperations';
import { useTabDragDrop } from '../hooks/useTabDragDrop';
import { useInitialLoad } from '../hooks/useInitialLoad';
import { useFileOperations } from '../hooks/useFileOperations';
import type { ThreatModel } from '../types/threatModel';

export interface ThreatModelEditorProps {
  initialContent?: string;
  initialFile?: File;
  initialGitHubMetadata?: GitHubMetadata;
}

export default function ThreatModelEditor({
  initialContent,
  initialFile,
  initialGitHubMetadata,
}: ThreatModelEditorProps): React.JSX.Element {
  // Use state management hook
  const {
    nodes,
    edges,
    threatModel,
    yamlContent,
    isDraggingEdge,
    isDraggingNode,
    isEditingMode,
    setNodes,
    setEdges,
    setThreatModel,
    setYamlContent,
    setIsDraggingEdge,
    setIsDraggingNode,
    setIsEditingMode,
    threatModelRef,
    nodesRef,
    edgesRef,
    arrowKeyMovedNodesRef,
    updateYaml,
    canUndo,
    canRedo,
    undo,
    redo,
    clearHistory,
    recordState,
    handleAssetNameChange,
    handleAssetDescriptionChange,
    handleThreatNameChange,
    handleThreatDescriptionChange,
    handleThreatStatusChange,
    handleThreatStatusLinkChange,
    handleThreatStatusNoteChange,
    handleControlNameChange,
    handleControlDescriptionChange,
    handleControlStatusChange,
    handleControlStatusLinkChange,
    handleControlStatusNoteChange,
    handleThreatAffectedComponentsChange,
    handleThreatAffectedDataFlowsChange,
    handleThreatAffectedAssetsChange,
    handleControlMitigatesChange,
    handleControlImplementedInChange,
    handleComponentNameChange,
    handleComponentTypeChange,
    handleComponentColorChange,
    handleComponentDescriptionChange,
    handleComponentAssetsChange,
    handleBoundaryNameChange,
    handleBoundaryDescriptionChange,
    handleBoundaryResizeEnd,
    handleDataFlowLabelChange,
    handleDataFlowDirectionChange,
    handleToggleDirectionAndReverse,
    handleThreatModelNameChange,
    handleThreatModelDescriptionChange,
    handleParticipantsChange,
    handleReorderAssets,
    handleReorderComponents,
    handleReorderThreats,
    handleReorderControls,
  } = useThreatModelState();

  // GitHub integration hook
  const {
    domain: githubDomain,
    githubMetadata,
    isPatModalOpen,
    isSettingsModalOpen,
    patModalAction,
    patError,
    isValidatingPat,
    setDomain: setGitHubDomain,
    setGitHubMetadata,
    closePatModal,
    openSettingsModal,
    closeSettingsModal,
    submitPat,
    getApiClient,
    requirePat,
    cleanupPat,
    syncWithRepository,
  } = useGitHubIntegration();
  
  // Local UI state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const saved = localStorage.getItem('darkMode');
    return saved ? JSON.parse(saved) : window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Tab layout system
  const contentWrapperRef = useRef<HTMLDivElement>(null);
  const {
    tabs,
    tabWidths,
    canAddTab,
    addTab,
    removeTab,
    changeTabView,
    reorderTabs,
    resizeTabs,
    openOrSwitchToView,
  } = useTabLayout(contentWrapperRef);

  // Tab drag-and-drop
  const {
    dndSensors,
    activeDragTab,
    dropIndicatorLeft,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  } = useTabDragDrop({ tabs, tabWidths, reorderTabs });

  const [isSelecting, setIsSelecting] = useState(false);
  const [canvasCreationPhase, setCanvasCreationPhase] = useState<string>('idle');
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [showCommitModal, setShowCommitModal] = useState(false);
  const canvasPanelRef = useRef<CanvasPanelHandle>(null);
  const modalLayerRef = useRef<ModalLayerHandle>(null);
  const [draftKey] = useState<string>(() => getOrCreateSessionDraftKey());
  const yamlEditorRef = useRef<YamlEditorRef>(null);
  const tablesPanelRef = useRef<TablesPanelHandle>(null);
  const reactFlowWrapperRef = useRef<HTMLDivElement>(null);
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const reactFlowInstanceRef = useRef<any>(null);
  const buildNodesAndEdgesRef = useRef<(model: ThreatModel) => { nodes: any[]; edges: any[] }>(null!);
  const loadFromContentRef = useRef<(content: string, source: import('../hooks/useModelLoader').LoadSource, preParsedModel?: ThreatModel) => void>(null!);

  // Use toast hook
  const { showToast } = useToast();

  // Use save state context
  const {
    saveSource,
    lastSavedAt,
    isDirty,
    setSaveSource,
    markSaved,
    markDirty,
    clearSaveState,
    autoSaveSettings,
  } = useSaveState();

  // Entity operations (add/remove assets, threats, controls, components, boundaries, data flows)
  const {
    handleEditModeChange,
    handleSelectNode,
    justExitedEditModeRef,
    handleAddAsset,
    handleCreateAsset,
    handleRemoveAsset,
    handleAddThreat,
    handleRemoveThreat,
    handleCreateControl,
    handleAddControl,
    handleRemoveControl,
    handleRemoveDataFlow,
    handleAddComponent,
    handleRemoveComponent,
    handleAddBoundary,
    handleRemoveBoundary,
    updateBoundaryMemberships,
  } = useEntityOperations({
    threatModelRef,
    nodesRef,
    edgesRef,
    setThreatModel,
    setNodes,
    setEdges,
    updateYaml,
    recordState,
    isEditingMode,
    setIsEditingMode,
    reactFlowInstanceRef,
    reactFlowWrapperRef,
    handleComponentNameChange,
    handleComponentTypeChange,
    handleComponentColorChange,
    handleComponentDescriptionChange,
    handleComponentAssetsChange,
    handleBoundaryNameChange,
    handleBoundaryResizeEnd,
  });

  // Use export actions hook (wraps useDiagramExport + clipboard/toast logic)
  const {
    captureDiagram,
    handleDownloadFolderClick,
    handleCopyToConfluenceClick,
    handleCopyDiagramToClipboardClick,
    handleCopyAsYamlClick,
    handleCopyAsMarkdownClick,
    handleGenerateShareLink,
  } = useExportActions({ threatModel, yamlContent, isDarkMode, githubMetadata, yamlEditorRef, showToast });

  // Enable auto-save for YAML content changes
  const saveSourceMeta: SerializedSaveSource | undefined = useMemo(() => {
    if (!saveSource) return undefined;
    switch (saveSource.type) {
      case 'browser':
        return { type: 'browser' as const, modelId: saveSource.modelId, modelName: saveSource.modelName };
      case 'file':
        return { type: 'file' as const, fileName: saveSource.fileName };
      case 'github':
        return { type: 'github' as const, githubMeta: saveSource.metadata };
      default:
        return undefined;
    }
  }, [saveSource]);

  // Determine whether source-level auto-save is active for the current file
  const isAutoSaveToBrowser = autoSaveSettings.autoSaveBrowserFiles && saveSource?.type === 'browser';
  const isAutoSaveToFile = autoSaveSettings.autoSaveLocalFiles && saveSource?.type === 'file';
  const isAutoSavingToSource = isAutoSaveToBrowser || isAutoSaveToFile;

  // --- External file change detection ---
  const reloadFromExternalRef = useRef<((newContent: string) => void) | null>(null);

  // File tracking state (shared between useFileOperations, useSaveHandlers, useFileChangeDetection)
  const [localFileHandle, setLocalFileHandle] = useState<FileSystemFileHandle | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [browserModelId, setBrowserModelId] = useState<string | null>(null);

  const fileChangeDetection = useFileChangeDetection({
    fileHandle: localFileHandle,
    isDirty,
    enabled: saveSource?.type === 'file',
    onExternalChange: useCallback((newContent: string) => {
      reloadFromExternalRef.current?.(newContent);
    }, []),
    onConflictDetected: useCallback((newContent: string) => {
      modalLayerRef.current?.showExternalConflict(newContent);
    }, []),
  });

  // File operations (file select, upload from local)
  const {
    handleFileSelect,
    handleUploadFromLocal,
  } = useFileOperations({
    loadFromContent: (content, source) => loadFromContentRef.current(content, source),
    clearSaveState,
    fileChangeDetection,
    showToast,
    modalLayerRef,
    setLocalFileHandle,
    setLocalFileName,
    setBrowserModelId,
  });

  useAutoSave(
    threatModel?.name || 'Untitled',
    yamlContent,
    {
      enabled: !!threatModel && !!yamlContent,
      delay: 2000,
      githubMetadata,
      autoSaveToBrowser: isAutoSaveToBrowser,
      autoSaveToFile: isAutoSaveToFile,
      browserModelId: saveSource?.type === 'browser' ? saveSource.modelId : null,
      fileHandle: saveSource?.type === 'file' ? saveSource.handle : null,
      saveSourceMeta,
      lastSavedToSourceAt: lastSavedAt,
      isDirty,
      draftKey,
      onSave: () => {
        if (isAutoSavingToSource) {
          markSaved();
        }
      },
      onFileWritten: (lastModified: number) => {
        fileChangeDetection.updateLastKnownModified(lastModified);
      },
    }
  );

  // Initial data loading (URL, draft, initial content, empty template)
  const {
    loading,
    error,
    pendingFitViewRef,
    loadTimestampRef,
  } = useInitialLoad({
    initialContent,
    initialFile,
    initialGitHubMetadata,
    draftKey,
    loadFromContentRef,
    buildNodesAndEdgesRef,
    setYamlContent,
    setThreatModel,
    setNodes,
    setEdges,
    setGitHubMetadata,
    setBrowserModelId,
    setLocalFileHandle,
    setLocalFileName,
    clearHistory,
    markSaved,
    markDirty,
    showToast,
  });

  // After loading a new file, fit the canvas to show all nodes once they render
  useEffect(() => {
    if (pendingFitViewRef.current && nodes.length > 0 && reactFlowInstanceRef.current) {
      pendingFitViewRef.current = false;
      requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.fitView({ padding: 0.2, duration: 400 });
      });
    }
  }, [nodes]);

  // Track dirty state
  useEffect(() => {
    if (Date.now() - loadTimestampRef.current < 500) {
      return;
    }
    if (yamlContent) {
      markDirty();
    }
  }, [yamlContent, markDirty]);

  // Apply dark mode to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', isDarkMode ? 'dark' : 'light');
    localStorage.setItem('darkMode', JSON.stringify(isDarkMode));
  }, [isDarkMode]);

  // Sync YAML content to editor ref after state updates
  useEffect(() => {
    if (yamlEditorRef.current) {
      yamlEditorRef.current.setContent(yamlContent);
    }
  }, [yamlContent]);

  // Update all node availableAssets when threat model assets change
  useEffect(() => {
    if (!threatModel) return;
    
    const availableAssets = threatModel.assets?.map(a => ({ ref: a.ref, name: a.name })) || [];
    
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        if (node.type === 'threatModelNode') {
          return {
            ...node,
            data: {
              ...node.data,
              availableAssets,
            },
          };
        }
        return node;
      })
    );
  }, [threatModel?.assets, setNodes]);

  // Stable wrapper that transforms a model into nodes+edges with all callbacks attached.
  const buildNodesAndEdges = useCallback(
    (model: ThreatModel) => {
      const { nodes: transformedNodes, edges: transformedEdges } = transformThreatModel(model, handleDataFlowLabelChange);
      return addCallbacksToNodesAndEdges(transformedNodes, transformedEdges, model, {
        handleComponentNameChange,
        handleEditModeChange,
        handleComponentTypeChange,
        handleComponentColorChange,
        handleComponentDescriptionChange,
        handleComponentAssetsChange,
        handleCreateAsset,
        handleSelectNode,
        handleBoundaryNameChange,
        handleBoundaryResizeEnd,
        handleDataFlowLabelChange,
        handleDataFlowDirectionChange,
        handleToggleDirectionAndReverse,
      });
    },
    [handleComponentNameChange, handleEditModeChange, handleComponentTypeChange, handleComponentColorChange, handleComponentDescriptionChange, handleComponentAssetsChange, handleCreateAsset, handleSelectNode, handleBoundaryNameChange, handleBoundaryResizeEnd, handleDataFlowLabelChange, handleDataFlowDirectionChange, handleToggleDirectionAndReverse],
  );

  // Keep ref in sync so effects/callbacks can use it without depending on its identity
  buildNodesAndEdgesRef.current = buildNodesAndEdges;

  // Model loading: centralised load-from-content and YAML-update helpers
  const { loadFromContent, loadFromYamlUpdate } = useModelLoader({
    buildNodesAndEdges,
    setYamlContent,
    setThreatModel,
    setNodes,
    setEdges,
    setGitHubMetadata,
    setLocalFileHandle,
    setLocalFileName,
    setBrowserModelId,
    clearHistory,
    clearSaveState,
    markSaved,
    markDirty,
    setSaveSource,
    loadTimestampRef,
    pendingFitViewRef,
  });

  // Keep ref in sync so the loadData effect can use the latest version
  loadFromContentRef.current = loadFromContent;

  // Save handlers (browser storage, local file, quick save)
  const {
    handleSaveToBrowser,
    handleSaveToFile,
    handleSaveToNewFile,
    handleSaveToNewBrowser,
    handleCommitToGitHub,
    handleQuickSave,
    quickSaveRef,
  } = useSaveHandlers({
    yamlContent,
    yamlEditorRef,
    threatModel,
    githubMetadata,
    browserModelId,
    setBrowserModelId,
    localFileHandle,
    setLocalFileHandle,
    setLocalFileName,
    setThreatModel,
    saveSource,
    markSaved,
    fileChangeDetection,
    showToast,
    setShowCommitModal,
    requirePat,
    draftKey,
  });

  // Keyboard shortcuts (undo/redo, save, section toggles, edit mode, arrow keys, 1-4 creation)
  useKeyboardShortcuts({
    undo,
    redo,
    nodes,
    edges,
    setNodes,
    setEdges,
    creationPhase: canvasCreationPhase,
    isEditingMode,
    arrowKeyMovedNodesRef,
    quickSaveRef,
    mousePositionRef,
    reactFlowInstanceRef,
    toggleAllSections: () => { tablesPanelRef.current?.toggleAllSections(); },
    handleAddComponent,
    handleAddBoundary,
    handleCopySelection: () => { canvasPanelRef.current?.handleCopySelection(); },
    handlePasteSelection: () => { canvasPanelRef.current?.handlePasteSelection(); },
  });



  // GitHub operations (commit, sync, conflict resolution)
  const {
    handleCommitModalClose,
    handleCommit,
    getCommitApiClient,
    handleSyncWithGitHub,
    handleSyncModalConfirm,
    handleSyncModalCancel,
  } = useGitHubOperations({
    yamlContent,
    yamlEditorRef,
    threatModel,
    githubDomain,
    githubMetadata,
    setGitHubMetadata,
    setThreatModel,
    setYamlContent,
    getApiClient,
    requirePat,
    cleanupPat,
    syncWithRepository,
    closeSettingsModal,
    captureDiagram,
    markSaved,
    showToast,
    showCommitModal,
    setShowCommitModal,
    showSyncModal,
    setShowSyncModal,
    syncResult,
    setSyncResult,
    draftKey,
  });

  // Populate the external reload ref — needs to be after all node-callback
  // handlers are defined so they can be captured in the closure.
  reloadFromExternalRef.current = (newContent: string) => {
    if (localFileHandle) {
      loadFromContent(newContent, { type: 'file', fileHandle: localFileHandle });
    } else {
      loadFromContent(newContent, { type: 'template' });
    }
    showToast('File reloaded — changed externally', 'info');
  };

  // Bundle all table manipulation callbacks into a single object to keep the JSX clean.
  // useMemo ensures the object identity is stable unless a callback reference actually changes.
  const tableCallbacks: TableCallbacks = useMemo(() => ({
    onThreatModelNameChange: handleThreatModelNameChange,
    onThreatModelDescriptionChange: handleThreatModelDescriptionChange,
    onParticipantsChange: handleParticipantsChange,
    onComponentNameChange: handleComponentNameChange,
    onComponentTypeChange: handleComponentTypeChange,
    onComponentDescriptionChange: handleComponentDescriptionChange,
    onComponentAssetsChange: handleComponentAssetsChange,
    onCreateAsset: handleCreateAsset,
    onRemoveComponent: handleRemoveComponent,
    onAddComponent: (componentType) => handleAddComponent(componentType),
    onReorderComponents: handleReorderComponents,
    onAssetNameChange: handleAssetNameChange,
    onAssetDescriptionChange: handleAssetDescriptionChange,
    onRemoveAsset: handleRemoveAsset,
    onAddAsset: handleAddAsset,
    onReorderAssets: handleReorderAssets,
    onBoundaryNameChange: handleBoundaryNameChange,
    onBoundaryDescriptionChange: handleBoundaryDescriptionChange,
    onDataFlowDirectionChange: handleDataFlowDirectionChange,
    onDataFlowLabelChange: handleDataFlowLabelChange,
    onRemoveBoundary: handleRemoveBoundary,
    onRemoveDataFlow: handleRemoveDataFlow,
    onThreatNameChange: handleThreatNameChange,
    onThreatDescriptionChange: handleThreatDescriptionChange,
    onThreatAffectedComponentsChange: handleThreatAffectedComponentsChange,
    onThreatAffectedDataFlowsChange: handleThreatAffectedDataFlowsChange,
    onThreatAffectedAssetsChange: handleThreatAffectedAssetsChange,
    onThreatStatusChange: handleThreatStatusChange,
    onThreatStatusLinkChange: handleThreatStatusLinkChange,
    onThreatStatusNoteChange: handleThreatStatusNoteChange,
    onControlMitigatesChange: handleControlMitigatesChange,
    onCreateControl: handleCreateControl,
    onRemoveThreat: handleRemoveThreat,
    onAddThreat: handleAddThreat,
    onReorderThreats: handleReorderThreats,
    onControlNameChange: handleControlNameChange,
    onControlDescriptionChange: handleControlDescriptionChange,
    onControlStatusChange: handleControlStatusChange,
    onControlStatusLinkChange: handleControlStatusLinkChange,
    onControlStatusNoteChange: handleControlStatusNoteChange,
    onControlImplementedInChange: handleControlImplementedInChange,
    onRemoveControl: handleRemoveControl,
    onAddControl: handleAddControl,
    onReorderControls: handleReorderControls,
  }), [
    handleThreatModelNameChange, handleThreatModelDescriptionChange, handleParticipantsChange,
    handleComponentNameChange, handleComponentTypeChange, handleComponentDescriptionChange,
    handleComponentAssetsChange, handleCreateAsset, handleRemoveComponent, handleAddComponent,
    handleReorderComponents, handleAssetNameChange, handleAssetDescriptionChange, handleRemoveAsset,
    handleAddAsset, handleReorderAssets, handleBoundaryNameChange, handleBoundaryDescriptionChange,
    handleDataFlowDirectionChange, handleDataFlowLabelChange, handleRemoveBoundary, handleRemoveDataFlow,
    handleThreatNameChange, handleThreatDescriptionChange, handleThreatAffectedComponentsChange,
    handleThreatAffectedDataFlowsChange, handleThreatAffectedAssetsChange, handleThreatStatusChange,
    handleThreatStatusLinkChange, handleThreatStatusNoteChange, handleControlMitigatesChange,
    handleCreateControl, handleRemoveThreat, handleAddThreat, handleReorderThreats,
    handleControlNameChange, handleControlDescriptionChange, handleControlStatusChange,
    handleControlStatusLinkChange, handleControlStatusNoteChange, handleControlImplementedInChange,
    handleRemoveControl, handleAddControl, handleReorderControls,
  ]);

  if (loading) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '18px', color: '#666' }}>Loading threat model...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ width: '100vw', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: '18px', color: '#dc2626', textAlign: 'center' }}>
          <div style={{ fontWeight: 'bold', marginBottom: '8px' }}>Error</div>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-container ${isSelecting ? 'selecting' : ''}`}>
      <Navbar
        isDarkMode={isDarkMode}
        canUndo={canUndo}
        canRedo={canRedo}
        localFileName={localFileName}
        canSaveToFile={isFileSystemAccessSupported()}
        onCopyToConfluence={handleCopyToConfluenceClick}
        onCopyDiagramToClipboard={handleCopyDiagramToClipboardClick}
        onCopyAsYaml={handleCopyAsYamlClick}
        onCopyAsMarkdown={handleCopyAsMarkdownClick}
        onUndo={undo}
        onRedo={redo}
        onNewThreatModel={(source) => modalLayerRef.current?.openNewModelFlow(source)}
        onQuickSave={handleQuickSave}
        onSaveToBrowser={handleSaveToBrowser}
        onSaveToFile={handleSaveToFile}
        onSaveToNewFile={handleSaveToNewFile}
        onSaveToNewBrowser={handleSaveToNewBrowser}
        onCommitToGitHub={handleCommitToGitHub}
        onDownloadFolder={handleDownloadFolderClick}
        onDarkModeToggle={() => setIsDarkMode(!isDarkMode)}
        onGitHubSettingsClick={openSettingsModal}
        onGenerateShareLink={handleGenerateShareLink}
        onOpenTutorials={() => openOrSwitchToView('tutorials')}
      />

      <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd} onDragCancel={handleDragCancel}>
      <div className="content-wrapper" ref={contentWrapperRef}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={horizontalListSortingStrategy}>
        {tabs.map((tab, i) => {
          const isFirstTables = tab.view === 'tables' && tabs.findIndex(t => t.view === 'tables') === i;
          const isFirstYaml = tab.view === 'yaml' && tabs.findIndex(t => t.view === 'yaml') === i;
          const isFirstCanvas = tab.view === 'canvas' && tabs.findIndex(t => t.view === 'canvas') === i;

          return (
            <React.Fragment key={tab.id}>
              <div
                className="tab-panel"
                data-view={tab.view}
                style={{ width: `${tabWidths[i]}%` }}
              >
                <TabPanelHeader
                  tab={tab}
                  tabCount={tabs.length}
                  canAddTab={canAddTab}
                  onAddTab={addTab}
                  onRemoveTab={removeTab}
                  onChangeView={changeTabView}
                />

                {/* Tables view */}
                {tab.view === 'tables' && (
                  <TablesPanel
                    ref={isFirstTables ? tablesPanelRef : undefined}
                    threatModel={threatModel}
                    githubMetadata={githubMetadata ?? undefined}
                    isFirstTables={isFirstTables}
                    callbacks={tableCallbacks}
                  />
                )}

                {/* YAML view */}
                {tab.view === 'yaml' && (
                  <div className="tab-panel-yaml">
                    {yamlContent && (
                      <Suspense fallback={
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          justifyContent: 'center', 
                          height: '100%',
                          width: '100%',
                          color: 'var(--text-secondary)'
                        }}>
                          Loading YAML editor...
                        </div>
                      }>
                        <YamlEditor 
                          ref={isFirstYaml ? yamlEditorRef : undefined}
                          initialContent={yamlContent}
                          onUpdate={loadFromYamlUpdate}
                        />
                      </Suspense>
                    )}
                  </div>
                )}

                {/* Canvas view */}
                {tab.view === 'canvas' && isFirstCanvas && (
                  <CanvasPanel
                    ref={canvasPanelRef}
                    nodes={nodes}
                    edges={edges}
                    threatModel={threatModel}
                    isDarkMode={isDarkMode}
                    isDraggingEdge={isDraggingEdge}
                    isDraggingNode={isDraggingNode}
                    isEditingMode={isEditingMode}
                    setNodes={setNodes}
                    setEdges={setEdges}
                    setThreatModel={setThreatModel}
                    setIsDraggingEdge={setIsDraggingEdge}
                    setIsDraggingNode={setIsDraggingNode}
                    setIsEditingMode={setIsEditingMode}
                    setIsSelecting={setIsSelecting}
                    threatModelRef={threatModelRef}
                    nodesRef={nodesRef}
                    edgesRef={edgesRef}
                    arrowKeyMovedNodesRef={arrowKeyMovedNodesRef}
                    reactFlowInstanceRef={reactFlowInstanceRef}
                    reactFlowWrapperRef={reactFlowWrapperRef}
                    mousePositionRef={mousePositionRef}
                    justExitedEditModeRef={justExitedEditModeRef}
                    updateYaml={updateYaml}
                    updateBoundaryMemberships={updateBoundaryMemberships}
                    recordState={recordState}
                    showToast={showToast}
                    handleComponentNameChange={handleComponentNameChange}
                    handleEditModeChange={handleEditModeChange}
                    handleComponentTypeChange={handleComponentTypeChange}
                    handleComponentColorChange={handleComponentColorChange}
                    handleComponentDescriptionChange={handleComponentDescriptionChange}
                    handleComponentAssetsChange={handleComponentAssetsChange}
                    handleCreateAsset={handleCreateAsset}
                    handleSelectNode={handleSelectNode}
                    handleBoundaryNameChange={handleBoundaryNameChange}
                    handleBoundaryResizeEnd={handleBoundaryResizeEnd}
                    handleDataFlowLabelChange={handleDataFlowLabelChange}
                    handleDataFlowDirectionChange={handleDataFlowDirectionChange}
                    handleToggleDirectionAndReverse={handleToggleDirectionAndReverse}
                    onAddComponent={handleAddComponent}
                    onAddBoundary={handleAddBoundary}
                    onCreationPhaseChange={setCanvasCreationPhase}
                  />
                )}

                {/* Canvas placeholder for duplicate canvas tabs */}
                {tab.view === 'canvas' && !isFirstCanvas && (
                  <div className="tab-panel-canvas-placeholder">
                    <Shapes size={16} />
                    <span>Canvas is shown in another tab</span>
                  </div>
                )}

                {/* Tutorials view */}
                {tab.view === 'tutorials' && (
                  <TutorialPanel />
                )}
              </div>

              {/* Resize divider between tabs */}
              {i < tabs.length - 1 && (
                <ResizeDivider
                  dividerIndex={i}
                  onResizeTab={resizeTabs}
                />
              )}
            </React.Fragment>
          );
        })}
        </SortableContext>
        {dropIndicatorLeft !== null && (
          <div className="tab-drop-indicator" style={{ left: dropIndicatorLeft }} />
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeDragTab ? (
          <div className="tab-panel-header tab-panel-header--overlay">
            <TabPanelHeaderContent
              tab={activeDragTab}
              showDragHandle
            />
          </div>
        ) : null}
      </DragOverlay>
      </DndContext>

      <ModalLayer
        ref={modalLayerRef}
        isDirty={isDirty}
        canUndo={canUndo}
        saveSource={saveSource}
        onLoadFromContent={loadFromContent}
        onUploadFromLocal={handleUploadFromLocal}
        onQuickSave={handleQuickSave}
        onFileSelect={handleFileSelect}
        localFileName={localFileName}
        yamlContent={yamlContent}
        threatModelName={threatModel?.name}
        onResolveConflict={fileChangeDetection.resolveConflict}
        onReloadExternal={(content) => reloadFromExternalRef.current?.(content)}
        showToast={showToast}
        isPatModalOpen={isPatModalOpen}
        patModalAction={patModalAction}
        githubDomain={githubDomain}
        onSubmitPat={submitPat}
        onClosePatModal={closePatModal}
        onChangeDomain={setGitHubDomain}
        isValidatingPat={isValidatingPat}
        patError={patError}
        isSettingsModalOpen={isSettingsModalOpen}
        githubMetadata={githubMetadata}
        onCloseSettingsModal={closeSettingsModal}
        onSyncWithGitHub={githubMetadata ? handleSyncWithGitHub : undefined}
        showSyncModal={showSyncModal}
        syncResult={syncResult}
        onSyncModalConfirm={handleSyncModalConfirm}
        onSyncModalCancel={handleSyncModalCancel}
        canUndoForSync={canUndo}
        showCommitModal={showCommitModal}
        getCommitApiClient={getCommitApiClient}
        onCommitModalClose={handleCommitModalClose}
        onCommit={handleCommit}
        requirePat={requirePat}
        clearSaveState={clearSaveState}
        cleanupPat={cleanupPat}
        isDarkMode={isDarkMode}
        onDarkModeChange={setIsDarkMode}
        onMetadataLoad={(metadata) => setGitHubMetadata(metadata ?? null)}
        onGenerateShareLink={handleGenerateShareLink}
        threatModel={threatModel}
      />
    </div>
  );
}
