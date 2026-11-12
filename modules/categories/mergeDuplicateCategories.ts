import { Category } from '@/core/models';
import {
  categoryMergeRepository,
  CategoryIdMap,
  CategoryReferenceUpdate,
} from '@/core/repositories/CategoryMergeRepository';

export interface DuplicateGroup {
  keep: Category;
  duplicates: Category[];
}

export interface CategoryMergePlan {
  groups: DuplicateGroup[];
  idMap: CategoryIdMap;
  updates: CategoryReferenceUpdate[];
  /** Number of reference updates per collection */
  updateCounts: Record<string, number>;
}

const groupKey = (c: Category) => `${c.type}|${c.parentId ?? ''}|${c.name.trim().toLowerCase()}`;

/**
 * Group categories with the same type, parent and name (case-insensitive).
 * The oldest category in each group is kept.
 */
export function findDuplicateGroups(categories: Category[]): DuplicateGroup[] {
  const groups = new Map<string, Category[]>();
  for (const c of categories) {
    const key = groupKey(c);
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }

  const result: DuplicateGroup[] = [];
  groups.forEach((list) => {
    if (list.length < 2) return;
    const [keep, ...duplicates] = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    result.push({ keep, duplicates });
  });
  return result.sort((a, b) => a.keep.name.localeCompare(b.keep.name));
}

/** Build the merge plan without writing anything. */
export async function planCategoryMerge(userId: string, categories: Category[]): Promise<CategoryMergePlan> {
  const groups = findDuplicateGroups(categories);
  const idMap: CategoryIdMap = {};
  for (const g of groups) for (const d of g.duplicates) idMap[d.id] = g.keep.id;

  const updates = groups.length > 0 ? await categoryMergeRepository.collectReferenceUpdates(userId, idMap) : [];
  const updateCounts: Record<string, number> = {};
  for (const u of updates) updateCounts[u.collection] = (updateCounts[u.collection] ?? 0) + 1;

  return { groups, idMap, updates, updateCounts };
}

/** Human-readable summary of a plan, for a confirm dialog or the console. */
export function describeCategoryMergePlan(plan: CategoryMergePlan): string {
  const removed = plan.groups.reduce((n, g) => n + g.duplicates.length, 0);
  const lines = [
    `Duplicate groups: ${plan.groups.length}, categories to delete: ${removed}`,
    ...plan.groups.map((g) => `  • ${g.keep.name} (${g.keep.type}) ×${g.duplicates.length + 1}`),
    'Documents to re-point:',
    ...Object.entries(plan.updateCounts).map(([name, n]) => `  • ${name}: ${n}`),
  ];
  if (Object.keys(plan.updateCounts).length === 0) lines.push('  • none');
  return lines.join('\n');
}

/** Re-point every reference to the kept categories, then delete the duplicates. */
export async function executeCategoryMerge(plan: CategoryMergePlan): Promise<void> {
  await categoryMergeRepository.apply(plan.updates, Object.keys(plan.idMap));
}
