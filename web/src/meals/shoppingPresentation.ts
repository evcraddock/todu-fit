export function partitionShoppingItems<T>(
  items: T[],
  isChecked: (item: T) => boolean,
): { unchecked: T[]; checked: T[] } {
  const unchecked: T[] = []
  const checked: T[] = []

  for (const item of items) {
    if (isChecked(item)) {
      checked.push(item)
    } else {
      unchecked.push(item)
    }
  }

  return { unchecked, checked }
}
