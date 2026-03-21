import { describe, expect, it } from 'vitest';
import { parseCanvasClipboardPayload, resolveCanvasClipboardAssets } from '../canvasClipboard';

describe('canvasClipboard', () => {
  describe('parseCanvasClipboardPayload', () => {
    it('accepts component asset references and internal data flows', () => {
      const payload = parseCanvasClipboardPayload(
        JSON.stringify({
          type: 'flowstate/canvas-nodes',
          version: 1,
          copyId: 'copy-1',
          nodes: [
            {
              kind: 'component',
              ref: 'component-1',
              name: 'API',
              componentType: 'internal',
              assets: [{ ref: 'A01', name: 'Customer data' }],
              position: { x: 10, y: 20 },
            },
            {
              kind: 'component',
              ref: 'component-2',
              name: 'DB',
              componentType: 'data_store',
              position: { x: 110, y: 20 },
            },
          ],
          dataFlows: [
            {
              sourceRef: 'component-1',
              targetRef: 'component-2',
              label: 'DF1',
              direction: 'unidirectional',
              sourcePoint: 'right',
              targetPoint: 'left',
            },
          ],
        }),
      );

      expect(payload?.nodes[0]).toMatchObject({
        kind: 'component',
        ref: 'component-1',
        assets: [{ ref: 'A01', name: 'Customer data' }],
      });
      expect(payload?.dataFlows).toEqual([
        {
          sourceRef: 'component-1',
          targetRef: 'component-2',
          label: 'DF1',
          direction: 'unidirectional',
          sourcePoint: 'right',
          targetPoint: 'left',
        },
      ]);
    });
  });

  describe('resolveCanvasClipboardAssets', () => {
    it('drops ref-only matches when the asset name does not match', () => {
      const result = resolveCanvasClipboardAssets(
        [{ ref: 'A01', name: 'Customer data' }],
        [{ ref: 'A01', name: 'Payment token' }],
      );

      expect(result).toEqual({
        assetRefs: [],
        droppedAssets: [{ ref: 'A01', name: 'Customer data' }],
      });
    });

    it('falls back to matching by asset name across models', () => {
      const result = resolveCanvasClipboardAssets(
        [{ ref: 'A01', name: 'Customer data' }],
        [{ ref: 'A99', name: 'Customer data' }],
      );

      expect(result).toEqual({
        assetRefs: ['A99'],
        droppedAssets: [],
      });
    });

    it('drops missing asset references when they cannot be mapped', () => {
      const result = resolveCanvasClipboardAssets(
        [{ ref: 'A01', name: 'Customer data' }],
        [{ ref: 'A99', name: 'Payment token' }],
      );

      expect(result).toEqual({
        assetRefs: [],
        droppedAssets: [{ ref: 'A01', name: 'Customer data' }],
      });
    });

    it('drops assets with no copied name because name is required for safe matching', () => {
      const result = resolveCanvasClipboardAssets(
        [{ ref: 'A01' }],
        [{ ref: 'A01', name: 'Customer data' }],
      );

      expect(result).toEqual({
        assetRefs: [],
        droppedAssets: [{ ref: 'A01' }],
      });
    });
  });
});
