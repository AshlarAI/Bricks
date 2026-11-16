//! Cross-platform subprocess helpers for GUI and background execution.
//!
//! On Windows, processes built with `#![windows_subsystem = "windows"]` have no
//! console attached. Spawning child CLI tools without `CREATE_NO_WINDOW` forces
//! Windows to allocate a visible console/Terminal window for every spawn, which
//! flashes on screen and steals window focus (triggering focus-refresh loops).

/// Windows process creation flag (`CREATE_NO_WINDOW`) that runs a child without
/// allocating or attaching a console window.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows process creation flag (`CREATE_NEW_PROCESS_GROUP`).
pub const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;

/// Windows creation flags for detached background jobs: own process group and
/// no console window (`CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW`).
pub const DETACHED_NO_WINDOW: u32 = CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW;

/// Extension trait configuring spawned subprocesses so background commands do
/// not create visible console windows on Windows. No-op on other platforms.
pub trait NoWindowExt {
    /// Suppresses creating a console window on Windows. No-op elsewhere.
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindowExt for std::process::Command {
    #[inline]
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl NoWindowExt for tokio::process::Command {
    #[inline]
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_flags_match_win32_constants() {
        assert_eq!(CREATE_NO_WINDOW, 0x0800_0000);
        assert_eq!(CREATE_NEW_PROCESS_GROUP, 0x0000_0200);
        assert_eq!(DETACHED_NO_WINDOW, 0x0800_0200);
    }

    #[test]
    fn no_window_chains_on_std_and_tokio_commands() {
        let mut std_cmd = std::process::Command::new("echo");
        std_cmd.arg("ok").no_window();

        let mut tokio_cmd = tokio::process::Command::new("echo");
        tokio_cmd.arg("ok").no_window();
    }
}
