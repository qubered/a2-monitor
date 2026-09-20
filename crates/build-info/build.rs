use std::path::PathBuf;
use std::process::Command;

fn main() {
    let manifest_dir = PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR must be set"),
    );
    let repository_root = manifest_dir
        .parent()
        .and_then(|path| path.parent())
        .expect("a2-build-info must remain under crates/build-info");
    let generator = repository_root.join("scripts/generate-build-identity.mjs");
    let output = Command::new("node")
        .arg(&generator)
        .arg("--check")
        .arg("--cargo-rerun-if-changed")
        .current_dir(repository_root)
        .output()
        .unwrap_or_else(|error| {
            panic!(
                "could not run Node.js build-identity check ({error}); install the repository-pinned Node.js toolchain and run `node scripts/generate-build-identity.mjs`"
            )
        });

    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.starts_with("cargo:rerun-if-changed=") {
            println!("{line}");
        }
    }
    if !output.status.success() {
        let details = String::from_utf8_lossy(&output.stderr);
        panic!(
            "embedded build identity is stale; run `node scripts/generate-build-identity.mjs` before building\n{details}"
        );
    }
}
