/**
 * Cross-MF (cross-microfrontend) contracts.
 *
 * Types that represent dispatch payloads or shared messages between MFs.
 * Owned here (not in any feature barrel) so dependency direction stays neutral:
 * neither MF depends on the other — both depend on this shared contract.
 */

export interface TestInLabPayload {
  readonly systemPrompts: readonly string[];
  readonly userPrompt: string;
  readonly model: string;
  readonly providerId: string;
  readonly sourceSessionId: string;
  readonly source: 'chat-deep-link';
}
