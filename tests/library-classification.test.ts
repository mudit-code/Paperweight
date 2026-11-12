import { describe, it, expect, afterEach } from 'vitest';
import {
  saveLibraryAssets,
  getLibraryAssets,
  deleteLibraryAssets,
  mapToolToLibraryCategory,
} from '../src/core/library/library-db';

describe('Library Drafts & Recently Processed Classification', () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length > 0) {
      await deleteLibraryAssets(createdIds);
      createdIds.length = 0;
    }
  });

  it('maps each tool ID to one of the four Library categories', () => {
    expect(mapToolToLibraryCategory('image-resizer')).toBe('compression');
    expect(mapToolToLibraryCategory('converter')).toBe('conversion');
    expect(mapToolToLibraryCategory('image-to-pdf')).toBe('conversion');
    expect(mapToolToLibraryCategory('pdf-to-image')).toBe('conversion');
    expect(mapToolToLibraryCategory('pdf-merge')).toBe('merges');
    expect(mapToolToLibraryCategory('resizer')).toBe('resizes');
  });

  it('stores and restores in-process drafts with full snapshot and section/category metadata', async () => {
    const sampleBuf1 = new Uint8Array([1, 2, 3, 4]).buffer;
    const sampleBuf2 = new Uint8Array([5, 6, 7, 8]).buffer;

    const saved = await saveLibraryAssets([
      {
        name: 'doc1.pdf (+1 more)',
        type: 'application/pdf',
        size: 8,
        data: sampleBuf1,
        section: 'drafts',
        category: 'merges',
        thumbnailUrl: 'data:image/jpeg;base64,test',
        draftSnapshot: {
          toolId: 'pdf-merge',
          options: { stripMetadata: true },
          files: [
            { id: 'f1', name: 'doc1.pdf', type: 'application/pdf', size: 4, lastModified: 1000, data: sampleBuf1 },
            { id: 'f2', name: 'doc2.pdf', type: 'application/pdf', size: 4, lastModified: 1001, data: sampleBuf2 },
          ],
        },
      },
      {
        name: 'photo_compressed.jpg',
        type: 'image/jpeg',
        size: 4,
        data: sampleBuf1,
        section: 'recent',
        category: 'compression',
        thumbnailUrl: 'data:image/jpeg;base64,thumb',
      },
    ]);

    saved.forEach((s) => createdIds.push(s.id));

    const assets = await getLibraryAssets();
    const draft = assets.find((a) => a.id === saved[0].id);
    const recent = assets.find((a) => a.id === saved[1].id);

    expect(draft).toBeDefined();
    expect(draft?.section).toBe('drafts');
    expect(draft?.category).toBe('merges');
    expect(draft?.draftSnapshot?.toolId).toBe('pdf-merge');
    expect(draft?.draftSnapshot?.files).toHaveLength(2);
    expect(draft?.draftSnapshot?.files[1].name).toBe('doc2.pdf');

    expect(recent).toBeDefined();
    expect(recent?.section).toBe('recent');
    expect(recent?.category).toBe('compression');
    expect(recent?.draftSnapshot).toBeUndefined();
  });
});
