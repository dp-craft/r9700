export interface CuratedModel {
  readonly baseName: string;
  readonly displayName: string;
  readonly description: string;
  readonly approxSize: string;
  readonly pros: string;
  readonly cons: string;
}

export interface CuratedMatch {
  readonly model: CuratedModel;
  readonly providerModelId: string;
}
