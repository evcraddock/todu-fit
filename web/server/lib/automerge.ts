/**
 * Server-side Automerge document reader.
 *
 * Connects to the sync server to read Automerge documents.
 * Used for calendar endpoint to read mealplans without user session.
 */

import { Repo, AutomergeUrl } from '@automerge/automerge-repo'
import { WebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'

// Get sync URL from environment or default to localhost
const SYNC_URL = process.env.SYNC_URL || 'ws://localhost:8080'

// Singleton repo instance for server-side reads
let serverRepo: Repo | null = null

/**
 * Get or create a server-side Repo instance.
 * This repo connects to the sync server for read-only access.
 */
function getServerRepo(): Repo {
  if (!serverRepo) {
    console.log('[automerge] Creating server-side repo, connecting to:', SYNC_URL)

    // Create WebSocket client adapter (works in Node.js via isomorphic-ws)
    const wsAdapter = new WebSocketClientAdapter(SYNC_URL)

    serverRepo = new Repo({
      network: [wsAdapter],
      // No storage - server is read-only and doesn't persist
    })

    console.log('[automerge] Server repo created')
  }
  return serverRepo
}

// Helper to extract string value from automerge ImmutableString or plain string
function getString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  if (value && typeof value === 'object' && 'val' in value) {
    return String((value as { val: unknown }).val)
  }
  return null
}

// Document data types
interface GroupDocData {
  name: string
  dishes_doc_id: string
  mealplans_doc_id: string
  shopping_carts_doc_id?: string
}

interface RawDoc {
  data: string | object
}

// Parse the data field which may be a JSON string (CLI format) or object (web format)
function parseDocData<T>(doc: RawDoc | null | undefined): T | null {
  if (!doc || !doc.data) return null

  const stringData = getString(doc.data)
  if (stringData) {
    try {
      return JSON.parse(stringData) as T
    } catch {
      console.error('[automerge] Failed to parse doc data as JSON')
      return null
    }
  }

  if (typeof doc.data === 'object') {
    return doc.data as T
  }

  return null
}

export interface MealPlanEntry {
  id: string
  date: string
  mealType: string
  title: string
  cook: string
  dishIds: string[]
  usesLeftovers: boolean
}

interface CliMealPlan {
  id?: string
  date: string
  meal_type: string
  title: string
  cook: string
  dish_ids: string[]
  uses_leftovers?: boolean
}

/**
 * Load meal plans for a group by its doc ID.
 *
 * @param groupDocId - The bs58check-encoded group document ID
 * @param timeoutMs - Timeout in milliseconds (default 10s)
 * @returns Array of meal plans, or null if failed
 */
export async function loadGroupMealPlans(
  groupDocId: string,
  timeoutMs = 10000
): Promise<MealPlanEntry[] | null> {
  const repo = getServerRepo()

  try {
    // Load the group document to get mealplans_doc_id
    const groupUrl = `automerge:${groupDocId}` as AutomergeUrl
    console.log('[automerge] Loading group document:', groupDocId)

    const groupHandle = await Promise.race([
      repo.find<RawDoc>(groupUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Group document timeout')), timeoutMs)
      ),
    ])

    // Wait for the document to be ready
    await groupHandle.whenReady()

    const rawGroupDoc = groupHandle.doc()
    const groupData = parseDocData<GroupDocData>(rawGroupDoc)

    if (!groupData?.mealplans_doc_id) {
      console.error('[automerge] Group document missing mealplans_doc_id')
      return null
    }

    // Load the mealplans document
    const mealplansUrl = `automerge:${groupData.mealplans_doc_id}` as AutomergeUrl
    console.log('[automerge] Loading mealplans document:', groupData.mealplans_doc_id)

    const mealplansHandle = await Promise.race([
      repo.find<Record<string, CliMealPlan>>(mealplansUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Mealplans document timeout')), timeoutMs)
      ),
    ])

    // Wait for the document to be ready
    await mealplansHandle.whenReady()

    const mealplansDoc = mealplansHandle.doc()
    if (!mealplansDoc) {
      console.log('[automerge] Mealplans document is empty')
      return []
    }

    // Convert CLI format to normalized format
    const mealPlans: MealPlanEntry[] = []
    for (const [id, plan] of Object.entries(mealplansDoc)) {
      if (!plan || typeof plan !== 'object') continue
      if (!('date' in plan) || !('meal_type' in plan)) continue

      mealPlans.push({
        id,
        date: getString(plan.date) || '',
        mealType: getString(plan.meal_type) || '',
        title: getString(plan.title) || '',
        cook: getString(plan.cook) || '',
        dishIds: (plan.dish_ids || []).map((d) => getString(d) || '').filter(Boolean),
        usesLeftovers: plan.uses_leftovers ?? false,
      })
    }

    console.log(`[automerge] Loaded ${mealPlans.length} meal plans`)
    return mealPlans
  } catch (error) {
    console.error('[automerge] Failed to load meal plans:', error)
    return null
  }
}

/**
 * Load dishes for a group by its doc ID.
 *
 * @param groupDocId - The bs58check-encoded group document ID
 * @param timeoutMs - Timeout in milliseconds (default 10s)
 * @returns Map of dish ID to dish data, or null if failed
 */
export async function loadGroupDishes(
  groupDocId: string,
  timeoutMs = 10000
): Promise<Map<string, { name: string; ingredients: string[] }> | null> {
  const repo = getServerRepo()

  try {
    // Load the group document to get dishes_doc_id
    const groupUrl = `automerge:${groupDocId}` as AutomergeUrl
    const groupHandle = await Promise.race([
      repo.find<RawDoc>(groupUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Group document timeout')), timeoutMs)
      ),
    ])

    // Wait for the document to be ready
    await groupHandle.whenReady()

    const rawGroupDoc = groupHandle.doc()
    const groupData = parseDocData<GroupDocData>(rawGroupDoc)

    if (!groupData?.dishes_doc_id) {
      console.error('[automerge] Group document missing dishes_doc_id')
      return null
    }

    // Load the dishes document
    const dishesUrl = `automerge:${groupData.dishes_doc_id}` as AutomergeUrl
    const dishesHandle = await Promise.race([
      repo.find<Record<string, unknown>>(dishesUrl),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Dishes document timeout')), timeoutMs)
      ),
    ])

    // Wait for the document to be ready
    await dishesHandle.whenReady()

    const dishesDoc = dishesHandle.doc()
    if (!dishesDoc) {
      return new Map()
    }

    const dishes = new Map<string, { name: string; ingredients: string[] }>()
    for (const [id, dish] of Object.entries(dishesDoc)) {
      if (!dish || typeof dish !== 'object') continue
      const d = dish as Record<string, unknown>
      dishes.set(id, {
        name: getString(d.name) || getString(d.title) || 'Unknown Dish',
        ingredients: Array.isArray(d.ingredients)
          ? d.ingredients.map((i) => getString(i) || '').filter(Boolean)
          : [],
      })
    }

    return dishes
  } catch (error) {
    console.error('[automerge] Failed to load dishes:', error)
    return null
  }
}
