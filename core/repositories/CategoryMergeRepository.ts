import {
  collection,
  doc,
  getDocsFromServer,
  query,
  where,
  writeBatch,
  DocumentReference,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { FIREBASE_COLLECTIONS } from '@/shared/config/constants';

/** Maps a duplicate category id to the id of the category it is merged into. */
export type CategoryIdMap = Record<string, string>;

export interface CategoryReferenceUpdate {
  ref: DocumentReference;
  collection: string;
  data: Record<string, unknown>;
}

const SINGLE_REF_COLLECTIONS = [
  FIREBASE_COLLECTIONS.TRANSACTIONS,
  FIREBASE_COLLECTIONS.BUDGETS,
  FIREBASE_COLLECTIONS.SCHEDULED_TRANSACTIONS,
  FIREBASE_COLLECTIONS.WISHLIST_ITEMS,
] as const;

// Firestore allows 500 writes per batch
const BATCH_SIZE = 450;

export class CategoryMergeRepository {
  /**
   * Find every document that references one of the duplicate category ids
   * and build the update that points it to the kept category. Reads from the server only.
   */
  async collectReferenceUpdates(userId: string, idMap: CategoryIdMap): Promise<CategoryReferenceUpdate[]> {
    const updates: CategoryReferenceUpdate[] = [];
    const byUser = (name: string) =>
      getDocsFromServer(query(collection(db, name), where('userId', '==', userId)));

    for (const name of SINGLE_REF_COLLECTIONS) {
      const snapshot = await byUser(name);
      for (const d of snapshot.docs) {
        const target = idMap[d.data().categoryId as string];
        if (target) updates.push({ ref: d.ref, collection: name, data: { categoryId: target } });
      }
    }

    const presets = await byUser(FIREBASE_COLLECTIONS.ANALYTICS_PRESETS);
    for (const d of presets.docs) {
      const ids = (d.data().categoryIds as string[] | undefined) ?? [];
      if (!ids.some((id) => idMap[id])) continue;
      const remapped = Array.from(new Set(ids.map((id) => idMap[id] ?? id)));
      updates.push({ ref: d.ref, collection: FIREBASE_COLLECTIONS.ANALYTICS_PRESETS, data: { categoryIds: remapped } });
    }

    const categories = await byUser(FIREBASE_COLLECTIONS.CATEGORIES);
    for (const d of categories.docs) {
      if (idMap[d.id]) continue; // will be deleted
      const target = idMap[d.data().parentId as string];
      if (target) updates.push({ ref: d.ref, collection: FIREBASE_COLLECTIONS.CATEGORIES, data: { parentId: target } });
    }

    return updates;
  }

  /**
   * Apply reference updates, then delete the duplicate categories.
   * Deletes run last so an interrupted run never leaves documents pointing to a missing category.
   */
  async apply(updates: CategoryReferenceUpdate[], duplicateIds: string[]): Promise<void> {
    for (let i = 0; i < updates.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const u of updates.slice(i, i + BATCH_SIZE)) batch.update(u.ref, u.data);
      await batch.commit();
    }
    for (let i = 0; i < duplicateIds.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const id of duplicateIds.slice(i, i + BATCH_SIZE)) {
        batch.delete(doc(db, FIREBASE_COLLECTIONS.CATEGORIES, id));
      }
      await batch.commit();
    }
  }
}

export const categoryMergeRepository = new CategoryMergeRepository();
