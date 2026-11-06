use automerge::{transaction::Transactable, AutoCommit, ObjType, ReadDoc, ROOT};
use todu_fit_core::{
    automerge::{
        delete_dish,
        reader::{read_all_dishes, read_dish_by_id},
    },
    write_dish,
};

const IOS_ID: &str = "550E8400-E29B-41D4-A716-446655440001";
fn ios_dish(quantity: &str) -> AutoCommit {
    let mut doc = AutoCommit::new();
    let obj = doc.put_object(ROOT, IOS_ID, ObjType::Map).unwrap();
    doc.put(&obj, "name", "iOS soup").unwrap();
    let ingredients = doc.put_object(&obj, "ingredients", ObjType::List).unwrap();
    let ingredient = doc.insert_object(&ingredients, 0, ObjType::Map).unwrap();
    doc.put(&ingredient, "name", "Lentils").unwrap();
    doc.put(&ingredient, "quantity", quantity).unwrap();
    doc.put(&ingredient, "unit", "cup").unwrap();
    doc
}
#[test]
fn ios_dish_lookup_update_and_delete_preserve_original_key() {
    let mut doc = ios_dish("0.5");
    let listed = read_all_dishes(&doc).unwrap().remove(0);
    let mut dish = read_dish_by_id(&doc, listed.id)
        .unwrap()
        .expect("uppercase iOS key must resolve");
    dish.name = "Desktop edit".into();
    write_dish(&mut doc, &dish);
    assert_eq!(doc.keys(ROOT).collect::<Vec<_>>(), vec![IOS_ID]);
    assert_eq!(
        read_dish_by_id(&doc, dish.id).unwrap().unwrap().name,
        "Desktop edit"
    );
    delete_dish(&mut doc, dish.id);
    assert_eq!(doc.keys(ROOT).count(), 0);
}
#[test]
fn ios_fraction_quantities_keep_their_numeric_value() {
    for (quantity, expected) in [("1/2", 0.5), ("1 1/2", 1.5), (" 3/4 ", 0.75), ("0.5", 0.5)] {
        assert_eq!(
            read_all_dishes(&ios_dish(quantity)).unwrap()[0].ingredients[0].quantity,
            expected,
            "{quantity}"
        );
    }
}
#[test]
fn unsupported_ios_quantities_are_reported_not_silently_zeroed() {
    for quantity in ["to taste", "1/0", "NaN", "1/inf"] {
        assert!(read_all_dishes(&ios_dish(quantity)).is_err(), "{quantity}");
    }
}
