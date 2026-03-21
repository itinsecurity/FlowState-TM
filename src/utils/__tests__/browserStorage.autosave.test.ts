/**
 * Unit tests for multi-tab safe autosave draft functions in browserStorage.ts
 *
 * These tests use idb-keyval's in-memory store equivalent — we mock the
 * idb-keyval module with a simple Map-backed implementation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory store that replaces IndexedDB for testing
const store = new Map<string, unknown>();

vi.mock('idb-keyval', () => ({
  get: vi.fn((key: string) => Promise.resolve(store.get(key))),
  set: vi.fn((key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve();
  }),
  del: vi.fn((key: string) => {
    store.delete(key);
    return Promise.resolve();
  }),
  entries: vi.fn(() => Promise.resolve([...store.entries()])),
  clear: vi.fn(() => {
    store.clear();
    return Promise.resolve();
  }),
}));

import {
  generateDraftKey,
  getOrCreateSessionDraftKey,
  saveAutoSaveDraft,
  getAutoSaveDraft,
  clearAutoSaveDraft,
  getAllAutoSaveDrafts,
  pruneAutoSaveDrafts,
  migrateSingletonDraft,
} from '../browserStorage';
import type { AutoSaveDraft } from '../browserStorage';

beforeEach(() => {
  store.clear();
  sessionStorage.clear();
});

describe('getOrCreateSessionDraftKey', () => {
  it('generates and stores a key in sessionStorage on first call', () => {
    const key = getOrCreateSessionDraftKey();
    expect(key).toMatch(/^autosave-draft-/);
    expect(sessionStorage.getItem('flowstate-draft-key')).toBe(key);
  });

  it('returns the same key on subsequent calls (same tab)', () => {
    const key1 = getOrCreateSessionDraftKey();
    const key2 = getOrCreateSessionDraftKey();
    expect(key1).toBe(key2);
  });

  it('returns a different key after sessionStorage is cleared (simulates new tab)', () => {
    const key1 = getOrCreateSessionDraftKey();
    sessionStorage.clear();
    const key2 = getOrCreateSessionDraftKey();
    expect(key1).not.toBe(key2);
  });
});

describe('generateDraftKey', () => {
  it('returns a string starting with the autosave prefix', () => {
    const key = generateDraftKey();
    expect(key).toMatch(/^autosave-draft-/);
  });

  it('generates unique keys on each call', () => {
    const keys = new Set(Array.from({ length: 20 }, () => generateDraftKey()));
    expect(keys.size).toBe(20);
  });
});

describe('saveAutoSaveDraft / getAutoSaveDraft', () => {
  it('saves and retrieves a draft by key', async () => {
    const key = 'autosave-draft-abc123';
    await saveAutoSaveDraft(key, 'My Model', 'name: My Model');
    const draft = await getAutoSaveDraft(key);

    expect(draft).not.toBeNull();
    expect(draft!.name).toBe('My Model');
    expect(draft!.content).toBe('name: My Model');
    expect(draft!.savedAt).toBeGreaterThan(0);
  });

  it('returns null for a non-existent key', async () => {
    const draft = await getAutoSaveDraft('autosave-draft-nonexistent');
    expect(draft).toBeNull();
  });

  it('stores optional metadata fields', async () => {
    const key = 'autosave-draft-meta';
    await saveAutoSaveDraft(
      key,
      'Test',
      'content',
      { owner: 'o', repository: 'r', branch: 'b', path: 'p', sha: 's', loadedAt: 1, domain: 'github.com' },
      { type: 'browser', modelId: 'threat-model-123', modelName: 'Test' },
      12345,
      true
    );

    const draft = await getAutoSaveDraft(key);
    expect(draft!.githubMetadata).toBeDefined();
    expect(draft!.saveSource?.type).toBe('browser');
    expect(draft!.lastSavedToSourceAt).toBe(12345);
    expect(draft!.isDirty).toBe(true);
  });
});

describe('clearAutoSaveDraft', () => {
  it('removes a specific draft', async () => {
    const key = 'autosave-draft-to-delete';
    await saveAutoSaveDraft(key, 'doomed', 'content');
    expect(await getAutoSaveDraft(key)).not.toBeNull();

    await clearAutoSaveDraft(key);
    expect(await getAutoSaveDraft(key)).toBeNull();
  });

  it('does not affect other drafts', async () => {
    const key1 = 'autosave-draft-keep';
    const key2 = 'autosave-draft-remove';
    await saveAutoSaveDraft(key1, 'keep', 'c1');
    await saveAutoSaveDraft(key2, 'remove', 'c2');

    await clearAutoSaveDraft(key2);
    expect(await getAutoSaveDraft(key1)).not.toBeNull();
    expect(await getAutoSaveDraft(key2)).toBeNull();
  });
});

describe('getAllAutoSaveDrafts', () => {
  it('returns an empty array when no drafts exist', async () => {
    const drafts = await getAllAutoSaveDrafts();
    expect(drafts).toEqual([]);
  });

  it('returns only draft entries (ignores other keys)', async () => {
    // Non-draft entries
    store.set('threat-model-1234', { id: 'threat-model-1234', name: 'Saved', content: '', savedAt: 100 });
    store.set('local-file-handle', 'handle');

    // Draft entries
    await saveAutoSaveDraft('autosave-draft-a', 'A', 'content-a');
    await saveAutoSaveDraft('autosave-draft-b', 'B', 'content-b');

    const drafts = await getAllAutoSaveDrafts();
    expect(drafts).toHaveLength(2);
    expect(drafts.every(d => d.key.startsWith('autosave-draft-'))).toBe(true);
  });

  it('returns drafts sorted newest-first', async () => {
    // Manually set drafts with explicit savedAt timestamps
    store.set('autosave-draft-old', { name: 'Old', content: '', savedAt: 1000 } satisfies AutoSaveDraft);
    store.set('autosave-draft-mid', { name: 'Mid', content: '', savedAt: 2000 } satisfies AutoSaveDraft);
    store.set('autosave-draft-new', { name: 'New', content: '', savedAt: 3000 } satisfies AutoSaveDraft);

    const drafts = await getAllAutoSaveDrafts();
    expect(drafts[0].draft.name).toBe('New');
    expect(drafts[1].draft.name).toBe('Mid');
    expect(drafts[2].draft.name).toBe('Old');
  });

  it('includes the legacy singleton key if present', async () => {
    store.set('autosave-draft', { name: 'Legacy', content: 'legacy', savedAt: 500 } satisfies AutoSaveDraft);
    await saveAutoSaveDraft('autosave-draft-new', 'New', 'new');

    const drafts = await getAllAutoSaveDrafts();
    expect(drafts).toHaveLength(2);
    const keys = drafts.map(d => d.key);
    expect(keys).toContain('autosave-draft');
    expect(keys).toContain('autosave-draft-new');
  });
});

describe('pruneAutoSaveDrafts', () => {
  it('does nothing when draft count is within limit', async () => {
    await saveAutoSaveDraft('autosave-draft-1', '1', 'c');
    await saveAutoSaveDraft('autosave-draft-2', '2', 'c');

    await pruneAutoSaveDrafts(10);
    const drafts = await getAllAutoSaveDrafts();
    expect(drafts).toHaveLength(2);
  });

  it('removes oldest drafts beyond the limit', async () => {
    // Create 5 drafts with explicit timestamps
    for (let i = 1; i <= 5; i++) {
      store.set(`autosave-draft-${i}`, { name: `D${i}`, content: '', savedAt: i * 1000 } satisfies AutoSaveDraft);
    }

    await pruneAutoSaveDrafts(3);
    const remaining = await getAllAutoSaveDrafts();
    expect(remaining).toHaveLength(3);
    // Should keep the 3 newest (savedAt 5000, 4000, 3000)
    const names = remaining.map(d => d.draft.name);
    expect(names).toContain('D5');
    expect(names).toContain('D4');
    expect(names).toContain('D3');
    expect(names).not.toContain('D1');
    expect(names).not.toContain('D2');
  });
});

describe('migrateSingletonDraft', () => {
  it('returns null when no legacy draft exists', async () => {
    const result = await migrateSingletonDraft();
    expect(result).toBeNull();
  });

  it('migrates legacy singleton to a prefixed key and deletes the old key', async () => {
    const legacyDraft: AutoSaveDraft = { name: 'Legacy', content: 'yaml', savedAt: 9999 };
    store.set('autosave-draft', legacyDraft);

    const newKey = await migrateSingletonDraft();
    expect(newKey).toBe('autosave-draft-migrated');

    // Old key should be gone
    expect(store.has('autosave-draft')).toBe(false);
    // New key should have the draft
    expect(store.get('autosave-draft-migrated')).toEqual(legacyDraft);
  });

  it('is idempotent (no-op on second call)', async () => {
    store.set('autosave-draft', { name: 'L', content: '', savedAt: 1 } satisfies AutoSaveDraft);
    await migrateSingletonDraft();
    // Now the old key is gone — calling again should be a no-op
    const result = await migrateSingletonDraft();
    expect(result).toBeNull();
  });
});

describe('multi-tab isolation', () => {
  it('two different draft keys do not interfere with each other', async () => {
    const key1 = 'autosave-draft-tab1';
    const key2 = 'autosave-draft-tab2';

    await saveAutoSaveDraft(key1, 'Model A', 'content-a');
    await saveAutoSaveDraft(key2, 'Model B', 'content-b');

    const draftA = await getAutoSaveDraft(key1);
    const draftB = await getAutoSaveDraft(key2);

    expect(draftA!.name).toBe('Model A');
    expect(draftB!.name).toBe('Model B');

    // Overwrite one — the other is untouched
    await saveAutoSaveDraft(key1, 'Model A v2', 'content-a-v2');
    expect((await getAutoSaveDraft(key1))!.name).toBe('Model A v2');
    expect((await getAutoSaveDraft(key2))!.name).toBe('Model B');
  });
});
