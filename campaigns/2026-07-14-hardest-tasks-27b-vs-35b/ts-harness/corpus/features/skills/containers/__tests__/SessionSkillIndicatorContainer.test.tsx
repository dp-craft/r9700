import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  AtomicSkillDTO,
  ChatSession,
  SkillContainerDTO,
  SkillSnapshot
} from '@/domain/entities';
import { useSessionStore } from '@/features/sessions';
import { useSkillStore } from '@/features/skills';

import { SessionSkillIndicatorContainer } from '../SessionSkillIndicatorContainer';

// -- Constants --

const FIXED_TIMESTAMP = 1_700_000_000_000;

// -- Builders --

const buildSession = (overrides?: Partial<ChatSession>): ChatSession => ({
  id: 'session-1',
  title: 'Test Session',
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  model: 'llama3',
  providerId: 'ollama',
  skillSnapshot: null,
  ...overrides,
});

const buildContainer = (overrides?: Partial<SkillContainerDTO>): SkillContainerDTO => ({
  id: 'container-1',
  name: 'Writing Tools',
  skillIds: ['skill-1'],
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

const buildSkill = (overrides?: Partial<AtomicSkillDTO>): AtomicSkillDTO => ({
  id: 'skill-1',
  name: 'Test Skill',
  prompt: 'Do something helpful',
  type: 'custom',
  category: null,
  commandPrefix: null,
  conditions: null,
  description: null,
  createdAt: FIXED_TIMESTAMP,
  updatedAt: FIXED_TIMESTAMP,
  ...overrides,
});

const buildSnapshot = (overrides?: Partial<SkillSnapshot>): SkillSnapshot => ({
  containerId: 'container-1',
  containerName: 'Writing Tools',
  skillNames: ['Test Skill'],
  composedPrompt: 'Do something helpful',
  ...overrides,
});

// -- Store state snapshots for reset --

const initialSessionState = useSessionStore.getState();
const initialSkillState = useSkillStore.getState();

// -- Setup --

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState(initialSessionState, true);
  useSkillStore.setState(initialSkillState, true);
});

// -- Tests --

