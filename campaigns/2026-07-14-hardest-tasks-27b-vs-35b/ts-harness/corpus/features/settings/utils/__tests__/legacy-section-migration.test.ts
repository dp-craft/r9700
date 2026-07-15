import { describe, expect, it } from 'vitest';

import { migrateLegacySection } from '../legacy-section-migration';

describe('migrateLegacySection', () => {
  describe('current valid sections (pass-through)', () => {
    it('should return { section: \'general\' } when raw is \'general\'', () => {
      expect(migrateLegacySection('general')).toEqual({ section: 'general' });
    });

    it('should return { section: \'api-models\' } when raw is \'api-models\'', () => {
      expect(migrateLegacySection('api-models')).toEqual({ section: 'api-models' });
    });

    it('should return { section: \'appearance\' } when raw is \'appearance\'', () => {
      expect(migrateLegacySection('appearance')).toEqual({ section: 'appearance' });
    });

    it('should return { section: \'defaults\' } when raw is \'defaults\'', () => {
      expect(migrateLegacySection('defaults')).toEqual({ section: 'defaults' });
    });
  });

  describe('legacy section migration', () => {
    it('should map \'global:workspace\' to { section: \'general\' }', () => {
      expect(migrateLegacySection('global:workspace')).toEqual({ section: 'general' });
    });

    it('should map \'global:appearance\' to { section: \'appearance\' }', () => {
      expect(migrateLegacySection('global:appearance')).toEqual({ section: 'appearance' });
    });

    it('should map \'mf-chat:providers\' to { section: \'api-models\' }', () => {
      expect(migrateLegacySection('mf-chat:providers')).toEqual({ section: 'api-models' });
    });

    it('should map \'mf-chat:defaults\' to { section: \'defaults\' }', () => {
      expect(migrateLegacySection('mf-chat:defaults')).toEqual({ section: 'defaults' });
    });

    it('should map \'mf-lab:retention\' to { section: \'defaults\', anchor: \'lab-retention\' }', () => {
      expect(migrateLegacySection('mf-lab:retention')).toEqual({
        section: 'defaults',
        anchor: 'lab-retention',
      });
    });

    it('should map \'mf-lab:defaults\' to { section: \'defaults\' }', () => {
      expect(migrateLegacySection('mf-lab:defaults')).toEqual({ section: 'defaults' });
    });
  });

  describe('unknown sections', () => {
    it('should return null for an unknown section string', () => {
      expect(migrateLegacySection('unknown:section')).toBeNull();
    });

    it('should return null for an empty string', () => {
      expect(migrateLegacySection('')).toBeNull();
    });
  });
});
