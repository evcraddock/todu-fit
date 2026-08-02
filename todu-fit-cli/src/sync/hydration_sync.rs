//! Sync-aware hydration repository that reads/writes Automerge documents.
//!
//! This module provides a repository layer that uses the user's personal
//! hydration document. Identity must be initialized first.

use std::path::PathBuf;

use automerge::AutoCommit;
use chrono::NaiveDate;
use uuid::Uuid;

use todu_fit_core::{
    average_daily_ml_in_timezone, daily_total_ml_in_timezone, entries_for_date_in_timezone,
    goal_progress_in_timezone, streak_days_in_timezone, DocumentId, HydrationSettings,
    MultiDocStorage, WaterEntry,
};

use crate::sync::group_context::{resolve_user_context, GroupContextError};
use crate::sync::reader::{
    read_all_water_entries, read_hydration_settings, read_hydration_timezone,
    read_water_entry_by_id, ReaderError,
};
use crate::sync::writer;

#[derive(Debug)]
pub enum SyncHydrationError {
    Reader(ReaderError),
    NotFound(String),
    UserContext(GroupContextError),
    MultiStorage(todu_fit_core::MultiStorageError),
    Validation(String),
}

impl std::fmt::Display for SyncHydrationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SyncHydrationError::Reader(e) => write!(f, "Reader error: {}", e),
            SyncHydrationError::NotFound(id) => write!(f, "Water entry not found: {}", id),
            SyncHydrationError::UserContext(e) => write!(f, "{}", e),
            SyncHydrationError::MultiStorage(e) => write!(f, "Storage error: {}", e),
            SyncHydrationError::Validation(e) => write!(f, "Validation error: {}", e),
        }
    }
}

impl std::error::Error for SyncHydrationError {}

impl From<ReaderError> for SyncHydrationError {
    fn from(e: ReaderError) -> Self {
        SyncHydrationError::Reader(e)
    }
}

impl From<GroupContextError> for SyncHydrationError {
    fn from(e: GroupContextError) -> Self {
        SyncHydrationError::UserContext(e)
    }
}

impl From<todu_fit_core::MultiStorageError> for SyncHydrationError {
    fn from(e: todu_fit_core::MultiStorageError) -> Self {
        SyncHydrationError::MultiStorage(e)
    }
}

#[allow(dead_code)]
pub struct SyncHydrationRepository {
    storage: MultiDocStorage,
    data_dir: PathBuf,
}

#[allow(dead_code)]
impl SyncHydrationRepository {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            storage: MultiDocStorage::new(data_dir.clone()),
            data_dir,
        }
    }

    fn resolve_doc_id(&self) -> Result<DocumentId, SyncHydrationError> {
        let ctx = resolve_user_context(&self.data_dir)?;
        Ok(ctx.hydration_doc_id)
    }

    fn load_or_create_doc(&self) -> Result<(AutoCommit, DocumentId), SyncHydrationError> {
        let doc_id = self.resolve_doc_id()?;
        let doc = match self.storage.load(&doc_id)? {
            Some(bytes) => AutoCommit::load(&bytes).map_err(|e| {
                SyncHydrationError::Reader(ReaderError::AutomergeError(e.to_string()))
            })?,
            None => AutoCommit::new(),
        };
        Ok((doc, doc_id))
    }

    fn save_doc(
        &self,
        doc: &mut AutoCommit,
        doc_id: &DocumentId,
    ) -> Result<(), SyncHydrationError> {
        let bytes = doc.save();
        self.storage.save(doc_id, &bytes)?;
        Ok(())
    }

    pub fn create_entry(&self, entry: &WaterEntry) -> Result<WaterEntry, SyncHydrationError> {
        entry.validate().map_err(SyncHydrationError::Validation)?;
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::write_water_entry(&mut doc, entry);
        self.save_doc(&mut doc, &doc_id)?;
        self.get_by_id(entry.id)?
            .ok_or_else(|| SyncHydrationError::NotFound(entry.id.to_string()))
    }

    pub fn update_entry(&self, entry: &WaterEntry) -> Result<WaterEntry, SyncHydrationError> {
        self.create_entry(entry)
    }

    pub fn delete_entry(&self, id: Uuid) -> Result<(), SyncHydrationError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::delete_water_entry(&mut doc, id);
        self.save_doc(&mut doc, &doc_id)?;
        Ok(())
    }

    pub fn get_by_id(&self, id: Uuid) -> Result<Option<WaterEntry>, SyncHydrationError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_water_entry_by_id(&doc, id)?)
    }

    pub fn list_entries(&self) -> Result<Vec<WaterEntry>, SyncHydrationError> {
        let (doc, _) = self.load_or_create_doc()?;
        Ok(read_all_water_entries(&doc)?)
    }

    pub fn list_entries_for_date(
        &self,
        date: NaiveDate,
    ) -> Result<Vec<WaterEntry>, SyncHydrationError> {
        let entries = self.list_entries()?;
        let timezone = self.settings_timezone()?;
        Ok(entries_for_date_in_timezone(&entries, date, timezone)
            .into_iter()
            .cloned()
            .collect())
    }

    pub fn get_settings(&self) -> Result<HydrationSettings, SyncHydrationError> {
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        let persisted_timezone = read_hydration_timezone(&doc)?;
        let mut settings = read_hydration_settings(&doc)?.unwrap_or_default();

        if persisted_timezone.is_none() {
            settings.timezone = detected_system_timezone();
            writer::write_hydration_settings(&mut doc, &settings);
            self.save_doc(&mut doc, &doc_id)?;
        }

        Ok(settings)
    }

    pub fn save_settings(
        &self,
        settings: &HydrationSettings,
    ) -> Result<HydrationSettings, SyncHydrationError> {
        settings
            .validate()
            .map_err(SyncHydrationError::Validation)?;
        let (mut doc, doc_id) = self.load_or_create_doc()?;
        writer::write_hydration_settings(&mut doc, settings);
        self.save_doc(&mut doc, &doc_id)?;
        self.get_settings()
    }

    pub fn daily_total_ml(&self, date: NaiveDate) -> Result<i32, SyncHydrationError> {
        let entries = self.list_entries()?;
        Ok(daily_total_ml_in_timezone(
            &entries,
            date,
            self.settings_timezone()?,
        ))
    }

    pub fn goal_progress(&self, date: NaiveDate) -> Result<f64, SyncHydrationError> {
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

    pub fn streak_days(&self, through_date: NaiveDate) -> Result<usize, SyncHydrationError> {
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
    ) -> Result<f64, SyncHydrationError> {
        let entries = self.list_entries()?;
        Ok(average_daily_ml_in_timezone(
            &entries,
            end_date,
            days,
            self.settings_timezone()?,
        ))
    }

    fn settings_timezone(&self) -> Result<chrono_tz::Tz, SyncHydrationError> {
        let settings = self.get_settings()?;
        parse_timezone(&settings.timezone)
    }
}

