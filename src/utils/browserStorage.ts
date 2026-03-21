/**
 * Browser Storage Utility using IndexedDB
 * Handles persistent storage for threat models using idb-keyval
 */

import { get, set, del, entries, clear } from 'idb-keyval';
import type { GitHubMetadata } from '../integrations/github/types';

export interface SavedModel {
  id: string;
  name: string;
  content: string;
  savedAt: number;
  githubMetadata?: GitHubMetadata;
}

/**
 * Serializable save-source metadata (no FileSystemFileHandle — not serializable).
 * Used to restore the save-source indicator on draft recovery.
 */
export interface SerializedSaveSource {
  type: 'browser' | 'file' | 'github';
  /** For browser: the IndexedDB model ID */
  modelId?: string;
  /** For browser: display name */
  modelName?: string;
  /** For file: the filename (handle is restored separately) */
  fileName?: string;
  /** For github: full metadata */
  githubMeta?: GitHubMetadata;
}

export interface AutoSaveDraft {
  name: string;
  content: string;
  savedAt: number;
  githubMetadata?: GitHubMetadata;
  /** Which save source was active when this draft was written */
  saveSource?: SerializedSaveSource;
  /** Timestamp of the last successful save to source (browser/file/github) */
  lastSavedToSourceAt?: number;
  /** Whether the content had unsaved changes when the draft was written */
  isDirty?: boolean;
}

const AUTOSAVE_KEY = 'autosave-draft';
const AUTOSAVE_PREFIX = 'autosave-draft-';
const SESSION_DRAFT_KEY = 'flowstate-draft-key';
const MODEL_PREFIX = 'threat-model-';
const MIGRATION_FLAG = 'indexeddb-migrated';
const MAX_DRAFTS = 10;

/**
 * Save a threat model to IndexedDB
 */
export const saveToBrowserStorage = async (
  name: string,
  content: string,
  timestamp?: number,
  githubMetadata?: GitHubMetadata
): Promise<string> => {
  const id = `${MODEL_PREFIX}${Date.now()}`;
  const metadata: SavedModel = {
    id,
    name,
    content,
    savedAt: timestamp || Date.now(),
    ...(githubMetadata && { githubMetadata }),
  };
  await set(id, metadata);
  return id;
};

/**
 * Update an existing browser storage entry's content in place (overwrite).
 * Returns true if the entry was found and updated, false otherwise.
 */
export const updateModelContent = async (
  id: string,
  content: string,
  name?: string,
  githubMetadata?: GitHubMetadata
): Promise<boolean> => {
  const model = await get<SavedModel>(id);
  if (!model) return false;
  model.content = content;
  model.savedAt = Date.now();
  if (name !== undefined) model.name = name;
  if (githubMetadata !== undefined) model.githubMetadata = githubMetadata;
  await set(id, model);
  return true;
};

/**
 * Get all saved threat models from IndexedDB
 */
export const getSavedModelsFromBrowser = async (): Promise<SavedModel[]> => {
  const allEntries = await entries<string, SavedModel>();
  return allEntries
    .filter(([key]) => key.startsWith(MODEL_PREFIX))
    .map(([_, value]) => value)
    .sort((a, b) => b.savedAt - a.savedAt);
};

/**
 * Load a saved threat model from IndexedDB
 */
export const loadFromBrowserStorage = async (id: string): Promise<string | null> => {
  const model = await get<SavedModel>(id);
  return model?.content || null;
};

/**
 * Load a saved threat model with all metadata from IndexedDB
 */
export const loadModelWithMetadata = async (id: string): Promise<SavedModel | null> => {
  const model = await get<SavedModel>(id);
  return model || null;
};

/**
 * Update GitHub metadata for a saved model
 */
export const updateModelGitHubMetadata = async (
  id: string,
  githubMetadata: GitHubMetadata | undefined
): Promise<void> => {
  const model = await get<SavedModel>(id);
  if (model) {
    if (githubMetadata) {
      model.githubMetadata = githubMetadata;
    } else {
      delete model.githubMetadata;
    }
    await set(id, model);
  }
};

/**
 * Delete a saved threat model from IndexedDB
 */
export const deleteFromBrowserStorage = async (id: string): Promise<void> => {
  await del(id);
};

/**
 * Rename a saved threat model
 */
