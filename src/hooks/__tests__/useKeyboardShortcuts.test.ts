import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

function createOptions(overrides: Partial<Parameters<typeof useKeyboardShortcuts>[0]> = {}) {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    nodes: [],
    edges: [],
    setNodes: vi.fn(),
    setEdges: vi.fn(),
    creationPhase: 'idle',
    isEditingMode: false,
    arrowKeyMovedNodesRef: { current: new Set<string>() },
    quickSaveRef: { current: null },
    mousePositionRef: { current: { x: 0, y: 0 } },
    reactFlowInstanceRef: { current: null },
    toggleAllSections: vi.fn(),
    handleAddComponent: vi.fn(),
    handleAddBoundary: vi.fn(),
    handleCopySelection: vi.fn(),
    handlePasteSelection: vi.fn(),
    ...overrides,
  };
}

describe('useKeyboardShortcuts', () => {
  const originalPlatform = navigator.platform;

  beforeEach(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: 'Win32',
    });
  });

  afterEach(() => {
    Object.defineProperty(window.navigator, 'platform', {
      configurable: true,
      value: originalPlatform,
    });
    document.body.innerHTML = '';
  });

  it('triggers copy for selected canvas nodes', () => {
    const options = createOptions();

    renderHook(() => useKeyboardShortcuts(options));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(options.handleCopySelection).toHaveBeenCalledTimes(1);
  });

  it('triggers paste for copied canvas nodes', () => {
    const options = createOptions();

    renderHook(() => useKeyboardShortcuts(options));

    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(options.handlePasteSelection).toHaveBeenCalledTimes(1);
  });

  it('does not trigger copy or paste while typing in an input', () => {
    const options = createOptions();
    const input = document.createElement('input');
    document.body.appendChild(input);

    renderHook(() => useKeyboardShortcuts(options));

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    input.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'v',
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(options.handleCopySelection).not.toHaveBeenCalled();
    expect(options.handlePasteSelection).not.toHaveBeenCalled();
  });
});
