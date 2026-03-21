import { useState, useEffect, useRef, type MutableRefObject } from 'react';
import type { ThreatModel } from '../types/threatModel';
import type { GitHubMetadata } from '../integrations/github/types';
import type { LoadSource } from './useModelLoader';
import { parseYaml, modelToYaml } from '../utils/yamlParser';
import { getModelFromUrl, decodeModelFromUrl } from '../utils/urlEncoder';
import { loadTemplateByPath } from '../utils/templateLoader';
import {
  clearAutoSaveDraft,
  getAllAutoSaveDrafts,
  pruneAutoSaveDrafts,
  migrateSingletonDraft,
  getStoredFileHandle,
} from '../utils/browserStorage';

export interface UseInitialLoadOptions {
  initialContent?: string;
  initialFile?: File;
  initialGitHubMetadata?: GitHubMetadata;
  draftKey: string;
  loadFromContentRef: MutableRefObject<(content: string, source: LoadSource, preParsedModel?: ThreatModel) => void>;
  buildNodesAndEdgesRef: MutableRefObject<(model: ThreatModel) => { nodes: any[]; edges: any[] }>;
  setYamlContent: (content: string) => void;
  setThreatModel: (model: ThreatModel | null) => void;
  setNodes: (nodes: any[]) => void;
  setEdges: (edges: any[]) => void;
  setGitHubMetadata: (metadata: GitHubMetadata | null) => void;
  setBrowserModelId: (id: string | null) => void;
  setLocalFileHandle: (handle: FileSystemFileHandle | null) => void;
  setLocalFileName: (name: string | null) => void;
  clearHistory: () => void;
  markSaved: (source?: any, timestamp?: number) => void;
  markDirty: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export function useInitialLoad({
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
}: UseInitialLoadOptions) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedFromUrlRef = useRef(false);
  const pendingFitViewRef = useRef(false);
  const loadTimestampRef = useRef(Date.now());

  useEffect(() => {
    async function loadData(): Promise<void> {
      try {
        setLoading(true);

        // Check for model in URL first (highest priority)
        const encodedModel = getModelFromUrl();
        if (encodedModel && !initialContent && !initialFile && !loadedFromUrlRef.current) {
          try {
            loadedFromUrlRef.current = true;
            const { model, githubMetadata } = decodeModelFromUrl(encodedModel);
            const rawYaml = modelToYaml(model);

            loadFromContentRef.current(rawYaml, { type: 'url', githubMetadata }, model);
            setError(null);

            showToast('Threat model loaded from share link', 'success');
            setLoading(false);

            // Clear URL parameter after a short delay to ensure state is updated
            setTimeout(() => {
              window.history.replaceState({}, '', window.location.pathname);
            }, 100);

            return;
          } catch (urlError) {
            console.error('Failed to load threat model from URL:', urlError);
            showToast('Failed to load shared threat model', 'error');
            loadedFromUrlRef.current = false;
          }
        }

        // Check for auto-save draft (only if no initial content/file/URL provided)
        if (!initialContent && !initialFile && !loadedFromUrlRef.current) {
          await migrateSingletonDraft();
          const allDrafts = await getAllAutoSaveDrafts();

          if (allDrafts.length > 0) {
            const ownDraft = allDrafts.find(d => d.key === draftKey);
            const { key: recoveredKey, draft } = ownDraft || allDrafts[0];
            try {
              const model = parseYaml(draft.content);
              setYamlContent(draft.content);

              if (draft.githubMetadata) {
                setGitHubMetadata(draft.githubMetadata);
              }

              if (draft.saveSource) {
                if (draft.saveSource.type === 'browser' && draft.saveSource.modelId) {
                  setBrowserModelId(draft.saveSource.modelId);
                  markSaved({
                    type: 'browser',
                    modelId: draft.saveSource.modelId,
                    modelName: draft.saveSource.modelName || 'Untitled',
                  }, draft.lastSavedToSourceAt);
                } else if (draft.saveSource.type === 'file' && draft.saveSource.fileName) {
                  const storedHandle = await getStoredFileHandle();
                  if (storedHandle) {
                    setLocalFileHandle(storedHandle);
                    setLocalFileName(storedHandle.name);
                    markSaved({
                      type: 'file',
                      handle: storedHandle,
                      fileName: storedHandle.name,
                    }, draft.lastSavedToSourceAt);
                  }
                } else if (draft.saveSource.type === 'github' && draft.saveSource.githubMeta) {
                  markSaved({
                    type: 'github',
                    metadata: draft.saveSource.githubMeta,
                  }, draft.lastSavedToSourceAt);
                }

                if (draft.isDirty) {
                  markDirty();
                }
              }
              setThreatModel(model);

              const { nodes: nodesWithCallbacks, edges: edgesWithCallbacks } = buildNodesAndEdgesRef.current(model);

              setNodes(nodesWithCallbacks);
              setEdges(edgesWithCallbacks);
              clearHistory();
              pendingFitViewRef.current = true;
              loadTimestampRef.current = Date.now();
              setLoading(false);

              pruneAutoSaveDrafts().catch(() => {});
              return;
            } catch (draftError) {
              console.error('Failed to load auto-save draft (corrupted or invalid), loading empty template instead:', draftError);
              await clearAutoSaveDraft(recoveredKey);
            }
          }
        }

        // Use initial content if provided, otherwise load empty template
        if (loadedFromUrlRef.current) {
          return;
        }

        if (initialContent) {
          loadFromContentRef.current(initialContent, {
            type: 'initial',
            githubMetadata: initialGitHubMetadata ?? undefined,
            saveSource: initialGitHubMetadata ? { type: 'github', metadata: initialGitHubMetadata } : undefined,
          });
        } else if (initialFile) {
          const rawYaml = await initialFile.text();
          loadFromContentRef.current(rawYaml, { type: 'template' });
        } else {
          const rawYaml = await loadTemplateByPath('empty.yaml');
          loadFromContentRef.current(rawYaml, { type: 'template' });
        }

        setError(null);
      } catch (err) {
        console.error('Failed to load threat model:', err);
        setError('Failed to load threat model. Please check the console for details.');
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [initialContent, initialFile, initialGitHubMetadata, clearHistory, showToast]);

  return {
    loading,
    error,
    loadedFromUrlRef,
    pendingFitViewRef,
    loadTimestampRef,
  };
}
