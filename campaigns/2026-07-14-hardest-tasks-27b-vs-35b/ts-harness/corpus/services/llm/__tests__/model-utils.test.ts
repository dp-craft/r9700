import { describe, expect, it } from 'vitest';

import { filterChatModels, sortModels } from '../model-utils';
import type { Model } from '../types';

// -- Builder --

const buildModel = (overrides?: Partial<Model>): Model => ({
  id: 'gpt-4o',
  name: 'GPT-4o',
  ...overrides,
});

const buildModelWithPricing = (
  overrides?: Partial<Model>,
  promptPrice = 0.01,
  completionPrice = 0.03
): Model =>
  buildModel({
    pricing: { promptPrice, completionPrice },
    ...overrides,
  });

describe('filterChatModels', () => {
  describe('retains chat models', () => {
    it('should retain gpt-4o', () => {
      const models = [buildModel({ id: 'gpt-4o', name: 'GPT-4o' })];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });

    it('should retain gpt-4-turbo', () => {
      const models = [buildModel({ id: 'gpt-4-turbo', name: 'GPT-4 Turbo' })];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });

    it('should retain gpt-3.5-turbo', () => {
      const models = [buildModel({ id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' })];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });

    it('should retain non-OpenAI model IDs like claude-3-opus', () => {
      const models = [buildModel({ id: 'claude-3-opus', name: 'Claude 3 Opus' })];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });

    it('should retain all models when none match filter patterns', () => {
      const models = [
        buildModel({ id: 'gpt-4o', name: 'GPT-4o' }),
        buildModel({ id: 'claude-3-opus', name: 'Claude 3 Opus' }),
        buildModel({ id: 'llama-3.1-70b', name: 'Llama 3.1 70B' }),
      ];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });

    it('should retain o1-preview and o1-mini', () => {
      const models = [
        buildModel({ id: 'o1-preview', name: 'o1 Preview' }),
        buildModel({ id: 'o1-mini', name: 'o1 Mini' }),
      ];

      const result = filterChatModels(models);

      expect(result).toEqual(models);
    });
  });

  describe('filters embedding models', () => {
    it('should filter text-embedding-ada-002', () => {
      const models = [buildModel({ id: 'text-embedding-ada-002', name: 'Embedding Ada' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter text-embedding-3-small', () => {
      const models = [buildModel({ id: 'text-embedding-3-small', name: 'Embedding 3 Small' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });
  });

  describe('filters image, audio, and moderation models', () => {
    it('should filter dall-e-3', () => {
      const models = [buildModel({ id: 'dall-e-3', name: 'DALL-E 3' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter tts-1 and tts-1-hd', () => {
      const models = [
        buildModel({ id: 'tts-1', name: 'TTS 1' }),
        buildModel({ id: 'tts-1-hd', name: 'TTS 1 HD' }),
      ];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter whisper-1', () => {
      const models = [buildModel({ id: 'whisper-1', name: 'Whisper 1' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter text-moderation-latest', () => {
      const models = [buildModel({ id: 'text-moderation-latest', name: 'Text Moderation' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter omni-moderation-latest', () => {
      const models = [buildModel({ id: 'omni-moderation-latest', name: 'Omni Moderation' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });
  });

  describe('filters legacy and specialized models', () => {
    it('should filter davinci-002', () => {
      const models = [buildModel({ id: 'davinci-002', name: 'Davinci 002' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter babbage-002', () => {
      const models = [buildModel({ id: 'babbage-002', name: 'Babbage 002' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter chatgpt-4o-latest as exact match', () => {
      const models = [buildModel({ id: 'chatgpt-4o-latest', name: 'ChatGPT-4o Latest' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter codex-mini-latest', () => {
      const models = [buildModel({ id: 'codex-mini-latest', name: 'Codex Mini' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });
  });

  describe('filters audio and realtime variants', () => {
    it('should filter models with -transcribe suffix', () => {
      const models = [buildModel({ id: 'gpt-4o-transcribe', name: 'GPT-4o Transcribe' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter models with -realtime suffix', () => {
      const models = [buildModel({ id: 'gpt-4o-mini-realtime', name: 'GPT-4o Mini Realtime' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter gpt-4o-audio-preview', () => {
      const models = [buildModel({ id: 'gpt-4o-audio-preview', name: 'GPT-4o Audio Preview' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter gpt-4o-mini-audio-preview', () => {
      const models = [
        buildModel({ id: 'gpt-4o-mini-audio-preview', name: 'GPT-4o Mini Audio Preview' }),
      ];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter gpt-4o-mini-tts', () => {
      const models = [buildModel({ id: 'gpt-4o-mini-tts', name: 'GPT-4o Mini TTS' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });
  });

  describe('case insensitivity', () => {
    it('should filter TEXT-EMBEDDING-ADA-002 in uppercase', () => {
      const models = [buildModel({ id: 'TEXT-EMBEDDING-ADA-002', name: 'Embedding Ada' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should filter Dall-E-3 in mixed case', () => {
      const models = [buildModel({ id: 'Dall-E-3', name: 'DALL-E 3' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });
  });

  describe('edge cases', () => {
    it('should return empty array when given empty input', () => {
      const result = filterChatModels([]);

      expect(result).toEqual([]);
    });

    it('should filter pplx-embed- prefixed models', () => {
      const models = [buildModel({ id: 'pplx-embed-large', name: 'Perplexity Embed Large' })];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should return empty array when all models are filtered', () => {
      const models = [
        buildModel({ id: 'text-embedding-ada-002', name: 'Embedding' }),
        buildModel({ id: 'dall-e-3', name: 'DALL-E' }),
        buildModel({ id: 'whisper-1', name: 'Whisper' }),
      ];

      const result = filterChatModels(models);

      expect(result).toEqual([]);
    });

    it('should preserve all model fields in retained models', () => {
      const model = buildModel({
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextLength: 128000,
      });

      const result = filterChatModels([model]);

      expect(result).toEqual([model]);
      expect(result[0]).toHaveProperty('contextLength', 128000);
    });

    it('should correctly separate chat from non-chat in a mixed list', () => {
      const chatModel = buildModel({ id: 'gpt-4o', name: 'GPT-4o' });
      const embeddingModel = buildModel({ id: 'text-embedding-3-large', name: 'Embedding' });
      const imageModel = buildModel({ id: 'dall-e-3', name: 'DALL-E 3' });
      const anotherChat = buildModel({ id: 'claude-3-sonnet', name: 'Claude 3 Sonnet' });
      const ttsModel = buildModel({ id: 'tts-1', name: 'TTS' });

      const result = filterChatModels([
        chatModel,
        embeddingModel,
        imageModel,
        anotherChat,
        ttsModel,
      ]);

      expect(result).toEqual([chatModel, anotherChat]);
    });
  });

  describe('cross-provider filter patterns', () => {
    describe('\\bgemma\\b word boundary pattern', () => {
      it('should filter gemma-7b by word boundary match', () => {
        const models = [buildModel({ id: 'gemma-7b', name: 'Gemma 7B' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });

      it('should filter google/gemma-2-9b-it with vendor prefix', () => {
        const models = [buildModel({ id: 'google/gemma-2-9b-it', name: 'Gemma 2 9B IT' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });

      it('should retain model whose name contains gemma as a substring of another word', () => {
        const models = [buildModel({ id: 'digemmatic-v2', name: 'Digemmatic V2' })];

        const result = filterChatModels(models);

        expect(result).toEqual(models);
      });
    });

    describe('\\btts\\b word boundary pattern', () => {
      it('should filter some-tts-model matched by word boundary', () => {
        const models = [buildModel({ id: 'some-tts-model', name: 'Some TTS Model' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });

      it('should filter google/gemma-tts-1 with vendor prefix', () => {
        const models = [buildModel({ id: 'google/gemma-tts-1', name: 'Gemma TTS 1' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });
    });

    describe('\\bembedding\\b word boundary pattern', () => {
      it('should filter text-embedding-large by word boundary match', () => {
        const models = [buildModel({ id: 'text-embedding-large', name: 'Text Embedding Large' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });

      it('should filter openai/embedding-3 with vendor prefix', () => {
        const models = [buildModel({ id: 'openai/embedding-3', name: 'OpenAI Embedding 3' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });
    });

    describe('\\bwhisper\\b word boundary pattern', () => {
      it('should filter openai/whisper-large with vendor prefix', () => {
        const models = [buildModel({ id: 'openai/whisper-large', name: 'Whisper Large' })];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });
    });

    describe('\\bmoderation\\b word boundary pattern', () => {
      it('should filter openai/moderation-latest with vendor prefix', () => {
        const models = [
          buildModel({ id: 'openai/moderation-latest', name: 'OpenAI Moderation Latest' }),
        ];

        const result = filterChatModels(models);

        expect(result).toEqual([]);
      });
    });
  });
});

describe('sortModels', () => {
  describe('empty and single inputs', () => {
    it('should return empty array when given empty input', () => {
      const result = sortModels([]);

      expect(result).toEqual([]);
    });

    it('should return single model unchanged', () => {
      const model = buildModel({ id: 'gpt-4o', name: 'GPT-4o' });

      const result = sortModels([model]);

      expect(result).toEqual([model]);
    });
  });

  describe('models without pricing', () => {
    it('should sort alphabetically by name when no models have pricing', () => {
      const models = [
        buildModel({ id: 'c', name: 'Zebra Model' }),
        buildModel({ id: 'a', name: 'Alpha Model' }),
        buildModel({ id: 'b', name: 'Mango Model' }),
      ];

      const result = sortModels(models);

      expect(result.map(m => m.name)).toEqual(['Alpha Model', 'Mango Model', 'Zebra Model']);
    });
  });

  describe('free models (promptPrice = 0)', () => {
    it('should sort free models before paid models', () => {
      const freeModel = buildModelWithPricing({ id: 'free', name: 'Free Model' }, 0, 0);
      const paidModel = buildModelWithPricing({ id: 'paid', name: 'Paid Model' }, 0.01, 0.03);

      const result = sortModels([paidModel, freeModel]);

      expect(result[0]).toEqual(freeModel);
      expect(result[1]).toEqual(paidModel);
    });

    it('should sort multiple free models alphabetically among themselves', () => {
      const freeB = buildModelWithPricing({ id: 'b', name: 'Beta Free' }, 0, 0);
      const freeA = buildModelWithPricing({ id: 'a', name: 'Alpha Free' }, 0, 0);

      const result = sortModels([freeB, freeA]);

      expect(result.map(m => m.name)).toEqual(['Alpha Free', 'Beta Free']);
    });
  });

  describe('models sorted by promptPrice ascending', () => {
    it('should sort cheaper models before more expensive models', () => {
      const expensive = buildModelWithPricing({ id: 'exp', name: 'Expensive' }, 0.1, 0.3);
      const cheap = buildModelWithPricing({ id: 'chp', name: 'Cheap' }, 0.001, 0.003);

      const result = sortModels([expensive, cheap]);

      expect(result[0]).toEqual(cheap);
      expect(result[1]).toEqual(expensive);
    });

    it('should sort same-price models alphabetically by name', () => {
      const samePriceB = buildModelWithPricing({ id: 'b', name: 'Zeta Model' }, 0.01, 0.03);
      const samePriceA = buildModelWithPricing({ id: 'a', name: 'Alpha Model' }, 0.01, 0.03);

      const result = sortModels([samePriceB, samePriceA]);

      expect(result.map(m => m.name)).toEqual(['Alpha Model', 'Zeta Model']);
    });
  });

  describe('varies pricing (promptPrice < 0)', () => {
    it('should sort varies-price models after all priced models', () => {
      const variesModel = buildModelWithPricing({ id: 'varies', name: 'Varies Model' }, -1, -1);
      const paidModel = buildModelWithPricing({ id: 'paid', name: 'Paid Model' }, 0.01, 0.03);

      const result = sortModels([variesModel, paidModel]);

      expect(result[0]).toEqual(paidModel);
      expect(result[1]).toEqual(variesModel);
    });

    it('should sort varies-price models before no-pricing models', () => {
      const variesModel = buildModelWithPricing({ id: 'varies', name: 'Varies Model' }, -1, -1);
      const noPriceModel = buildModel({ id: 'noprice', name: 'No Price Model' });

      const result = sortModels([noPriceModel, variesModel]);

      expect(result[0]).toEqual(variesModel);
      expect(result[1]).toEqual(noPriceModel);
    });
  });

  describe('full sort order', () => {
    it('should sort in order: free → cheap → expensive → varies → no-price (alphabetical within tier)', () => {
      const noPrice = buildModel({ id: 'np', name: 'No Price' });
      const expensive = buildModelWithPricing({ id: 'exp', name: 'Expensive' }, 0.5, 1.0);
      const free = buildModelWithPricing({ id: 'fr', name: 'Free' }, 0, 0);
      const varies = buildModelWithPricing({ id: 'var', name: 'Varies' }, -1, -1);
      const cheap = buildModelWithPricing({ id: 'chp', name: 'Cheap' }, 0.001, 0.003);

      const result = sortModels([noPrice, expensive, free, varies, cheap]);

      expect(result.map(m => m.name)).toEqual(['Free', 'Cheap', 'Expensive', 'Varies', 'No Price']);
    });

    it('should sort alphabetically within the no-pricing group', () => {
      const noPriceZ = buildModel({ id: 'z', name: 'Zeta' });
      const noPriceA = buildModel({ id: 'a', name: 'Alpha' });
      const noPriceM = buildModel({ id: 'm', name: 'Mango' });

      const result = sortModels([noPriceZ, noPriceA, noPriceM]);

      expect(result.map(m => m.name)).toEqual(['Alpha', 'Mango', 'Zeta']);
    });
  });

  describe('field preservation', () => {
    it('should preserve all model fields after sorting', () => {
      const model = buildModelWithPricing(
        {
          id: 'full-model',
          name: 'Full Model',
          contextLength: 128000,
          description: 'A complete model',
          inputModalities: ['text'],
          outputModalities: ['text'],
          supportsThinking: true,
        },
        0.01,
        0.03
      );

      const result = sortModels([model]);

      expect(result[0]).toEqual(model);
    });
  });
});