fn parse_timezone(timezone: &str) -> Result<chrono_tz::Tz, SyncHydrationError> {
    timezone
        .parse()
        .map_err(|_| SyncHydrationError::Validation(format!("Invalid IANA timezone: {}", timezone)))
}

fn detected_system_timezone() -> String {
    iana_time_zone::get_timezone()
        .ok()
        .filter(|timezone| timezone.parse::<chrono_tz::Tz>().is_ok())
        .unwrap_or_else(|| "UTC".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{TimeZone, Utc};
    use tempfile::TempDir;
    use todu_fit_core::{daily_total_ml, goal_progress, ml_from_oz, HydrationUnit};

    struct TestHydrationRepo {
        storage: MultiDocStorage,
        doc_id: DocumentId,
    }

    impl TestHydrationRepo {
        fn new(temp_dir: &TempDir) -> Self {
            Self {
                storage: MultiDocStorage::new(temp_dir.path().to_path_buf()),
                doc_id: DocumentId::new(),
            }
        }

        fn load_or_create_doc(&self) -> AutoCommit {
            match self.storage.load(&self.doc_id).unwrap() {
                Some(bytes) => AutoCommit::load(&bytes).unwrap(),
                None => AutoCommit::new(),
            }
        }

        fn save_doc(&self, doc: &mut AutoCommit) {
            self.storage.save(&self.doc_id, &doc.save()).unwrap();
        }

        fn create_entry(&self, entry: &WaterEntry) -> WaterEntry {
            let mut doc = self.load_or_create_doc();
            writer::write_water_entry(&mut doc, entry);
            self.save_doc(&mut doc);
            read_water_entry_by_id(&self.load_or_create_doc(), entry.id)
                .unwrap()
                .unwrap()
        }

        fn save_settings(&self, settings: &HydrationSettings) -> HydrationSettings {
            let mut doc = self.load_or_create_doc();
            writer::write_hydration_settings(&mut doc, settings);
            self.save_doc(&mut doc);
            read_hydration_settings(&self.load_or_create_doc())
                .unwrap()
                .unwrap()
        }
    }

    #[test]
    fn test_create_and_get_water_entry() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestHydrationRepo::new(&temp_dir);
        let entry = WaterEntry::new(500, Utc::now()).unwrap();

        let created = repo.create_entry(&entry);
        assert_eq!(created.amount_ml, 500);
    }

    #[test]
    fn test_save_settings() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestHydrationRepo::new(&temp_dir);
        let mut settings = HydrationSettings::new(ml_from_oz(80.0), HydrationUnit::Oz);
        settings.timezone = "America/Chicago".to_string();

        let saved = repo.save_settings(&settings);
        assert_eq!(saved.preferred_unit, HydrationUnit::Oz);
        assert_eq!(saved.daily_goal_ml, ml_from_oz(80.0));
        assert_eq!(saved.timezone, "America/Chicago");
    }

    #[test]
    fn test_aggregation_helpers() {
        let temp_dir = TempDir::new().unwrap();
        let repo = TestHydrationRepo::new(&temp_dir);
        let settings = HydrationSettings::new(1000, HydrationUnit::Ml);
        repo.save_settings(&settings);

        let day = chrono::NaiveDate::from_ymd_opt(2026, 4, 8).unwrap();
        let entry1 = WaterEntry::new(
            500,
            Utc.from_utc_datetime(&day.and_hms_opt(9, 0, 0).unwrap()),
        )
        .unwrap();
        let entry2 = WaterEntry::new(
            600,
            Utc.from_utc_datetime(&day.and_hms_opt(12, 0, 0).unwrap()),
        )
        .unwrap();
        repo.create_entry(&entry1);
        repo.create_entry(&entry2);

        let entries = read_all_water_entries(&repo.load_or_create_doc()).unwrap();
        assert_eq!(daily_total_ml(&entries, day), 1100);
        assert!(goal_progress(&entries, day, 1000) > 1.0);
    }
}
