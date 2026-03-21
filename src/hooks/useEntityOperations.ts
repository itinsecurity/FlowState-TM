import { useCallback, useRef, type MutableRefObject } from 'react';
import { produce } from 'immer';
import type { ThreatModel, ComponentType, ComponentColor } from '../types/threatModel';
import { isComponentInsideBoundary } from '../utils/geometryHelpers';
import { findUnoccupiedPosition } from '../utils/navigationHelpers';
import { sortNodesByRenderOrder } from '../utils/flowTransformer';
import { updateYamlField, appendYamlItem, removeRefFromArrayFields, removeYamlItem } from '../utils/yamlParser';
import {
  generateComponentRef,
  generateBoundaryRef,
  generateAssetRef,
  generateThreatRef,
  generateControlRef,
  generateAssetName,
  generateThreatName,
  generateControlName,
  generateComponentName,
  generateBoundaryName,
} from '../utils/refGenerators';

export interface UseEntityOperationsOptions {
  threatModelRef: MutableRefObject<ThreatModel | null>;
  nodesRef: MutableRefObject<any[]>;
  edgesRef: MutableRefObject<any[]>;
  setThreatModel: (updater: ThreatModel | null | ((prev: ThreatModel | null) => ThreatModel | null)) => void;
  setNodes: (updater: any[] | ((prev: any[]) => any[])) => void;
  setEdges: (updater: any[] | ((prev: any[]) => any[])) => void;
  updateYaml: (updater: (content: string) => string) => void;
  recordState: () => void;
  /** Read via ref only — not used as a callback dependency to avoid cascading re-renders */
  isEditingMode: boolean;
  setIsEditingMode: (isEditing: boolean) => void;
  reactFlowInstanceRef: MutableRefObject<any>;
  reactFlowWrapperRef: MutableRefObject<HTMLDivElement | null>;
  handleComponentNameChange: (componentRef: string, newName: string) => void;
  handleComponentTypeChange: (componentRef: string, newType: ComponentType) => void;
  handleComponentColorChange: (componentRef: string, newColor: ComponentColor | undefined) => void;
  handleComponentDescriptionChange: (componentRef: string, newDescription: string) => void;
  handleComponentAssetsChange: (componentRef: string, newAssets: string[]) => void;
  handleBoundaryNameChange: (boundaryRef: string, newName: string) => void;
  handleBoundaryResizeEnd: (boundaryRef: string, width: number, height: number, x: number, y: number) => void;
}

