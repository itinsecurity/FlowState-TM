import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { produce } from 'immer';
import type { ToastType } from '../contexts/ToastContext';
import type { ComponentType, ComponentColor, Direction, ThreatModel } from '../types/threatModel';
import { appendYamlItem } from '../utils/yamlParser';
import { sortNodesByRenderOrder } from '../utils/flowTransformer';
import { generateDataFlowRef, generateUniqueRef } from '../utils/refGenerators';
import {
  CANVAS_CLIPBOARD_VERSION,
  parseCanvasClipboardPayload,
  resolveCanvasClipboardAssets,
  serializeCanvasClipboardPayload,
  type CanvasClipboardPayload,
} from '../utils/canvasClipboard';

const CANVAS_PASTE_OFFSET = { x: 40, y: 40 };

interface CanvasClipboardPasteState {
  copyId: string | null;
  pasteCount: number;
}

interface UseCanvasClipboardOptions {
  nodesRef: RefObject<any[]>;
  threatModelRef: RefObject<ThreatModel | null>;
  setThreatModel: Dispatch<SetStateAction<ThreatModel | null>>;
  setNodes: Dispatch<SetStateAction<any[]>>;
  setEdges: Dispatch<SetStateAction<any[]>>;
  updateYaml: (updater: (content: string) => string) => void;
  updateBoundaryMemberships: (currentNodes: any[]) => void;
  recordState: () => void;
  showToast: (message: string, type?: ToastType, duration?: number) => string;
  handleComponentNameChange: (componentRef: string, newName: string) => void;
  handleEditModeChange: (isEditing: boolean) => void;
  handleComponentTypeChange: (componentRef: string, newType: ComponentType) => void;
  handleComponentColorChange: (componentRef: string, newColor: ComponentColor | undefined) => void;
  handleComponentDescriptionChange: (componentRef: string, newDescription: string) => void;
  handleComponentAssetsChange: (componentRef: string, newAssets: string[]) => void;
  handleCreateAsset: (name: string) => string;
  handleSelectNode: (nodeId: string) => void;
  handleBoundaryNameChange: (boundaryRef: string, newName: string) => void;
  handleBoundaryResizeEnd: (boundaryRef: string, width: number, height: number, x?: number, y?: number) => void;
  handleDataFlowLabelChange: (dataFlowRef: string, newLabel: string) => void;
  handleDataFlowDirectionChange: (dataFlowRef: string, newDirection: Direction) => void;
  handleToggleDirectionAndReverse: (dataFlowRef: string, currentDirection: string) => void;
}

interface UseCanvasClipboardResult {
  handleCopySelection: () => Promise<void>;
  handlePasteSelection: () => Promise<void>;
}

