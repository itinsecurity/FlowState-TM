import { useCallback, type RefObject } from 'react';
import type { ThreatModel } from '../types/threatModel';
import type { GitHubMetadata } from '../integrations/github/types';
import type { YamlEditorRef } from '../components/YamlEditor';
import { useDiagramExport, generateMarkdown } from './useDiagramExport';
import { generateShareableUrl } from '../utils/urlEncoder';

interface UseExportActionsParams {
  threatModel: ThreatModel | null;
  yamlContent: string;
  isDarkMode: boolean;
  githubMetadata: GitHubMetadata | null;
  yamlEditorRef: RefObject<YamlEditorRef | null>;
  showToast: (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
}

export function useExportActions({
  threatModel,
  yamlContent,
  isDarkMode,
  githubMetadata,
  yamlEditorRef,
  showToast,
}: UseExportActionsParams) {
  const { captureDiagram, handleDownloadFolder, handleCopyToConfluence, handleCopyDiagramToClipboard } =
    useDiagramExport(threatModel, isDarkMode, githubMetadata);

  const handleDownloadFolderClick = useCallback(async (): Promise<void> => {
    // Get content from YAML editor if available (includes unsaved changes), otherwise use state
    const content = yamlEditorRef.current?.getContent() || yamlContent;
    if (content) {
      await handleDownloadFolder(content);
    }
  }, [yamlContent, handleDownloadFolder, yamlEditorRef]);

  const handleCopyToConfluenceClick = useCallback(async (): Promise<void> => {
    const success = await handleCopyToConfluence();
    if (success) {
      showToast('Confluence markup copied to clipboard! Paste into an empty Confluence page.', 'success');
    } else {
      showToast('Failed to copy to clipboard', 'error');
    }
  }, [handleCopyToConfluence, showToast]);

  const handleCopyDiagramToClipboardClick = useCallback(async (): Promise<void> => {
    const success = await handleCopyDiagramToClipboard();
    if (success) {
      showToast('Data Flow Diagram image copied to clipboard!', 'success');
    } else {
      showToast('Failed to copy diagram to clipboard', 'error');
    }
  }, [handleCopyDiagramToClipboard, showToast]);

  const handleCopyAsYamlClick = useCallback(async (): Promise<void> => {
    try {
      // Get content from YAML editor if available (includes unsaved changes), otherwise use state
      const content = yamlEditorRef.current?.getContent() || yamlContent;
      if (!content) {
        showToast('No content to copy', 'error');
        return;
      }
      await navigator.clipboard.writeText(content);
      showToast('YAML copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy YAML to clipboard:', error);
      showToast('Failed to copy YAML to clipboard', 'error');
    }
  }, [yamlContent, showToast, yamlEditorRef]);

  const handleCopyAsMarkdownClick = useCallback(async (): Promise<void> => {
    try {
      if (!threatModel) {
        showToast('No threat model to export', 'error');
        return;
      }
      
      // Generate markdown from the threat model (with embedded diagram, not PNG reference)
      const markdown = generateMarkdown(threatModel, undefined, githubMetadata, false);
      
      await navigator.clipboard.writeText(markdown);
      showToast('Markdown copied to clipboard!', 'success');
    } catch (error) {
      console.error('Failed to copy markdown to clipboard:', error);
      showToast('Failed to copy markdown to clipboard', 'error');
    }
  }, [threatModel, githubMetadata, showToast]);

  const handleGenerateShareLink = useCallback(() => {
    if (!threatModel) {
      showToast('No threat model to share', 'error');
      return;
    }

    try {
      const shareUrl = generateShareableUrl(threatModel, githubMetadata);
      const urlLength = shareUrl.length;
      
      // Warn if URL is larger than safe thresholds
      if (urlLength > 8000) {
        showToast('Warning: Share link is very large and may have compatibility issues', 'warning');
      } 
      // Copy to clipboard
      navigator.clipboard.writeText(shareUrl).then(() => {
        if (urlLength <= 8000) {
          showToast('Share link copied to clipboard!', 'success');
        } else {
          // Already showed warning above, just confirm copy
          showToast('Share link copied (see warning)', 'success');
        }
      }).catch(() => {
        showToast('Failed to copy share link to clipboard', 'error');
      });
    } catch (error) {
      console.error('Failed to generate share link:', error);
      showToast('Failed to generate share link', 'error');
    }
  }, [threatModel, githubMetadata, showToast]);

  return {
    captureDiagram,
    handleDownloadFolderClick,
    handleCopyToConfluenceClick,
    handleCopyDiagramToClipboardClick,
    handleCopyAsYamlClick,
    handleCopyAsMarkdownClick,
    handleGenerateShareLink,
  };
}
