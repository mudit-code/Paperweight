import type React from 'react';
import type { ToolManifest, ToolProps, ToolCategory } from './types';
import { PaperweightError } from '../errors';

class ToolRegistry {
  private static instance: ToolRegistry | null = null;
  private readonly tools = new Map<string, ToolManifest>();
  private readonly componentCache = new Map<string, React.ComponentType<ToolProps>>();
  private readonly loadingPromises = new Map<string, Promise<React.ComponentType<ToolProps>>>();

  public static getInstance(): ToolRegistry {
    if (!ToolRegistry.instance) {
      ToolRegistry.instance = new ToolRegistry();
    }
    return ToolRegistry.instance;
  }

  public register(manifest: ToolManifest): void {
    if (this.tools.has(manifest.id)) {
      console.warn(`Tool with id "${manifest.id}" is already registered. Overwriting.`);
    }
    this.tools.set(manifest.id, manifest);
  }

  public getAll(): ToolManifest[] {
    return Array.from(this.tools.values());
  }

  public getByCategory(category: ToolCategory): ToolManifest[] {
    return this.getAll().filter((tool) => tool.category === category);
  }

  public getById(id: string): ToolManifest | undefined {
    return this.tools.get(id);
  }

  public getByShortcutIndex(index: number): ToolManifest | undefined {
    return this.getAll().find((tool) => tool.shortcutIndex === index);
  }

  /**
   * Lazily loads the tool's React component using dynamic import, caching the result.
   */
  public async loadToolComponent(id: string): Promise<React.ComponentType<ToolProps>> {
    const cached = this.componentCache.get(id);
    if (cached) {
      return cached;
    }

    const inflight = this.loadingPromises.get(id);
    if (inflight) {
      return inflight;
    }

    const manifest = this.getById(id);
    if (!manifest) {
      throw new PaperweightError({
        code: 'ERR_TOOL_NOT_FOUND',
        title: 'Tool Not Found',
        message: `The tool "${id}" is not registered in the system registry.`,
      });
    }

    const loadPromise = manifest
      .loadComponent()
      .then((module) => {
        const comp = module.default;
        this.componentCache.set(id, comp);
        this.loadingPromises.delete(id);
        return comp;
      })
      .catch((err) => {
        this.loadingPromises.delete(id);
        throw new PaperweightError({
          code: 'ERR_TOOL_LOAD_FAILED',
          title: `Failed to Load ${manifest.name}`,
          message: 'The tool component could not be loaded into memory.',
          suggestion: 'Ensure your browser has sufficient resources and try again.',
          cause: err,
        });
      });

    this.loadingPromises.set(id, loadPromise);
    return loadPromise;
  }

  public clear(): void {
    this.tools.clear();
    this.componentCache.clear();
    this.loadingPromises.clear();
  }
}

export const toolRegistry = ToolRegistry.getInstance();
