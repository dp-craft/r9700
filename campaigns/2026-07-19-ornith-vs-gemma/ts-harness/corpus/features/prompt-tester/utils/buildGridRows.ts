import {
  type GridCellVM,
  type GridTableModelColumn,
  type GridTableSkillRow,
  type GridTableVM,
  IMPLICIT_PROMPT_ID,
  type ModelEntry,
  type PromptEntry,
  type ResultCellVM
} from '../types';
import { buildQualityStarRows } from './starMetrics';

// Cell identity mirrors the store's buildCellId: `${modelId}::${promptId}`.
const CELL_ID_SEPARATOR = '::';

const cellIdFor = (modelId: string, promptId: string): string =>
  `${modelId}${CELL_ID_SEPARATOR}${promptId}`;

const toGridCellVM = (cell: ResultCellVM, selected: boolean): GridCellVM => ({
  id: cell.id,
  cell,
  selected,
  starRows: buildQualityStarRows(cell.output),
  tps: cell.tps,
  timeToFirstTokenMs: cell.ttfMs,
});

export const buildGridCells = (
  cells: readonly ResultCellVM[],
  selectedCellIds: readonly string[]
): readonly GridCellVM[] => {
  const selectedSet = new Set(selectedCellIds);
  return cells.map(cell => toGridCellVM(cell, selectedSet.has(cell.id)));
};

export const buildGridTable = (
  cells: readonly ResultCellVM[],
  models: readonly ModelEntry[],
  prompts: readonly PromptEntry[],
  selectedCellIds: readonly string[]
): GridTableVM => {
  const selectedSet = new Set(selectedCellIds);
  const cellById = new Map(cells.map(cell => [cell.id, cell] as const));

  const modelColumns: readonly GridTableModelColumn[] = models.map(model => ({
    modelId: model.id,
    label: model.name,
  }));

  // Zero-prompt runs build cells against a synthetic prompt id (IMPLICIT_PROMPT_ID),
  // so the grid mirrors that fallback to keep a row for the user-prompt-only path.
  const rowPrompts: readonly Pick<PromptEntry, 'id' | 'text'>[] =
    prompts.length > 0 || models.length === 0 ? prompts : [{ id: IMPLICIT_PROMPT_ID, text: '' }];

  const skillRows: readonly GridTableSkillRow[] = rowPrompts.map(prompt => ({
    skillKey: prompt.id,
    label: prompt.text,
    cells: models.map(model => {
      const id = cellIdFor(model.id, prompt.id);
      const cell = cellById.get(id);
      return cell ? toGridCellVM(cell, selectedSet.has(id)) : null;
    }),
  }));

  return { modelColumns, skillRows };
};