export function useEntityOperations({
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
}: UseEntityOperationsOptions) {
  // Track when we exit edit mode to temporarily disable selection
  const justExitedEditModeRef = useRef(false);

  // Use a ref for isEditingMode so handleEditModeChange keeps a stable identity.
  // Without this, every isEditingMode toggle cascades through handleAddComponent →
  // handleAddBoundary → buildNodesAndEdges → full node re-render.
  const isEditingModeRef = useRef(isEditingMode);
  isEditingModeRef.current = isEditingMode;

  const handleEditModeChange = useCallback((isEditing: boolean) => {
    if (!isEditing && isEditingModeRef.current) {
      justExitedEditModeRef.current = true;
      setTimeout(() => {
        justExitedEditModeRef.current = false;
      }, 100);
    }
    setIsEditingMode(isEditing);
  }, [setIsEditingMode]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setNodes((prevNodes: any[]) =>
      prevNodes.map((node: any) => ({
        ...node,
        selected: node.id === nodeId,
      }))
    );
  }, [setNodes]);

  // ── Asset operations ─────────────────────────────────────────────

  const handleAddAsset = useCallback((): void => {
    const ref = generateAssetRef(threatModelRef.current);
    const newAsset = {
      ref,
      name: generateAssetName(ref),
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.assets) {
          draft.assets = [];
        }
        draft.assets.push(newAsset);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'assets', newAsset));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  const handleCreateAsset = useCallback((name: string): string => {
    const ref = generateAssetRef(threatModelRef.current);
    const newAsset = {
      ref,
      name: name.trim(),
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.assets) {
          draft.assets = [];
        }
        draft.assets.push(newAsset);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'assets', newAsset));

    setTimeout(() => {
      recordState();
    }, 0);

    return ref;
  }, [updateYaml, recordState]);

  const handleRemoveAsset = useCallback((assetRef: string): void => {
    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;

        if (draft.assets) {
          draft.assets = draft.assets.filter((a) => a.ref !== assetRef);
        }

        draft.components.forEach((c) => {
          if (c.assets) {
            c.assets = c.assets.filter((a) => a !== assetRef);
          }
        });

        draft.threats?.forEach((t) => {
          if (t.affected_assets) {
            t.affected_assets = t.affected_assets.filter((a) => a !== assetRef);
          }
        });
      })
    );

    updateYaml((content) => {
      let updated = removeYamlItem(content, 'assets', assetRef);
      updated = removeRefFromArrayFields(updated, assetRef, ['assets', 'affected_assets']);
      return updated;
    });

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  // ── Threat operations ────────────────────────────────────────────

  const handleAddThreat = useCallback((): void => {
    const ref = generateThreatRef(threatModelRef.current);
    const newThreat = {
      ref,
      name: generateThreatName(ref),
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.threats) {
          draft.threats = [];
        }
        draft.threats.push(newThreat);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'threats', newThreat));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  const handleRemoveThreat = useCallback((threatRef: string): void => {
    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;

        if (draft.threats) {
          draft.threats = draft.threats.filter((t) => t.ref !== threatRef);
        }

        draft.controls?.forEach((c) => {
          if (c.mitigates) {
            c.mitigates = c.mitigates.filter((m) => m !== threatRef);
          }
        });
      })
    );

    updateYaml((content) => {
      let updated = removeYamlItem(content, 'threats', threatRef);
      updated = removeRefFromArrayFields(updated, threatRef, ['mitigates']);
      return updated;
    });

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  // ── Control operations ───────────────────────────────────────────

  const handleCreateControl = useCallback((name: string): string => {
    const ref = generateControlRef(threatModelRef.current);
    const newControl = {
      ref,
      name: name.trim(),
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.controls) {
          draft.controls = [];
        }
        draft.controls.push(newControl);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'controls', newControl));

    setTimeout(() => {
      recordState();
    }, 0);

    return ref;
  }, [updateYaml, recordState]);

  const handleAddControl = useCallback((): void => {
    const ref = generateControlRef(threatModelRef.current);
    const newControl = {
      ref,
      name: generateControlName(ref),
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.controls) {
          draft.controls = [];
        }
        draft.controls.push(newControl);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'controls', newControl));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  const handleRemoveControl = useCallback((controlRef: string): void => {
    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft || !draft.controls) return;
        draft.controls = draft.controls.filter((c) => c.ref !== controlRef);
      })
    );

    updateYaml((content) => removeYamlItem(content, 'controls', controlRef));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, recordState]);

  // ── Data flow operations ─────────────────────────────────────────

  const handleRemoveDataFlow = useCallback((dataFlowRef: string): void => {
    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;

        if (draft.data_flows) {
          draft.data_flows = draft.data_flows.filter((df) => df.ref !== dataFlowRef);
        }

        draft.threats?.forEach((t) => {
          if (t.affected_data_flows) {
            t.affected_data_flows = t.affected_data_flows.filter((df) => df !== dataFlowRef);
          }
        });
      })
    );

    updateYaml((content) => {
      let updated = removeYamlItem(content, 'data_flows', dataFlowRef);
      updated = removeRefFromArrayFields(updated, dataFlowRef, ['affected_data_flows']);
      return updated;
    });

    setEdges((prevEdges: any[]) => prevEdges.filter((e: any) => e.id !== dataFlowRef));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, setEdges, recordState]);

  // ── Component operations ─────────────────────────────────────────

  const handleAddComponent = useCallback((componentType: ComponentType, position?: { x: number; y: number }): void => {
    const ref = generateComponentRef(threatModelRef.current);
    const name = generateComponentName(ref);

    let x: number, y: number;
    if (position) {
      x = position.x;
      y = position.y;
    } else {
      if (reactFlowInstanceRef.current && reactFlowWrapperRef.current) {
        const bounds = reactFlowWrapperRef.current.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;

        const flowCenter = reactFlowInstanceRef.current.screenToFlowPosition({
          x: centerX,
          y: centerY,
        });

        const targetX = Math.round(flowCenter.x - 70);
        const targetY = Math.round(flowCenter.y - 40);

        const unoccupiedPos = findUnoccupiedPosition(targetX, targetY, nodesRef.current, 140, 80);
        x = unoccupiedPos.x;
        y = unoccupiedPos.y;
      } else {
        x = 0;
        y = 0;
      }
    }

    const newComponent = {
      ref,
      name,
      component_type: componentType,
      x,
      y,
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        draft.components.push(newComponent);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'components', newComponent));

    const newNode = {
      id: ref,
      type: 'threatModelNode',
      position: { x, y },
      selected: true,
      data: {
        label: name,
        ref,
        description: undefined,
        componentType: componentType,
        color: undefined,
        assets: [],
        availableAssets: threatModelRef.current?.assets?.map(a => ({ ref: a.ref, name: a.name })) || [],
        initialEditMode: true,
        onNameChange: (newName: string) => handleComponentNameChange(ref, newName),
        onEditModeChange: handleEditModeChange,
        onTypeChange: (newType: ComponentType) => handleComponentTypeChange(ref, newType),
        onColorChange: (newColor: ComponentColor | undefined) => handleComponentColorChange(ref, newColor),
        onDescriptionChange: (newDescription: string) => handleComponentDescriptionChange(ref, newDescription),
        onAssetsChange: (newAssets: string[]) => handleComponentAssetsChange(ref, newAssets),
        onCreateAsset: handleCreateAsset,
        onSelectNode: () => handleSelectNode(ref),
      },
    };

    setNodes((prevNodes: any[]) => [
      ...prevNodes.map((n: any) => n.selected ? { ...n, selected: false } : n),
      newNode
    ]);

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, handleComponentNameChange, handleEditModeChange, handleComponentTypeChange, handleComponentColorChange, handleComponentDescriptionChange, handleComponentAssetsChange, handleCreateAsset, handleSelectNode, recordState]);

  const handleRemoveComponent = useCallback((componentRef: string): void => {
    const connectedEdgeIds = edgesRef.current
      .filter((e: any) => e.source === componentRef || e.target === componentRef)
      .map((e: any) => e.id);

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;

        draft.components = draft.components.filter((c) => c.ref !== componentRef);

        if (draft.data_flows) {
          draft.data_flows = draft.data_flows.filter((df) => !connectedEdgeIds.includes(df.ref));
        }

        draft.boundaries?.forEach((b) => {
          if (b.components) {
            b.components = b.components.filter((c) => c !== componentRef);
          }
        });

        draft.threats?.forEach((t) => {
          if (t.affected_components) {
            t.affected_components = t.affected_components.filter((c) => c !== componentRef);
          }
          if (t.affected_data_flows) {
            t.affected_data_flows = t.affected_data_flows.filter((df) => !connectedEdgeIds.includes(df));
          }
        });

        draft.controls?.forEach((c) => {
          if (c.implemented_in) {
            c.implemented_in = c.implemented_in.filter((comp) => comp !== componentRef);
          }
        });
      })
    );

    updateYaml((content) => {
      let updated = removeYamlItem(content, 'components', componentRef);
      updated = removeRefFromArrayFields(updated, componentRef, [
        'components',
        'affected_components',
        'implemented_in',
      ]);
      for (const edgeId of connectedEdgeIds) {
        updated = removeYamlItem(updated, 'data_flows', edgeId);
        updated = removeRefFromArrayFields(updated, edgeId, ['affected_data_flows']);
      }
      return updated;
    });

    setNodes((prevNodes: any[]) => prevNodes.filter((n: any) => n.id !== componentRef));
    setEdges((prevEdges: any[]) => prevEdges.filter((e: any) => e.source !== componentRef && e.target !== componentRef));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, setNodes, setEdges, recordState]);

  // ── Boundary operations ──────────────────────────────────────────

  const handleAddBoundary = useCallback((position?: { x: number; y: number }): void => {
    const ref = generateBoundaryRef(threatModelRef.current);
    const name = generateBoundaryName(ref);

    let x: number, y: number;
    if (position && !isNaN(position.x) && !isNaN(position.y)) {
      x = position.x;
      y = position.y;
    } else {
      if (reactFlowInstanceRef.current && reactFlowWrapperRef.current) {
        const bounds = reactFlowWrapperRef.current.getBoundingClientRect();
        const centerX = bounds.left + bounds.width / 2;
        const centerY = bounds.top + bounds.height / 2;

        const flowCenter = reactFlowInstanceRef.current.screenToFlowPosition({
          x: centerX,
          y: centerY,
        });

        const targetX = Math.round(flowCenter.x - 75);
        const targetY = Math.round(flowCenter.y - 37.5);

        const unoccupiedPos = findUnoccupiedPosition(targetX, targetY, nodesRef.current, 150, 75);
        x = unoccupiedPos.x;
        y = unoccupiedPos.y;
      } else {
        x = 0;
        y = 0;
      }
    }

    const width = 150;
    const height = 75;

    const newBoundary = {
      ref,
      name,
      x,
      y,
      width,
      height,
    };

    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft) return;
        if (!draft.boundaries) {
          draft.boundaries = [];
        }
        draft.boundaries.push(newBoundary);
      })
    );

    updateYaml((content) => appendYamlItem(content, 'boundaries', newBoundary));

    const newNode = {
      id: ref,
      type: 'boundaryNode',
      position: { x, y },
      selectable: true,
      style: {
        width,
        height,
      },
      data: {
        label: name,
        description: undefined,
        onNameChange: (newName: string) => handleBoundaryNameChange(ref, newName),
        onEditModeChange: handleEditModeChange,
        onResizeEnd: (w: number, h: number, bx: number, by: number) => handleBoundaryResizeEnd(ref, w, h, bx, by),
      },
    };

    setNodes((prevNodes: any[]) => sortNodesByRenderOrder([...prevNodes, newNode]));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, handleEditModeChange, handleBoundaryNameChange, handleBoundaryResizeEnd, recordState]);

  const handleRemoveBoundary = useCallback((boundaryRef: string): void => {
    setThreatModel(
      produce((draft: ThreatModel | null) => {
        if (!draft || !draft.boundaries) return;
        draft.boundaries = draft.boundaries.filter((b) => b.ref !== boundaryRef);
      })
    );

    updateYaml((content) => removeYamlItem(content, 'boundaries', boundaryRef));

    setNodes((prevNodes: any[]) => prevNodes.filter((n: any) => n.id !== boundaryRef));

    setTimeout(() => {
      recordState();
    }, 0);
  }, [updateYaml, setNodes, recordState]);

  const updateBoundaryMemberships = useCallback(
    (currentNodes: any[]) => {
      if (!threatModelRef.current) return;

      const boundaryNodes = currentNodes.filter((n: any) => n.type === 'boundaryNode');
      const componentNodes = currentNodes.filter((n: any) => n.type === 'threatModelNode');

      const boundaryMemberships = new Map<string, Set<string>>();

      boundaryNodes.forEach((boundaryNode: any) => {
        const containedComponents = new Set<string>();

        componentNodes.forEach((componentNode: any) => {
          if (isComponentInsideBoundary(componentNode, boundaryNode)) {
            containedComponents.add(componentNode.id);
          }
        });

        boundaryMemberships.set(boundaryNode.id, containedComponents);
      });

      setThreatModel(
        produce((draft: ThreatModel | null) => {
          if (!draft) return;

          draft.boundaries?.forEach((boundary) => {
            const newMembers = boundaryMemberships.get(boundary.ref);
            const components = newMembers ? Array.from(newMembers) : [];

            const boundaryNode = boundaryNodes.find((n: any) => n.id === boundary.ref);
            if (boundaryNode) {
              boundary.x = boundaryNode.position.x;
              boundary.y = boundaryNode.position.y;
              boundary.width = boundaryNode.measured?.width ?? boundaryNode.width ?? boundaryNode.style?.width ?? boundary.width;
              boundary.height = boundaryNode.measured?.height ?? boundaryNode.height ?? boundaryNode.style?.height ?? boundary.height;
            }

            boundary.components = components.length > 0 ? components : undefined;
          });
        })
      );

      updateYaml((content) => {
        let updated = content;
        boundaryMemberships.forEach((members, boundaryRef) => {
          const components = Array.from(members);
          updated = updateYamlField(updated, 'boundaries', boundaryRef, 'components', components.length > 0 ? components : undefined);
        });
        return updated;
      });
    },
    [updateYaml]
  );

  return {
    // Edit mode / selection
    handleEditModeChange,
    handleSelectNode,
    justExitedEditModeRef,
    // Assets
    handleAddAsset,
    handleCreateAsset,
    handleRemoveAsset,
    // Threats
    handleAddThreat,
    handleRemoveThreat,
    // Controls
    handleCreateControl,
    handleAddControl,
    handleRemoveControl,
    // Data flows
    handleRemoveDataFlow,
    // Components
    handleAddComponent,
    handleRemoveComponent,
    // Boundaries
    handleAddBoundary,
    handleRemoveBoundary,
    updateBoundaryMemberships,
  };
}
