# Windows unsigned layout wrapper

`New-A2WindowsLayout.ps1` invokes the shared portable slot stager for Windows,
verifies the closed slot manifest, and emits a clearly named directory ending
in `-unsigned-layout`. It refuses overwrite and creates no archive, installer,
registry entry, service, scheduled task or activation record.

The wrapper requires and forwards the build identity, closed release metadata,
Cargo/npm locks, generated dependency inventories and Node licence input. Their
hashes and normalized release coordinates remain owned by the portable closed
manifest.

The directory is input for a future approved MSI authoring implementation. It
is not an MSI, must not be renamed to imply one, and provides no installation,
Windows confinement, signing or platform-support evidence. WiX remains absent
until its commercial/EULA approval or an alternative author is selected.

Run the focused test where PowerShell and Node.js are available:

```powershell
pwsh -NoProfile -File infra/appliance/windows/Test-A2WindowsLayout.ps1
```
