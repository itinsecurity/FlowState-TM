import React, { useState, useCallback, useRef, useEffect, useMemo, useImperativeHandle, forwardRef } from 'react';
import { DiscardModal } from './DiscardModal';
import { ExternalChangeModal } from './ExternalChangeModal';
import { PatModal } from '../../integrations/github/modals/PatModal';
import { GitHubSettingsModal } from '../../integrations/github/modals/GitHubSettingsModal';
import { GitHubCommitModal } from '../../integrations/github/modals/GitHubCommitModal';
import { GitHubSyncModal } from '../../integrations/github/modals/GitHubSyncModal';
import { FileBrowser } from '../filebrowser/FileBrowser';
import { GitHubLoadModalWrapper } from '../../integrations/github/modals/GitHubLoadModalWrapper';
import { loadTemplateByPath } from '../../utils/templateLoader';
import { saveFileWithPicker } from '../../utils/browserStorage';
import type { SourceType } from '../filebrowser/SourceSelector';
import type { GitHubMetadata, GitHubAction, GitHubDomain, CommitExtraFilesOptions } from '../../integrations/github/types';
import type { SyncResult } from '../../integrations/github/hooks/useGitHubIntegration';
import type { GitHubApiClient } from '../../integrations/github/githubApi';
import type { LoadSource } from '../../hooks/useModelLoader';
import type { SaveSource } from '../../contexts/SaveStateContext';

// Module-level timestamp used as fallback for date fields — avoids impure Date.now() calls during render
const MODULE_INIT_TIMESTAMP = Date.now();

