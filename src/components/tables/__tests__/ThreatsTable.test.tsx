import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderWithProviders as render, screen } from '../../../__tests__/test-utils';
import userEvent from '@testing-library/user-event';
import ThreatsTable from '../ThreatsTable';
import type { ThreatModel } from '../../../types/threatModel';

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  closestCenter: vi.fn(),
  KeyboardSensor: vi.fn(),
  PointerSensor: vi.fn(),
  useSensor: vi.fn(() => ({})),
  useSensors: vi.fn(() => []),
  DragOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  sortableKeyboardCoordinates: vi.fn(),
  verticalListSortingStrategy: vi.fn(),
  arrayMove: vi.fn((items: unknown[]) => items),
}));

vi.mock('../EditableCell', () => ({
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock('../EditableTextarea', () => ({
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

vi.mock('../EditableStatusPickerCell', () => ({
  default: () => <div>Status</div>,
}));

vi.mock('../SortableTableRow', () => ({
  default: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

vi.mock('../MultiPickerCell', () => ({
  default: ({ sections }: { sections: Array<{ label: string; value: string[]; onChange: (refs: string[]) => void; onCreateItem?: (name: string) => string | Promise<string> }> }) => {
    const controlsSection = sections.find((section) => section.label === 'Controls');

    if (!controlsSection) {
      return <div data-testid="multi-picker-cell" />;
    }

    return (
      <div data-testid="multi-picker-cell">
        <div data-testid="controls-value">{controlsSection.value.join(',')}</div>
        <button onClick={() => controlsSection.onChange(['control-added'])} type="button">
          replace-controls
        </button>
        <button onClick={() => controlsSection.onChange(['control-existing', 'control-added'])} type="button">
          keep-add-controls
        </button>
        <button onClick={() => controlsSection.onCreateItem?.('Created Control')} type="button">
          create-control
        </button>
      </div>
    );
  },
}));

const threatModel: ThreatModel = {
  schema_version: '1.0',
  name: 'Threat Model',
  components: [
    {
      ref: 'component-1',
      name: 'Component 1',
      component_type: 'internal',
    },
  ],
  assets: [],
  data_flows: [],
  threats: [
    {
      ref: 'threat-1',
      name: 'Threat 1',
      affected_components: [],
      affected_assets: [],
      affected_data_flows: [],
    },
  ],
  controls: [
    {
      ref: 'control-existing',
      name: 'Existing Control',
      mitigates: ['threat-1'],
    },
    {
      ref: 'control-added',
      name: 'Added Control',
    },
    {
      ref: 'control-unrelated',
      name: 'Unrelated Control',
      mitigates: ['threat-2'],
    },
  ],
};

describe('ThreatsTable', () => {
  const onThreatNameChange = vi.fn();
  const onThreatDescriptionChange = vi.fn();
  const onThreatAffectedComponentsChange = vi.fn();
  const onThreatAffectedDataFlowsChange = vi.fn();
  const onThreatAffectedAssetsChange = vi.fn();
  const onThreatStatusChange = vi.fn();
  const onThreatStatusLinkChange = vi.fn();
  const onThreatStatusNoteChange = vi.fn();
  const onControlMitigatesChange = vi.fn();
  const onCreateControl = vi.fn(() => 'control-created');
  const onRemoveThreat = vi.fn();
  const onAddThreat = vi.fn();
  const onReorderThreats = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderComponent = () =>
    render(
      <ThreatsTable
        threatModel={threatModel}
        onThreatNameChange={onThreatNameChange}
        onThreatDescriptionChange={onThreatDescriptionChange}
        onThreatAffectedComponentsChange={onThreatAffectedComponentsChange}
        onThreatAffectedDataFlowsChange={onThreatAffectedDataFlowsChange}
        onThreatAffectedAssetsChange={onThreatAffectedAssetsChange}
        onThreatStatusChange={onThreatStatusChange}
        onThreatStatusLinkChange={onThreatStatusLinkChange}
        onThreatStatusNoteChange={onThreatStatusNoteChange}
        onControlMitigatesChange={onControlMitigatesChange}
        onCreateControl={onCreateControl}
        onRemoveThreat={onRemoveThreat}
        onAddThreat={onAddThreat}
        onReorderThreats={onReorderThreats}
      />
    );

  it('derives currently related controls for the threat row', () => {
    renderComponent();

    expect(screen.getByTestId('controls-value')).toHaveTextContent('control-existing');
  });

  it('forwards control creation without immediately mutating mitigates', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: 'create-control' }));

    expect(onCreateControl).toHaveBeenCalledWith('Created Control');
    expect(onControlMitigatesChange).not.toHaveBeenCalled();
  });

  it('updates only changed control relationships from the threat row', async () => {
    const user = userEvent.setup();
    renderComponent();

    await user.click(screen.getByRole('button', { name: 'replace-controls' }));

    expect(onControlMitigatesChange).toHaveBeenCalledTimes(2);
    expect(onControlMitigatesChange).toHaveBeenCalledWith('control-existing', []);
    expect(onControlMitigatesChange).toHaveBeenCalledWith('control-added', ['threat-1']);
    expect(onControlMitigatesChange).not.toHaveBeenCalledWith('control-unrelated', expect.anything());
  });
});