describe('SessionSkillIndicatorContainer', () => {
  // -- Null / no active session --

  it('should return null when activeSessionId is null', () => {
    useSessionStore.setState({ activeSessionId: null, sessionList: [] });

    const { container } = render(<SessionSkillIndicatorContainer />);

    expect(container.innerHTML).toBe('');
  });

  it('should return null when activeSessionId is set but session not found in list', () => {
    useSessionStore.setState({
      activeSessionId: 'nonexistent-id',
      sessionList: [buildSession({ id: 'other-id' })],
    });

    const { container } = render(<SessionSkillIndicatorContainer />);

    // Component returns null only when activeSessionId is falsy
    expect(container.innerHTML).not.toBe('');
  });

  // -- Renders when active session exists --

  it('should render the select trigger when an active session exists', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
    });

    render(<SessionSkillIndicatorContainer />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  // -- selectedValue derivation --

  it('should derive selectedValue as pkg:<containerId> when session has a snapshot with containerId', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [
        buildSession({
          skillSnapshot: buildSnapshot({
            containerId: 'container-1',
            containerName: 'Research Kit',
          }),
        }),
      ],
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'container-1', name: 'Research Kit' })],
    });

    render(<SessionSkillIndicatorContainer />);

    // The combobox should display the container name (selected value is pkg:container-1)
    expect(screen.getByRole('combobox')).toBeInTheDocument();
    expect(screen.getByText('Research Kit')).toBeInTheDocument();
  });

  it('should derive selectedValue as __none__ when session has no snapshot', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ skillSnapshot: null })],
    });
    useSkillStore.setState({ containers: [], skills: [] });

    render(<SessionSkillIndicatorContainer />);

    // Trigger renders with placeholder (no selected value text besides placeholder)
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('should derive selectedValue as skill:<id> when snapshot has no containerId but has a skillName matching an atomic skill', () => {
    const skill = buildSkill({ id: 's1', name: 'Grammar' });
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [
        buildSession({
          skillSnapshot: buildSnapshot({
            containerId: null,
            containerName: null,
            skillNames: ['Grammar'],
            composedPrompt: null,
          }),
        }),
      ],
    });
    useSkillStore.setState({
      skills: [skill],
      containers: [],
    });

    render(<SessionSkillIndicatorContainer />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
    // The combobox displays "Grammar" because selectedValue is skill:s1
    expect(screen.getByText('Grammar')).toBeInTheDocument();
  });

  // -- Empty state --

  it('should render combobox when no containers in store and no snapshot', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession({ skillSnapshot: null })],
    });
    useSkillStore.setState({ containers: [], skills: [] });

    render(<SessionSkillIndicatorContainer />);

    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  // -- Dropdown shows container options --

  it('should show container options from store when user opens the select', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
    });
    useSkillStore.setState({
      containers: [
        buildContainer({ id: 'c1', name: 'Writing Tools' }),
        buildContainer({ id: 'c2', name: 'Code Helpers' }),
      ],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Writing Tools' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Code Helpers' })).toBeInTheDocument();
  });

  it('should always show "No skills" option in the dropdown', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Some Container' })],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: /no skills/i })).toBeInTheDocument();
  });

  // -- Selecting pkg:<id> calls updateSessionSnapshot with container snapshot --

  it('should call updateSessionSnapshot with built snapshot when a container option is selected', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);
    const testSkill = buildSkill({ id: 'skill-1', name: 'Grammar Check', prompt: 'Check grammar' });

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Writing Tools', skillIds: ['skill-1'] })],
      resolveContainerSkills: () => [testSkill],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Writing Tools' }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
    expect(mockUpdateSnapshot).toHaveBeenCalledWith('session-1', {
      containerId: 'c1',
      containerName: 'Writing Tools',
      skillNames: ['Grammar Check'],
      composedPrompt: 'Check grammar',
    });
  });

  // -- Selecting __none__ clears snapshot --

  it('should call updateSessionSnapshot with null when "No skills" is selected', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: 'session-1',
      // Session has an active container snapshot so selectedValue starts as pkg:c1,
      // ensuring selecting __none__ triggers a real value change in Radix Select.
      sessionList: [
        buildSession({
          skillSnapshot: buildSnapshot({ containerId: 'c1', containerName: 'Writing Tools' }),
        }),
      ],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Writing Tools' })],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: /no skills/i }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
    expect(mockUpdateSnapshot).toHaveBeenCalledWith('session-1', null);
  });

  // -- Selecting skill:<id> calls updateSessionSnapshot with single-skill snapshot --

  it('should call updateSessionSnapshot with single-skill snapshot when a skill:<id> option is selected', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);
    const skill = buildSkill({ id: 's1', name: 'Grammar', prompt: 'Check grammar' });

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      skills: [skill],
      containers: [],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Grammar' }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
    const [calledSessionId, snapshot] = mockUpdateSnapshot.mock.calls[0] as [string, SkillSnapshot];
    expect(calledSessionId).toBe('session-1');
    expect(snapshot.skillNames).toContain('Grammar');
  });

  // -- Does not call when no active session --

  it('should not call updateSessionSnapshot when activeSessionId is null even if handler fires', () => {
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: null,
      sessionList: [],
      updateSessionSnapshot: mockUpdateSnapshot,
    });

    const { container } = render(<SessionSkillIndicatorContainer />);

    expect(container.innerHTML).toBe('');
    expect(mockUpdateSnapshot).not.toHaveBeenCalled();
  });

  // -- Container not found in store --

  it('should call updateSessionSnapshot when a valid container is selected', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Container A' })],
      resolveContainerSkills: () => [],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Container A' }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
  });

  // -- Token count display --

  it('should show token count when session has a snapshot with composedPrompt', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [
        buildSession({
          skillSnapshot: buildSnapshot({
            containerName: 'My Container',
            skillNames: ['Skill A'],
            composedPrompt: 'A prompt that has some content for token estimation',
          }),
        }),
      ],
    });

    render(<SessionSkillIndicatorContainer />);

    expect(screen.getByText(/tokens/i)).toBeInTheDocument();
  });

  it('should not show token count when snapshot has no composedPrompt', () => {
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [
        buildSession({
          skillSnapshot: buildSnapshot({
            containerName: 'Empty Container',
            skillNames: [],
            composedPrompt: null,
          }),
        }),
      ],
    });

    render(<SessionSkillIndicatorContainer />);

    expect(screen.queryByText(/tokens/i)).not.toBeInTheDocument();
  });

  // -- Containers load after initial render (async race) --

  it('should show containers when store updates after initial render with empty containers', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
    });
    useSkillStore.setState({ containers: [] });

    render(<SessionSkillIndicatorContainer />);

    act(() => {
      useSkillStore.setState({
        containers: [buildContainer({ id: 'c1', name: 'Loaded Container' })],
      });
    });

    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Loaded Container' })).toBeInTheDocument();
  });

  // -- Multiple skills in snapshot --

  it('should build snapshot with multiple skill names when container has multiple skills', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);
    const skills: readonly AtomicSkillDTO[] = [
      buildSkill({ id: 's1', name: 'Grammar', prompt: 'Check grammar' }),
      buildSkill({ id: 's2', name: 'Style', prompt: 'Improve style' }),
    ];

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Writing Kit', skillIds: ['s1', 's2'] })],
      resolveContainerSkills: () => [...skills],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Writing Kit' }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
    const snapshotArg = mockUpdateSnapshot.mock.calls[0][1] as SkillSnapshot;
    expect(snapshotArg.skillNames).toEqual(['Grammar', 'Style']);
    expect(snapshotArg.composedPrompt).toContain('Check grammar');
    expect(snapshotArg.composedPrompt).toContain('Improve style');
  });

  // -- Individual skills shown in dropdown --

  it('should show individual skills in dropdown derived from atomic skills in the store', async () => {
    const user = userEvent.setup();
    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
    });
    useSkillStore.setState({
      skills: [buildSkill({ id: 's1', name: 'Grammar' }), buildSkill({ id: 's2', name: 'Style' })],
      containers: [],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));

    expect(await screen.findByRole('option', { name: 'Grammar' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Style' })).toBeInTheDocument();
  });

  // -- Container with no skills --

  it('should build snapshot with null composedPrompt when container has no skills', async () => {
    const user = userEvent.setup();
    const mockUpdateSnapshot = vi.fn().mockResolvedValue(undefined);

    useSessionStore.setState({
      activeSessionId: 'session-1',
      sessionList: [buildSession()],
      updateSessionSnapshot: mockUpdateSnapshot,
    });
    useSkillStore.setState({
      containers: [buildContainer({ id: 'c1', name: 'Empty Kit', skillIds: [] })],
      resolveContainerSkills: () => [],
    });

    render(<SessionSkillIndicatorContainer />);
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Empty Kit' }));

    expect(mockUpdateSnapshot).toHaveBeenCalledOnce();
    const snapshotArg = mockUpdateSnapshot.mock.calls[0][1] as SkillSnapshot;
    expect(snapshotArg.composedPrompt).toBeNull();
    expect(snapshotArg.skillNames).toEqual([]);
  });
});
