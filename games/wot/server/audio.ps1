# Hexcall Hub – audio helper for the replay-to-video renderer.
#   -Action list                     -> JSON: playback devices (id, name, default?)
#   -Action route  -ProcId -Device   -> plays this process on that device (same as Windows' "App volume and device
#                                       preferences"); -Device default sets it back to the Windows default
#   -Action record -Device -Out -Stop-> records what plays on the device (WASAPI loopback) into a WAV file until the
#                                       stop file exists; silence is written as zeros so the WAV stays in sync with time
param(
  [string]$Action = 'list',
  [int]$ProcId = 0,
  [string]$Device = '',
  [string]$Out = '',
  [string]$Stop = ''
)
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class HubAudio {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCo { }
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, int mask, out IMMDeviceCollection c);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice d);
    [PreserveSig] int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice d);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceCollection { [PreserveSig] int GetCount(out uint n); [PreserveSig] int Item(uint i, out IMMDevice d); }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    [PreserveSig] int OpenPropertyStore(int access, out IPropertyStore ps);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
  }
  [StructLayout(LayoutKind.Sequential)] struct PKEY { public Guid g; public int pid; }
  [StructLayout(LayoutKind.Sequential)] struct PV { public ushort vt, r1, r2, r3; public IntPtr p; public IntPtr p2; }
  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore { [PreserveSig] int GetCount(out uint n); [PreserveSig] int GetAt(uint i, out PKEY k); [PreserveSig] int GetValue(ref PKEY k, out PV v); }
  [ComImport, Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioClient {
    [PreserveSig] int Initialize(int share, int flags, long buf, long period, IntPtr fmt, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint n);
    [PreserveSig] int GetStreamLatency(out long l);
    [PreserveSig] int GetCurrentPadding(out uint n);
    [PreserveSig] int IsFormatSupported(int share, IntPtr fmt, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr fmt);
    [PreserveSig] int GetDevicePeriod(out long a, out long b);
    [PreserveSig] int Start();
    [PreserveSig] int Stop();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr h);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [ComImport, Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong pos, out ulong qpc);
    [PreserveSig] int ReleaseBuffer(uint frames);
    [PreserveSig] int GetNextPacketSize(out uint frames);
  }

  static IMMDeviceEnumerator Enum() { return (IMMDeviceEnumerator)new MMDeviceEnumeratorCo(); }
  static string J(string s) { return "\"" + (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

  static string Name(IMMDevice d) {
    IPropertyStore ps; if (d.OpenPropertyStore(0, out ps) != 0) return "";
    var k = new PKEY { g = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
    PV v; if (ps.GetValue(ref k, out v) != 0 || v.p == IntPtr.Zero) return "";
    return Marshal.PtrToStringUni(v.p);
  }

  public static string List() {
    var e = Enum();
    string def = ""; IMMDevice dd; if (e.GetDefaultAudioEndpoint(0, 1, out dd) == 0) dd.GetId(out def);
    IMMDeviceCollection c; e.EnumAudioEndpoints(0, 1, out c); // render, active
    uint n; c.GetCount(out n);
    var sb = new StringBuilder("[");
    for (uint i = 0; i < n; i++) {
      IMMDevice d; c.Item(i, out d); string id; d.GetId(out id);
      if (i > 0) sb.Append(",");
      sb.AppendFormat("{{\"id\":{0},\"name\":{1},\"default\":{2}}}", J(id), J(Name(d)), id == def ? "true" : "false");
    }
    return sb.Append("]").ToString();
  }

  // ---- per-app output device (undocumented Windows API, the same one the Settings app uses) ----
  [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr h);
  [DllImport("combase.dll")] static extern int WindowsDeleteString(IntPtr h);
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr cls, ref Guid iid, out IntPtr f);
  [DllImport("combase.dll")] static extern IntPtr WindowsGetStringRawBuffer(IntPtr h, out uint len);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int SetPersisted(IntPtr self, uint pid, int flow, int role, IntPtr dev);
  [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int GetPersisted(IntPtr self, uint pid, int flow, int role, out IntPtr dev);

  static IntPtr Factory() {
    IntPtr cls; string name = "Windows.Media.Internal.AudioPolicyConfig";
    WindowsCreateString(name, name.Length, out cls);
    var iid = new Guid(Environment.OSVersion.Version.Build >= 21390 ? "ab3d4648-e242-459f-b02f-541c70306324" : "2a59116d-6c4f-45e0-a74f-707e3fef9258");
    IntPtr f; int hr = RoGetActivationFactory(cls, ref iid, out f);
    WindowsDeleteString(cls);
    if (hr != 0) throw new Exception("AudioPolicyConfig nicht verfügbar: 0x" + hr.ToString("X"));
    return f;
  }
  static IntPtr Slot(IntPtr f, int i) { return Marshal.ReadIntPtr(Marshal.ReadIntPtr(f), i * IntPtr.Size); }

  public static string Route(uint pid, string deviceId) {
    IntPtr f = Factory();
    var set = (SetPersisted)Marshal.GetDelegateForFunctionPointer(Slot(f, 25), typeof(SetPersisted));
    var get = (GetPersisted)Marshal.GetDelegateForFunctionPointer(Slot(f, 26), typeof(GetPersisted));
    IntPtr h = IntPtr.Zero;
    if (!string.IsNullOrEmpty(deviceId) && deviceId != "default") {
      string full = "\\\\?\\SWD#MMDEVAPI#" + deviceId + "#{e6327cad-dcec-4949-ae8a-991e976a79d2}";
      WindowsCreateString(full, full.Length, out h);
    }
    int r1 = set(f, pid, 0, 0, h), r2 = set(f, pid, 0, 1, h); // render: console + multimedia
    if (h != IntPtr.Zero) WindowsDeleteString(h);
    IntPtr back; get(f, pid, 0, 1, out back);
    uint len; string now = back == IntPtr.Zero ? "" : Marshal.PtrToStringUni(WindowsGetStringRawBuffer(back, out len));
    return "{\"hr\":[" + r1 + "," + r2 + "],\"now\":" + J(now) + "}";
  }

  // ---- loopback recording ----
  public static void Record(string deviceId, string outFile, string stopFile) {
    var e = Enum(); IMMDevice d;
    if (e.GetDevice(deviceId, out d) != 0) throw new Exception("Audiogerät nicht gefunden");
    var iidC = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"); object o;
    Marshal.ThrowExceptionForHR(d.Activate(ref iidC, 23, IntPtr.Zero, out o));
    var ac = (IAudioClient)o;
    IntPtr fmt; Marshal.ThrowExceptionForHR(ac.GetMixFormat(out fmt));
    int cb = Marshal.ReadInt16(fmt, 16); var fmtBytes = new byte[18 + cb]; Marshal.Copy(fmt, fmtBytes, 0, fmtBytes.Length);
    int rate = Marshal.ReadInt32(fmt, 4), align = Marshal.ReadInt16(fmt, 12);
    Marshal.ThrowExceptionForHR(ac.Initialize(0, 0x00020000, 2000000, 0, fmt, IntPtr.Zero)); // shared, loopback, 200 ms
    var iidCap = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"); object co;
    Marshal.ThrowExceptionForHR(ac.GetService(ref iidCap, out co));
    var cap = (IAudioCaptureClient)co;

    using (var fs = new FileStream(outFile, FileMode.Create, FileAccess.Write, FileShare.Read)) {
      var w = new BinaryWriter(fs);
      w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(0); w.Write(Encoding.ASCII.GetBytes("WAVE"));
      w.Write(Encoding.ASCII.GetBytes("fmt ")); w.Write(fmtBytes.Length); w.Write(fmtBytes);
      w.Write(Encoding.ASCII.GetBytes("data")); long sizePos = fs.Position; w.Write(0);
      long written = 0; var buf = new byte[0]; var zero = new byte[align * rate / 10];
      var sw = Stopwatch.StartNew();
      Marshal.ThrowExceptionForHR(ac.Start());
      Console.WriteLine("START " + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + " " + rate);
      Console.Out.Flush();
      while (!File.Exists(stopFile)) {
        uint next; cap.GetNextPacketSize(out next);
        while (next > 0) {
          IntPtr data; uint frames, flags; ulong pos, qpc;
          cap.GetBuffer(out data, out frames, out flags, out pos, out qpc);
          int bytes = (int)frames * align;
          if (buf.Length < bytes) buf = new byte[bytes];
          if ((flags & 2) != 0) Array.Clear(buf, 0, bytes); else Marshal.Copy(data, buf, 0, bytes);
          w.Write(buf, 0, bytes); written += frames;
          cap.ReleaseBuffer(frames);
          cap.GetNextPacketSize(out next);
        }
        // nothing playing -> Windows delivers no packets: fill the gap with silence so time keeps running
        long expected = (long)(sw.Elapsed.TotalSeconds * rate);
        while (expected - written > rate / 5) { long n = Math.Min(zero.Length / align, expected - written - rate / 20); w.Write(zero, 0, (int)n * align); written += n; }
        Thread.Sleep(10);
      }
      ac.Stop();
      w.Flush();
      long dataBytes = written * align;
      fs.Position = sizePos; w.Write((int)dataBytes);
      fs.Position = 4; w.Write((int)(fs.Length - 8));
    }
    Console.WriteLine("DONE");
  }
}
'@

switch ($Action) {
  'list'   { [HubAudio]::List() }
  'route'  { [HubAudio]::Route([uint32]$ProcId, $Device) }
  'record' { [HubAudio]::Record($Device, $Out, $Stop) }
}
