import React, { useCallback, useEffect, forwardRef, useImperativeHandle, memo } from 'react';
// @ts-ignore - @xyflow/react has type declaration issues but works at runtime
import { ReactFlow, Background, Controls, SelectionMode } from '@xyflow/react';

import ThreatModelNode from './ThreatModelNode';
import BoundaryNode from './BoundaryNode';
import EditableEdge from './EditableEdge';
import EdgeMarkers from './EdgeMarkers';
import CustomConnectionLine from './CustomConnectionLine';
import CanvasToolbar from './CanvasToolbar';
import { CanvasOverlay } from './CanvasOverlay';
import { useFlowDiagram } from '../../hooks/useFlowDiagram';
import { useCanvasNavigation } from '../../hooks/useCanvasNavigation';
import { useDataFlowCreation } from '../../hooks/useDataFlowCreation';
import type { DataFlowCreationPhase } from '../../hooks/useDataFlowCreation';
import { useDataFlowReconnection } from '../../hooks/useDataFlowReconnection';
import { useCanvasClipboard } from '../../hooks/useCanvasClipboard';
import { isComponentInsideBoundary } from '../../utils/geometryHelpers';
import type { ThreatModel, ComponentType, ComponentColor, Direction } from '../../types/threatModel';
import type { ToastType } from '../../contexts/ToastContext';

const nodeTypes = {
  threatModelNode: ThreatModelNode,
  boundaryNode: BoundaryNode,
};

const edgeTypes = {
  editableEdge: EditableEdge,
};

export interface CanvasPanelHandle {
  handleCopySelection: () => Promise<void>;
  handlePasteSelection: () => Promise<void>;
}

export interface CanvasPanelProps {
  // State (read)
  nodes: any[];
  edges: any[];
  threatModel: ThreatModel | null;
  isDarkMode: boolean;
  isDraggingEdge: boolean;
  isDraggingNode: string | null;
  isEditingMode: boolean;

  // State (write)
  setNodes: React.Dispatch<React.SetStateAction<any[]>>;
  setEdges: React.Dispatch<React.SetStateAction<any[]>>;
  setThreatModel: React.Dispatch<React.SetStateAction<ThreatModel | null>>;
  setIsDraggingEdge: React.Dispatch<React.SetStateAction<boolean>>;
  setIsDraggingNode: React.Dispatch<React.SetStateAction<string | null>>;
  setIsEditingMode: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSelecting: React.Dispatch<React.SetStateAction<boolean>>;

  // Refs (owned by parent, shared with canvas)
  threatModelRef: React.RefObject<ThreatModel | null>;
  nodesRef: React.RefObject<any[]>;
  edgesRef: React.RefObject<any[]>;
  arrowKeyMovedNodesRef: React.RefObject<Set<string>>;
  reactFlowInstanceRef: React.MutableRefObject<any>;
  reactFlowWrapperRef: React.RefObject<HTMLDivElement | null>;
  mousePositionRef: React.MutableRefObject<{ x: number; y: number }>;
  justExitedEditModeRef: React.RefObject<boolean>;

  // State management callbacks
  updateYaml: (updater: (content: string) => string) => void;
  updateBoundaryMemberships: (currentNodes: any[]) => void;
  recordState: () => void;
  showToast: (message: string, type?: ToastType, duration?: number) => string;

  // Entity callbacks (for useFlowDiagram + useCanvasClipboard)
  handleComponentNameChange: (ref: string, name: string) => void;
  handleEditModeChange: (isEditing: boolean) => void;
  handleComponentTypeChange: (ref: string, type: ComponentType) => void;
  handleComponentColorChange: (ref: string, color: ComponentColor | undefined) => void;
  handleComponentDescriptionChange: (ref: string, desc: string) => void;
  handleComponentAssetsChange: (ref: string, assets: string[]) => void;
  handleCreateAsset: (name: string) => string;
  handleSelectNode: (nodeId: string) => void;
  handleBoundaryNameChange: (ref: string, name: string) => void;
  handleBoundaryResizeEnd: (ref: string, w: number, h: number, x?: number, y?: number) => void;
  handleDataFlowLabelChange: (ref: string, label: string) => void;
  handleDataFlowDirectionChange: (ref: string, direction: Direction) => void;
  handleToggleDirectionAndReverse: (ref: string, currentDir: string) => void;

  // Canvas actions from parent
  onAddComponent: (type: ComponentType, position?: { x: number; y: number }) => void;
  onAddBoundary: (position?: { x: number; y: number }) => void;
  onCreationPhaseChange?: (phase: DataFlowCreationPhase) => void;
}

