import { useCallback, type MutableRefObject } from 'react';
import type { LoadSource } from './useModelLoader';
import type { FileChangeDetectionHandle } from './useFileChangeDetection';
import type { ModalLayerHandle } from '../components/modals/ModalLayer';
import {
  isFileSystemAccessSupported,
  openFileWithPicker,
  storeFileHandle,
  clearFileHandle,
} from '../utils/browserStorage';

export interface UseFileOperationsOptions {
  loadFromContent: (content: string, source: LoadSource) => void;
  clearSaveState: () => void;
  fileChangeDetection: FileChangeDetectionHandle;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  modalLayerRef: MutableRefObject<ModalLayerHandle | null>;
  setLocalFileHandle: (handle: FileSystemFileHandle | null) => void;
  setLocalFileName: (name: string | null) => void;
  setBrowserModelId: (id: string | null) => void;
}

export function useFileOperations({
  loadFromContent,
  clearSaveState,
  fileChangeDetection,
  showToast,
  modalLayerRef,
  setLocalFileHandle,
  setLocalFileName,
  setBrowserModelId,
}: UseFileOperationsOptions) {
  const handleFileSelect = useCallback((
    file: File | { name: string; content: string },
    fileHandle?: FileSystemFileHandle | null,
    loadedBrowserModelId?: string
  ) => {
    modalLayerRef.current?.closeFileBrowser();

    clearSaveState();

    if (fileHandle === null) {
      setLocalFileHandle(null);
      setLocalFileName(null);
      clearFileHandle();
    } else if (fileHandle) {
      setLocalFileHandle(fileHandle);
      setLocalFileName(fileHandle.name);
      storeFileHandle(fileHandle);
    }

    if (loadedBrowserModelId) {
      setBrowserModelId(loadedBrowserModelId);
    } else {
      setBrowserModelId(null);
    }

    const processContent = (content: string) => {
      if (loadedBrowserModelId) {
        loadFromContent(content, { type: 'browser', modelId: loadedBrowserModelId });
      } else if (fileHandle) {
        loadFromContent(content, { type: 'file', fileHandle });
      } else {
        loadFromContent(content, { type: 'template' });
      }
    };

    if (file instanceof File) {
      file.text().then(processContent).catch((err) => {
        console.error('Failed to read file:', err);
        showToast('Failed to read file', 'error');
      });
    } else {
      try {
        processContent(file.content);
      } catch (err) {
        console.error('Failed to process content:', err);
        showToast('Failed to process content', 'error');
      }
    }
  }, [loadFromContent, clearSaveState]);

  const handleUploadFromLocal = useCallback(async () => {
    if (isFileSystemAccessSupported()) {
      try {
        const result = await openFileWithPicker();
        if (result) {
          const file = { name: result.name, content: result.content };
          handleFileSelect(file, result.handle);
          fileChangeDetection.updateLastKnownModified(result.lastModified);
        }
      } catch (error) {
        console.error('Failed to open file:', error);
        showToast(`Failed to open file: ${error instanceof Error ? error.message : 'Unknown error'}`, 'error');
      }
    } else {
      modalLayerRef.current?.triggerFileInput();
    }
  }, [handleFileSelect, fileChangeDetection]);

  return {
    handleFileSelect,
    handleUploadFromLocal,
  };
}
