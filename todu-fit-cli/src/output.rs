//! Buffer command output until the daemon has durably committed the operation.
use std::cell::{Cell, RefCell};
thread_local! { static OVERFLOW: Cell<bool> = const { Cell::new(false) }; }
thread_local! { static CAPTURE: RefCell<Option<String>> = const { RefCell::new(None) }; }
pub fn write(text: String, stderr: bool) {
    CAPTURE.with(|cell| {
        if let Some(output) = cell.borrow_mut().as_mut() {
            if output.len() + text.len() <= 4 * 1024 * 1024 {
                output.push_str(&text);
            } else {
                OVERFLOW.with(|flag| flag.set(true));
            }
        } else if stderr {
            eprint!("{text}");
        } else {
            print!("{text}");
        }
    });
}
pub fn capture<T>(f: impl FnOnce() -> T) -> std::io::Result<(T, String)> {
    struct Reset;
    impl Drop for Reset {
        fn drop(&mut self) {
            CAPTURE.with(|c| {
                c.borrow_mut().take();
            });
        }
    }
    CAPTURE.with(|c| *c.borrow_mut() = Some(String::new()));
    OVERFLOW.with(|flag| flag.set(false));
    let _reset = Reset;
    let value = f();
    let output = CAPTURE.with(|c| c.borrow_mut().take().unwrap());
    if OVERFLOW.with(Cell::get) {
        return Err(std::io::Error::other(
            "Command output exceeds 4 MiB; operation was not committed",
        ));
    }
    Ok((value, output))
}
pub fn read_confirmation(input: &mut String) -> std::io::Result<usize> {
    if CAPTURE.with(|c| c.borrow().is_some()) {
        return Err(std::io::Error::other("Confirmation required: rerun with the command's --force/--yes option after reviewing the operation"));
    }
    std::io::stdin().read_line(input)
}
macro_rules! println { () => { crate::output::write("\n".into(), false) }; ($($arg:tt)*) => { crate::output::write(format!("{}\n", format_args!($($arg)*)), false) }; }
macro_rules! print { ($($arg:tt)*) => { crate::output::write(format!($($arg)*), false) }; }
macro_rules! eprintln { ($($arg:tt)*) => { crate::output::write(format!("{}\n", format_args!($($arg)*)), true) }; }
