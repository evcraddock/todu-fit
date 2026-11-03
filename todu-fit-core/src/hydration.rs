//! Local hydration repository that reads/writes Automerge documents.
//!
//! Network synchronization remains an explicit caller responsibility.
//!
//! This module provides a repository layer that uses the user's personal
//! hydration document. Identity must be initialized first.

use std::path::PathBuf;

use crate::{ml_from_oz, HydrationUnit};
use automerge::AutoCommit;
use chrono::NaiveDate;
use uuid::Uuid;

use crate::{
    average_daily_ml_in_timezone, daily_total_ml_in_timezone, entries_for_date_in_timezone,
    goal_progress_in_timezone, streak_days_in_timezone, DocumentId, HydrationSettings,
    MultiDocStorage, WaterEntry,
};

use crate::automerge as writer;
use crate::automerge::reader::{
    read_all_water_entries, read_hydration_settings, read_hydration_timezone,
    read_water_entry_by_id, ReaderError,
};
use crate::context::{resolve_user_context, GroupContextError};

#[derive(Debug)]
pub enum HydrationError {
    Reader(ReaderError),
    NotFound(String),
    UserContext(GroupContextError),
    MultiStorage(crate::MultiStorageError),
    Validation(String),
}

impl std::fmt::Display for HydrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            HydrationError::Reader(e) => write!(f, "Reader error: {}", e),
            HydrationError::NotFound(id) => write!(f, "Water entry not found: {}", id),
            HydrationError::UserContext(e) => write!(f, "{}", e),
            HydrationError::MultiStorage(e) => write!(f, "Storage error: {}", e),
            HydrationError::Validation(e) => write!(f, "Validation error: {}", e),
        }
    }
}

impl std::error::Error for HydrationError {}

impl From<ReaderError> for HydrationError {
    fn from(e: ReaderError) -> Self {
        HydrationError::Reader(e)
    }
}

impl From<GroupContextError> for HydrationError {
    fn from(e: GroupContextError) -> Self {
        HydrationError::UserContext(e)
    }
}

impl From<crate::MultiStorageError> for HydrationError {
    fn from(e: crate::MultiStorageError) -> Self {
        HydrationError::MultiStorage(e)
    }
}

/// Parsed settings changes using the existing numeric-unit and normalization rules.
/// Adapters validate their raw timezone input for their own error presentation;
/// repository `save_settings` remains the final settings validation boundary.
#[derive(Default)]
pub struct HydrationSettingsUpdate {
    pub goal: Option<f64>,
    pub unit: Option<HydrationUnit>,
    pub display_unit: Option<HydrationUnit>,
    pub timezone: Option<String>,
    pub presets: Vec<f64>,
}

impl HydrationSettingsUpdate {
    /// Apply values using the original input unit before changing the display unit.
    pub fn apply_to(&self, settings: &mut HydrationSettings) {
        let numeric_unit = self.unit.unwrap_or(settings.preferred_unit);
        let to_ml = |value: f64| match numeric_unit {
            HydrationUnit::Ml => value.round() as i32,
            HydrationUnit::Oz => ml_from_oz(value),
        };
        if let Some(goal) = self.goal {
            settings.daily_goal_ml = to_ml(goal);
        }
        if !self.presets.is_empty() {
            settings.quick_add_presets_ml =
                self.presets.iter().map(|value| to_ml(*value)).collect();
            settings.normalize_presets();
        }
        if let Some(display_unit) = self.display_unit {
            settings.preferred_unit = display_unit;
        }
        if let Some(timezone) = &self.timezone {
            settings.timezone = timezone.clone();
        }
    }
}

/// Local, personal hydration repository with adapter-supplied timezone initialization.
pub struct HydrationRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
    timezone_provider: fn() -> String,
}

impl HydrationRepository {
    /// Construct a portable repository with UTC as the fallback for new/legacy settings.
    /// Platform adapters should supply their existing detector through
    /// `with_timezone_provider`; already persisted timezones are never replaced.
    pub fn new(data_dir: PathBuf) -> Self {
        Self::with_timezone_provider(data_dir, || "UTC".to_string())
    }

