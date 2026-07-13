import type { ReactElement } from 'react';

import { useTranslation } from '@/i18n';

import { DetailPanel, type DetailPanelProps } from '../components/DetailPanel';
import { usePromptTesterStore } from '../stores/usePromptTesterStore';
import { formatCellTitle } from '../utils/cellTitle';
import {
  buildDetailLabels,
  buildModelParamsVM,
  buildParamLabels,
  resolvedSnapshotToModelEntry
} from '../utils/detailPanelProps';
import { labCellToDetailPanelProps } from '../utils/labCellToDetailPanel';

export function DetailPanelContainer(): ReactElement | null {
  const activeDetailCellId = usePromptTesterStore(s => s.activeDetailCellId);
  const activeRunId = usePromptTesterStore(s => s.activeRunId);
  const runs = usePromptTesterStore(s => s.runs);
  const closeDetail = usePromptTesterStore(s => s.closeDetail);
  const retryCell = usePromptTesterStore(s => s.retryCell);
  const analyzingCellIds = usePromptTesterStore(s => s.analyzingCellIds);
  const judgingCellId = usePromptTesterStore(s => s.judgingCellId);
  const analyzeCell = usePromptTesterStore(s => s.analyzeCell);
  const runJudge = usePromptTesterStore(s => s.runJudge);
  const t = useTranslation();

  if (activeDetailCellId === null) return null;

  const activeRun = runs.find(r => r.id === activeRunId);
  if (!activeRun) return null;

  const cell = activeRun.cells.find(c => c.id === activeDetailCellId);
  if (!cell) return null;

  const snapshotModel = activeRun.configSnapshot.models.find(m => m.id === cell.modelId);
  const model =
    snapshotModel ?? (cell.resolvedModel ? resolvedSnapshotToModelEntry(cell.resolvedModel) : null);
  if (!model) return null;

  const prompt = activeRun.configSnapshot.prompts.find(p => p.id === cell.promptId);

  const baseProps = labCellToDetailPanelProps({
    cell,
    model,
    systemPrompt: prompt?.text,
    userPrompt: activeRun.configSnapshot.userPrompt,
  });

  const props: DetailPanelProps = {
    ...baseProps,
    isOpen: true,
    labels: buildDetailLabels(t),
    title: formatCellTitle({
      modelAxisId: model.axisId,
      promptAxisId: prompt?.axisId,
      modelLabel: model.name,
      phrase: prompt?.text,
    }),
    modelParams: buildModelParamsVM(model, buildParamLabels(t)),
    tier2: cell.tier2 ?? null,
    judge: cell.judge ?? null,
    isAnalyzing: analyzingCellIds.includes(cell.id),
    isJudging: judgingCellId === cell.id,
    onClose: closeDetail,
    onAnalyzeTier2: () => {
      void analyzeCell(cell.id);
    },
    onRunJudge: () => {
      void runJudge(cell.id);
    },
    onRetry:
      cell.status === 'error'
        ? () => {
            void retryCell(activeDetailCellId);
          }
        : undefined,
  };

  return <DetailPanel {...props} />;
}
