fn main() {
    tauri_build::build();
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "linux") {
        println!("cargo:rustc-link-lib=gbm");
    }
}
