; Inno Setup script for Hexcall – compiled by tools/release.js (needs Inno Setup 6).
; Installs per user (no admin rights), so the in-app updater can replace files later.
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef SourceDir
  #define SourceDir "..\dist\Hexcall"
#endif

[Setup]
AppId={{6B91C4AC-4D94-4F0F-8AE1-853FD13654DC}
AppName=Hexcall
AppVersion={#AppVersion}
AppPublisher=DarkWizard
DefaultDirName={localappdata}\Programs\Hexcall
DefaultGroupName=Hexcall
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputBaseFilename=Hexcall-Setup-{#AppVersion}
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
Name: "{group}\Hexcall"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexcall.vbs"""; IconFilename: "{app}\icon.ico"
Name: "{group}\Hexcall Guide"; Filename: "{app}\Guide.html"
Name: "{group}\Uninstall Hexcall"; Filename: "{uninstallexe}"
Name: "{userdesktop}\Hexcall"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexcall.vbs"""; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\Hexcall.vbs"""; Description: "Start Hexcall now"; Flags: postinstall nowait skipifsilent

; User data in %APPDATA%\Hexcall is intentionally kept on uninstall.
