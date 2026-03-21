import { useState, useCallback, useMemo } from 'react';
import { useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { NativeDragAwarePointerSensor } from '../components/canvas/NativeDragAwarePointerSensor';
import type { Tab } from './useTabLayout';

interface UseTabDragDropOptions {
  tabs: Tab[];
  tabWidths: number[];
  reorderTabs: (oldIndex: number, newIndex: number) => void;
}

export function useTabDragDrop({ tabs, tabWidths, reorderTabs }: UseTabDragDropOptions) {
  // dnd-kit: require 5px drag distance before starting to avoid accidental drags
  const dndSensors = useSensors(
    useSensor(NativeDragAwarePointerSensor, { activationConstraint: { distance: 5 } })
  );

  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const activeDragTab = activeDragId ? tabs.find((t) => t.id === activeDragId) : null;

  const dropIndicatorIndex = useMemo(() => {
    if (!activeDragId || !overId || activeDragId === overId) return -1;
    const activeIdx = tabs.findIndex((t) => t.id === activeDragId);
    const overIdx = tabs.findIndex((t) => t.id === overId);
    if (activeIdx === -1 || overIdx === -1) return -1;
    return activeIdx < overIdx ? overIdx + 1 : overIdx;
  }, [activeDragId, overId, tabs]);

  const dropIndicatorLeft = useMemo(() => {
    if (dropIndicatorIndex < 0) return null;
    let left = 0;
    for (let i = 0; i < dropIndicatorIndex && i < tabWidths.length; i++) {
      left += tabWidths[i];
    }
    return `${Math.min(left, 100)}%`;
  }, [dropIndicatorIndex, tabWidths]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    setOverId(event.over ? String(event.over.id) : null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      setOverId(null);
      const { active, over } = event;
      if (over && active.id !== over.id) {
        const oldIndex = tabs.findIndex((t) => t.id === active.id);
        const newIndex = tabs.findIndex((t) => t.id === over.id);
        if (oldIndex !== -1 && newIndex !== -1) {
          reorderTabs(oldIndex, newIndex);
        }
      }
    },
    [tabs, reorderTabs]
  );

  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
    setOverId(null);
  }, []);

  return {
    dndSensors,
    activeDragTab,
    dropIndicatorLeft,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDragCancel,
  };
}
