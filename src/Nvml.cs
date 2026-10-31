using System;
using System.Runtime.InteropServices;
using System.Text;
public static class AetherNvml {
  // NVIDIA's public nvmlClockOffset_v1_t ABI (24 bytes, version 1).
  [StructLayout(LayoutKind.Sequential)] public struct Offset {
    public uint version, type, pstate;
    public int clockOffsetMHz, minClockOffsetMHz, maxClockOffsetMHz;
  }
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlInit_v2();
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlDeviceGetHandleByIndex_v2(uint index, out IntPtr device);
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlDeviceGetUUID(IntPtr device, StringBuilder uuid, uint length);
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlDeviceGetClockOffsets(IntPtr device, ref Offset info);
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlDeviceSetClockOffsets(IntPtr device, ref Offset info);
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern int nvmlDeviceGetTemperature(IntPtr device, uint sensor, out uint value);
  [DllImport("nvml.dll", CallingConvention=CallingConvention.Cdecl)] static extern IntPtr nvmlErrorString(int result);
  static IntPtr gpu;
  static void Check(int code) { if(code != 0) throw new InvalidOperationException(Marshal.PtrToStringAnsi(nvmlErrorString(code)) + " (NVML " + code + ")"); }
  public static string Initialize() {
    Check(nvmlInit_v2()); Check(nvmlDeviceGetHandleByIndex_v2(0, out gpu));
    var uuid=new StringBuilder(96); Check(nvmlDeviceGetUUID(gpu, uuid, 96)); return uuid.ToString();
  }
  public static Offset Read(uint type, uint pstate) {
    var info=new Offset { version=24u | (1u << 24), type=type, pstate=pstate };
    Check(nvmlDeviceGetClockOffsets(gpu, ref info)); return info;
  }
  public static Offset Write(uint type, uint pstate, int value) {
    if((type!=0 && type!=2) || (pstate!=0 && pstate!=2)) throw new ArgumentException("Unsupported clock domain");
    var info=Read(type,pstate);
    if(value<info.minClockOffsetMHz || value>info.maxClockOffsetMHz) throw new ArgumentOutOfRangeException("value", "Offset exceeds the GPU driver's range");
    info.clockOffsetMHz=value; Check(nvmlDeviceSetClockOffsets(gpu,ref info));
    var after=Read(type,pstate);
    // NVIDIA can quantize odd VRAM MHz requests; the caller journals the actual applied value.
    if(after.clockOffsetMHz!=value && !(type==2 && Math.Abs(after.clockOffsetMHz-value)==1)) throw new InvalidOperationException("GPU offset read-back did not match");
    return after;
  }
  public static uint Temperature() { uint value; Check(nvmlDeviceGetTemperature(gpu,0,out value)); return value; }
}
