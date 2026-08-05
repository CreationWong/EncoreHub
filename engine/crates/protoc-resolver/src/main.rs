//! Prints the platform-specific vendored `protoc` path for build orchestration.

fn main() {
    match protoc_bin_vendored::protoc_bin_path() {
        Ok(path) => println!("{}", path.display()),
        Err(error) => {
            eprintln!("failed to resolve vendored protoc: {error}");
            std::process::exit(1);
        }
    }
}
