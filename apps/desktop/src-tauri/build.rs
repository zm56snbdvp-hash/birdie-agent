fn main() {
    println!("cargo:rerun-if-env-changed=BIRDIE_DESKTOP_BUILD_ID");
    tauri_build::build()
}
