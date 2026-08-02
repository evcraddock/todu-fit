import { FormEvent, useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Link, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, ProtectedRoute, Login, PasskeyRegister, AllowlistAdmin, InviteSuccess, InviteError } from './auth'
import { RepoProvider, RepoLoading, useRepoState } from './repo'
import { ThemeProvider, useTheme } from './theme'
import { deletePasskey, setRootDocId, sendGroupInvite } from './auth/api'
import { DishList, DishDetail, DishForm } from './dishes'
import { MealCalendar, DayView, MealPlanForm, MealLogList, MealLogForm } from './meals'
import { isValidIanaTimezone, WaterPage, useHydration } from './hydration'
import { ConfirmDialog } from './components'
import { CalendarSubscription } from './calendar'

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <RepoProvider>
          <BrowserRouter>
            <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
              <Header />
            <main className="container mx-auto p-4">
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route
                  path="/"
                  element={
                    <ProtectedRoute>
                      <Home />
                    </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <Settings />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dishes"
                element={
                  <ProtectedRoute>
                    <DishList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dishes/new"
                element={
                  <ProtectedRoute>
                    <DishForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dishes/:id"
                element={
                  <ProtectedRoute>
                    <DishDetail />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/dishes/:id/edit"
                element={
                  <ProtectedRoute>
                    <DishForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/meals"
                element={
                  <ProtectedRoute>
                    <MealCalendar />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/meals/plan/new"
                element={
                  <ProtectedRoute>
                    <MealPlanForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/meals/plan/:id/edit"
                element={
                  <ProtectedRoute>
                    <MealPlanForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/meals/shopping"
                element={<Navigate to="/meals" replace />}
              />
              <Route
                path="/meals/:date"
                element={
                  <ProtectedRoute>
                    <DayView />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/log"
                element={
                  <ProtectedRoute>
                    <MealLogList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/water"
                element={
                  <ProtectedRoute>
                    <WaterPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/log/new"
                element={
                  <ProtectedRoute>
                    <MealLogForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/log/:id/edit"
                element={
                  <ProtectedRoute>
                    <MealLogForm />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/log/:date"
                element={
                  <ProtectedRoute>
                    <MealLogList />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/admin/allowlist"
                element={
                  <ProtectedRoute>
                    <AllowlistAdmin />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invite/success"
                element={
                  <ProtectedRoute requireIdentity={false}>
                    <InviteSuccess />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/invite/error"
                element={<InviteError />}
              />
                </Routes>
              </main>
            </div>
          </BrowserRouter>
        </RepoProvider>
      </AuthProvider>
    </ThemeProvider>
  )
}

function Header() {
  const { isAuthenticated, logout } = useAuth()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const closeMobileMenu = () => setMobileMenuOpen(false)

  return (
    <header className="bg-blue-600 dark:bg-slate-800 text-white p-4 transition-colors">
      <div className="container mx-auto flex justify-between items-center">
        <Link to="/" className="text-xl font-bold hover:opacity-90" onClick={closeMobileMenu}>
          Todu Fit
        </Link>
        {isAuthenticated && (
          <>
            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-4">
              <Link
                to="/meals"
                className="text-sm hover:underline py-2"
              >
                Meals
              </Link>
              <Link
                to="/log"
                className="text-sm hover:underline py-2"
              >
                Log
              </Link>
              <Link
                to="/dishes"
                className="text-sm hover:underline py-2"
              >
                Dishes
              </Link>
              <Link
                to="/water"
                className="text-sm hover:underline py-2"
              >
                Water
              </Link>
              <Link
                to="/settings"
                className="text-sm hover:underline py-2"
              >
                Settings
              </Link>
              <button
                onClick={logout}
                className="text-sm bg-blue-700 dark:bg-blue-900 hover:bg-blue-800 dark:hover:bg-blue-950 px-3 py-2 rounded transition-colors"
              >
                Logout
              </button>
            </nav>

            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 min-w-[44px] min-h-[44px] flex items-center justify-center"
              aria-label="Toggle menu"
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </>
        )}
      </div>

      {/* Mobile Navigation Drawer */}
      {isAuthenticated && mobileMenuOpen && (
        <nav className="md:hidden mt-4 pt-4 border-t border-blue-500 dark:border-slate-700">
          <div className="flex flex-col gap-1">
            <Link
              to="/meals"
              onClick={closeMobileMenu}
              className="block px-4 py-3 min-h-[44px] text-base hover:bg-blue-700 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Meals
            </Link>
            <Link
              to="/log"
              onClick={closeMobileMenu}
              className="block px-4 py-3 min-h-[44px] text-base hover:bg-blue-700 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Log
            </Link>
            <Link
              to="/dishes"
              onClick={closeMobileMenu}
              className="block px-4 py-3 min-h-[44px] text-base hover:bg-blue-700 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Dishes
            </Link>
            <Link
              to="/water"
              onClick={closeMobileMenu}
              className="block px-4 py-3 min-h-[44px] text-base hover:bg-blue-700 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Water
            </Link>
            <Link
              to="/settings"
              onClick={closeMobileMenu}
              className="block px-4 py-3 min-h-[44px] text-base hover:bg-blue-700 dark:hover:bg-slate-700 rounded transition-colors"
            >
              Settings
            </Link>
            <button
              onClick={() => {
                closeMobileMenu()
                logout()
              }}
              className="text-left px-4 py-3 min-h-[44px] text-base bg-blue-700 dark:bg-blue-900 hover:bg-blue-800 dark:hover:bg-blue-950 rounded transition-colors mt-2"
            >
              Logout
            </button>
          </div>
        </nav>
      )}
    </header>
  )
}

function Home() {
  const { auth } = useAuth()

  return (
    <div className="py-8 md:py-12">
      <div className="text-center mb-8">
        <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-gray-100">Welcome to Todu Fit</h2>
        <p className="text-gray-600 dark:text-gray-400">Meal planning and nutrition tracking</p>
      </div>

      {/* Quick Access Buttons */}
      <div className="max-w-md mx-auto space-y-4 px-4">
        <Link
          to="/meals"
          className="flex items-center justify-center gap-3 w-full min-h-[56px] px-6 py-4 bg-blue-600 hover:bg-blue-700 text-white text-lg font-medium rounded-xl shadow-md hover:shadow-lg transition-all"
        >
          <span className="text-2xl">🗓️</span>
          <span>Meal Plans</span>
        </Link>
        <Link
          to="/dishes"
          className="flex items-center justify-center gap-3 w-full min-h-[56px] px-6 py-4 bg-green-600 hover:bg-green-700 text-white text-lg font-medium rounded-xl shadow-md hover:shadow-lg transition-all"
        >
          <span className="text-2xl">🍽️</span>
          <span>Dishes</span>
        </Link>
        <Link
          to="/log"
          className="flex items-center justify-center gap-3 w-full min-h-[56px] px-6 py-4 bg-amber-600 hover:bg-amber-700 text-white text-lg font-medium rounded-xl shadow-md hover:shadow-lg transition-all"
        >
          <span className="text-2xl">📝</span>
          <span>Food Log</span>
        </Link>
        <Link
          to="/water"
          className="flex items-center justify-center gap-3 w-full min-h-[56px] px-6 py-4 bg-cyan-600 hover:bg-cyan-700 text-white text-lg font-medium rounded-xl shadow-md hover:shadow-lg transition-all"
        >
          <span className="text-2xl">💧</span>
          <span>Water</span>
        </Link>
      </div>
      
      {auth?.isAdmin && (
        <div className="mt-8 pt-8 border-t border-gray-200 dark:border-gray-700 text-center">
          <h3 className="text-lg font-medium mb-3 text-gray-900 dark:text-gray-100">Admin</h3>
          <Link
            to="/admin/allowlist"
            className="inline-flex items-center px-4 py-3 min-h-[44px] bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            Manage Allowed Users
          </Link>
        </div>
      )}
    </div>
  )
}

function hydrationGoalAmountForUnit(dailyGoalMl: number, unit: 'ml' | 'oz', ozFromMl: (ml: number) => number): string {
  if (unit === 'ml') {
    return String(dailyGoalMl)
  }

  const ounces = Math.round(ozFromMl(dailyGoalMl) * 10) / 10
  return Number.isInteger(ounces) ? String(ounces.toFixed(0)) : String(ounces.toFixed(1))
}

function hydrationPresetEditorValue(presetsMl: number[], unit: 'ml' | 'oz', ozFromMl: (ml: number) => number): string {
  return presetsMl
    .map((preset) => {
      if (unit === 'ml') {
        return String(preset)
      }
      const ounces = Math.round(ozFromMl(preset) * 10) / 10
      return Number.isInteger(ounces) ? ounces.toFixed(0) : ounces.toFixed(1)
    })
    .join(', ')
}

function Settings() {
  const { isReady } = useRepoState()

  if (!isReady) {
    return <RepoLoading />
  }

  return <SettingsContent />
}

function SettingsContent() {
  const { auth, refreshAuth } = useAuth()
  const { currentGroupName, groups } = useRepoState()
  const { theme, setTheme } = useTheme()
  const { settings: hydrationSettings, saveSettings: saveHydrationSettings, helpers: hydrationHelpers } = useHydration()
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isEditingRootDocId, setIsEditingRootDocId] = useState(false)
  const [newRootDocId, setNewRootDocId] = useState('')
  const [isUpdatingRootDocId, setIsUpdatingRootDocId] = useState(false)
  const [waterSettingsUnit, setWaterSettingsUnit] = useState<'ml' | 'oz'>(hydrationSettings.preferredUnit)
  const [waterGoalInput, setWaterGoalInput] = useState(() => hydrationGoalAmountForUnit(hydrationSettings.dailyGoalMl, hydrationSettings.preferredUnit, hydrationHelpers.ozFromMl))
  const [waterPresetInput, setWaterPresetInput] = useState(() => hydrationPresetEditorValue(hydrationSettings.quickAddPresetsMl, hydrationSettings.preferredUnit, hydrationHelpers.ozFromMl))
  const [waterTimezoneInput, setWaterTimezoneInput] = useState(hydrationSettings.timezone)

  // Group invite state
  const [inviteModalGroup, setInviteModalGroup] = useState<{ id: string; name: string; doc_id: string } | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [isSendingInvite, setIsSendingInvite] = useState(false)

  // Passkey delete state
  const [deletePasskeyTarget, setDeletePasskeyTarget] = useState<{ id: string; name: string | null } | null>(null)

  const passkeys = auth?.passkeys || []

  const hydrationPresetKey = hydrationSettings.quickAddPresetsMl.join(',')

  // Get sync URL from environment or compute it
  const syncUrl = import.meta.env.VITE_SYNC_URL ||
    `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/sync`

  const handleChangeRootDocId = async () => {
    if (!newRootDocId.trim()) {
      setMessage({ type: 'error', text: 'Root Doc ID cannot be empty' })
      return
    }

    setIsUpdatingRootDocId(true)
    try {
      await setRootDocId(newRootDocId.trim(), true)
      setMessage({ type: 'success', text: 'Root Doc ID updated! Refreshing...' })
      await refreshAuth()
      setIsEditingRootDocId(false)
      setNewRootDocId('')
      // Reload to reinitialize repo with new root doc
      window.location.reload()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to update Root Doc ID' })
    } finally {
      setIsUpdatingRootDocId(false)
    }
  }

  useEffect(() => {
    setWaterSettingsUnit(hydrationSettings.preferredUnit)
    setWaterGoalInput(hydrationGoalAmountForUnit(hydrationSettings.dailyGoalMl, hydrationSettings.preferredUnit, hydrationHelpers.ozFromMl))
    setWaterPresetInput(hydrationPresetEditorValue(hydrationSettings.quickAddPresetsMl, hydrationSettings.preferredUnit, hydrationHelpers.ozFromMl))
    setWaterTimezoneInput(hydrationSettings.timezone)
  }, [hydrationHelpers.ozFromMl, hydrationPresetKey, hydrationSettings.dailyGoalMl, hydrationSettings.preferredUnit, hydrationSettings.timezone])

  const handleSaveWaterSettings = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const goalValue = Number(waterGoalInput)
    if (!Number.isFinite(goalValue) || goalValue <= 0) {
      setMessage({ type: 'error', text: 'Water goal must be positive' })
      return
    }

    const quickAddValues = waterPresetInput
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
      .map(Number)

    if (quickAddValues.length === 0 || quickAddValues.some((value) => !Number.isFinite(value) || value <= 0)) {
      setMessage({ type: 'error', text: 'Water presets must be a comma-separated list of positive numbers' })
      return
    }

    if (!isValidIanaTimezone(waterTimezoneInput.trim())) {
      setMessage({ type: 'error', text: 'Enter a valid IANA timezone, such as America/Chicago' })
      return
    }

    const dailyGoalMl = waterSettingsUnit === 'ml' ? Math.round(goalValue) : hydrationHelpers.mlFromOz(goalValue)
    const quickAddPresetsMl = quickAddValues.map((value) => waterSettingsUnit === 'ml' ? Math.round(value) : hydrationHelpers.mlFromOz(value))

    try {
      saveHydrationSettings({
        dailyGoalMl,
        preferredUnit: waterSettingsUnit,
        quickAddPresetsMl,
        timezone: waterTimezoneInput.trim(),
      })
      setMessage({ type: 'success', text: 'Water settings saved' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to save water settings' })
    }
  }

  const handlePasskeySuccess = async () => {
    setMessage({ type: 'success', text: 'Passkey registered successfully!' })
    await refreshAuth()
  }

  const handleDeletePasskey = (passkeyId: string, passkeyName: string | null) => {
    setDeletePasskeyTarget({ id: passkeyId, name: passkeyName })
  }

  const confirmDeletePasskey = async () => {
    if (!deletePasskeyTarget) return

    try {
      await deletePasskey(deletePasskeyTarget.id)
      setMessage({ type: 'success', text: 'Passkey deleted successfully!' })
      await refreshAuth()
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete passkey' })
    } finally {
      setDeletePasskeyTarget(null)
    }
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const handleSendInvite = async () => {
    if (!inviteModalGroup || !inviteEmail.trim()) return

    setIsSendingInvite(true)
    try {
      await sendGroupInvite(inviteEmail.trim(), inviteModalGroup.doc_id, inviteModalGroup.name)
      setMessage({ type: 'success', text: `Invitation sent to ${inviteEmail}` })
      setInviteModalGroup(null)
      setInviteEmail('')
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to send invitation' })
    } finally {
      setIsSendingInvite(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-semibold mb-6 text-gray-900 dark:text-gray-100">Settings</h2>

      {/* Appearance */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Appearance</h3>
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</p>
            <div className="flex gap-2">
              <button
                onClick={() => setTheme('light')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  theme === 'light'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Light
              </button>
              <button
                onClick={() => setTheme('dark')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  theme === 'dark'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Dark
              </button>
              <button
                onClick={() => setTheme('system')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  theme === 'system'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                System
              </button>
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {theme === 'system' ? 'Theme will match your system preferences' : `Using ${theme} theme`}
            </p>
          </div>
        </div>
      </div>

      {/* Account Info */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Account</h3>
        <div className="text-gray-600 dark:text-gray-400">
          <p><span className="font-medium text-gray-900 dark:text-gray-100">Email:</span> {auth?.email}</p>
          <p><span className="font-medium text-gray-900 dark:text-gray-100">User ID:</span> {auth?.userId}</p>
        </div>
      </div>

      {/* Sync Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Sync Settings</h3>
        <div className="space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Root Doc ID</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 font-mono truncate">
                {auth?.rootDocId || '(not set)'}
              </p>
            </div>
            {!isEditingRootDocId && (
              <button
                onClick={() => {
                  setIsEditingRootDocId(true)
                  setNewRootDocId('')
                }}
                className="ml-4 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                Change
              </button>
            )}
          </div>

          {isEditingRootDocId && (
            <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <label htmlFor="new-root-doc-id" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                New Root Doc ID
              </label>
              <input
                type="text"
                id="new-root-doc-id"
                value={newRootDocId}
                onChange={(e) => setNewRootDocId(e.target.value)}
                placeholder="Enter root doc ID from CLI"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-mono bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
              />
              <p className="mt-2 text-sm text-amber-600 dark:text-amber-400">
                Warning: Changing your root doc ID will disconnect you from your current data.
              </p>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => {
                    setIsEditingRootDocId(false)
                    setNewRootDocId('')
                  }}
                  className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                  disabled={isUpdatingRootDocId}
                >
                  Cancel
                </button>
                <button
                  onClick={handleChangeRootDocId}
                  disabled={isUpdatingRootDocId || !newRootDocId.trim()}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {isUpdatingRootDocId ? 'Updating...' : 'Confirm Change'}
                </button>
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Sync Server</p>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-mono">{syncUrl}</p>
          </div>

          {currentGroupName && (
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Current Group</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">{currentGroupName}</p>
            </div>
          )}
        </div>
      </div>

      <div id="water-settings" className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors scroll-mt-24">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Water Settings</h3>
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">Preferred unit changes display only. Storage stays canonical in mL.</p>
        <form className="space-y-4" onSubmit={handleSaveWaterSettings}>
          <div>
            <label htmlFor="water-settings-unit" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Preferred display unit
            </label>
            <select
              id="water-settings-unit"
              value={waterSettingsUnit}
              onChange={(event) => {
                const nextUnit = event.target.value as 'ml' | 'oz'
                setWaterSettingsUnit(nextUnit)
                setWaterGoalInput(hydrationGoalAmountForUnit(hydrationSettings.dailyGoalMl, nextUnit, hydrationHelpers.ozFromMl))
                setWaterPresetInput(hydrationPresetEditorValue(hydrationSettings.quickAddPresetsMl, nextUnit, hydrationHelpers.ozFromMl))
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            >
              <option value="oz">oz</option>
              <option value="ml">mL</option>
            </select>
          </div>
          <div>
            <label htmlFor="water-timezone" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Timezone
            </label>
            <input
              id="water-timezone"
              type="text"
              value={waterTimezoneInput}
              onChange={(event) => setWaterTimezoneInput(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 font-mono text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder="America/Chicago"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Use an IANA timezone. Water days and history ranges use this timezone.</p>
          </div>
          <div>
            <label htmlFor="water-goal" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Daily goal ({waterSettingsUnit === 'ml' ? 'mL' : 'oz'})
            </label>
            <input
              id="water-goal"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.1"
              value={waterGoalInput}
              onChange={(event) => setWaterGoalInput(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
          </div>
          <div>
            <label htmlFor="water-presets" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Quick-add presets ({waterSettingsUnit === 'ml' ? 'mL' : 'oz'})
            </label>
            <input
              id="water-presets"
              type="text"
              value={waterPresetInput}
              onChange={(event) => setWaterPresetInput(event.target.value)}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-3 text-gray-900 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
              placeholder={waterSettingsUnit === 'ml' ? '237, 355, 473, 710' : '8, 12, 16, 24'}
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Enter a comma-separated list of positive numbers.</p>
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-gray-900 px-4 py-3 font-medium text-white transition-colors hover:bg-black dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Save water settings
          </button>
        </form>
      </div>

      {/* Groups */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Groups</h3>

        {groups.length > 0 ? (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{group.name}</p>
                  {group.name === currentGroupName && (
                    <p className="text-xs text-green-600 dark:text-green-400">Current group</p>
                  )}
                </div>
                <button
                  onClick={() => setInviteModalGroup(group)}
                  className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
                >
                  Invite
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400">
            No groups found. Create an identity to get started.
          </p>
        )}
      </div>

      {/* Invite Modal */}
      {inviteModalGroup && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">
              Invite to "{inviteModalGroup.name}"
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Enter the email address of the person you want to invite. They'll receive an email with a link to join this group.
            </p>
            <input
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="email@example.com"
              disabled={isSendingInvite}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setInviteModalGroup(null)
                  setInviteEmail('')
                }}
                disabled={isSendingInvite}
                className="px-4 py-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleSendInvite}
                disabled={isSendingInvite || !inviteEmail.trim()}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
              >
                {isSendingInvite ? 'Sending...' : 'Send Invitation'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Calendar Subscription */}
      {groups.length > 0 && currentGroupName && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6 transition-colors">
          <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Calendar</h3>
          {(() => {
            const currentGroup = groups.find(g => g.name === currentGroupName)
            if (!currentGroup) return <p className="text-gray-500">No current group selected</p>
            return (
              <CalendarSubscription
                groupDocId={currentGroup.doc_id}
                groupName={currentGroup.name}
              />
            )
          })()}
        </div>
      )}

      {/* Passkeys */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 transition-colors">
        <h3 className="text-lg font-medium mb-4 text-gray-900 dark:text-gray-100">Passkeys</h3>

        {message && (
          <div
            className={`mb-4 p-3 rounded-lg ${
              message.type === 'success'
                ? 'bg-green-100 dark:bg-green-900/30 border border-green-300 dark:border-green-700 text-green-700 dark:text-green-400'
                : 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-400'
            }`}
          >
            {message.text}
          </div>
        )}

        {passkeys.length > 0 ? (
          <div className="mb-6">
            <p className="text-gray-600 dark:text-gray-400 mb-4">Your registered passkeys:</p>
            <ul className="space-y-3">
              {passkeys.map((passkey) => (
                <li key={passkey.id} className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100">{passkey.name || 'Unnamed passkey'}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Added {formatDate(passkey.created_at)}
                      {passkey.last_used_at && ` · Last used ${formatDate(passkey.last_used_at)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDeletePasskey(passkey.id, passkey.name)}
                    className="text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 text-sm"
                  >
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            No passkeys registered. Add one to sign in faster next time.
          </p>
        )}

        <PasskeyRegister
          onSuccess={handlePasskeySuccess}
          onError={(error) => setMessage({ type: 'error', text: error })}
        />
      </div>

      <ConfirmDialog
        isOpen={deletePasskeyTarget !== null}
        title="Delete Passkey"
        message={deletePasskeyTarget?.name
          ? `Delete passkey "${deletePasskeyTarget.name}"?`
          : 'Delete this passkey?'}
        onConfirm={confirmDeletePasskey}
        onCancel={() => setDeletePasskeyTarget(null)}
      />
    </div>
  )
}

export default App
