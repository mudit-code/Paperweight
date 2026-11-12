import { describe, it, expect, beforeEach } from 'vitest';
import { toolRegistry } from '../src/core/tools/registry';
import type { ToolManifest } from '../src/core/tools/types';

describe('ToolRegistry', () => {
  beforeEach(() => {
    toolRegistry.clear();
  });

  const mockTool: ToolManifest = {
    id: 'test-tool',
    name: 'Test Tool',
    shortName: 'Test',
    tagline: 'Test Tagline',
    description: 'Test Description',
    category: 'image',
    iconName: 'FileImage',
    shortcutIndex: 1,
    acceptedMimes: ['image/png'],
    availableOptions: [],
    loadComponent: async () => ({
      default: () => null as unknown as React.ReactElement,
    }),
  };

  it('registers and retrieves tools by ID', () => {
    toolRegistry.register(mockTool);
    const retrieved = toolRegistry.getById('test-tool');
    expect(retrieved).toBeDefined();
    expect(retrieved?.name).toBe('Test Tool');
  });

  it('retrieves tools by category', () => {
    toolRegistry.register(mockTool);
    const imageTools = toolRegistry.getByCategory('image');
    expect(imageTools).toHaveLength(1);
    expect(imageTools[0].id).toBe('test-tool');

    const pdfTools = toolRegistry.getByCategory('pdf');
    expect(pdfTools).toHaveLength(0);
  });

  it('retrieves tools by Alt shortcut index', () => {
    toolRegistry.register(mockTool);
    const shortcutTool = toolRegistry.getByShortcutIndex(1);
    expect(shortcutTool?.id).toBe('test-tool');

    const invalidShortcut = toolRegistry.getByShortcutIndex(9);
    expect(invalidShortcut).toBeUndefined();
  });

  it('lazily loads and caches tool component', async () => {
    let loadCount = 0;
    const dynamicTool: ToolManifest = {
      ...mockTool,
      id: 'dynamic-tool',
      loadComponent: async () => {
        loadCount++;
        return { default: () => null as unknown as React.ReactElement };
      },
    };

    toolRegistry.register(dynamicTool);

    const comp1 = await toolRegistry.loadToolComponent('dynamic-tool');
    const comp2 = await toolRegistry.loadToolComponent('dynamic-tool');

    expect(comp1).toBe(comp2);
    expect(loadCount).toBe(1); // Cached after first load
  });

  it('throws friendly PaperweightError if tool is not found', async () => {
    await expect(toolRegistry.loadToolComponent('non-existent')).rejects.toThrow(
      'The tool "non-existent" is not registered'
    );
  });

  it('initializes registry with contiguous Alt+1 to Alt+5 shortcuts without gaps', async () => {
    const { initializeToolRegistry } = await import('../src/tools/registry-init');
    initializeToolRegistry();

    const allTools = toolRegistry.getAll();
    expect(allTools.length).toBe(5);

    const shortcuts = allTools.map((t) => t.shortcutIndex).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(shortcuts).toEqual([1, 2, 3, 4, 5]);

    const resizer = toolRegistry.getById('resizer');
    expect(resizer).toBeDefined();
    expect(resizer?.shortcutIndex).toBe(4);
    expect(resizer?.category).toBe('image');

    const converter = toolRegistry.getById('converter');
    expect(converter).toBeDefined();
    expect(converter?.description).not.toContain('Word');
    expect(converter?.description).not.toContain('Excel');
    expect(converter?.description).not.toContain('PowerPoint');

    // Confirm Office mimes are excluded by default
    expect(converter?.acceptedMimes).not.toContain('.docx');
    expect(converter?.acceptedMimes).not.toContain('.xlsx');
    expect(converter?.acceptedMimes).not.toContain('.pptx');
  });
});
