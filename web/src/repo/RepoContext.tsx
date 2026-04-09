import { useEffect, useState, useCallback, ReactNode, createContext, useContext } from 'react'
import { Repo, AutomergeUrl, DocHandle } from '@automerge/automerge-repo'
import { IndexedDBStorageAdapter } from '@automerge/automerge-repo-storage-indexeddb'
import { BrowserWebSocketClientAdapter } from '@automerge/automerge-repo-network-websocket'
import { RepoContext as AutomergeRepoContext } from '@automerge/react'
import { useAuth } from '../auth'

// ============================================================================
// Types
// ============================================================================

interface DocUrls {
  dishes: AutomergeUrl
  mealPlans: AutomergeUrl
  mealLogs: AutomergeUrl
  hydration: AutomergeUrl
  shoppingCarts: AutomergeUrl
}

interface GroupRef {
  id: string
  name: string
  doc_id: string
}

interface IdentityDocData {
  schema_version?: number
  meallogs_doc_id: string
  hydration_doc_id?: string
  groups: GroupRef[]
}

// The CLI stores identity/group data as JSON strings in the "data" field
// So the raw Automerge document has: { data: string } where string is JSON
interface RawDoc {
  data: string | object
}

interface GroupDocData {
  schema_version?: number
  name: string
  dishes_doc_id: string
  mealplans_doc_id: string
  shopping_carts_doc_id?: string  // Optional for backwards compatibility
}

// GroupDoc is used when creating new documents from the web app
interface GroupDoc {
  data: GroupDocData
}

// Helper to extract string value from automerge ImmutableString or plain string
// Automerge-rs stores strings as ImmutableString { val: string, [Symbol]: true }
function getString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value
  }
  // Handle Automerge ImmutableString objects (from automerge-rs/CLI)
  if (value && typeof value === 'object' && 'val' in value) {
    return String((value as { val: unknown }).val)
  }
  return null
}

// Parse the data field which may be a JSON string (CLI format) or object (web format)
// CLI stores data as: { data: ImmutableString { val: '{"json":"here"}' } }
// Web stores data as: { data: { json: "here" } }
function parseDocData<T>(doc: RawDoc | null | undefined): T | null {
  if (!doc || !doc.data) return null

  // First, try to extract string from ImmutableString wrapper (CLI format)
  const stringData = getString(doc.data)
  if (stringData) {
    try {
      return JSON.parse(stringData) as T
    } catch {
      console.error('[repo] Failed to parse doc data as JSON:', stringData)
      return null
    }
  }

  // If it's a plain object (web format), return it directly
  if (typeof doc.data === 'object') {
    return doc.data as T
  }

  return null
}

type RepoStatus = 'idle' | 'loading' | 'ready' | 'error' | 'pending_sync'

interface RepoStateContextType {
  isReady: boolean
  status: RepoStatus
  error: string | null
  docUrls: DocUrls | null
  groups: GroupRef[]
  currentGroupName: string | null
}

const RepoStateContext = createContext<RepoStateContextType>({
  isReady: false,
  status: 'idle',
  error: null,
  docUrls: null,
  groups: [],
  currentGroupName: null,
})

// Get sync URL from environment or default to localhost
function getSyncUrl(): string {
  if (import.meta.env.VITE_SYNC_URL) {
    console.log('[sync] Using VITE_SYNC_URL:', import.meta.env.VITE_SYNC_URL)
    return import.meta.env.VITE_SYNC_URL
  }

  // Default to localhost for local development
  const url = 'ws://localhost:8080'
  console.log('[sync] Using default sync URL:', url)
  return url
}

const SYNC_URL = getSyncUrl()
console.log('[sync] Final SYNC_URL:', SYNC_URL)

// ============================================================================
// Helper Functions
// ============================================================================

// Extract the document ID from an AutomergeUrl (strip the "automerge:" prefix)
function getDocIdFromUrl(url: AutomergeUrl): string {
  return url.replace('automerge:', '')
}

