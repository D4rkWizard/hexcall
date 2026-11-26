; Inno Setup script for Hexhub – compiled by tools/release.js (needs Inno Setup 6).
; Installs per user (no admin rights), so the in-app updater can replace files later.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Hexhub"
#endif

[Setup]
AppId={{3F0C8E2A-7B51-4C3E-9A6D-1E2B5D7C9F40}
AppName=Hexhub
AppVersion={#AppVersion}
AppPublisher=DarkWizard
DefaultDirName={localappdata}\Programs\Hexhub
DefaultGroupName=Hexhub
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputBaseFilename=Hexhub-Setup-{#AppVersion}
SetupIconFile={#SourceDir}\icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Languages]
Name: "en"; MessagesFile: "compiler:Default.isl"
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Desktop shortcut"; GroupDescription: "Additional:"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\Hexhub"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexhub.vbs"""; IconFilename: "{app}\icon.ico"
Name: "{group}\Uninstall Hexhub"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Hexhub"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexhub.vbs"""; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexhub.vbs"""; Description: "Start Hexhub now"; Flags: postinstall nowait skipifsilent

; User data in %APPDATA%\Hexhub and %APPDATA%\Hexcall is intentionally kept on uninstall.