export const CanvasPanel = memo(forwardRef<CanvasPanelHandle, CanvasPanelProps>(function CanvasPanel(
  {
    nodes,
    edges,
    threatModel,
    isDraggingEdge,
    isDraggingNode,
    isEditingMode,
    setNodes,
    setEdges,
    setThreatModel,
    setIsDraggingEdge,
    setIsDraggingNode,
    setIsEditingMode,
    setIsSelecting,
    threatModelRef,
    nodesRef,
    edgesRef,
    arrowKeyMovedNodesRef,
    reactFlowInstanceRef,
    reactFlowWrapperRef,
    mousePositionRef,
    justExitedEditModeRef,
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
    onAddComponent,
    onAddBoundary,
    onCreationPhaseChange,
  },
  ref,
) {
  // --- Hook calls ---

  const {
    onNodesChange,
    onEdgesChange,
    onNodeDragStop,
    onNodeDragStart,
    onSelectionDragStop: onSelectionDragStopOriginal,
    onSelectionDragStart: onSelectionDragStartOriginal,
    onConnect,
    onReconnect,
  } = useFlowDiagram({
    threatModel,
    nodes,
    edges,
    setNodes,
    setEdges,
    setThreatModel,
    setIsDraggingNode,
    setIsEditingMode,
    isDraggingNode,
    threatModelRef,
    nodesRef,
    edgesRef,
    arrowKeyMovedNodesRef,
    updateYaml,
    updateBoundaryMemberships,
    isComponentInsideBoundary,
    handleDataFlowLabelChange,
    handleDataFlowDirectionChange,
    handleToggleDirectionAndReverse,
    recordState,
  });

  useCanvasNavigation({
    nodes,
    edges,
    setNodes,
    setEdges,
    isEditingMode,
    reactFlowInstance: reactFlowInstanceRef.current,
  });

  const { creationState, cancelCreation } = useDataFlowCreation({
    nodes,
    edges,
    setNodes,
    isEditingMode,
    onConnect,
    reactFlowInstance: reactFlowInstanceRef.current,
  });

  const { reconnectionState, cancelReconnection } = useDataFlowReconnection({
    nodes,
    edges,
    setNodes,
    setEdges,
    isEditingMode,
    reactFlowInstance: reactFlowInstanceRef.current,
  });

  const { handleCopySelection, handlePasteSelection } = useCanvasClipboard({
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
  });

  // --- Imperative handle ---

  useImperativeHandle(ref, () => ({
    handleCopySelection,
    handlePasteSelection,
  }), [handleCopySelection, handlePasteSelection]);

  // --- Notify parent of creation phase changes ---

  useEffect(() => {
    onCreationPhaseChange?.(creationState.phase);
  }, [creationState.phase, onCreationPhaseChange]);

  // --- Selection wrappers ---

  const onSelectionDragStart = useCallback((event: any, nodes: any[]) => {
    setIsSelecting(true);
    onSelectionDragStartOriginal(event, nodes);
  }, [onSelectionDragStartOriginal, setIsSelecting]);

  const onSelectionDragStop = useCallback((event: any, nodes: any[]) => {
    setIsSelecting(false);
    onSelectionDragStopOriginal(event, nodes);
  }, [onSelectionDragStopOriginal, setIsSelecting]);

  const onSelectionStart = useCallback(() => {
    setIsSelecting(true);
  }, [setIsSelecting]);

  const onSelectionEnd = useCallback(() => {
    setIsSelecting(false);
  }, [setIsSelecting]);

  // --- Canvas click handlers ---

  const onPaneClick = useCallback(() => {
    setNodes((currentNodes) => currentNodes.map((node) => node.selected ? { ...node, selected: false } : node));
    setEdges((currentEdges) => currentEdges.map((edge) => edge.selected ? { ...edge, selected: false } : edge));
    cancelCreation();
    cancelReconnection();
  }, [setNodes, setEdges, cancelCreation, cancelReconnection]);

  const onNodeClick = useCallback((event: React.MouseEvent, _node: any) => {
    if (!event.metaKey && !event.ctrlKey) {
      cancelCreation();
      cancelReconnection();
    }
  }, [cancelCreation, cancelReconnection]);

  const onEdgeClick = useCallback(() => {
    cancelCreation();
    cancelReconnection();
  }, [cancelCreation, cancelReconnection]);

  // --- Drag and drop ---

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();

    if (!reactFlowInstanceRef.current) return;

    const type = event.dataTransfer.getData('application/reactflow');
    if (!type) return;

    try {
      const dragData = JSON.parse(type);
      const rawPosition = reactFlowInstanceRef.current.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      let position;
      if (dragData.type === 'component') {
        position = {
          x: Math.round(rawPosition.x - 70),
          y: Math.round(rawPosition.y - 40),
        };
        onAddComponent(dragData.componentType, position);
      } else if (dragData.type === 'boundary') {
        position = {
          x: Math.round(rawPosition.x - 75),
          y: Math.round(rawPosition.y - 37.5),
        };
        onAddBoundary(position);
      }
    } catch (error) {
      console.error('Error parsing drag data:', error);
    }
  }, [onAddComponent, onAddBoundary, reactFlowInstanceRef]);

  // --- Effects ---

  // Global click outside canvas → deselect all + cancel data flow operations
  useEffect(() => {
    const handleGlobalClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (reactFlowWrapperRef.current && !reactFlowWrapperRef.current.contains(target)) {
        setNodes((currentNodes) => {
          const hasSelected = currentNodes.some((node) => node.selected);
          return hasSelected ? currentNodes.map((node) => node.selected ? { ...node, selected: false } : node) : currentNodes;
        });
        setEdges((currentEdges) => {
          const hasSelected = currentEdges.some((edge) => edge.selected);
          return hasSelected ? currentEdges.map((edge) => edge.selected ? { ...edge, selected: false } : edge) : currentEdges;
        });
        cancelCreation();
        cancelReconnection();
      }
    };

    document.addEventListener('mousedown', handleGlobalClick);
    return () => {
      document.removeEventListener('mousedown', handleGlobalClick);
    };
  }, [setNodes, setEdges, cancelCreation, cancelReconnection, reactFlowWrapperRef]);

  // Edge dragging visualization
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.react-flow__handle') || target.closest('svg')?.closest('.react-flow__edges')) {
        setIsDraggingEdge(true);
        document.addEventListener('mouseup', handleMouseUp);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingEdge(false);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setIsDraggingEdge]);

  // Update nodes with data flow creation/reconnection state
  useEffect(() => {
    setNodes((prevNodes) =>
      prevNodes.map((node) => {
        if (node.type === 'threatModelNode') {
          const shouldShowHandleFocus =
            (creationState.phase === 'source-handle' && node.id === creationState.sourceNodeId) ||
            (creationState.phase === 'target-handle' && node.id === creationState.targetNodeId) ||
            (reconnectionState.phase === 'source-handle' && node.id === reconnectionState.sourceNodeId) ||
            (reconnectionState.phase === 'target-handle' && node.id === reconnectionState.targetNodeId);

          const focusedHandleId = shouldShowHandleFocus
            ? (creationState.phase !== 'idle' ? creationState.focusedHandleId : reconnectionState.focusedHandleId)
            : null;

          const isInDataFlowCreation =
            (creationState.phase !== 'idle' && node.id === creationState.sourceNodeId) ||
            (reconnectionState.phase !== 'idle' && (node.id === reconnectionState.sourceNodeId || node.id === reconnectionState.targetNodeId));

          const isHandleSelectionMode = shouldShowHandleFocus;

          return {
            ...node,
            data: {
              ...node.data,
              focusedHandleId,
              isInDataFlowCreation,
              isHandleSelectionMode,
            },
          };
        }
        return node;
      })
    );
  }, [
    creationState.phase,
    creationState.sourceNodeId,
    creationState.targetNodeId,
    creationState.focusedHandleId,
    reconnectionState.phase,
    reconnectionState.sourceNodeId,
    reconnectionState.targetNodeId,
    reconnectionState.focusedHandleId,
    setNodes,
  ]);

  // --- JSX ---

  return (
    <div className="tab-panel-canvas">
      <CanvasToolbar
        onAddComponent={onAddComponent}
        onAddBoundary={onAddBoundary}
      />
      <div
        ref={reactFlowWrapperRef}
        className={`react-flow__container ${isDraggingEdge ? 'dragging-edge' : ''}`}
        onMouseMove={(event) => {
          mousePositionRef.current = { x: event.clientX, y: event.clientY };
        }}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <EdgeMarkers />
        <CanvasOverlay
          title={
            creationState.phase !== 'idle' ? 'Creating Data-Flow Connection' :
            reconnectionState.phase !== 'idle' ? 'Reconnecting Data-Flow' : ''
          }
          instruction={
            creationState.phase === 'source-handle' ? 'Select source handle' :
            creationState.phase === 'target-node' ? 'Select target node' :
            creationState.phase === 'target-handle' ? 'Select target handle' :
            reconnectionState.phase === 'source-node' ? 'Select source node' :
            reconnectionState.phase === 'source-handle' ? 'Select source handle' :
            reconnectionState.phase === 'target-node' ? 'Select target node' :
            reconnectionState.phase === 'target-handle' ? 'Select target handle' : ''
          }
          keybindings={[
            { keys: ['Esc'], label: 'Cancel' },
            { keys: ['⌫'], label: 'Back' },
            { keys: [], label: 'Navigate', isArrowKeys: true },
            { keys: ['↵'], label: 'Confirm' },
          ]}
          show={creationState.phase !== 'idle' || reconnectionState.phase !== 'idle'}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onSelectionDragStart={onSelectionDragStart}
          onSelectionDragStop={onSelectionDragStop}
          onSelectionStart={onSelectionStart}
          onSelectionEnd={onSelectionEnd}
          onPaneClick={onPaneClick}
          onConnect={onConnect}
          onReconnect={onReconnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={CustomConnectionLine}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          nodesDraggable={!isEditingMode}
          nodesFocusable={true}
          panOnDrag={!isEditingMode}
          panOnScroll={true}
          zoomOnDoubleClick={false}
          zIndexMode="manual"
          elevateNodesOnSelect={false}
          selectionOnDrag={!isEditingMode && !justExitedEditModeRef.current}
          selectionMode={SelectionMode.Partial}
          disableKeyboardA11y={true}
          multiSelectionKeyCode={['Meta', 'Control']}
          deleteKeyCode={creationState.phase === 'idle' && reconnectionState.phase === 'idle' ? ['Backspace', 'Delete'] : null}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
          }}
        >
          <Background gap={16} />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}));
