use automerge::{
    sync::{Message, State, SyncDoc},
    transaction::Transactable,
    AutoCommit, AutoSerde, ObjType, ReadDoc, ROOT,
};

const DISH_ID: &str = "00000000-0000-4000-8000-000000000001";
const OLD_RUST: &[u8] = include_bytes!("fixtures/rust-0.7.2.automerge");
const OLD_JS: &[u8] = include_bytes!("fixtures/js-3.2.1.automerge");
const NEW_RUST: &[u8] = include_bytes!("fixtures/rust-0.12.0.automerge");
const NEW_JS: &[u8] = include_bytes!("fixtures/js-3.5.0.automerge");

fn verify_fixture(bytes: &[u8], quantity: f64, tag_count: usize) {
    let mut doc = AutoCommit::load(bytes).expect("load synthetic snapshot");
    let original_heads = doc.get_heads();
    let original_changes: Vec<_> = doc.get_changes(&[]).iter().map(|c| c.hash()).collect();
    let original_value = serde_json::to_value(AutoSerde::from(&doc)).unwrap();

    let (_, dish) = doc.get(ROOT, DISH_ID).unwrap().unwrap();
    let (name, _) = doc.get(&dish, "name").unwrap().unwrap();
    assert_eq!(name.into_string().unwrap(), "Café 🥗");
    let (_, ingredients) = doc.get(&dish, "ingredients").unwrap().unwrap();
    let (_, ingredient) = doc.get(&ingredients, 0).unwrap().unwrap();
    assert_eq!(
        doc.get(&ingredient, "quantity")
            .unwrap()
            .unwrap()
            .0
            .as_f64(),
        Some(quantity)
    );
    let (_, tags) = doc.get(&dish, "tags").unwrap().unwrap();
    assert_eq!(doc.length(&tags), tag_count);
    let (value, text) = doc.get(ROOT, "_text").unwrap().unwrap();
    assert_eq!(value.as_objtype(), Some(ObjType::Text));
    assert_eq!(doc.text(&text).unwrap(), "Hello 🌍");

    let mut reopened = AutoCommit::load(&doc.save()).unwrap();
    assert_eq!(reopened.get_heads(), original_heads);
    assert_eq!(
        serde_json::to_value(AutoSerde::from(&reopened)).unwrap(),
        original_value
    );
    assert_eq!(
        reopened
            .get_changes(&[])
            .iter()
            .map(|c| c.hash())
            .collect::<Vec<_>>(),
        original_changes
    );

    reopened.put(ROOT, "after_upgrade", "new edit").unwrap();
    let mut edited = AutoCommit::load(&reopened.save()).unwrap();
    let changes: Vec<_> = edited.get_changes(&[]).iter().map(|c| c.hash()).collect();
    assert!(original_changes.iter().all(|hash| changes.contains(hash)));
    assert_eq!(
        edited
            .get(ROOT, "after_upgrade")
            .unwrap()
            .unwrap()
            .0
            .into_string()
            .unwrap(),
        "new edit"
    );
}

#[test]
fn loads_and_edits_pre_upgrade_rust_snapshot_without_losing_history() {
    verify_fixture(OLD_RUST, 2.5, 1);
}

#[test]
fn loads_and_edits_pre_upgrade_javascript_snapshot_without_losing_history() {
    verify_fixture(OLD_JS, 3.5, 2);
}

#[test]
fn loads_and_edits_upgraded_rust_snapshot_without_losing_history() {
    verify_fixture(NEW_RUST, 2.5, 1);
}

#[test]
fn loads_and_edits_upgraded_javascript_snapshot_without_losing_history() {
    verify_fixture(NEW_JS, 3.5, 2);
}

fn synchronize(
    left: &mut AutoCommit,
    right: &mut AutoCommit,
    left_state: &mut State,
    right_state: &mut State,
) {
    for _ in 0..20 {
        let to_right = left.sync().generate_sync_message(left_state);
        let to_left = right.sync().generate_sync_message(right_state);
        let finished = to_right.is_none() && to_left.is_none();
        if let Some(message) = to_right {
            right
                .sync()
                .receive_sync_message(right_state, Message::decode(&message.encode()).unwrap())
                .unwrap();
        }
        if let Some(message) = to_left {
            left.sync()
                .receive_sync_message(left_state, Message::decode(&message.encode()).unwrap())
                .unwrap();
        }
        if finished {
            assert_eq!(left.get_heads(), right.get_heads());
            assert_eq!(
                serde_json::to_value(AutoSerde::from(&*left)).unwrap(),
                serde_json::to_value(AutoSerde::from(&*right)).unwrap()
            );
            return;
        }
    }
    panic!("sync did not reach equal heads and quiesce");
}

#[test]
fn syncs_old_client_snapshots_after_concurrent_edits_and_state_reset() {
    let mut left = AutoCommit::load(OLD_RUST).unwrap();
    let mut right = AutoCommit::load(OLD_JS).unwrap();
    left.put(ROOT, "rust_edit", "offline Rust edit").unwrap();
    right.put(ROOT, "js_edit", "offline JS edit").unwrap();
    let mut left_state = State::new();
    let mut right_state = State::new();
    synchronize(&mut left, &mut right, &mut left_state, &mut right_state);
    assert_eq!(
        left.get(ROOT, "js_edit")
            .unwrap()
            .unwrap()
            .0
            .into_string()
            .unwrap(),
        "offline JS edit"
    );
    assert_eq!(
        right
            .get(ROOT, "rust_edit")
            .unwrap()
            .unwrap()
            .0
            .into_string()
            .unwrap(),
        "offline Rust edit"
    );
    synchronize(&mut left, &mut right, &mut State::new(), &mut State::new());
}
