//! Reproducible build identity generated from declared repository inputs.

include!("generated.rs");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_identity_is_complete() {
        const {
            assert!(SOURCE_INPUT_COUNT > 0);
            assert!(!VERSION.is_empty());
        }
        assert!(BUILD_ID.starts_with("a2-"));
        assert_eq!(SOURCE_SHA256.len(), 64);
        assert!(SOURCE_SHA256.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(IDENTITY_KIND, "content-addressed-source-inputs");
    }
}
