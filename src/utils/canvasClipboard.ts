import type { ComponentColor } from '../types/threatModel';

export const CANVAS_CLIPBOARD_VERSION = 1;

export interface CanvasClipboardPosition {
  x: number;
  y: number;
}

export interface CanvasClipboardAssetReference {
  ref: string;
  name?: string;
}

export interface CanvasClipboardComponent {
  kind: 'component';
  ref: string;
  name: string;
  description?: string;
  componentType: 'internal' | 'external' | 'data_store';
  color?: ComponentColor;
  assets?: CanvasClipboardAssetReference[];
  position: CanvasClipboardPosition;
}

export interface CanvasClipboardBoundary {
  kind: 'boundary';
  ref: string;
  name: string;
  description?: string;
  width: number;
  height: number;
  position: CanvasClipboardPosition;
}

export interface CanvasClipboardDataFlow {
  sourceRef: string;
  targetRef: string;
  label?: string;
  direction?: 'unidirectional' | 'bidirectional';
  sourcePoint?: string;
  targetPoint?: string;
}

export type CanvasClipboardNode = CanvasClipboardComponent | CanvasClipboardBoundary;

export interface CanvasClipboardPayload {
  type: 'flowstate/canvas-nodes';
  version: number;
  copyId: string;
  nodes: CanvasClipboardNode[];
  dataFlows?: CanvasClipboardDataFlow[];
}

export interface CanvasClipboardAssetLookup {
  ref: string;
  name: string;
}

export interface ResolvedCanvasClipboardAssets {
  assetRefs: string[];
  droppedAssets: CanvasClipboardAssetReference[];
}

export function serializeCanvasClipboardPayload(payload: CanvasClipboardPayload): string {
  return JSON.stringify(payload);
}

export function parseCanvasClipboardPayload(value: string): CanvasClipboardPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<CanvasClipboardPayload>;

    if (
      parsed?.type !== 'flowstate/canvas-nodes' ||
      parsed.version !== CANVAS_CLIPBOARD_VERSION ||
      typeof parsed.copyId !== 'string' ||
      !Array.isArray(parsed.nodes)
    ) {
      return null;
    }

    const nodes = parsed.nodes.filter(isCanvasClipboardNode);
    if (nodes.length !== parsed.nodes.length) {
      return null;
    }

    return {
      type: parsed.type,
      version: parsed.version,
      copyId: parsed.copyId,
      nodes,
      dataFlows:
        parsed.dataFlows === undefined
          ? undefined
          : Array.isArray(parsed.dataFlows) && parsed.dataFlows.every(isCanvasClipboardDataFlow)
            ? parsed.dataFlows
            : undefined,
    };
  } catch {
    return null;
  }
}

export function resolveCanvasClipboardAssets(
  assetReferences: CanvasClipboardAssetReference[] | undefined,
  availableAssets: CanvasClipboardAssetLookup[],
): ResolvedCanvasClipboardAssets {
  if (!assetReferences || assetReferences.length === 0) {
    return {
      assetRefs: [],
      droppedAssets: [],
    };
  }

  const availableByName = new Map<string, CanvasClipboardAssetLookup[]>();

  availableAssets.forEach((asset) => {
    const matches = availableByName.get(asset.name) || [];
    matches.push(asset);
    availableByName.set(asset.name, matches);
  });

  const assetRefs: string[] = [];
  const droppedAssets: CanvasClipboardAssetReference[] = [];

  assetReferences.forEach((assetReference) => {
    if (assetReference.name) {
      const byName = availableByName.get(assetReference.name);
      if (byName?.length) {
        assetRefs.push(byName[0].ref);
        return;
      }
    }

    droppedAssets.push(assetReference);
  });

  return {
    assetRefs: Array.from(new Set(assetRefs)),
    droppedAssets,
  };
}

function isCanvasClipboardDataFlow(value: unknown): value is CanvasClipboardDataFlow {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CanvasClipboardDataFlow>;

  return (
    typeof candidate.sourceRef === 'string' &&
    typeof candidate.targetRef === 'string' &&
    (candidate.label === undefined || typeof candidate.label === 'string') &&
    (candidate.direction === undefined ||
      candidate.direction === 'unidirectional' ||
      candidate.direction === 'bidirectional') &&
    (candidate.sourcePoint === undefined || typeof candidate.sourcePoint === 'string') &&
    (candidate.targetPoint === undefined || typeof candidate.targetPoint === 'string')
  );
}

function isCanvasClipboardNode(value: unknown): value is CanvasClipboardNode {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<CanvasClipboardNode> & {
    position?: Partial<CanvasClipboardPosition>;
  };

  if (
    !candidate.position ||
    typeof candidate.position.x !== 'number' ||
    typeof candidate.position.y !== 'number' ||
    typeof candidate.ref !== 'string' ||
    typeof candidate.name !== 'string'
  ) {
    return false;
  }

  if (candidate.kind === 'component') {
    return (
      (candidate.componentType === 'internal' ||
        candidate.componentType === 'external' ||
        candidate.componentType === 'data_store') &&
      (candidate.color === undefined ||
        candidate.color === 'yellow' ||
        candidate.color === 'blue' ||
        candidate.color === 'green' ||
        candidate.color === 'red' ||
        candidate.color === 'orange' ||
        candidate.color === 'purple') &&
      (candidate.assets === undefined ||
        (Array.isArray(candidate.assets) &&
          candidate.assets.every(
            (asset) =>
              !!asset &&
              typeof asset === 'object' &&
              typeof (asset as CanvasClipboardAssetReference).ref === 'string' &&
              (((asset as CanvasClipboardAssetReference).name === undefined) ||
                typeof (asset as CanvasClipboardAssetReference).name === 'string'),
          )))
    );
  }

  if (candidate.kind === 'boundary') {
    return typeof candidate.width === 'number' && typeof candidate.height === 'number';
  }

  return false;
}