export const renameModelInBrowserStorage = async (
  id: string,
  newName: string
): Promise<void> => {
  const model = await get<SavedModel>(id);
  if (model) {
    model.name = newName;
    await set(id, model);
  }
};

/**
 * Duplicate a saved threat model with a new ID
 */
export const duplicateModelInBrowserStorage = async (
  id: string,
  newName?: string
): Promise<string | null> => {
  const model = await get<SavedModel>(id);
  if (!model) return null;
  
  const newId = `${MODEL_PREFIX}${Date.now()}`;
  const duplicate: SavedModel = {
    ...model,
    id: newId,
    name: newName || `${model.name} (Copy)`,
    savedAt: Date.now(),
  };
  await set(newId, duplicate);
  return newId;
};

/**
 * Get or create a unique draft key for this browser tab.
 * Uses sessionStorage so the key survives page refreshes within the
 * same tab, but each tab gets its own isolated key.
 */
export const getOrCreateSessionDraftKey = (): string => {
  const existing = sessionStorage.getItem(SESSION_DRAFT_KEY);
  if (existing) return existing;
  const key = `${AUTOSAVE_PREFIX}${crypto.randomUUID()}`;
  sessionStorage.setItem(SESSION_DRAFT_KEY, key);
  return key;
};

/**
 * Generate a new unique draft key (without storing it).
 * Prefer getOrCreateSessionDraftKey() in component code.
 */
export const generateDraftKey = (): string => {
  return `${AUTOSAVE_PREFIX}${crypto.randomUUID()}`;
};

/**
 * Save auto-save draft to a per-session IndexedDB key.
 * @param draftKey - Unique key for this draft (from generateDraftKey)
 */
export const saveAutoSaveDraft = async (
  draftKey: string,
  name: string,
  content: string,
  githubMetadata?: GitHubMetadata,
  saveSource?: SerializedSaveSource,
  lastSavedToSourceAt?: number,
  isDirty?: boolean
): Promise<void> => {
  const draft: AutoSaveDraft = {
    name,
    content,
    savedAt: Date.now(),
    ...(githubMetadata && { githubMetadata }),
    ...(saveSource && { saveSource }),
    ...(lastSavedToSourceAt && { lastSavedToSourceAt }),
    ...(isDirty !== undefined && { isDirty }),
  };
  await set(draftKey, draft);
};

/**
 * Get a specific auto-save draft by key.
 */
export const getAutoSaveDraft = async (draftKey: string): Promise<AutoSaveDraft | null> => {
  const draft = await get<AutoSaveDraft>(draftKey);
  return draft || null;
};

/**
 * Clear a specific auto-save draft by key.
 */
export const clearAutoSaveDraft = async (draftKey: string): Promise<void> => {
  await del(draftKey);
};

/**
 * Get all auto-save drafts from IndexedDB, sorted newest-first.
 * Scans for both legacy singleton key and per-session prefixed keys.
 */
export const getAllAutoSaveDrafts = async (): Promise<Array<{ key: string; draft: AutoSaveDraft }>> => {
  const allEntries = await entries<string, AutoSaveDraft>();
  return allEntries
    .filter(([key]) => key.startsWith(AUTOSAVE_PREFIX) || key === AUTOSAVE_KEY)
    .map(([key, draft]) => ({ key, draft }))
    .sort((a, b) => b.draft.savedAt - a.draft.savedAt);
};

/**
 * Prune auto-save drafts to keep at most `maxCount` (default MAX_DRAFTS).
 * Removes the oldest drafts beyond the limit.
 */
export const pruneAutoSaveDrafts = async (maxCount: number = MAX_DRAFTS): Promise<void> => {
  const drafts = await getAllAutoSaveDrafts();
  if (drafts.length <= maxCount) return;
  const toDelete = drafts.slice(maxCount);
  await Promise.all(toDelete.map(({ key }) => del(key)));
};

/**
 * Migrate the legacy singleton 'autosave-draft' key to a prefixed key.
 * Safe to call multiple times — no-ops if already migrated.
 */
export const migrateSingletonDraft = async (): Promise<string | null> => {
  const legacy = await get<AutoSaveDraft>(AUTOSAVE_KEY);
  if (!legacy) return null;
  const newKey = `${AUTOSAVE_PREFIX}migrated`;
  await set(newKey, legacy);
  await del(AUTOSAVE_KEY);
  return newKey;
};

/**
 * Migrate existing localStorage data to IndexedDB (one-time operation)
 */
