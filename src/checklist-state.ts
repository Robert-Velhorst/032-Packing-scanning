export interface ChecklistInstanceState {
  itemDone: number;
  notPlaced: boolean;
  unavailable: { id: string; index: number }[];
  packable: string[];
  undo: boolean;
}

export function checklistInstanceState(
  entryId: string,
  quantity: number,
  completedIds: ReadonlySet<string>,
  unavailableIds: ReadonlySet<string>,
  placedIds: ReadonlySet<string>,
): ChecklistInstanceState {
  let itemDone = 0;
  let notPlaced = false;
  const unavailable: ChecklistInstanceState['unavailable'] = [];
  const packable: string[] = [];

  for (let index = 0; index < Math.max(1, quantity); index += 1) {
    const id = `${entryId}#${index + 1}`;
    const isUnavailable = unavailableIds.has(id);
    if (completedIds.has(id)) itemDone += 1;
    if (isUnavailable) unavailable.push({ id, index });
    else if (placedIds.has(id)) packable.push(id);
    else notPlaced = true;
  }

  return {
    itemDone,
    notPlaced,
    unavailable,
    packable,
    undo: itemDone > 0 && packable.every((id) => completedIds.has(id)),
  };
}