// ---------------------------------------------------------------------------
// Public imperative handle
// ---------------------------------------------------------------------------
export interface ModalLayerHandle {
  /** Trigger the "new threat model" flow — shows discard modal if needed. */
  openNewModelFlow: (source: SourceType) => void;
  /** Close the file browser (called when a file is selected from outside). */
  closeFileBrowser: () => void;
  /** Show the external-change conflict modal. */
  showExternalConflict: (content: string) => void;
  /** Programmatically click the hidden file input (fallback upload). */
  triggerFileInput: () => void;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export interface ModalLayerProps {
  // --- Discard-flow deps ---
  isDirty: boolean;
  canUndo: boolean;
  saveSource: SaveSource | null;
  onLoadFromContent: (content: string, source: LoadSource) => void;
  onUploadFromLocal: () => void;
  onQuickSave: () => Promise<void>;

  // --- File select (called by FileBrowser / GitHub load / file drag) ---
  onFileSelect: (
    file: File | { name: string; content: string },
    fileHandle?: FileSystemFileHandle | null,
    browserModelId?: string,
  ) => void;

  // --- External-change conflict deps ---
  localFileName: string | null;
  yamlContent: string;
  threatModelName?: string;
  onResolveConflict: () => void;
  onReloadExternal: (content: string) => void;

  // --- File drag-drop ---
  showToast: (message: string, type: 'success' | 'error' | 'warning' | 'info') => void;

  // --- PAT modal (state owned by useGitHubIntegration in parent) ---
  isPatModalOpen: boolean;
  patModalAction: GitHubAction | null;
  githubDomain: GitHubDomain;
  onSubmitPat: (token: string, persistInSession: boolean) => Promise<boolean>;
  onClosePatModal: () => void;
  onChangeDomain: (domain: GitHubDomain) => void;
  isValidatingPat: boolean;
  patError: string | null;

  // --- Settings modal ---
  isSettingsModalOpen: boolean;
  githubMetadata: GitHubMetadata | null;
  onCloseSettingsModal: () => void;
  onSyncWithGitHub?: () => void;

  // --- Sync modal (state owned by useGitHubOperations in parent) ---
  showSyncModal: boolean;
  syncResult: SyncResult | null;
  onSyncModalConfirm: () => void;
  onSyncModalCancel: () => void;
  canUndoForSync: boolean;

  // --- Commit modal (state owned by useGitHubOperations in parent) ---
  showCommitModal: boolean;
  getCommitApiClient: () => Promise<GitHubApiClient | null>;
  onCommitModalClose: () => void;
  onCommit: (owner: string, repo: string, branch: string, path: string, commitMessage: string, sha?: string, extraFiles?: CommitExtraFilesOptions) => Promise<void>;

  // --- GitHub load ---
  requirePat: (action: GitHubAction) => Promise<GitHubApiClient | null>;
  clearSaveState: () => void;
  cleanupPat: () => void;

  // --- FileBrowser display ---
  isDarkMode: boolean;
  onDarkModeChange: (dark: boolean) => void;
  onMetadataLoad: (metadata: GitHubMetadata | null | undefined) => void;
  onGenerateShareLink: () => void;

  // --- Threat model info ---
  threatModel: { name?: string } | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export const ModalLayer = forwardRef<ModalLayerHandle, ModalLayerProps>(function ModalLayer(props, ref) {
  const {
    isDirty,
    canUndo,
    saveSource,
    onLoadFromContent,
    onUploadFromLocal,
    onQuickSave,
    onFileSelect,
    localFileName,
    yamlContent,
    threatModelName,
    onResolveConflict,
    onReloadExternal,
    showToast,
    isPatModalOpen,
    patModalAction,
    githubDomain,
    onSubmitPat,
    onClosePatModal,
    onChangeDomain,
    isValidatingPat,
    patError,
    isSettingsModalOpen,
    githubMetadata,
    onCloseSettingsModal,
    onSyncWithGitHub,
    showSyncModal,
    syncResult,
    onSyncModalConfirm,
    onSyncModalCancel,
    canUndoForSync,
    showCommitModal,
    getCommitApiClient,
    onCommitModalClose,
    onCommit,
    requirePat,
    clearSaveState,
    cleanupPat,
    isDarkMode,
    onDarkModeChange,
    onMetadataLoad,
    onGenerateShareLink,
    threatModel,
  } = props;

  // ---- Local state ----
  const [showDiscardModal, setShowDiscardModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState<SourceType | null>(null);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [showExternalChangeModal, setShowExternalChangeModal] = useState(false);
  const [externalChangeContent, setExternalChangeContent] = useState<string | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);

  // ---- Helpers ----

  /** Proceed with the given source (load template, open upload, or open browser). */
  const proceedWithSource = useCallback(
    (source: SourceType) => {
      if (source === 'empty') {
        loadTemplateByPath('empty.yaml')
          .then((content) => onLoadFromContent(content, { type: 'template' }))
          .catch((err) => {
            console.error('Failed to load empty template:', err);
            showToast('Failed to load empty template', 'error');
          });
      } else if (source === 'upload') {
        onUploadFromLocal();
      } else {
        setShowFileBrowser(true);
      }
    },
    [onLoadFromContent, onUploadFromLocal, showToast],
  );

  // ---- Imperative handle ----
  useImperativeHandle(ref, () => ({
    openNewModelFlow(source: SourceType) {
      setSelectedSource(source);
      const shouldShowModal = isDirty || (!saveSource && canUndo);
      if (shouldShowModal) {
        setShowDiscardModal(true);
      } else {
        proceedWithSource(source);
      }
    },
    closeFileBrowser() {
      setShowFileBrowser(false);
      setSelectedSource(null);
    },
    showExternalConflict(content: string) {
      setExternalChangeContent(content);
      setShowExternalChangeModal(true);
    },
    triggerFileInput() {
      fileInputRef.current?.click();
    },
  }), [isDirty, saveSource, canUndo, proceedWithSource]);

  // ---- Discard-flow callbacks ----
  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardModal(false);
    if (selectedSource) {
      proceedWithSource(selectedSource);
    }
  }, [selectedSource, proceedWithSource]);

  const handleDiscardCancel = useCallback(() => {
    setShowDiscardModal(false);
    setSelectedSource(null);
  }, []);

  // ---- External-change callbacks ----
  const handleKeepMyChanges = useCallback(() => {
    setShowExternalChangeModal(false);
    setExternalChangeContent(null);
    onResolveConflict();
  }, [onResolveConflict]);

  const handleLoadExternalChanges = useCallback(() => {
    if (!externalChangeContent) return;
    setShowExternalChangeModal(false);
    onResolveConflict();
    onReloadExternal(externalChangeContent);
    setExternalChangeContent(null);
    showToast('Loaded external changes', 'success');
  }, [externalChangeContent, onResolveConflict, onReloadExternal, showToast]);

  const handleSaveAsAndLoadExternal = useCallback(async () => {
    const content = yamlContent;
    if (content) {
      const handle = await saveFileWithPicker(
        content,
        threatModelName ? `${threatModelName}.yaml` : 'threat_model.yaml',
      );
      if (!handle) return; // User cancelled
      showToast(`Saved your changes to ${handle.name}`, 'success');
    }
    handleLoadExternalChanges();
  }, [yamlContent, threatModelName, handleLoadExternalChanges, showToast]);

  // ---- File browser callbacks ----
  const handleFileBrowserBack = useCallback(() => {
    setShowFileBrowser(false);
    setSelectedSource(null);
  }, []);

  const handleGitHubFileSelect = useCallback(
    (content: string, metadata: GitHubMetadata) => {
      setShowFileBrowser(false);
      setSelectedSource(null);
      clearSaveState();
      onLoadFromContent(content, { type: 'github', metadata });
      cleanupPat();
    },
    [onLoadFromContent, cleanupPat, clearSaveState],
  );

  const handleGitHubError = useCallback(
    (error: string) => {
      console.error('GitHub error:', error);
      showToast(error, 'error');
    },
    [showToast],
  );

  // ---- File input fallback ----
  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      if (file) {
        onFileSelect(file);
      }
      event.currentTarget.value = '';
    },
    [onFileSelect],
  );

  // ---- File drag-and-drop effect ----
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types.includes('Files')) {
        dragCounterRef.current++;
        setIsFileDragOver(true);
      }
    };
    const handleDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsFileDragOver(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsFileDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const name = file.name.toLowerCase();
      if (!name.endsWith('.yaml') && !name.endsWith('.yml') && !name.endsWith('.json')) {
        showToast('Please drop a .yaml, .yml, or .json file', 'error');
        return;
      }
      onFileSelect(file);
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [onFileSelect, showToast]);

  // Memoize fallback dates to avoid impure calls during render
  const remoteUpdatedAt = useMemo(
    () => syncResult?.fileUpdatedAt || new Date(MODULE_INIT_TIMESTAMP).toISOString(),
    [syncResult?.fileUpdatedAt]
  );
  const localLoadedAt = useMemo(
    () => new Date(githubMetadata?.loadedAt || MODULE_INIT_TIMESTAMP).toISOString(),
    [githubMetadata?.loadedAt]
  );

  // ---- Render ----
  return (
    <>
      {/* Hidden file input for upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".yaml,.yml,.json"
        onChange={handleFileUpload}
        style={{ display: 'none' }}
      />

      {/* Discard modal */}
      {showDiscardModal && (
        <DiscardModal
          onConfirm={handleDiscardConfirm}
          onCancel={handleDiscardCancel}
          onSave={onQuickSave}
        />
      )}

      {/* External file change conflict modal */}
      {showExternalChangeModal && (
        <ExternalChangeModal
          fileName={localFileName || 'file'}
          onKeepMine={handleKeepMyChanges}
          onLoadExternal={handleLoadExternalChanges}
          onSaveAs={handleSaveAsAndLoadExternal}
        />
      )}

      {/* PAT modal for GitHub authentication */}
      {isPatModalOpen && patModalAction && (
        <PatModal
          action={patModalAction}
          domain={githubDomain}
          onSubmit={onSubmitPat}
          onCancel={onClosePatModal}
          onChangeDomain={onChangeDomain}
          isValidating={isValidatingPat}
          error={patError || undefined}
        />
      )}

      {/* GitHub Settings modal */}
      {isSettingsModalOpen && (
        <GitHubSettingsModal
          domain={githubDomain}
          onDomainChange={onChangeDomain}
          githubMetadata={githubMetadata}
          onClose={onCloseSettingsModal}
          onSync={onSyncWithGitHub}
        />
      )}

      {/* GitHub Sync modal */}
      {showSyncModal && syncResult && (
        <GitHubSyncModal
          onConfirm={onSyncModalConfirm}
          onCancel={onSyncModalCancel}
          hasLocalChanges={canUndoForSync}
          remoteUpdatedAt={remoteUpdatedAt}
          localLoadedAt={localLoadedAt}
        />
      )}

      {/* GitHub Commit modal */}
      {showCommitModal && (
        <GitHubCommitModal
          isOpen={showCommitModal}
          metadata={githubMetadata}
          threatModelName={threatModel?.name || 'Untitled'}
          domain={githubDomain}
          getApiClient={getCommitApiClient}
          onClose={onCommitModalClose}
          onCommit={onCommit}
        />
      )}

      {/* File browser modal - for templates and browser storage */}
      {showFileBrowser && selectedSource && selectedSource !== 'github' && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 10001,
          background: 'var(--bg-primary)',
        }}>
          <FileBrowser
            source={selectedSource}
            onFileSelect={onFileSelect}
            onBack={handleFileBrowserBack}
            isDarkMode={isDarkMode}
            onDarkModeChange={onDarkModeChange}
            onMetadataLoad={onMetadataLoad}
            onGenerateShareLink={onGenerateShareLink}
          />
        </div>
      )}

      {/* GitHub Load modal */}
      {showFileBrowser && selectedSource === 'github' && (
        <GitHubLoadModalWrapper
          domain={githubDomain}
          onFileSelect={handleGitHubFileSelect}
          onBack={handleFileBrowserBack}
          onError={handleGitHubError}
          requirePat={requirePat}
        />
      )}

      {/* File drag-and-drop overlay */}
      {isFileDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <div className="drop-overlay-icon">📄</div>
            <div className="drop-overlay-text">Drop file to open</div>
          </div>
        </div>
      )}
    </>
  );
});
