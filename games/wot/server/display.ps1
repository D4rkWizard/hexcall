# Hexcall Hub – Monitor helper for the replay-to-video renderer.
#   -Action list   -> JSON list of all monitors (DXGI adapter/output index, physical pixel coordinates, virtual?)
#   -Action place  -> keeps the World of Tanks window borderless on the given rectangle (physical pixels)
#                     without taking focus, until -Seconds have passed or the game has closed.
param(
  [string]$Action = 'list',
  [int]$Left = 0, [int]$Top = 0, [int]$Width = 1920, [int]$Height = 1080,
  [int]$Seconds = 3600
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class HubDisplay {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct OUTPUT_DESC {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName;
    public RECT Desktop; public int Attached; public int Rotation; public IntPtr Monitor;
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct ADAPTER_DESC {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Description;
    public uint Vendor, Device, SubSys, Revision; public UIntPtr Vram, SysMem, Shared; public long Luid;
  }
  [ComImport, Guid("ae02eedb-c735-4690-8d52-5a8dc20213aa"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIOutput { void a(); void b(); void c(); void d(); [PreserveSig] int GetDesc(out OUTPUT_DESC desc); }
  [ComImport, Guid("2411e7e1-12ac-4ccf-bd14-9798e8534dc0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIAdapter { void a(); void b(); void c(); void d(); [PreserveSig] int EnumOutputs(uint i, out IDXGIOutput o); [PreserveSig] int GetDesc(out ADAPTER_DESC desc); }
  [ComImport, Guid("770aae78-f26f-4dba-a829-253c83d1b387"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IDXGIFactory1 { void a(); void b(); void c(); void d(); [PreserveSig] int EnumAdapters(uint i, out IDXGIAdapter a); }
  [DllImport("dxgi.dll")] static extern int CreateDXGIFactory1(ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IDXGIFactory1 f);
  [DllImport("user32.dll")] static extern IntPtr SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

  public static void DpiAware() { try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { try { SetProcessDPIAware(); } catch { } } }

  static string J(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

  // Windows' own name for the display (e.g. "Virtual Display Driver") – a virtual monitor rendered by the
  // graphics card shows up under the card's name in DXGI, so this is what tells it apart
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct DISPLAY_DEVICE { public int cb; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string DeviceName; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceString; public int StateFlags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceID; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string DeviceKey; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool EnumDisplayDevicesW(string dev, int i, ref DISPLAY_DEVICE d, int flags);
  static string DisplayString(string name) {
    for (int i = 0; ; i++) {
      var d = new DISPLAY_DEVICE(); d.cb = Marshal.SizeOf(d);
      if (!EnumDisplayDevicesW(null, i, ref d, 0)) return "";
      if (d.DeviceName == name) return d.DeviceString;
    }
  }

  public static string List() {
    DpiAware();
    var g = typeof(IDXGIFactory1).GUID; IDXGIFactory1 f;
    if (CreateDXGIFactory1(ref g, out f) != 0) return "[]";
    var sb = new StringBuilder("[");
    bool first = true;
    for (uint ai = 0; ; ai++) {
      IDXGIAdapter ad; if (f.EnumAdapters(ai, out ad) != 0) break;
      ADAPTER_DESC ades; ad.GetDesc(out ades);
      for (uint oi = 0; ; oi++) {
        IDXGIOutput o; if (ad.EnumOutputs(oi, out o) != 0) break;
        OUTPUT_DESC d; o.GetDesc(out d);
        if (!first) sb.Append(","); first = false;
        sb.AppendFormat("{{\"adapter\":{0},\"output\":{1},\"device\":{2},\"adapterName\":{3},\"x\":{4},\"y\":{5},\"w\":{6},\"h\":{7},\"attached\":{8},\"displayName\":{9}}}",
          ai, oi, J(d.DeviceName), J(ades.Description), d.Desktop.L, d.Desktop.T, d.Desktop.R - d.Desktop.L, d.Desktop.B - d.Desktop.T, d.Attached != 0 ? "true" : "false", J(DisplayString(d.DeviceName)));
      }
    }
    return sb.Append("]").ToString();
  }

  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll")] static extern int SetWindowLong(IntPtr h, int i, int v);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint f);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int c);

  // Borderless + exact rectangle, never activates the window (the user keeps working undisturbed)
  public static bool Place(IntPtr h, int x, int y, int w, int hh) {
    const int GWL_STYLE = -16; const int GWL_EXSTYLE = -20; const int FRAME = 0x00CF0000; // WS_OVERLAPPEDWINDOW
    if (IsIconic(h)) ShowWindow(h, 4); // SW_SHOWNOACTIVATE
    int ex = GetWindowLong(h, GWL_EXSTYLE);
    if ((ex & 0x08000000) == 0) SetWindowLong(h, GWL_EXSTYLE, ex | 0x08000000); // WS_EX_NOACTIVATE: clicks/Alt-Tab never focus it
    int st = GetWindowLong(h, GWL_STYLE);
    RECT r; GetWindowRect(h, out r);
    if ((st & FRAME) == 0 && r.L == x && r.T == y && r.R - r.L == w && r.B - r.T == hh) return false;
    SetWindowLong(h, GWL_STYLE, (st & ~FRAME) | unchecked((int)0x80000000)); // WS_POPUP
    SetWindowPos(h, IntPtr.Zero, x, y, w, hh, 0x0010 | 0x0020 | 0x0004 | 0x0040); // NOACTIVATE|FRAMECHANGED|NOZORDER|SHOWWINDOW
    return true;
  }

  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] static extern bool ClipCursor(IntPtr r);
  [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  public static IntPtr Foreground() { return GetForegroundWindow(); }

  // WoT grabbed the focus (and with it mouse + keyboard)? Hand it back to the window the user had before.
  public static bool GiveBack(IntPtr wot, IntPtr prev) {
    if (GetForegroundWindow() != wot) return false;
    ClipCursor(IntPtr.Zero);
    if (prev == IntPtr.Zero || !IsWindow(prev) || !IsWindowVisible(prev)) return false;
    uint pid; uint fgThread = GetWindowThreadProcessId(wot, out pid), me = GetCurrentThreadId();
    AttachThreadInput(me, fgThread, true);
    keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero); // Alt tap: allows the focus change
    bool ok = SetForegroundWindow(prev);
    AttachThreadInput(me, fgThread, false);
    ClipCursor(IntPtr.Zero);
    return ok;
  }
}
'@

if ($Action -eq 'list') {
  [HubDisplay]::List()
  return
}

if ($Action -eq 'place') {
  [HubDisplay]::DpiAware()
  $until = (Get-Date).AddSeconds($Seconds)
  $seen = $false
  $prev = [HubDisplay]::Foreground()   # the user's window before WoT starts
  while ((Get-Date) -lt $until) {
    $p = Get-Process -Name WorldOfTanks -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1
    if ($p) {
      $seen = $true
      $h = $p.MainWindowHandle
      $fg = [HubDisplay]::Foreground()
      if ($fg -ne $h -and $fg -ne [IntPtr]::Zero) { $prev = $fg }
      if ([HubDisplay]::Place($h, $Left, $Top, $Width, $Height)) { Write-Output "placed $($p.Id)" }
      [void][HubDisplay]::GiveBack($h, $prev)
      Start-Sleep -Milliseconds 250
    } else {
      if ($seen -and -not (Get-Process -Name WorldOfTanks -ErrorAction SilentlyContinue)) { break }
      Start-Sleep -Milliseconds 100
    }
  }
}
