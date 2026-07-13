import type { ReactElement } from 'react';

export type FilterCycleButtonProps = {
  readonly label: string;
  readonly onClick: () => void;
};

export function FilterCycleButton(props: FilterCycleButtonProps): ReactElement {
  return (
    <button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={props.onClick}>
      {props.label}
    </button>
  );
}