export function useCanvasClipboard({
  nodesRef,
  threatModelRef,
  setThreatModel,
  setNodes,
  setEdges,
  updateYaml,
  updateBoundaryMemberships,
  recordState,
  showToast,
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
}: UseCanvasClipboardOptions): UseCanvasClipboardResult {
  const canvasClipboardStateRef = useRef<CanvasClipboardPasteState>({ copyId: null, pasteCount: 0 });

  const handleCopySelection = useCallback(async (): Promise<void> => {
    if (!navigator.clipboard) {
      showToast('Clipboard access is not available in this browser', 'error');
      return;
    }

    const selectedNodes = nodesRef.current.filter(
      (node) => node.selected && (node.type === 'threatModelNode' || node.type === 'boundaryNode'),
    );

    if (selectedNodes.length === 0) {
      return;
    }

    const currentModel = threatModelRef.current;
    if (!currentModel) {
      return;
    }

    const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));

    const payloadNodes = selectedNodes
      .map((node) => {
        if (node.type === 'threatModelNode') {
          const component = currentModel.components.find((candidate) => candidate.ref === node.id);
          if (!component) {
            return null;
          }

          const clipboardAssets = (component.assets || []).map((assetRef) => {
            const asset = currentModel.assets?.find((candidate) => candidate.ref === assetRef);
            return {
              ref: assetRef,
              name: asset?.name,
            };
          });

          return {
            kind: 'component' as const,
            ref: component.ref,
            name: component.name,
            description: component.description,
            componentType: component.component_type,
            color: component.color,
            assets: clipboardAssets.length > 0 ? clipboardAssets : undefined,
            position: {
              x: Math.round(component.x ?? node.position.x),
              y: Math.round(component.y ?? node.position.y),
            },
          };
        }

        const boundary = currentModel.boundaries?.find((candidate) => candidate.ref === node.id);
        if (!boundary) {
          return null;
        }

        return {
          kind: 'boundary' as const,
          ref: boundary.ref,
          name: boundary.name,
          description: boundary.description,
          width: Math.round(node.measured?.width ?? node.style?.width ?? boundary.width ?? 150),
          height: Math.round(node.measured?.height ?? node.style?.height ?? boundary.height ?? 75),
          position: {
            x: Math.round(boundary.x ?? node.position.x),
            y: Math.round(boundary.y ?? node.position.y),
          },
        };
      })
      .filter((node): node is NonNullable<typeof node> => node !== null);

    const payloadDataFlows = (currentModel.data_flows || [])
      .filter(
        (dataFlow) => selectedNodeIds.has(dataFlow.source) && selectedNodeIds.has(dataFlow.destination),
      )
      .map((dataFlow) => ({
        sourceRef: dataFlow.source,
        targetRef: dataFlow.destination,
        label: dataFlow.label,
        direction: dataFlow.direction,
        sourcePoint: dataFlow.source_point,
        targetPoint: dataFlow.destination_point,
      }));

    if (payloadNodes.length === 0) {
      return;
    }

    const payload: CanvasClipboardPayload = {
      type: 'flowstate/canvas-nodes',
      version: CANVAS_CLIPBOARD_VERSION,
      copyId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      nodes: payloadNodes,
      dataFlows: payloadDataFlows.length > 0 ? payloadDataFlows : undefined,
    };

    try {
      await navigator.clipboard.writeText(serializeCanvasClipboardPayload(payload));
      canvasClipboardStateRef.current = { copyId: payload.copyId, pasteCount: 0 };
      const copySummary = payloadDataFlows.length > 0
        ? `Copied ${payloadNodes.length} canvas node${payloadNodes.length === 1 ? '' : 's'} and ${payloadDataFlows.length} data flow${payloadDataFlows.length === 1 ? '' : 's'}`
        : `Copied ${payloadNodes.length} canvas node${payloadNodes.length === 1 ? '' : 's'}`;
      showToast(copySummary, 'success');
    } catch (error) {
      console.error('Failed to copy selected canvas nodes:', error);
      showToast('Failed to copy selected canvas nodes', 'error');
    }
  }, [nodesRef, threatModelRef, showToast]);

  const handlePasteSelection = useCallback(async (): Promise<void> => {
    if (!navigator.clipboard) {
      showToast('Clipboard access is not available in this browser', 'error');
      return;
    }

    const currentModel = threatModelRef.current;
    if (!currentModel) {
      return;
    }

    let clipboardText = '';

    try {
      clipboardText = await navigator.clipboard.readText();
    } catch (error) {
      console.error('Failed to read clipboard contents:', error);
      showToast('Failed to read clipboard contents', 'error');
      return;
    }

    const payload = parseCanvasClipboardPayload(clipboardText);
    if (!payload || payload.nodes.length === 0) {
      return;
    }

    const nextPasteCount = canvasClipboardStateRef.current.copyId === payload.copyId
      ? canvasClipboardStateRef.current.pasteCount + 1
      : 1;
    canvasClipboardStateRef.current = {
      copyId: payload.copyId,
      pasteCount: nextPasteCount,
    };

    const offsetX = CANVAS_PASTE_OFFSET.x * nextPasteCount;
    const offsetY = CANVAS_PASTE_OFFSET.y * nextPasteCount;

    const componentRefs = new Set(currentModel.components.map((component) => component.ref));
    const boundaryRefs = new Set(currentModel.boundaries?.map((boundary) => boundary.ref) || []);
    const dataFlowRefs = currentModel.data_flows?.map((dataFlow) => dataFlow.ref) || [];
    const availableAssets = currentModel.assets?.map((asset) => ({ ref: asset.ref, name: asset.name })) || [];
    let omittedAssetReferenceCount = 0;
    const nodeRefMap = new Map<string, string>();

    const pastedComponents: ThreatModel['components'] = [];
    const pastedBoundaries: NonNullable<ThreatModel['boundaries']> = [];
    const pastedDataFlows: NonNullable<ThreatModel['data_flows']> = [];
    const pastedNodes: any[] = [];
    const pastedEdges: any[] = [];

    for (const node of payload.nodes) {
      if (node.kind === 'component') {
        const ref = generateUniqueRef('component', componentRefs);
        componentRefs.add(ref);
        const resolvedAssets = resolveCanvasClipboardAssets(node.assets, availableAssets);
        omittedAssetReferenceCount += resolvedAssets.droppedAssets.length;

        const pastedComponent = {
          ref,
          name: node.name,
          description: node.description,
          component_type: node.componentType,
          color: node.color,
          assets: resolvedAssets.assetRefs.length > 0 ? resolvedAssets.assetRefs : undefined,
          x: Math.round(node.position.x + offsetX),
          y: Math.round(node.position.y + offsetY),
        };
        nodeRefMap.set(node.ref, ref);

        pastedComponents.push(pastedComponent);
        pastedNodes.push({
          id: ref,
          type: 'threatModelNode',
          position: { x: pastedComponent.x, y: pastedComponent.y },
          selected: true,
          data: {
            label: pastedComponent.name,
            ref,
            description: pastedComponent.description,
            componentType: pastedComponent.component_type,
            color: pastedComponent.color,
            assets: pastedComponent.assets || [],
            availableAssets,
            initialEditMode: false,
            onNameChange: (newName: string) => handleComponentNameChange(ref, newName),
            onEditModeChange: handleEditModeChange,
            onTypeChange: (newType: ComponentType) => handleComponentTypeChange(ref, newType),
            onColorChange: (newColor: ComponentColor | undefined) => handleComponentColorChange(ref, newColor),
            onDescriptionChange: (newDescription: string) => handleComponentDescriptionChange(ref, newDescription),
            onAssetsChange: (newAssets: string[]) => handleComponentAssetsChange(ref, newAssets),
            onCreateAsset: handleCreateAsset,
            onSelectNode: () => handleSelectNode(ref),
          },
        });

        continue;
      }

      const ref = generateUniqueRef('boundary', boundaryRefs);
      boundaryRefs.add(ref);

      const pastedBoundary = {
        ref,
        name: node.name,
        description: node.description,
        x: Math.round(node.position.x + offsetX),
        y: Math.round(node.position.y + offsetY),
        width: Math.round(node.width),
        height: Math.round(node.height),
      };
      nodeRefMap.set(node.ref, ref);

      pastedBoundaries.push(pastedBoundary);
      pastedNodes.push({
        id: ref,
        type: 'boundaryNode',
        position: { x: pastedBoundary.x, y: pastedBoundary.y },
        selectable: true,
        selected: true,
        style: {
          width: pastedBoundary.width,
          height: pastedBoundary.height,
        },
        data: {
          label: pastedBoundary.name,
          description: pastedBoundary.description,
          initialEditMode: false,
          onNameChange: (newName: string) => handleBoundaryNameChange(ref, newName),
          onEditModeChange: handleEditModeChange,
          onResizeEnd: (width: number, height: number, x: number, y: number) =>
            handleBoundaryResizeEnd(ref, width, height, x, y),
        },
      });
    }

    (payload.dataFlows || []).forEach((dataFlow) => {
      const source = nodeRefMap.get(dataFlow.sourceRef);
      const destination = nodeRefMap.get(dataFlow.targetRef);

      if (!source || !destination) {
        return;
      }

      const direction = dataFlow.direction || 'unidirectional';
      const ref = generateDataFlowRef(source, destination, direction, dataFlowRefs);
      dataFlowRefs.push(ref);

      const pastedDataFlow = {
        ref,
        source,
        destination,
        source_point: dataFlow.sourcePoint,
        destination_point: dataFlow.targetPoint,
        direction,
        label: dataFlow.label,
      };

      pastedDataFlows.push(pastedDataFlow);
      pastedEdges.push({
        id: ref,
        source,
        target: destination,
        sourceHandle: dataFlow.sourcePoint,
        targetHandle: dataFlow.targetPoint ? `target-${dataFlow.targetPoint}` : undefined,
        type: 'editableEdge',
        label: dataFlow.label,
        markerStart: direction === 'bidirectional' ? { type: 'arrowclosed' } : undefined,
        markerEnd: { type: 'arrowclosed' },
        selected: false,
        data: {
          direction,
          label: dataFlow.label,
          edgeRef: ref,
          onLabelChange: handleDataFlowLabelChange,
          onDirectionChange: handleDataFlowDirectionChange,
          onToggleDirectionAndReverse: handleToggleDirectionAndReverse,
          onEditModeChange: handleEditModeChange,
        },
      });
    });

    if (pastedComponents.length === 0 && pastedBoundaries.length === 0) {
      return;
    }

    recordState();

    setThreatModel(
      produce((draft) => {
        if (!draft) return;
        draft.components.push(...pastedComponents);
        if (!draft.boundaries) {
          draft.boundaries = [];
        }
        draft.boundaries.push(...pastedBoundaries);
        if (pastedDataFlows.length > 0) {
          if (!draft.data_flows) {
            draft.data_flows = [];
          }
          draft.data_flows.push(...pastedDataFlows);
        }
      }),
    );

    updateYaml((content) => {
      let updated = content;

      pastedComponents.forEach((component) => {
        updated = appendYamlItem(updated, 'components', component as unknown as Record<string, unknown>);
      });

      pastedBoundaries.forEach((boundary) => {
        updated = appendYamlItem(updated, 'boundaries', boundary as unknown as Record<string, unknown>);
      });

      pastedDataFlows.forEach((dataFlow) => {
        updated = appendYamlItem(updated, 'data_flows', dataFlow as unknown as Record<string, unknown>);
      });

      return updated;
    });

    setEdges((prevEdges) => [
      ...prevEdges.map((edge) => edge.selected ? { ...edge, selected: false } : edge),
      ...pastedEdges,
    ]);
    setNodes((prevNodes) =>
      sortNodesByRenderOrder([
        ...prevNodes.map((node) => node.selected ? { ...node, selected: false } : node),
        ...pastedNodes,
      ]),
    );

    setTimeout(() => {
      setNodes((currentNodes) => {
        updateBoundaryMemberships(currentNodes);
        return currentNodes;
      });
      recordState();
    }, 0);

    const pasteSummary = pastedDataFlows.length > 0
      ? `Pasted ${pastedNodes.length} canvas node${pastedNodes.length === 1 ? '' : 's'} and ${pastedDataFlows.length} data flow${pastedDataFlows.length === 1 ? '' : 's'}`
      : `Pasted ${pastedNodes.length} canvas node${pastedNodes.length === 1 ? '' : 's'}`;
    showToast(pasteSummary, 'success');
    if (omittedAssetReferenceCount > 0) {
      showToast(
        `${omittedAssetReferenceCount} asset reference${omittedAssetReferenceCount === 1 ? '' : 's'} could not be mapped in this threat model and were skipped`,
        'warning',
      );
    }
  }, [
    threatModelRef,
    showToast,
    recordState,
    setThreatModel,
    updateYaml,
    setEdges,
    setNodes,
    updateBoundaryMemberships,
    handleComponentNameChange,
    handleEditModeChange,
    handleComponentTypeChange,
    handleComponentDescriptionChange,
    handleComponentAssetsChange,
    handleCreateAsset,
    handleSelectNode,
    handleBoundaryNameChange,
    handleBoundaryResizeEnd,
    handleDataFlowLabelChange,
    handleDataFlowDirectionChange,
    handleToggleDirectionAndReverse,
  ]);

  return {
    handleCopySelection,
    handlePasteSelection,
  };
}
