//! Native Windows effects for the Pocket Relay host boundary.
//!
//! These functions are deliberately not Tauri commands. They are crate-local
//! hooks for a future authenticated gateway integration; exposing them to the
//! WebView would bypass the signed-command and approval boundary.

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum PocketRelayHostError {
    InvalidHttpsUrl,
    UnsupportedPlatform,
    OpenLinkFailed,
    LockWorkstationFailed,
}

pub(crate) fn validate_https_url(url: &str) -> Result<(), PocketRelayHostError> {
    if url.is_empty() || url.len() > 2048 || url.contains('\0') {
        return Err(PocketRelayHostError::InvalidHttpsUrl);
    }
    let Some(authority_and_path) = url.strip_prefix("https://") else {
        return Err(PocketRelayHostError::InvalidHttpsUrl);
    };
    let authority_end = authority_and_path
        .find(['/', '?', '#'])
        .unwrap_or(authority_and_path.len());
    let authority = &authority_and_path[..authority_end];
    if authority.is_empty()
        || authority.contains('@')
        || authority.contains('\\')
        || authority
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(PocketRelayHostError::InvalidHttpsUrl);
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn open_https_link(url: &str) -> Result<(), PocketRelayHostError> {
    use std::ptr::null_mut;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    validate_https_url(url)?;
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let wide_url: Vec<u16> = url.encode_utf16().chain(std::iter::once(0)).collect();
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            wide_url.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(PocketRelayHostError::OpenLinkFailed);
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn open_https_link(url: &str) -> Result<(), PocketRelayHostError> {
    validate_https_url(url)?;
    Err(PocketRelayHostError::UnsupportedPlatform)
}

#[cfg(windows)]
pub(crate) fn lock_interactive_session() -> Result<(), PocketRelayHostError> {
    use windows_sys::Win32::System::Shutdown::LockWorkStation;

    let result = unsafe { LockWorkStation() };
    if result == 0 {
        return Err(PocketRelayHostError::LockWorkstationFailed);
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn lock_interactive_session() -> Result<(), PocketRelayHostError> {
    Err(PocketRelayHostError::UnsupportedPlatform)
}

#[cfg(test)]
mod tests {
    use super::{validate_https_url, PocketRelayHostError};

    #[test]
    fn accepts_only_credential_free_https_urls() {
        assert_eq!(validate_https_url("https://example.com/path?q=1"), Ok(()));
        assert_eq!(
            validate_https_url("http://example.com"),
            Err(PocketRelayHostError::InvalidHttpsUrl)
        );
        assert_eq!(
            validate_https_url("https://user@example.com"),
            Err(PocketRelayHostError::InvalidHttpsUrl)
        );
        assert_eq!(
            validate_https_url("https:///missing-host"),
            Err(PocketRelayHostError::InvalidHttpsUrl)
        );
        assert_eq!(
            validate_https_url("https://example.com\\evil"),
            Err(PocketRelayHostError::InvalidHttpsUrl)
        );
    }
}