    /// Supply the adapter's validated IANA timezone detector. It is called lazily,
    /// only where the existing settings initialization requires a missing timezone.
    pub fn with_timezone_provider(data_dir: PathBuf, timezone_provider: fn() -> String) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
            timezone_provider,
        }
    }

    fn resolve_doc_id(&self) -> Result<DocumentId, HydrationError> {
        let ctx = resolve_user_context(&self.data_dir)?;
        Ok(ctx.hydration_doc_id)
    }

    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), HydrationError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes)
                .map_err(|e| HydrationError::Reader(ReaderError::AutomergeError(e.to_string())))?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    fn save_doc(&self, doc: &mut AutoCommit, doc_id: &DocumentId) -> Result<(), HydrationError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    pub fn create_entry(&self, entry: &WaterEntry) -> Result<WaterEntry, HydrationError> {
        entry.validate().map_err(HydrationError::Validation)?;
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::write_water_entry(&mut doc, entry);
        self.save_doc(&mut doc, &doc_id)?;
        self.get_by_id(entry.id)?
            .ok_or_else(|| HydrationError::NotFound(entry.id.to_string()))
    }

    pub fn update_entry(&self, entry: &WaterEntry) -> Result<WaterEntry, HydrationError> {
        self.create_entry(entry)
    }

    pub fn delete_entry(&self, id: Uuid) -> Result<(), HydrationError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::delete_water_entry(&mut doc, id);
        self.save_doc(&mut doc, &doc_id)?;
        Ok(())
    }

    pub fn get_by_id(&self, id: Uuid) -> Result<Option<WaterEntry>, HydrationError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_water_entry_by_id(&doc, id)?)
    }

    pub fn list_entries(&self) -> Result<Vec<WaterEntry>, HydrationError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_water_entries(&doc)?)
    }

    /// Newest entries first, preserving the existing stable ordering on equal times.
    pub fn recent_entries(&self, limit: usize) -> Result<Vec<WaterEntry>, HydrationError> {
        let mut entries = self.list_entries()?;
        entries.sort_by_key(|entry| std::cmp::Reverse(entry.consumed_at));
        entries.truncate(limit);
        Ok(entries)
    }

    pub fn list_entries_for_date(
        &self,
        date: NaiveDate,
    ) -> Result<Vec<WaterEntry>, HydrationError> {
        let entries = self.list_entries()?;
        let timezone = self.settings_timezone()?;
        Ok(entries_for_date_in_timezone(&entries, date, timezone)
            .into_iter()
            .cloned()
            .collect())
    }

    pub fn get_settings(&self) -> Result<HydrationSettings, HydrationError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        let persisted_timezone = read_hydration_timezone(&doc)?;
        let mut settings = read_hydration_settings(&doc)?.unwrap_or_default();

        if persisted_timezone.is_none() {
            settings.timezone = (self.timezone_provider)();
            writer::write_hydration_settings(&mut doc, &settings);
            self.save_doc(&mut doc, &doc_id)?;
        }

        Ok(settings)
    }

    pub fn save_settings(
        &self,
        settings: &HydrationSettings,
    ) -> Result<HydrationSettings, HydrationError> {
        settings.validate().map_err(HydrationError::Validation)?;
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::write_hydration_settings(&mut doc, settings);
        self.save_doc(&mut doc, &doc_id)?;
        self.get_settings()
    }

    pub fn daily_total_ml(&self, date: NaiveDate) -> Result<i32, HydrationError> {
        let entries = self.list_entries()?;
        Ok(daily_total_ml_in_timezone(
            &entries,
            date,
            self.settings_timezone()?,
        ))
    }

    pub fn goal_progress(&self, date: NaiveDate) -> Result<f64, HydrationError> {
        let entries = self.list_entries()?;
        let settings = self.get_settings()?;
        let timezone = parse_timezone(&settings.timezone)?;
        Ok(goal_progress_in_timezone(
            &entries,
            date,
            settings.daily_goal_ml,
            timezone,
        ))
    }

    pub fn streak_days(&self, through_date: NaiveDate) -> Result<usize, HydrationError> {
        let entries = self.list_entries()?;
        let settings = self.get_settings()?;
        let timezone = parse_timezone(&settings.timezone)?;
        Ok(streak_days_in_timezone(
            &entries,
            through_date,
            settings.daily_goal_ml,
            timezone,
        ))
    }

    pub fn average_daily_ml(
        &self,
        end_date: NaiveDate,
        days: usize,
    ) -> Result<f64, HydrationError> {
        let entries = self.list_entries()?;
        Ok(average_daily_ml_in_timezone(
            &entries,
            end_date,
            days,
            self.settings_timezone()?,
        ))
    }

    fn settings_timezone(&self) -> Result<chrono_tz::Tz, HydrationError> {
        let settings = self.get_settings()?;
        parse_timezone(&settings.timezone)
    }
}

fn parse_timezone(timezone: &str) -> Result<chrono_tz::Tz, HydrationError> {
    timezone
        .parse()
        .map_err(|_| HydrationError::Validation(format!("Invalid IANA timezone: {}", timezone)))
}

/// Inclusive calendar-date filtering in a caller-supplied timezone.
pub fn entries_in_date_range(
    entries: &[WaterEntry],
    from: NaiveDate,
    to: NaiveDate,
    timezone: chrono_tz::Tz,
) -> Vec<WaterEntry> {
    entries
        .iter()
        .filter(|entry| {
            let date = entry.consumed_at.with_timezone(&timezone).date_naive();
            date >= from && date <= to
        })
        .cloned()
        .collect()
}