export const migrateFromLocalStorage = async (): Promise<number> => {
  // Check if migration already done
  const migrated = localStorage.getItem(MIGRATION_FLAG);
  if (migrated) return 0;

  let migratedCount = 0;
  
  // Migrate saved models
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('threat-model-')) {
      const item = localStorage.getItem(key);
      if (item) {
        try {
          const parsed = JSON.parse(item);
          const model: SavedModel = {
            id: key,
            name: parsed.name,
            content: parsed.content,
            savedAt: parsed.savedAt,
          };
          await set(key, model);
          migratedCount++;
        } catch (e) {
          console.error(`Failed to migrate ${key}:`, e);
        }
      }
    }
  }

  // Mark migration as complete
  localStorage.setItem(MIGRATION_FLAG, 'true');
  
  return migratedCount;
};

/**
 * Clear all stored threat models (for testing/cleanup)
 */
export const clearAllStoredModels = async (): Promise<void> => {
  await clear();
};

// File System Access API support

const FILE_HANDLE_KEY = 'local-file-handle';

/**
 * Check if File System Access API is supported
 */
export const isFileSystemAccessSupported = (): boolean => {
  return 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
};

/**
 * Store a file handle for future write operations.
 * Note: File handles can be stored in IndexedDB and persist across sessions.
 */
export const storeFileHandle = async (handle: FileSystemFileHandle): Promise<void> => {
  await set(FILE_HANDLE_KEY, handle);
};

/**
 * Get the stored file handle
 */
export const getStoredFileHandle = async (): Promise<FileSystemFileHandle | null> => {
  const handle = await get<FileSystemFileHandle>(FILE_HANDLE_KEY);
  return handle || null;
};

/**
 * Clear the stored file handle
 */
export const clearFileHandle = async (): Promise<void> => {
  await del(FILE_HANDLE_KEY);
};

/**
 * Request permission for a file handle (required before read/write operations)
 * Returns true if permission granted, false otherwise
 */
export const requestFileHandlePermission = async (
  handle: FileSystemFileHandle,
  mode: 'read' | 'readwrite' = 'readwrite'
): Promise<boolean> => {
  try {
    // Check current permission state
    const options = { mode } as FileSystemHandlePermissionDescriptor;
    let permission = await handle.queryPermission(options);
    
    if (permission === 'granted') {
      return true;
    }
    
    // Request permission if not granted
    permission = await handle.requestPermission(options);
    return permission === 'granted';
  } catch (error) {
    console.error('Error requesting file handle permission:', error);
    return false;
  }
};

/**
 * Write content to a file handle.
 * Returns the file's new `lastModified` timestamp after the write completes,
 * which callers can use to keep external-change-detection in sync.
 */
export const writeToFileHandle = async (
  handle: FileSystemFileHandle,
  content: string
): Promise<number> => {
  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
  // Re-read file metadata to get the updated lastModified timestamp
  const file = await handle.getFile();
  return file.lastModified;
};

/**
 * Open a file using the File System Access API
 * Returns the file handle and content, or null if cancelled
 */
export const openFileWithPicker = async (): Promise<{ handle: FileSystemFileHandle; content: string; name: string; lastModified: number } | null> => {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [
        {
          description: 'YAML files',
          accept: {
            'text/yaml': ['.yaml', '.yml'],
          },
        },
      ],
      multiple: false,
    });
    
    const file = await handle.getFile();
    const content = await file.text();
    
    return { handle, content, name: file.name, lastModified: file.lastModified };
  } catch (error) {
    // User cancelled the picker
    if (error instanceof Error && error.name === 'AbortError') {
      return null;
    }
    throw error;
  }
};

/**
 * Save content using the File System Access API picker
 * Returns the file handle for future operations, or null if cancelled
 */
export const saveFileWithPicker = async (
  content: string,
  suggestedName?: string
): Promise<FileSystemFileHandle | null> => {
  try {
    const handle = await window.showSaveFilePicker({
      suggestedName: suggestedName || 'threat_model.yaml',
      types: [
        {
          description: 'YAML files',
          accept: {
            'text/yaml': ['.yaml', '.yml'],
          },
        },
      ],
    });
    
    await writeToFileHandle(handle, content);
    return handle;
  } catch (error) {
    // User cancelled the picker
    if (error instanceof Error && error.name === 'AbortError') {
      return null;
    }
    throw error;
  }
};
