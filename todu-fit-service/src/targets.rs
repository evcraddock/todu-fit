use crate::{error, storage};
use automerge::{transaction::Transactable, AutoCommit, ReadDoc, ROOT};
use sha2::{Digest, Sha256};
use todu_fit_core::{DocumentId, Identity};
use todu_fit_protocol::{ApiError, ErrorCode, PersonalTargets, TargetProfile};

const PERSONAL: &str = "nutrition_targets";
use todu_fit_core::identity::nutrition_share_key;
const MEMBER: &str = "nutrition_member_";

fn root(identity: &Identity) -> Result<DocumentId, ApiError> {
    identity
        .root_doc_id()
        .map_err(storage)?
        .ok_or_else(|| error(ErrorCode::NotInitialized, "Set up your identity first"))
}
fn group(identity: &Identity, id: &str) -> Result<DocumentId, ApiError> {
    identity
        .list_groups()
        .map_err(storage)?
        .into_iter()
        .find(|g| g.doc_id.to_bs58check() == id)
        .map(|g| g.doc_id)
        .ok_or_else(|| error(ErrorCode::NotFound, "Group not found"))
}
fn load(identity: &Identity, id: DocumentId) -> Result<AutoCommit, ApiError> {
    let bytes = identity
        .storage()
        .load(&id)
        .map_err(storage)?
        .ok_or_else(|| {
            error(
                ErrorCode::PendingSync,
                "Sync this document before editing nutrition targets",
            )
        })?;
    AutoCommit::load(&bytes).map_err(storage)
}
fn read<T: serde::de::DeserializeOwned>(
    doc: &AutoCommit,
    key: &str,
) -> Result<Option<T>, ApiError> {
    doc.get(ROOT, key)
        .map_err(storage)?
        .map(|(v, _)| {
            let raw = v
                .as_str()
                .ok_or_else(|| storage("Invalid nutrition profile"))?;
            serde_json::from_str(raw).map_err(storage)
        })
        .transpose()
}
fn write<T: serde::Serialize>(
    identity: &Identity,
    id: DocumentId,
    key: &str,
    value: Option<&T>,
) -> Result<(), ApiError> {
    let mut doc = load(identity, id)?;
    if let Some(value) = value {
        doc.put(ROOT, key, serde_json::to_string(value).map_err(storage)?)
            .map_err(storage)?;
    } else {
        doc.delete(ROOT, key).map_err(storage)?;
    }
    identity.storage().save(&id, &doc.save()).map_err(storage)
}
pub fn personal(identity: &Identity) -> Result<PersonalTargets, ApiError> {
    let doc = load(identity, root(identity)?)?;
    let groups = identity.list_groups().map_err(storage)?;
    let shared_groups = groups
        .into_iter()
        .filter(|g| {
            doc.keys(ROOT)
                .any(|key| key == nutrition_share_key(&g.doc_id))
        })
        .map(|g| g.doc_id.to_bs58check())
        .collect();
    let mut profile: Option<TargetProfile> = read(&doc, PERSONAL)?;
    if let Some(profile) = &mut profile {
        let settings =
            todu_fit_core::HydrationRepository::new(identity.storage().data_dir().clone())
                .get_settings()
                .map_err(storage)?;
        let oz = (todu_fit_core::oz_from_ml(settings.daily_goal_ml) * 10.).round() / 10.;
        profile.targets.insert(
            todu_fit_protocol::TargetMetric::WaterFlOz,
            todu_fit_protocol::DailyTarget {
                min: Some(oz),
                max: None,
                reference_min: None,
                reference_max: None,
            },
        );
    }
    Ok(PersonalTargets {
        profile,
        shared_groups,
    })
}
// Never publish a personal sync code. Each group gets a distinct, stable slot.
fn member_key(root: DocumentId, group: DocumentId) -> String {
    let hash = Sha256::new()
        .chain_update(b"fit:shared-nutrition:v1")
        .chain_update(root.as_bytes())
        .chain_update(group.as_bytes())
        .finalize();
    format!("{MEMBER}{hash:x}")
}
fn validate(profile: &TargetProfile) -> Result<(), ApiError> {
    if profile.name.trim().is_empty() || profile.name.len() > 200 {
        return Err(error(
            ErrorCode::InvalidInput,
            "Enter a display name (up to 200 bytes)",
        ));
    }
    for target in profile.targets.values() {
        if target.min.is_none() && target.max.is_none()
            || [
                target.min,
                target.max,
                target.reference_min,
                target.reference_max,
            ]
            .into_iter()
            .flatten()
            .any(|v| !v.is_finite() || v < 0.)
            || target.min.zip(target.max).is_some_and(|(lo, hi)| lo > hi)
            || target
                .reference_min
                .zip(target.reference_max)
                .is_some_and(|(lo, hi)| lo > hi)
        {
            return Err(error(
                ErrorCode::InvalidInput,
                "Enter nonnegative targets with a minimum, a maximum, or an ordered range",
            ));
        }
    }
    Ok(())
}
fn check_expected(
    current: Option<&TargetProfile>,
    expected: Option<&TargetProfile>,
) -> Result<(), ApiError> {
    // Water can change in its own settings while a nutrition draft is open.
    let editable = |p: &TargetProfile| {
        let mut p = p.clone();
        p.targets
            .remove(&todu_fit_protocol::TargetMetric::WaterFlOz);
        p
    };
    if current.map(editable) != expected.map(editable) {
        return Err(error(
            ErrorCode::Conflict,
            "Your targets have changed. Reopen Nutrition targets to see the latest values.",
        ));
    }
    Ok(())
}
pub fn save(
    identity: &Identity,
    profile: &TargetProfile,
    expected: Option<&TargetProfile>,
) -> Result<PersonalTargets, ApiError> {
    let mut editable = profile.clone();
    editable
        .targets
        .remove(&todu_fit_protocol::TargetMetric::WaterFlOz);
    validate(&editable)?;
    let id = root(identity)?;
    let state = personal(identity)?;
    check_expected(state.profile.as_ref(), expected)?;
    write(identity, id, PERSONAL, Some(&editable))?;
    let state = personal(identity)?;
    publish(identity, &state)?;
    Ok(state)
}
fn publish(identity: &Identity, state: &PersonalTargets) -> Result<(), ApiError> {
    if let Some(profile) = &state.profile {
        let id = root(identity)?;
        for shared in &state.shared_groups {
            let group = group(identity, shared)?;
            write(identity, group, &member_key(id, group), Some(profile))?;
        }
    }
    Ok(())
}

