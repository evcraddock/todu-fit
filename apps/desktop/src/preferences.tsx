import { createContext, useContext, type ReactNode } from "react";
import { call, type WaterSettings } from "./api";
import { LoadError, useLoad } from "./ui";

const PreferencesContext = createContext<WaterSettings | undefined>(undefined);

// Keep the existing synced preference record as the single source of truth.
// Its timezone is shared by all screens, despite the legacy API name.
export function PreferencesProvider({
  revision,
  children,
}: {
  revision: number;
  children: ReactNode;
}) {
  const preferences = useLoad(
    () => call<WaterSettings>({ type: "water_settings_get" }, "water_settings"),
    revision,
  );
  return (
    <>
      <LoadError error={preferences.error} />
      {preferences.data ? (
        <PreferencesContext.Provider value={preferences.data}>
          {children}
        </PreferencesContext.Provider>
      ) : (
        <p>Loading preferences…</p>
      )}
    </>
  );
}

export function usePreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("Preferences are not loaded");
  return preferences;
}
