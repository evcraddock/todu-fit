//! Synchronous binding called exclusively on Electron's dedicated storage worker.
//! Core owns all document creation, domain operations and persistence.
use fs2::FileExt;
use napi::{Error, Result};
use napi_derive::napi;
use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
};
use todu_fit_core::{Dish, DishRepository, Identity, IdentityState, MultiDocStorage};

fn storage_error(_: impl std::fmt::Display) -> Error {
    Error::from_reason("STORAGE: Local storage operation failed")
}

#[napi(object)]
pub struct DishSummary {
    pub id: String,
    pub name: String,
}

fn summary(dish: Dish) -> DishSummary {
    DishSummary {
        id: dish.id.to_string(),
        name: dish.name,
    }
}

#[napi]
pub struct Session {
    repository: Option<DishRepository>,
    lock: Option<File>,
}

#[napi]
impl Session {
    #[napi(constructor)]
    pub fn new(data_root: String) -> Result<Self> {
        let path = PathBuf::from(data_root);
        if !path.is_absolute() {
            return Err(Error::from_reason(
                "INVALID_INPUT: Absolute storage path required",
            ));
        }
        fs::create_dir_all(&path).map_err(storage_error)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(path.join(".desktop.lock"))
            .map_err(storage_error)?;
        lock.try_lock_exclusive()
            .map_err(|_| Error::from_reason("STORE_BUSY: Storage is already open"))?;
        let identity = Identity::new(MultiDocStorage::new(path.clone()));
        if matches!(identity.state(), IdentityState::Uninitialized) {
            // Refuse to replace a damaged or unrelated store.
            if fs::read_dir(&path).map_err(storage_error)?.any(|entry| {
                entry
                    .map(|e| e.file_name() != ".desktop.lock")
                    .unwrap_or(true)
            }) {
                return Err(Error::from_reason(
                    "STORAGE: Refusing to initialize a nonempty store",
                ));
            }
            identity.initialize_new().map_err(storage_error)?;
            identity.create_group("Desktop").map_err(storage_error)?;
        }
        // Validate existing identity/group before accepting operations.
        let repository = DishRepository::new(path);
        repository.list().map_err(storage_error)?;
        Ok(Self {
            repository: Some(repository),
            lock: Some(lock),
        })
    }

    #[napi]
    pub fn list_dishes(&self) -> Result<Vec<DishSummary>> {
        self.repository
            .as_ref()
            .ok_or_else(|| Error::from_reason("CLOSED: Session closed"))?
            .list()
            .map(|items| items.into_iter().map(summary).collect())
            .map_err(storage_error)
    }

    #[napi]
    pub fn create_dish(&self, name: String) -> Result<DishSummary> {
        let name = name.trim();
        if name.is_empty() || name.len() > 512 {
            return Err(Error::from_reason(
                "INVALID_INPUT: Dish name must be 1–512 UTF-8 bytes",
            ));
        }
        self.repository
            .as_ref()
            .ok_or_else(|| Error::from_reason("CLOSED: Session closed"))?
            .create(&Dish::new(name, "desktop"))
            .map(summary)
            .map_err(storage_error)
    }

    #[napi]
    pub fn close(&mut self) {
        self.repository.take();
        self.lock.take();
    }
}
