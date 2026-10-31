using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class AetherCurve {
  // shortcut: private NVAPI V/F layouts verified on Ampere; reject writes on other architectures.
  const int MaskSize=6188, StatusSize=7208, ControlSize=9248;
  public class Point { public int index, voltageUV, frequencyKHz, deltaKHz; }
  [DllImport("nvapi64.dll",CallingConvention=CallingConvention.Cdecl)] static extern IntPtr nvapi_QueryInterface(uint id);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Init();
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int EnumGpu([Out]IntPtr[] handles,out int count);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int Query(IntPtr gpu,IntPtr buffer);
  [UnmanagedFunctionPointer(CallingConvention.Cdecl)] delegate int ErrorText(int code,StringBuilder text);
  static IntPtr gpu;
  static IntPtr Address(uint id) { var p=nvapi_QueryInterface(id); if(p==IntPtr.Zero)throw new InvalidOperationException("NVAPI curve function unavailable");return p; }
  static void Check(int code) {
    if(code==0)return;
    var text=new StringBuilder(64); ((ErrorText)Marshal.GetDelegateForFunctionPointer(Address(0x6C2D048C),typeof(ErrorText)))(code,text);
    throw new InvalidOperationException("NVAPI: "+text+" ("+code+")");
  }
  public static void Initialize() {
    Check(((Init)Marshal.GetDelegateForFunctionPointer(Address(0x0150E828),typeof(Init)))());
    var handles=new IntPtr[64];int count;
    Check(((EnumGpu)Marshal.GetDelegateForFunctionPointer(Address(0xE5AC921F),typeof(EnumGpu)))(handles,out count));
    if(count!=1)throw new InvalidOperationException("Curve editing requires exactly one NVIDIA GPU");gpu=handles[0];
  }
  static byte[] ReadBuffer(uint id,int size,byte[] mask,int version) {
    IntPtr p=Marshal.AllocHGlobal(262144);
    try {
      Marshal.Copy(new byte[262144],0,p,262144);Marshal.WriteInt32(p,size|(version<<16));
      if(mask!=null)Marshal.Copy(mask,0,IntPtr.Add(p,4),mask.Length);
      Check(((Query)Marshal.GetDelegateForFunctionPointer(Address(id),typeof(Query)))(gpu,p));
      var bytes=new byte[size];Marshal.Copy(p,bytes,0,size);return bytes;
    }finally{Marshal.FreeHGlobal(p);}
  }
  static byte[] Mask() { var bytes=ReadBuffer(0x507B4B59,MaskSize,null,1);var mask=new byte[32];Array.Copy(bytes,4,mask,0,32);return mask; }
  static int DeltaPosition(int index) { return 0x64+(index-1)*36+0x18; }
  public static Point[] Read() {
    if(BitConverter.ToInt32(ReadBuffer(0xD8265D24,16,null,2),4)!=0x170)throw new InvalidOperationException("V/F curve layout currently validated only for Ampere GPUs");
    var mask=Mask();var status=ReadBuffer(0x21537AD4,StatusSize,mask,1);var control=ReadBuffer(0x23F1B133,ControlSize,mask,1);
    var points=new List<Point>();int prior=0;
    for(int offset=0x40;offset+28<=status.Length;offset+=28) {
      int domain=BitConverter.ToInt32(status,offset+4),frequency=BitConverter.ToInt32(status,offset+8),voltage=BitConverter.ToInt32(status,offset+12),index=points.Count;
      if(domain!=0||voltage<300000||voltage>1300000||voltage<=prior)break;
      if(index>=200||frequency<20000||frequency>3500000||(mask[index/8]&(1<<(index%8)))==0)throw new InvalidOperationException("Unrecognized NVIDIA curve layout");
      int delta=index==0?0:BitConverter.ToInt32(control,DeltaPosition(index));
      if(Math.Abs((long)delta)>1000000)throw new InvalidOperationException("Curve delta outside validated bounds");
      points.Add(new Point{index=index,voltageUV=voltage,frequencyKHz=frequency,deltaKHz=delta});prior=voltage;
    }
    if(points.Count<60)throw new InvalidOperationException("GPU curve is incomplete");return points.ToArray();
  }
  public static int VoltageUV() { return BitConverter.ToInt32(ReadBuffer(0x465F9BCF,76,null,1),0x28); }
  public static int[] Plan(Point[] points,double millivolts,int megahertz) {
    if(points==null||points.Length<60||millivolts<650||millivolts>1000||megahertz<600||megahertz>2500||megahertz%15!=0)throw new ArgumentException("Choose 650–1000 mV and a 600–2500 MHz target in 15 MHz steps");
    int anchor=-1;double distance=double.MaxValue;
    for(int i=1;i<points.Length;i++){double d=Math.Abs(points[i].voltageUV-millivolts*1000);if(d<distance){distance=d;anchor=i;}}
    if(anchor<1||distance>3125)throw new ArgumentException("Requested voltage is not on the GPU curve");
    int target=checked(megahertz*1000);
    if(target<points[anchor-1].frequencyKHz||target>points[anchor].frequencyKHz+150000)throw new ArgumentException("Target must retain curve order and be within +150 MHz of the selected anchor");
    var deltas=new int[points.Length];
    for(int i=0;i<points.Length;i++) {
      deltas[i]=i<anchor?points[i].deltaKHz:checked(points[i].deltaKHz+target-points[i].frequencyKHz);
      if(Math.Abs((long)deltas[i])>1000000)throw new ArgumentException("Planned curve exceeds validated delta bounds");
    }
    return deltas;
  }
  public static void Write(int[] expected,int[] target) {
    if(BitConverter.ToInt32(ReadBuffer(0xD8265D24,16,null,2),4)!=0x170)throw new InvalidOperationException("Curve writes currently validated only for Ampere GPUs");
    var points=Read();if(expected==null||target==null||points.Length!=expected.Length||points.Length!=target.Length||target[0]!=expected[0])throw new ArgumentException("Curve recovery shape differs");
    for(int i=0;i<points.Length;i++){if(points[i].deltaKHz!=expected[i])throw new InvalidOperationException("Curve changed outside Aether; preserve the backup and review other tuning tools");if(Math.Abs((long)target[i])>1000000)throw new ArgumentOutOfRangeException("target");}
    var mask=Mask();var control=ReadBuffer(0x23F1B133,ControlSize,mask,1);
    for(int i=1;i<points.Length;i++)Array.Copy(BitConverter.GetBytes(target[i]),0,control,DeltaPosition(i),4);
    Array.Copy(BitConverter.GetBytes(ControlSize|(1<<16)),control,4);Array.Copy(mask,0,control,4,32);
    IntPtr p=Marshal.AllocHGlobal(control.Length);
    try{Marshal.Copy(control,0,p,control.Length);Check(((Query)Marshal.GetDelegateForFunctionPointer(Address(0x0733E009),typeof(Query)))(gpu,p));}finally{Marshal.FreeHGlobal(p);}
    var after=Read();for(int i=0;i<target.Length;i++)if(after[i].deltaKHz!=target[i])throw new InvalidOperationException("GPU curve write did not retain requested deltas");
  }
}