pub fn publish_water_goal(path: &std::path::Path) -> Result<(), ApiError> {
    let identity = Identity::new(todu_fit_core::MultiDocStorage::new(path.to_owned()));
    publish(&identity, &personal(&identity)?)
}
pub fn share(
    identity: &Identity,
    group_id: &str,
    enabled: bool,
    expected: &TargetProfile,
) -> Result<PersonalTargets, ApiError> {
    let id = root(identity)?;
    let group = group(identity, group_id)?;
    let mut state = personal(identity)?;
    check_expected(state.profile.as_ref(), Some(expected))?;
    write(
        identity,
        group,
        &member_key(id, group),
        if enabled {
            state.profile.as_ref()
        } else {
            None
        },
    )?;
    if enabled {
        state.shared_groups.insert(group_id.to_string());
    } else {
        state.shared_groups.remove(group_id);
    }
    write(
        identity,
        id,
        &nutrition_share_key(&group),
        enabled.then_some(&true),
    )?;
    Ok(state)
}
pub fn members(identity: &Identity, group_id: &str) -> Result<Vec<TargetProfile>, ApiError> {
    let doc = load(identity, group(identity, group_id)?)?;
    let mut members = Vec::<TargetProfile>::new();
    for k in doc.keys(ROOT).filter(|k| k.starts_with(MEMBER)) {
        if let Some(profile) = read(&doc, &k)? {
            members.push(profile);
        }
    }
    members.sort_by_cached_key(|p| p.name.to_lowercase());
    Ok(members)
}

#[cfg(test)]
mod tests {
    use super::*;
    use todu_fit_core::MultiDocStorage;
    use todu_fit_protocol::{DailyTarget, TargetMetric};

