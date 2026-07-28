import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateContainerInput, UpdateContainerInput } from '@/db/containers';
import type { CreateSkillInput, UpdateSkillInput } from '@/db/skills';
import type { AtomicSkillDTO, SkillContainerDTO } from '@/domain/entities';

vi.mock('@/db/skills', () => ({
  getAllSkills: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  duplicateSkill: vi.fn(),
}));

vi.mock('@/db/containers', () => ({
  getAllContainers: vi.fn(),
  createContainer: vi.fn(),
  updateContainer: vi.fn(),
  deleteContainer: vi.fn(),
  removeSkillFromAllContainers: vi.fn(),
}));

import * as containersDb from '@/db/containers';
import * as skillsDb from '@/db/skills';

import { useSkillStore } from '../useSkillStore';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildSkill = (overrides?: Partial<AtomicSkillDTO>): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'Test Skill',
  prompt: 'Do something',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

const buildContainer = (overrides?: Partial<SkillContainerDTO>): SkillContainerDTO => ({
  id: 'container-1',
  name: 'Test Container',
  skillIds: [],
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

// -- Mock aliases --

const mockGetAllSkills = skillsDb.getAllSkills as ReturnType<typeof vi.fn>;
const mockCreateSkill = skillsDb.createSkill as ReturnType<typeof vi.fn>;
const mockUpdateSkill = skillsDb.updateSkill as ReturnType<typeof vi.fn>;
const mockDeleteSkill = skillsDb.deleteSkill as ReturnType<typeof vi.fn>;
const mockDuplicateSkill = skillsDb.duplicateSkill as ReturnType<typeof vi.fn>;

const mockGetAllContainers = containersDb.getAllContainers as ReturnType<typeof vi.fn>;
const mockCreateContainer = containersDb.createContainer as ReturnType<typeof vi.fn>;
const mockUpdateContainer = containersDb.updateContainer as ReturnType<typeof vi.fn>;
const mockDeleteContainer = containersDb.deleteContainer as ReturnType<typeof vi.fn>;
const mockRemoveSkillFromAllContainers = containersDb.removeSkillFromAllContainers as ReturnType<
  typeof vi.fn
>;

// -- Initial state for reset --

const INITIAL_STATE = {
  activeTab: 'skills' as const,
  selectedSkillId: null,
  selectedContainerId: null,
  skills: [],
  containers: [],
};

describe('useSkillStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    act(() => {
      useSkillStore.setState(INITIAL_STATE);
    });
  });

  // =========================================================================
  // UI State
  // =========================================================================

  describe('UI state', () => {
    it('should initialize with skills tab active and no selections', () => {
      const { result } = renderHook(() => useSkillStore());

      expect(result.current.activeTab).toBe('skills');
      expect(result.current.selectedSkillId).toBeNull();
      expect(result.current.selectedContainerId).toBeNull();
      expect(result.current.skills).toEqual([]);
      expect(result.current.containers).toEqual([]);
    });

    it('should update activeTab when setActiveTab is called with containers', () => {
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.setActiveTab('containers');
      });

      expect(result.current.activeTab).toBe('containers');
    });

    it('should update activeTab when setActiveTab is called with skills', () => {
      act(() => {
        useSkillStore.setState({ activeTab: 'containers' });
      });
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.setActiveTab('skills');
      });

      expect(result.current.activeTab).toBe('skills');
    });

    it('should update selectedSkillId when selectSkill is called with an id', () => {
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.selectSkill('skill-1');
      });

      expect(result.current.selectedSkillId).toBe('skill-1');
    });

    it('should clear selectedSkillId when selectSkill is called with null', () => {
      act(() => {
        useSkillStore.setState({ selectedSkillId: 'skill-1' });
      });
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.selectSkill(null);
      });

      expect(result.current.selectedSkillId).toBeNull();
    });

    it('should update selectedContainerId when selectContainer is called with an id', () => {
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.selectContainer('container-1');
      });

      expect(result.current.selectedContainerId).toBe('container-1');
    });

    it('should clear selectedContainerId when selectContainer is called with null', () => {
      act(() => {
        useSkillStore.setState({ selectedContainerId: 'container-1' });
      });
      const { result } = renderHook(() => useSkillStore());

      act(() => {
        result.current.selectContainer(null);
      });

      expect(result.current.selectedContainerId).toBeNull();
    });
  });

  // =========================================================================
  // loadSkills
  // =========================================================================

  describe('loadSkills', () => {
    it('should populate skills from the db service when loadSkills is called', async () => {
      const skills = [
        buildSkill({ id: 'skill-1', name: 'Alpha' }),
        buildSkill({ id: 'skill-2', name: 'Beta' }),
      ];
      mockGetAllSkills.mockResolvedValueOnce(skills);

      const { result } = renderHook(() => useSkillStore());

      await act(async () => {
        await result.current.loadSkills();
      });

      expect(mockGetAllSkills).toHaveBeenCalledOnce();
      expect(result.current.skills).toEqual(skills);
    });

    it('should replace existing skills when loadSkills is called again', async () => {
      const oldSkills = [buildSkill({ id: 'skill-old' })];
      const newSkills = [buildSkill({ id: 'skill-new' })];
      mockGetAllSkills.mockResolvedValueOnce(oldSkills);
      mockGetAllSkills.mockResolvedValueOnce(newSkills);

      const { result } = renderHook(() => useSkillStore());

      await act(async () => {
        await result.current.loadSkills();
      });
      expect(result.current.skills).toEqual(oldSkills);

      await act(async () => {
        await result.current.loadSkills();
      });
      expect(result.current.skills).toEqual(newSkills);
    });

    it('should set skills to empty array when db returns no skills', async () => {
      mockGetAllSkills.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useSkillStore());

      await act(async () => {
        await result.current.loadSkills();
      });

      expect(result.current.skills).toEqual([]);
    });
  });

  // =========================================================================
  // Skill CRUD
  // =========================================================================

  describe('skill CRUD', () => {
    describe('createSkill', () => {
      it('should call createSkill service and refresh skills when createSkill is called', async () => {
        const input: CreateSkillInput = {
          name: 'New Skill',
          prompt: 'Do new things',
          category: 'persona',
          commandPrefix: '/new',
        };
        const created = buildSkill({ id: 'skill-new', name: 'New Skill' });
        mockCreateSkill.mockResolvedValueOnce(created);
        const refreshedSkills = [created];
        mockGetAllSkills.mockResolvedValueOnce(refreshedSkills);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.createSkill(input);
        });

        expect(mockCreateSkill).toHaveBeenCalledWith(input);
        expect(mockGetAllSkills).toHaveBeenCalledOnce();
        expect(result.current.skills).toEqual(refreshedSkills);
      });
    });

    describe('updateSkill', () => {
      it('should call updateSkill service and refresh skills when updateSkill is called', async () => {
        const input: UpdateSkillInput = { name: 'Updated Name' };
        const updated = buildSkill({ id: 'skill-1', name: 'Updated Name' });
        mockUpdateSkill.mockResolvedValueOnce(updated);
        const refreshedSkills = [updated];
        mockGetAllSkills.mockResolvedValueOnce(refreshedSkills);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.updateSkill('skill-1', input);
        });

        expect(mockUpdateSkill).toHaveBeenCalledWith('skill-1', input);
        expect(mockGetAllSkills).toHaveBeenCalledOnce();
        expect(result.current.skills).toEqual(refreshedSkills);
      });
    });

    describe('deleteSkill', () => {
      it('should call deleteSkill service and refresh skills when deleteSkill is called', async () => {
        const existingSkill = buildSkill({ id: 'skill-1' });
        act(() => {
          useSkillStore.setState({ skills: [existingSkill] });
        });
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce([]);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteSkill('skill-1');
        });

        expect(mockDeleteSkill).toHaveBeenCalledWith('skill-1');
        expect(mockGetAllSkills).toHaveBeenCalledOnce();
        expect(result.current.skills).toEqual([]);
      });

      it('should call removeSkillFromAllContainers before deleting the skill', async () => {
        const callOrder: string[] = [];
        mockRemoveSkillFromAllContainers.mockImplementationOnce(async () => {
          callOrder.push('remove');
          return [];
        });
        mockDeleteSkill.mockImplementationOnce(async () => {
          callOrder.push('delete');
        });
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteSkill('skill-1');
        });

        expect(callOrder).toEqual(['remove', 'delete']);
      });

      it('should reload containers after cascade removal', async () => {
        const updatedContainers = [buildContainer({ id: 'c1', skillIds: [] })];
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce(['Updated Container']);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce(updatedContainers);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteSkill('skill-1');
        });

        expect(mockGetAllContainers).toHaveBeenCalledOnce();
        expect(result.current.containers).toEqual(updatedContainers);
      });

      it('should return affected container names from deleteSkill', async () => {
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce(['Container A', 'Container B']);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        let affectedNames: readonly string[] = [];
        await act(async () => {
          affectedNames = await result.current.deleteSkill('skill-1');
        });

        expect(affectedNames).toEqual(['Container A', 'Container B']);
      });

      it('should return empty array when no containers are affected', async () => {
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce([]);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        let affectedNames: readonly string[] = [];
        await act(async () => {
          affectedNames = await result.current.deleteSkill('skill-1');
        });

        expect(affectedNames).toEqual([]);
      });

      it('should clear selectedSkillId when the selected skill is deleted', async () => {
        act(() => {
          useSkillStore.setState({
            skills: [buildSkill({ id: 'skill-1' })],
            selectedSkillId: 'skill-1',
          });
        });
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce([]);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteSkill('skill-1');
        });

        expect(result.current.selectedSkillId).toBeNull();
      });

      it('should not clear selectedSkillId when a different skill is deleted', async () => {
        act(() => {
          useSkillStore.setState({
            skills: [buildSkill({ id: 'skill-1' }), buildSkill({ id: 'skill-2', name: 'Other' })],
            selectedSkillId: 'skill-1',
          });
        });
        mockRemoveSkillFromAllContainers.mockResolvedValueOnce([]);
        mockDeleteSkill.mockResolvedValueOnce(undefined);
        mockGetAllSkills.mockResolvedValueOnce([buildSkill({ id: 'skill-1' })]);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteSkill('skill-2');
        });

        expect(result.current.selectedSkillId).toBe('skill-1');
      });
    });

    describe('duplicateSkill', () => {
      it('should call duplicateSkill service and refresh skills when duplicateSkill is called', async () => {
        const original = buildSkill({ id: 'skill-1', name: 'Original' });
        const duplicate = buildSkill({ id: 'skill-copy', name: 'Original (Copy)' });
        act(() => {
          useSkillStore.setState({ skills: [original] });
        });
        mockDuplicateSkill.mockResolvedValueOnce(duplicate);
        mockGetAllSkills.mockResolvedValueOnce([original, duplicate]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.duplicateSkill('skill-1');
        });

        expect(mockDuplicateSkill).toHaveBeenCalledWith('skill-1');
        expect(mockGetAllSkills).toHaveBeenCalledOnce();
        expect(result.current.skills).toEqual([original, duplicate]);
      });
    });
  });

  // =========================================================================
  // Container CRUD
  // =========================================================================

  describe('container CRUD', () => {
    describe('loadContainers', () => {
      it('should populate containers from the db service when loadContainers is called', async () => {
        const containers = [
          buildContainer({ id: 'c-1', name: 'Alpha' }),
          buildContainer({ id: 'c-2', name: 'Beta' }),
        ];
        mockGetAllContainers.mockResolvedValueOnce(containers);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.loadContainers();
        });

        expect(mockGetAllContainers).toHaveBeenCalledOnce();
        expect(result.current.containers).toEqual(containers);
      });

      it('should set containers to empty array when db returns no containers', async () => {
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.loadContainers();
        });

        expect(result.current.containers).toEqual([]);
      });
    });

    describe('createContainer', () => {
      it('should call createContainer service and refresh containers when createContainer is called', async () => {
        const input: CreateContainerInput = {
          name: 'New Container',
          skillIds: ['skill-1', 'skill-2'],
        };
        const created = buildContainer({
          id: 'c-new',
          name: 'New Container',
          skillIds: ['skill-1', 'skill-2'],
        });
        mockCreateContainer.mockResolvedValueOnce(created);
        mockGetAllContainers.mockResolvedValueOnce([created]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.createContainer(input);
        });

        expect(mockCreateContainer).toHaveBeenCalledWith(input);
        expect(mockGetAllContainers).toHaveBeenCalledOnce();
        expect(result.current.containers).toEqual([created]);
      });
    });

    describe('updateContainer', () => {
      it('should call updateContainer service and refresh containers when updateContainer is called', async () => {
        const input: UpdateContainerInput = { name: 'Renamed' };
        const updated = buildContainer({ id: 'c-1', name: 'Renamed' });
        mockUpdateContainer.mockResolvedValueOnce(updated);
        mockGetAllContainers.mockResolvedValueOnce([updated]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.updateContainer('c-1', input);
        });

        expect(mockUpdateContainer).toHaveBeenCalledWith('c-1', input);
        expect(mockGetAllContainers).toHaveBeenCalledOnce();
        expect(result.current.containers).toEqual([updated]);
      });
    });

    describe('deleteContainer', () => {
      it('should call deleteContainer service and refresh containers when deleteContainer is called', async () => {
        act(() => {
          useSkillStore.setState({ containers: [buildContainer({ id: 'c-1' })] });
        });
        mockDeleteContainer.mockResolvedValueOnce(undefined);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteContainer('c-1');
        });

        expect(mockDeleteContainer).toHaveBeenCalledWith('c-1');
        expect(mockGetAllContainers).toHaveBeenCalledOnce();
        expect(result.current.containers).toEqual([]);
      });

      it('should clear selectedContainerId when the selected container is deleted', async () => {
        act(() => {
          useSkillStore.setState({
            containers: [buildContainer({ id: 'c-1' })],
            selectedContainerId: 'c-1',
          });
        });
        mockDeleteContainer.mockResolvedValueOnce(undefined);
        mockGetAllContainers.mockResolvedValueOnce([]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteContainer('c-1');
        });

        expect(result.current.selectedContainerId).toBeNull();
      });

      it('should not clear selectedContainerId when a different container is deleted', async () => {
        act(() => {
          useSkillStore.setState({
            containers: [
              buildContainer({ id: 'c-1' }),
              buildContainer({ id: 'c-2', name: 'Other' }),
            ],
            selectedContainerId: 'c-1',
          });
        });
        mockDeleteContainer.mockResolvedValueOnce(undefined);
        mockGetAllContainers.mockResolvedValueOnce([buildContainer({ id: 'c-1' })]);

        const { result } = renderHook(() => useSkillStore());

        await act(async () => {
          await result.current.deleteContainer('c-2');
        });

        expect(result.current.selectedContainerId).toBe('c-1');
      });
    });
  });

  // =========================================================================
  // Derived selectors
  // =========================================================================

  describe('derived selectors', () => {
    describe('resolveContainerSkills', () => {
      it('should return resolved skills in container order when container has valid skill IDs', () => {
        const skill1 = buildSkill({ id: 'skill-1', name: 'Alpha' });
        const skill2 = buildSkill({ id: 'skill-2', name: 'Beta' });
        const container = buildContainer({ id: 'c-1', skillIds: ['skill-2', 'skill-1'] });
        act(() => {
          useSkillStore.setState({ skills: [skill1, skill2], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const resolved = result.current.resolveContainerSkills('c-1');

        expect(resolved).toEqual([skill2, skill1]);
      });

      it('should filter out missing skill IDs when container references deleted skills', () => {
        const skill1 = buildSkill({ id: 'skill-1', name: 'Alpha' });
        const container = buildContainer({ id: 'c-1', skillIds: ['skill-1', 'skill-deleted'] });
        act(() => {
          useSkillStore.setState({ skills: [skill1], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const resolved = result.current.resolveContainerSkills('c-1');

        expect(resolved).toEqual([skill1]);
      });

      it('should return empty array when container is not found', () => {
        act(() => {
          useSkillStore.setState({ skills: [buildSkill()], containers: [] });
        });

        const { result } = renderHook(() => useSkillStore());

        const resolved = result.current.resolveContainerSkills('nonexistent');

        expect(resolved).toEqual([]);
      });

      it('should return empty array when container has no skill IDs', () => {
        const container = buildContainer({ id: 'c-1', skillIds: [] });
        act(() => {
          useSkillStore.setState({ skills: [buildSkill()], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const resolved = result.current.resolveContainerSkills('c-1');

        expect(resolved).toEqual([]);
      });

      it('should return empty array when all skill IDs reference deleted skills', () => {
        const container = buildContainer({ id: 'c-1', skillIds: ['gone-1', 'gone-2'] });
        act(() => {
          useSkillStore.setState({ skills: [], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const resolved = result.current.resolveContainerSkills('c-1');

        expect(resolved).toEqual([]);
      });
    });

    describe('getComposedPrompt', () => {
      it('should return composed prompt for a container with skills', () => {
        const skill1 = buildSkill({ id: 'skill-1', prompt: 'Be helpful' });
        const skill2 = buildSkill({ id: 'skill-2', prompt: 'Be concise' });
        const container = buildContainer({ id: 'c-1', skillIds: ['skill-1', 'skill-2'] });
        act(() => {
          useSkillStore.setState({ skills: [skill1, skill2], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const composed = result.current.getComposedPrompt('c-1');

        expect(composed.text).toContain('Be helpful');
        expect(composed.text).toContain('Be concise');
        expect(typeof composed.tokenCount).toBe('number');
        expect(composed.tokenCount).toBeGreaterThan(0);
        expect(typeof composed.exceedsSoftLimit).toBe('boolean');
        expect(typeof composed.exceedsHardLimit).toBe('boolean');
      });

      it('should return empty composed prompt when container has no skills', () => {
        const container = buildContainer({ id: 'c-1', skillIds: [] });
        act(() => {
          useSkillStore.setState({ skills: [], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const composed = result.current.getComposedPrompt('c-1');

        expect(composed.text).toBe('');
        expect(composed.tokenCount).toBe(0);
      });

      it('should return empty composed prompt when container is not found', () => {
        act(() => {
          useSkillStore.setState({ skills: [], containers: [] });
        });

        const { result } = renderHook(() => useSkillStore());

        const composed = result.current.getComposedPrompt('nonexistent');

        expect(composed.text).toBe('');
        expect(composed.tokenCount).toBe(0);
      });
    });

    describe('getOrderingIssues', () => {
      it('should return no issues when skills are in canonical order', () => {
        const personaSkill = buildSkill({ id: 's-1', name: 'Persona', category: 'persona' });
        const contextSkill = buildSkill({ id: 's-2', name: 'Context', category: 'context' });
        const formatSkill = buildSkill({ id: 's-3', name: 'Format', category: 'format' });
        const container = buildContainer({ id: 'c-1', skillIds: ['s-1', 's-2', 's-3'] });
        act(() => {
          useSkillStore.setState({
            skills: [personaSkill, contextSkill, formatSkill],
            containers: [container],
          });
        });

        const { result } = renderHook(() => useSkillStore());

        const issues = result.current.getOrderingIssues('c-1');

        expect(issues).toEqual([]);
      });

      it('should return issues when skills are out of canonical order', () => {
        const formatSkill = buildSkill({ id: 's-1', name: 'Format', category: 'format' });
        const personaSkill = buildSkill({ id: 's-2', name: 'Persona', category: 'persona' });
        const container = buildContainer({ id: 'c-1', skillIds: ['s-1', 's-2'] });
        act(() => {
          useSkillStore.setState({
            skills: [formatSkill, personaSkill],
            containers: [container],
          });
        });

        const { result } = renderHook(() => useSkillStore());

        const issues = result.current.getOrderingIssues('c-1');

        expect(issues.length).toBeGreaterThan(0);
        expect(issues[0].skillId).toBeDefined();
        expect(issues[0].message).toBeDefined();
      });

      it('should return empty array when container is not found', () => {
        act(() => {
          useSkillStore.setState({ skills: [], containers: [] });
        });

        const { result } = renderHook(() => useSkillStore());

        const issues = result.current.getOrderingIssues('nonexistent');

        expect(issues).toEqual([]);
      });

      it('should return empty array when container has no categorized skills', () => {
        const uncategorized = buildSkill({ id: 's-1', category: null });
        const container = buildContainer({ id: 'c-1', skillIds: ['s-1'] });
        act(() => {
          useSkillStore.setState({ skills: [uncategorized], containers: [container] });
        });

        const { result } = renderHook(() => useSkillStore());

        const issues = result.current.getOrderingIssues('c-1');

        expect(issues).toEqual([]);
      });
    });
  });
});
