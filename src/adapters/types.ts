export type AssetKind = 'background' | 'character-sheet' | 'character' | 'decoration';

export type GenerationRequest = {
  prompt: string;
  negativePrompt?: string;
  kind: AssetKind;
  width: number;
  height: number;
  transparent?: boolean;
  seed?: number;
};

export type GeneratedAsset = {
  path: string;
  mimeType: string;
  width: number;
  height: number;
  prompt: string;
  seed?: number;
  providerMetadata?: Record<string, unknown>;
};

export type AdapterManifest = {
  apiVersion: 1;
  id: string;
  name: string;
  description: string;
  transport: 'manual' | 'agent' | 'http';
  capabilities: AssetKind[];
  requiresEnv: string[];
  documentation: string;
};

export interface ImageGenerationAdapter {
  manifest: AdapterManifest;
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<GeneratedAsset[]>;
}