    fn identity() -> (tempfile::TempDir, Identity) {
        let dir = tempfile::tempdir().unwrap();
        let identity = Identity::new(MultiDocStorage::new(dir.path().to_owned()));
        identity.initialize_new().unwrap();
        (dir, identity)
    }
    fn copy_group(from: &Identity, to: &Identity, id: DocumentId) {
        let bytes = from.storage().load(&id).unwrap().unwrap();
        to.storage().save(&id, &bytes).unwrap();
    }
    fn profile(name: &str) -> TargetProfile {
        TargetProfile {
            name: name.into(),
            targets: [(
                TargetMetric::FiberG,
                DailyTarget {
                    min: Some(20.),
                    max: None,
                    reference_min: Some(20.),
                    reference_max: Some(30.),
                },
            )]
            .into(),
        }
    }
    #[test]
    fn sharing_only_copies_the_selected_person_and_group() {
        let (_a, a) = identity();
        let (_b, b) = identity();
        let household = a.create_group("Home").unwrap();
        let home = household.to_bs58check();
        let person = profile("Person A");
        assert!(personal(&a).unwrap().profile.is_none());
        let person = save(&a, &person, None).unwrap().profile.unwrap();
        let other = a.create_group("Other").unwrap().to_bs58check();
        assert_eq!(personal(&a).unwrap().profile, Some(person.clone()));
        assert!(members(&a, &home).unwrap().is_empty());
        assert!(members(&b, &home).is_err());
        share(&a, &home, true, &person).unwrap();
        assert!(matches!(
            a.leave_group(&household),
            Err(todu_fit_core::IdentityError::NutritionTargetsShared)
        ));
        b.join_group(household, "Home".to_string()).unwrap();
        copy_group(&a, &b, household);
        assert_eq!(members(&b, &home).unwrap(), std::slice::from_ref(&person));
        assert!(personal(&b).unwrap().profile.is_none());
        let second = profile("Person B");
        let second = save(&b, &second, None).unwrap().profile.unwrap();
        share(&b, &home, true, &second).unwrap();
        copy_group(&b, &a, household);
        let mut updated = person.clone();
        updated.targets.get_mut(&TargetMetric::FiberG).unwrap().min = Some(25.);
        save(&a, &updated, Some(&person)).unwrap();
        assert!(save(&a, &person, Some(&person)).is_err());
        assert_eq!(
            members(&a, &home).unwrap(),
            [updated.clone(), second.clone()]
        );
        assert!(members(&a, &other).unwrap().is_empty());
        let doc = load(&a, household).unwrap();
        let keys: Vec<_> = doc.keys(ROOT).collect();
        assert!(!keys.join("").contains(&root(&a).unwrap().to_bs58check()));
        assert!(!keys
            .iter()
            .any(|k| k == PERSONAL || k == &nutrition_share_key(&household)));
        share(&a, &home, false, &updated).unwrap();
        save(&a, &person, Some(&updated)).unwrap();
        copy_group(&a, &b, household);
        assert_eq!(members(&b, &home).unwrap(), [second]);
        assert!(personal(&a).unwrap().shared_groups.is_empty());
        a.leave_group(&household).unwrap();
    }

    #[test]
    fn water_settings_drive_personal_and_shared_views_even_with_an_open_nutrition_draft() {
        use todu_fit_protocol::{HydrationFields, Operation};
        let (dir, owner) = identity();
        let group = owner.create_group("Household").unwrap().to_bs58check();
        let original = save(&owner, &profile("A"), None).unwrap().profile.unwrap();
        share(&owner, &group, true, &original).unwrap();
        let fields: HydrationFields =
            serde_json::from_value(serde_json::json!({"goal": 72, "unit":"oz", "presets":[]}))
                .unwrap();
        crate::execute(
            dir.path(),
            &crate::Context::default(),
            &Operation::WaterSettingsUpdate { fields },
        )
        .unwrap();
        let water = TargetMetric::WaterFlOz;
        assert_eq!(
            members(&owner, &group).unwrap()[0].targets[&water].min,
            Some(72.)
        );
        let after = save(&owner, &original, Some(&original))
            .unwrap()
            .profile
            .unwrap();
        assert_eq!(after.targets[&water].min, Some(72.));
        assert_eq!(members(&owner, &group).unwrap(), [after]);
        let stored: TargetProfile = read(&load(&owner, root(&owner).unwrap()).unwrap(), PERSONAL)
            .unwrap()
            .unwrap();
        assert!(!stored.targets.contains_key(&water));
    }

    #[test]
    fn invalid_bounds_do_not_replace_the_saved_profile() {
        let (_dir, owner) = identity();
        let saved = profile("Person");
        let saved = save(&owner, &saved, None).unwrap().profile.unwrap();
        let mut invalid = saved.clone();
        invalid.targets.get_mut(&TargetMetric::FiberG).unwrap().max = Some(10.);
        assert!(save(&owner, &invalid, Some(&saved)).is_err());
        assert_eq!(personal(&owner).unwrap().profile, Some(saved));
    }
}