// Type helper for repo.create - creates new documents
function createDoc<T>(repo: Repo, initialValue?: T): DocHandle<T> {
  return repo.create<T>(initialValue)
}

// ============================================================================
// Provider Component
// ============================================================================

export function RepoProvider({ children }: { children: ReactNode }) {
  const { auth, isAuthenticated } = useAuth()
  const [repo, setRepo] = useState<Repo | null>(null)
  const [status, setStatus] = useState<RepoStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [docUrls, setDocUrls] = useState<DocUrls | null>(null)
  const [groups, setGroups] = useState<GroupRef[]>([])
  const [currentGroupName, setCurrentGroupName] = useState<string | null>(null)

  // Initialize repo when authenticated
  useEffect(() => {
    if (!isAuthenticated || !auth) {
      if (repo) setRepo(null)
      setStatus('idle')
      setDocUrls(null)
      setGroups([])
      setCurrentGroupName(null)
      return
    }

    // Create repo
    console.log('[sync] Creating Repo with WebSocket adapter:', SYNC_URL)
    const wsAdapter = new BrowserWebSocketClientAdapter(SYNC_URL)

    const newRepo = new Repo({
      storage: new IndexedDBStorageAdapter(),
      network: [wsAdapter],
    })

    console.log('[sync] Repo created successfully')
    setRepo(newRepo)
    setStatus('loading')

    return () => {
      setRepo(null)
    }
  }, [isAuthenticated, auth?.userId])

  // Load identity and group documents
  const loadDocuments = useCallback(async () => {
    if (!repo || !auth?.rootDocId) {
      return
    }

    setStatus('loading')
    setError(null)

    try {
      // Check if this is a new identity joining an invited group
      const pendingInviteGroupDocId = localStorage.getItem('pendingInviteGroupDocId')
      const pendingInviteGroupName = localStorage.getItem('pendingInviteGroupName')
      const pendingInviteGroupRefId = localStorage.getItem('pendingInviteGroupRefId')

      if (pendingInviteGroupDocId && pendingInviteGroupName && pendingInviteGroupRefId) {
        console.log('[repo] Creating new identity with invited group')

        // Create only private documents - meal logs and hydration (empty object, CLI uses flat root-level structure)
        const meallogsHandle = createDoc<Record<string, unknown>>(repo, {})
        const hydrationHandle = createDoc<Record<string, unknown>>(repo, {})
        const meallogsDocId = getDocIdFromUrl(meallogsHandle.url)
        const hydrationDocId = getDocIdFromUrl(hydrationHandle.url)

        // Create the identity document with reference to the invited group
        const identityHandle = createDoc<RawDoc>(repo, {
          data: {
            meallogs_doc_id: meallogsDocId,
            hydration_doc_id: hydrationDocId,
            groups: [
              {
                id: pendingInviteGroupRefId,
                name: pendingInviteGroupName,
                doc_id: pendingInviteGroupDocId,
              },
            ],
          },
        })
        const identityDocId = getDocIdFromUrl(identityHandle.url)

        console.log('[repo] Created identity with invited group:', {
          identity: identityDocId,
          group: pendingInviteGroupDocId,
          meallogs: meallogsDocId,
          hydration: hydrationDocId,
        })

        // Update the rootDocId in the database to match the created document
        try {
          const response = await fetch('/auth/identity', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ root_doc_id: identityDocId }),
          })
          if (!response.ok) {
            console.error('[repo] Failed to update rootDocId:', await response.text())
          }
        } catch (err) {
          console.error('[repo] Failed to update rootDocId:', err)
        }

        // Clear pending data
        localStorage.removeItem('pendingInviteGroupDocId')
        localStorage.removeItem('pendingInviteGroupName')
        localStorage.removeItem('pendingInviteGroupRefId')

        // Load the group document to get the doc URLs
        const groupDocUrl = `automerge:${pendingInviteGroupDocId}` as AutomergeUrl
        const groupHandle = await repo.find<RawDoc>(groupDocUrl)
        const rawGroupDoc = groupHandle.doc()
        const groupData = parseDocData<GroupDocData>(rawGroupDoc)

        if (!groupData) {
          // Wait for group to sync
          setStatus('pending_sync')
          setError('Waiting for group data to sync...')
          return
        }

        // Set document URLs using the group's shared docs + our private meallogs
        const dishesUrl = `automerge:${groupData.dishes_doc_id}` as AutomergeUrl
        const mealPlansUrl = `automerge:${groupData.mealplans_doc_id}` as AutomergeUrl

        // Handle shopping carts - create if doesn't exist
        let shoppingCartsUrl: AutomergeUrl
        if (groupData.shopping_carts_doc_id) {
          shoppingCartsUrl = `automerge:${groupData.shopping_carts_doc_id}` as AutomergeUrl
        } else {
          const shoppingcartsHandle = createDoc<Record<string, unknown>>(repo, {})
          shoppingCartsUrl = shoppingcartsHandle.url
          const shoppingcartsDocId = getDocIdFromUrl(shoppingCartsUrl)
          groupHandle.change((d) => {
            const data = d.data as GroupDocData
            data.shopping_carts_doc_id = shoppingcartsDocId
          })
        }

        setDocUrls({
          dishes: dishesUrl,
          mealPlans: mealPlansUrl,
          mealLogs: meallogsHandle.url,
          hydration: hydrationHandle.url,
          shoppingCarts: shoppingCartsUrl,
        })
        setGroups([{
          id: pendingInviteGroupRefId,
          name: pendingInviteGroupName,
          doc_id: pendingInviteGroupDocId,
        }])
        setCurrentGroupName(pendingInviteGroupName)
        setStatus('ready')
        return
      }

      // Check if this is a new identity that needs to be created
      const pendingGroupName = localStorage.getItem('pendingGroupName')
      const pendingGroupId = localStorage.getItem('pendingGroupId')

      if (pendingGroupName && pendingGroupId) {
        console.log('[repo] Creating new identity documents')

        // Create new documents using repo.create() which generates URLs automatically
        // Use empty objects - CLI uses flat root-level structure (e.g., { "uuid": {...} })
        const dishesHandle = createDoc<Record<string, unknown>>(repo, {})
        const mealplansHandle = createDoc<Record<string, unknown>>(repo, {})
        const meallogsHandle = createDoc<Record<string, unknown>>(repo, {})
        const hydrationHandle = createDoc<Record<string, unknown>>(repo, {})
        const shoppingcartsHandle = createDoc<Record<string, unknown>>(repo, {})

        // Get the generated doc IDs from the URLs
        const dishesDocId = getDocIdFromUrl(dishesHandle.url)
        const mealplansDocId = getDocIdFromUrl(mealplansHandle.url)
        const meallogsDocId = getDocIdFromUrl(meallogsHandle.url)
        const hydrationDocId = getDocIdFromUrl(hydrationHandle.url)
        const shoppingcartsDocId = getDocIdFromUrl(shoppingcartsHandle.url)

        // Create the group document with references to dishes, mealplans, and shoppingcarts
        const groupHandle = createDoc<GroupDoc>(repo, {
          data: {
            name: pendingGroupName,
            dishes_doc_id: dishesDocId,
            mealplans_doc_id: mealplansDocId,
            shopping_carts_doc_id: shoppingcartsDocId,
          },
        })
        const groupDocId = getDocIdFromUrl(groupHandle.url)

        // Create the identity document with references to group, meal logs, and hydration
        const identityHandle = createDoc<RawDoc>(repo, {
          data: {
            meallogs_doc_id: meallogsDocId,
            hydration_doc_id: hydrationDocId,
            groups: [
              {
                id: pendingGroupId,
                name: pendingGroupName,
                doc_id: groupDocId,
              },
            ],
          },
        })
        const identityDocId = getDocIdFromUrl(identityHandle.url)

        console.log('[repo] Created documents:', {
          identity: identityDocId,
          group: groupDocId,
          dishes: dishesDocId,
          mealplans: mealplansDocId,
          meallogs: meallogsDocId,
          hydration: hydrationDocId,
          shoppingcarts: shoppingcartsDocId,
        })

        // Update the rootDocId in the database to match the created document
        try {
          const response = await fetch('/auth/identity', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ root_doc_id: identityDocId }),
          })
          if (!response.ok) {
            console.error('[repo] Failed to update rootDocId:', await response.text())
          }
        } catch (err) {
          console.error('[repo] Failed to update rootDocId:', err)
        }

        // Clear pending data
        localStorage.removeItem('pendingGroupName')
        localStorage.removeItem('pendingGroupId')

        // Set document URLs
        setDocUrls({
          dishes: dishesHandle.url,
          mealPlans: mealplansHandle.url,
          mealLogs: meallogsHandle.url,
          hydration: hydrationHandle.url,
          shoppingCarts: shoppingcartsHandle.url,
        })
        setGroups([{ id: pendingGroupId, name: pendingGroupName, doc_id: groupDocId }])
        setCurrentGroupName(pendingGroupName)
        setStatus('ready')
        return
      }

      // Existing identity - load from sync server
      const rootDocUrl = `automerge:${auth.rootDocId}` as AutomergeUrl
      console.log('[repo] Loading identity document:', rootDocUrl)

      const identityHandle = await repo.find<RawDoc>(rootDocUrl)
      console.log('[repo] Got identity handle')

      // Get the document and parse the data field (CLI stores as JSON string)
      const rawIdentityDoc = identityHandle.doc()
      console.log('[repo] Raw identity doc:', rawIdentityDoc)

      const identityData = parseDocData<IdentityDocData>(rawIdentityDoc)
      console.log('[repo] Parsed identity data:', identityData)

      if (!identityData) {
          // Document exists but has no data - wait for sync
          setStatus('pending_sync')
          setError('Waiting for identity data to sync...')

          // Set up a listener for when the document syncs
          const checkDoc = () => {
            const doc = identityHandle.docSync()
            const parsed = parseDocData<IdentityDocData>(doc)
            if (parsed?.groups && parsed.groups.length > 0) {
              loadDocuments()
            }
          }

          identityHandle.on('change', checkDoc)

          // Also check periodically
          const interval = setInterval(checkDoc, 2000)

          // Clean up after 30 seconds
          setTimeout(() => {
            clearInterval(interval)
            identityHandle.off('change', checkDoc)
            setStatus((current) => {
              if (current === 'pending_sync') {
                setError('Identity document not found. Please check your identity ID.')
                return 'error'
              }
              return current
            })
          }, 30000)

          return
      }

      // identityData is already parsed above
      console.log('[repo] Groups from identity:', identityData.groups)

      // Check for pending group join (from invitation acceptance)
      const pendingJoinGroupDocId = localStorage.getItem('pendingJoinGroupDocId')
      const pendingJoinGroupName = localStorage.getItem('pendingJoinGroupName')

      let updatedGroups = identityData.groups || []

      if (pendingJoinGroupDocId && pendingJoinGroupName) {
        console.log('[repo] Processing pending group join:', pendingJoinGroupName)

        // Check if group already exists in identity
        const groupExists = updatedGroups.some((g: GroupRef) => g.doc_id === pendingJoinGroupDocId)

        if (!groupExists) {
          // Generate a unique ID for this group reference
          const { v4: uuidv4 } = await import('uuid')
          const bs58check = (await import('bs58check')).default
          const groupRefIdBytes = new Uint8Array(16)
          const groupRefUuid = uuidv4()
          const hexStr = groupRefUuid.replace(/-/g, '')
          for (let i = 0; i < 16; i++) {
            groupRefIdBytes[i] = parseInt(hexStr.substr(i * 2, 2), 16)
          }
          const groupRefId = bs58check.encode(groupRefIdBytes)

          // Add group to identity document
          const newGroupRef: GroupRef = {
            id: groupRefId,
            name: pendingJoinGroupName,
            doc_id: pendingJoinGroupDocId,
          }

          // Update the identity document
          identityHandle.change((d) => {
            const data = d.data as IdentityDocData
            if (!data.groups) {
              data.groups = []
            }
            data.groups.push(newGroupRef)
          })

          updatedGroups = [...updatedGroups, newGroupRef]
          console.log('[repo] Added group to identity:', newGroupRef)

          // Update current group to the newly joined group
          try {
            await fetch('/auth/settings/current-group', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ current_group_id: groupRefId }),
            })
          } catch (err) {
            console.error('[repo] Failed to set current group:', err)
          }
        } else {
          console.log('[repo] Group already exists in identity')
        }

        // Clear pending join data
        localStorage.removeItem('pendingJoinGroupDocId')
        localStorage.removeItem('pendingJoinGroupName')
      }

      setGroups(updatedGroups)

      // Find the current group
      let currentGroup: GroupRef | undefined

      // If we just joined a group, use that one
      if (pendingJoinGroupDocId) {
        console.log('[repo] Using newly joined group')
        currentGroup = updatedGroups.find((g: GroupRef) => g.doc_id === pendingJoinGroupDocId)
      } else if (auth.currentGroupId) {
        console.log('[repo] Looking for group with id:', auth.currentGroupId)
        currentGroup = updatedGroups.find((g: GroupRef) => g.id === auth.currentGroupId)
      }

      // If no current group set or not found, use the first one
      if (!currentGroup && updatedGroups.length > 0) {
        console.log('[repo] Using first group')
        currentGroup = updatedGroups[0]
      }

      console.log('[repo] Current group:', currentGroup)

      if (!currentGroup) {
        setStatus('error')
        setError('No groups found in identity. Please create a group.')
        return
      }

      setCurrentGroupName(currentGroup.name)

      // Load the group document - repo.find() returns a Promise in this version
      console.log('[repo] Loading group document:', currentGroup.doc_id)
      const groupDocUrl = `automerge:${currentGroup.doc_id}` as AutomergeUrl
      console.log('[repo] Group URL:', groupDocUrl)

      // Wait for the document with timeout
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Group document sync timeout after 15s')), 15000)
      )

      const groupHandle = await Promise.race([
        repo.find<RawDoc>(groupDocUrl),
        timeoutPromise,
      ]) as DocHandle<RawDoc>
      console.log('[repo] Got group handle')
      const rawGroupDoc = groupHandle.doc()
      console.log('[repo] Raw group doc:', rawGroupDoc)
      const groupData = parseDocData<GroupDocData>(rawGroupDoc)
      console.log('[repo] Parsed group data:', groupData)

      if (!groupData) {
        setStatus('pending_sync')
        setError('Waiting for group data to sync...')
        return
      }

      let hydrationDocId = identityData.hydration_doc_id
      const ensureHydrationDoc = async (docId?: string): Promise<AutomergeUrl> => {
        if (docId) {
          const existingUrl = `automerge:${docId}` as AutomergeUrl
          try {
            const handle = await repo.find(existingUrl)
            const doc = await Promise.race([
              handle.doc(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
            ])
            if (doc) {
              return existingUrl
            }
          } catch {
            console.warn('[repo] Hydration document missing, creating a replacement')
          }
        }

        const hydrationHandle = createDoc<Record<string, unknown>>(repo, {})
        hydrationDocId = getDocIdFromUrl(hydrationHandle.url)
        identityHandle.change((d) => {
          const data = parseDocData<IdentityDocData>(d) ?? {
            meallogs_doc_id: identityData.meallogs_doc_id,
            groups: identityData.groups,
          }
          d.data = {
            ...data,
            hydration_doc_id: hydrationDocId,
          }
        })
        return hydrationHandle.url
      }

      // Pre-fetch data documents - need to explicitly request from network
      const dishesUrl = `automerge:${groupData.dishes_doc_id}` as AutomergeUrl
      const mealPlansUrl = `automerge:${groupData.mealplans_doc_id}` as AutomergeUrl
      const mealLogsUrl = `automerge:${identityData.meallogs_doc_id}` as AutomergeUrl
      const hydrationUrl = await ensureHydrationDoc(hydrationDocId)

      // Shopping carts doc - create if doesn't exist (backwards compatibility)
      let shoppingCartsUrl: AutomergeUrl
      if (groupData.shopping_carts_doc_id) {
        // Try to find the existing document
        const existingUrl = `automerge:${groupData.shopping_carts_doc_id}` as AutomergeUrl
        try {
          const handle = await repo.find(existingUrl)
          // Wait briefly for the document to load
          const doc = await Promise.race([
            handle.doc(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000))
          ])
          if (!doc) throw new Error('doc is null')
          shoppingCartsUrl = existingUrl
        } catch {
          // Document doesn't exist or can't be found - create a new one
          const shoppingcartsHandle = createDoc<Record<string, unknown>>(repo, {})
          shoppingCartsUrl = shoppingcartsHandle.url
          const shoppingcartsDocId = getDocIdFromUrl(shoppingCartsUrl)

          // Update the group document with the new shopping carts doc ID
          groupHandle.change((d) => {
            const data = d.data as GroupDocData
            data.shopping_carts_doc_id = shoppingcartsDocId
          })
        }
      } else {
        // Create new shopping carts doc for existing groups that don't have one
        const shoppingcartsHandle = createDoc<Record<string, unknown>>(repo, {})
        shoppingCartsUrl = shoppingcartsHandle.url
        const shoppingcartsDocId = getDocIdFromUrl(shoppingCartsUrl)

        // Update the group document with the new shopping carts doc ID
        groupHandle.change((d) => {
          const data = d.data as GroupDocData
          data.shopping_carts_doc_id = shoppingcartsDocId
        })
      }

      console.log('[repo] Requesting data documents from network...')

      // Create handles and explicitly request from network
      // repo.find() in v2 returns a Promise that waits for the document to be ready
      // but doesn't automatically request from network for unknown documents
      // We need to use a different approach

      // Try to find documents with a timeout - if they exist locally, great
      // If not, they'll be synced when useDocument renders
      const docTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Data documents not available locally')), 2000)
      )

      try {
        await Promise.race([
          Promise.all([
            repo.find(dishesUrl),
            repo.find(mealPlansUrl),
            repo.find(mealLogsUrl),
            repo.find(hydrationUrl),
            groupData.shopping_carts_doc_id ? repo.find(shoppingCartsUrl) : Promise.resolve(null),
          ]),
          docTimeout,
        ])
        console.log('[repo] Data documents found locally')
      } catch {
        // Documents aren't available locally yet - that's ok
        // The useDocument hooks will trigger the sync when they render
        console.log('[repo] Data documents not local, will sync on demand')
      }

      // Set document URLs
      setDocUrls({
        dishes: dishesUrl,
        mealPlans: mealPlansUrl,
        mealLogs: mealLogsUrl,
        hydration: hydrationUrl,
        shoppingCarts: shoppingCartsUrl,
      })

      setStatus('ready')
    } catch (err) {
      console.error('[repo] Error loading documents:', err)
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to load documents')
    }
  }, [repo, auth?.rootDocId, auth?.currentGroupId])

  // Load documents when repo is ready and we have a root doc ID
  useEffect(() => {
    if (repo && auth?.rootDocId && status === 'loading') {
      loadDocuments()
    }
  }, [repo, auth?.rootDocId, status, loadDocuments])

  const isReady = status === 'ready' && docUrls !== null

  return (
    <RepoStateContext.Provider
      value={{
        isReady,
        status,
        error,
        docUrls,
        groups,
        currentGroupName,
      }}
    >
      {repo ? (
        <AutomergeRepoContext.Provider value={repo}>{children}</AutomergeRepoContext.Provider>
      ) : (
        children
      )}
    </RepoStateContext.Provider>
  )
}

export function useRepoState(): RepoStateContextType {
  return useContext(RepoStateContext)
}

// Re-export the automerge useRepo hook
export { useRepo } from '@automerge/react'
