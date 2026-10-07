fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(
            tauri_build::AppManifest::new().commands(&[
                "configure_collaboration_proxy",
                "navigate_to_public_room",
            ]),
        ),
    )
    .expect("failed to build Tauri application permissions");
    if std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "linux") {
        println!("cargo:rustc-link-lib=gbm");
    }
}
